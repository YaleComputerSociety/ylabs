import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import {
  listResearchEntityMergedInRowsBySurvivor,
  type MergedInResearchEntityRow,
} from '../services/researchEntityCanonicalTombstone';
import { serializedDocumentId } from '../utils/idSerialization';
import {
  shouldIgnoreObservationForEntityMaterialization,
  SURVIVOR_OWNED_RESEARCH_ENTITY_FIELDS,
} from './entityMaterializer';
import {
  invalidatedScrapeRunIds,
  partitionObservationsByInvalidatedRun,
} from './invalidatedScrapeRuns';
import {
  mergedInMemberOf,
  mergedRowEvidenceIdentity,
  mergedRowEvidenceQueryClauses,
  observationBelongsToMergedRow,
  type MergedRowEvidenceIdentity,
} from './mergedRowEvidenceIdentity';
import {
  applyResearchEntityOrgUnitCanonicalization,
  orgUnitMatchKey,
  type OrgUnitCanonicalizer,
} from './orgUnitCanonicalization';
import { liveResearchEntityNamedByKeyObservations } from './renamedResearchEntityAdoption';

export type SchoolCanonicalizer = Pick<OrgUnitCanonicalizer, 'canonicalizeSchool'>;

export interface SchoolBackingObservation {
  entityId?: unknown;
  entityKey?: unknown;
  field?: unknown;
  value?: unknown;
  sourceName?: unknown;
  sourceUrl?: unknown;
  superseded?: unknown;
  scrapeRunId?: unknown;
}

export interface SchoolBackingRow {
  _id?: unknown;
  slug?: unknown;
  school?: unknown;
  departments?: unknown;
  entityType?: unknown;
  websiteUrl?: unknown;
  sourceUrls?: unknown;
}

/**
 * A row's resolved `school` readings, split by whose they are. A merged-in row's reading of a
 * survivor-owned field never reaches the survivor's resolve (`SURVIVOR_OWNED_RESEARCH_ENTITY_FIELDS`,
 * #6096 review), so it is kept apart rather than counted as backing.
 */
export interface ResolvedSchoolReadings {
  own: SchoolBackingObservation[];
  mergedIn: SchoolBackingObservation[];
}

export const STORED_SCHOOL_BACKING_CLASSES = [
  'no-stored-school',
  'school-observation',
  'org-unit-derivation',
  'merged-in-reading-only',
  'never-backed',
] as const;

export type StoredSchoolBackingClass = (typeof STORED_SCHOOL_BACKING_CLASSES)[number];

const SCHOOL_FIELD = 'school';
const RESEARCH_ENTITY_TYPE = 'researchEntity' as const;
const NOT_ROLLED_BACK = { 'rollback.rolledBackAt': { $exists: false } };
const LOADER_CHUNK_SIZE = 500;

const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(textOf).filter(Boolean) : [];

function schoolMatchKeys(value: unknown, canonicalizer: SchoolCanonicalizer): string[] {
  const raw = textOf(value);
  if (!raw) return [];
  const forms = [raw, canonicalizer.canonicalizeSchool(raw).value];
  return [...new Set(forms.map(orgUnitMatchKey).filter(Boolean))];
}

/**
 * Whether any `school` reading states the stored school (#6096), under the same loose
 * comparison the department check uses (#6049): the engine's own org-unit match key over the
 * raw spelling and its canonical school, so a spelling the materializer would have written
 * from that reading never reads as unbacked.
 */
export function storedSchoolIsBacked(
  stored: unknown,
  observations: readonly Pick<SchoolBackingObservation, 'value'>[],
  canonicalizer: SchoolCanonicalizer,
): boolean {
  const storedKeys = new Set(schoolMatchKeys(stored, canonicalizer));
  if (storedKeys.size === 0) return true;
  return observations.some((observation) =>
    schoolMatchKeys(observation.value, canonicalizer).some((key) => storedKeys.has(key)),
  );
}

type OrgUnitCanonicalization = typeof applyResearchEntityOrgUnitCanonicalization;

/**
 * The school the engine's own org-unit canonicalization writes for this row when no reading
 * states one: called exactly as the profile-host backfill calls it, with an empty school, so a
 * cross-school center or institute that the engine leaves without a primary school reads as
 * deriving none, and only the first derived school counts.
 */
export async function schoolDerivedByOrgUnitCanonicalization(
  row: SchoolBackingRow,
  canonicalize: OrgUnitCanonicalization = applyResearchEntityOrgUnitCanonicalization,
): Promise<string> {
  const set: Record<string, unknown> = { school: '' };
  const profileUrls = [textOf(row.websiteUrl), ...stringList(row.sourceUrls)].filter(Boolean);
  await canonicalize(set, row as Record<string, unknown>, profileUrls);
  return textOf(set.school);
}

/**
 * What, if anything, still stands behind a row's stored school (#6096). The row's own resolved
 * `school` reading, live or superseded, comes first; then the school org-unit canonicalization
 * derives from the row; a merged-in row's reading backs nothing the engine reads, so it is its
 * own class; otherwise nothing a pass could re-derive backs it.
 */
export function storedSchoolBackingClass(
  row: SchoolBackingRow,
  readings: ResolvedSchoolReadings,
  canonicalizer: SchoolCanonicalizer,
  derivedSchool: string,
): StoredSchoolBackingClass {
  if (schoolMatchKeys(row.school, canonicalizer).length === 0) return 'no-stored-school';
  if (storedSchoolIsBacked(row.school, readings.own, canonicalizer)) return 'school-observation';
  if (
    derivedSchool &&
    storedSchoolIsBacked(row.school, [{ value: derivedSchool }], canonicalizer)
  ) {
    return 'org-unit-derivation';
  }
  if (storedSchoolIsBacked(row.school, readings.mergedIn, canonicalizer)) {
    return 'merged-in-reading-only';
  }
  return 'never-backed';
}

export interface SchoolObservationResolutionDeps {
  mergedInRowsBySurvivor?: (
    survivorIds: readonly string[],
  ) => Promise<Map<string, MergedInResearchEntityRow[]>>;
  rowNamedByKeyObservations?: (entityKey: string) => Promise<string | undefined>;
}

const defaultRowNamedByKeyObservations = async (entityKey: string): Promise<string | undefined> =>
  serializedDocumentId((await liveResearchEntityNamedByKeyObservations(entityKey))?._id) ||
  undefined;

async function readSchoolObservations(
  filter: Record<string, unknown>,
): Promise<SchoolBackingObservation[]> {
  const read = (await Observation.find({
    entityType: RESEARCH_ENTITY_TYPE,
    field: SCHOOL_FIELD,
    ...NOT_ROLLED_BACK,
    ...filter,
  })
    .select('entityId entityKey field value sourceName sourceUrl superseded scrapeRunId')
    .lean()) as SchoolBackingObservation[];
  return partitionObservationsByInvalidatedRun(read, await invalidatedScrapeRunIds()).kept.filter(
    (observation) =>
      !shouldIgnoreObservationForEntityMaterialization(
        RESEARCH_ENTITY_TYPE,
        observation as Parameters<typeof shouldIgnoreObservationForEntityMaterialization>[1],
      ),
  );
}

/**
 * Keys that carry `school` readings but are no row's slug, mapped to the row the engine adopts
 * them into by their own observations' `entityId` (`liveResearchEntityNamedByKeyObservations`),
 * which is how `materializeEntity` reaches a renamed row from an old key.
 */
async function renamedKeyRows(
  rowIds: ReadonlySet<string>,
  rowNamedByKeyObservations: (entityKey: string) => Promise<string | undefined>,
): Promise<Map<string, string>> {
  const keys = (await Observation.distinct('entityKey', {
    entityType: RESEARCH_ENTITY_TYPE,
    field: SCHOOL_FIELD,
    entityId: null,
    entityKey: { $nin: [null, ''] },
    ...NOT_ROLLED_BACK,
  })) as string[];
  if (keys.length === 0) return new Map();
  const slugged = new Set(
    (
      (await ResearchEntity.find({ slug: { $in: keys } })
        .select('slug')
        .lean()) as Array<{ slug?: unknown }>
    ).map((row) => textOf(row.slug)),
  );
  const byKey = new Map<string, string>();
  for (const key of keys.filter((candidate) => !slugged.has(candidate))) {
    const rowId = await rowNamedByKeyObservations(key);
    if (rowId && rowIds.has(rowId)) byKey.set(key, rowId);
  }
  return byKey;
}

const mergedInReadingsDropped = SURVIVOR_OWNED_RESEARCH_ENTITY_FIELDS.has(SCHOOL_FIELD);

/**
 * Every `school` reading, live or superseded but not rolled back, not from an invalidated run
 * and not one the materializer ignores, that the engine relates to each row (#6096): the row's
 * own `entityId` and slug, any old key the engine adopts into the row by rename, and, kept
 * apart, every merged-in row's id and slug (the engine's `mergedRowEvidenceIdentity`), whose
 * readings the survivor's resolve drops because `school` is survivor-owned.
 *
 * Two engine behaviours are deliberately not mirrored. The gone-page withdrawal and lane
 * refusals at resolve could only move a row toward never-backed. The slug-scoped read of
 * observations under the row's slug that carry another row's `entityId` can make a backed row
 * read as never-backed here, which is why every flagged row goes to a blind check.
 */
export async function loadResolvedSchoolObservationsByRow(
  rows: readonly SchoolBackingRow[],
  deps: SchoolObservationResolutionDeps = {},
): Promise<Map<string, ResolvedSchoolReadings>> {
  const mergedInRowsBySurvivor =
    deps.mergedInRowsBySurvivor ??
    ((ids: readonly string[]) => listResearchEntityMergedInRowsBySurvivor([...ids]));
  const rowNamedByKeyObservations =
    deps.rowNamedByKeyObservations ?? defaultRowNamedByKeyObservations;
  const byRow = new Map<string, ResolvedSchoolReadings>();
  const keyedRows = rows.filter((row) => serializedDocumentId(row._id));
  for (const row of keyedRows) {
    byRow.set(serializedDocumentId(row._id) as string, { own: [], mergedIn: [] });
  }

  for (let start = 0; start < keyedRows.length; start += LOADER_CHUNK_SIZE) {
    const chunk = keyedRows.slice(start, start + LOADER_CHUNK_SIZE);
    const mergedIn = await mergedInRowsBySurvivor(
      chunk.map((row) => serializedDocumentId(row._id) as string),
    );
    const identities: Array<{ rowId: string; identity: MergedRowEvidenceIdentity }> = chunk.map(
      (row) => {
        const rowId = serializedDocumentId(row._id) as string;
        return { rowId, identity: mergedRowEvidenceIdentity(row, mergedIn.get(rowId) ?? []) };
      },
    );
    const clauses = mergedRowEvidenceQueryClauses(identities.map(({ identity }) => identity));
    if (clauses.length === 0) continue;
    const observations = await readSchoolObservations({ $or: clauses });
    for (const observation of observations) {
      for (const { rowId, identity } of identities) {
        if (!observationBelongsToMergedRow(identity, observation)) continue;
        const readings = byRow.get(rowId);
        if (!readings) continue;
        if (mergedInReadingsDropped && mergedInMemberOf(identity, observation)) {
          readings.mergedIn.push(observation);
        } else {
          readings.own.push(observation);
        }
      }
    }
  }

  const renamed = await renamedKeyRows(new Set(byRow.keys()), rowNamedByKeyObservations);
  if (renamed.size > 0) {
    const observations = await readSchoolObservations({
      entityId: null,
      entityKey: { $in: [...renamed.keys()] },
    });
    for (const observation of observations) {
      const rowId = renamed.get(textOf(observation.entityKey));
      if (rowId) byRow.get(rowId)?.own.push(observation);
    }
  }
  return byRow;
}
