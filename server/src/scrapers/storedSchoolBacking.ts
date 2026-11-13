import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import {
  listResearchEntityMergedInRowsBySurvivor,
  type MergedInResearchEntityRow,
} from '../services/researchEntityCanonicalTombstone';
import { serializedDocumentId } from '../utils/idSerialization';
import { shouldIgnoreObservationForEntityMaterialization } from './entityMaterializer';
import {
  invalidatedScrapeRunIds,
  partitionObservationsByInvalidatedRun,
} from './invalidatedScrapeRuns';
import {
  mergedRowEvidenceIdentity,
  mergedRowEvidenceQueryClauses,
  observationBelongsToMergedRow,
  type MergedRowEvidenceIdentity,
} from './mergedRowEvidenceIdentity';
import {
  orgUnitMatchKey,
  schoolNameFromProfileHosts,
  type OrgUnitCanonicalizer,
} from './orgUnitCanonicalization';
import { liveResearchEntityNamedByKeyObservations } from './renamedResearchEntityAdoption';

export type SchoolCanonicalizer = Pick<
  OrgUnitCanonicalizer,
  'canonicalizeSchool' | 'canonicalizeDepartments' | 'schoolForDepartment'
>;

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
  websiteUrl?: unknown;
  sourceUrls?: unknown;
}

export const STORED_SCHOOL_BACKING_CLASSES = [
  'no-stored-school',
  'school-observation',
  'department-derivation',
  'profile-host',
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

function storedSchoolMatchesDepartmentDerivation(
  row: SchoolBackingRow,
  storedKeys: ReadonlySet<string>,
  canonicalizer: SchoolCanonicalizer,
): boolean {
  const departments = canonicalizer.canonicalizeDepartments(stringList(row.departments)).values;
  return departments.some((department) =>
    schoolMatchKeys(canonicalizer.schoolForDepartment(department), canonicalizer).some((key) =>
      storedKeys.has(key),
    ),
  );
}

function storedSchoolMatchesProfileHost(
  row: SchoolBackingRow,
  storedKeys: ReadonlySet<string>,
  canonicalizer: SchoolCanonicalizer,
): boolean {
  const urls = [textOf(row.websiteUrl), ...stringList(row.sourceUrls)].filter(Boolean);
  return schoolMatchKeys(schoolNameFromProfileHosts(urls), canonicalizer).some((key) =>
    storedKeys.has(key),
  );
}

/**
 * What, if anything, still stands behind a row's stored school (#6096). A resolved `school`
 * reading, live or superseded, comes first; then the two derivations org-unit canonicalization
 * writes a school from when no reading states one (a stored department's parent school, and a
 * profile host); otherwise nothing a pass could re-derive backs it.
 */
export function storedSchoolBackingClass(
  row: SchoolBackingRow,
  resolvedObservations: readonly Pick<SchoolBackingObservation, 'value'>[],
  canonicalizer: SchoolCanonicalizer,
): StoredSchoolBackingClass {
  const storedKeys = new Set(schoolMatchKeys(row.school, canonicalizer));
  if (storedKeys.size === 0) return 'no-stored-school';
  if (storedSchoolIsBacked(row.school, resolvedObservations, canonicalizer)) {
    return 'school-observation';
  }
  if (storedSchoolMatchesDepartmentDerivation(row, storedKeys, canonicalizer)) {
    return 'department-derivation';
  }
  if (storedSchoolMatchesProfileHost(row, storedKeys, canonicalizer)) return 'profile-host';
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

/**
 * Every `school` reading, live or superseded but not rolled back and not from an invalidated
 * run, that the materializer resolves for each row (#6096): the row's own `entityId` and slug,
 * every merged-in row's id and slug (the engine's `mergedRowEvidenceIdentity`), and any old key
 * the engine adopts into the row by rename. Never a join on the current slug alone, which
 * misses the keyed readings most rows' schools came from.
 */
export async function loadResolvedSchoolObservationsByRow(
  rows: readonly SchoolBackingRow[],
  deps: SchoolObservationResolutionDeps = {},
): Promise<Map<string, SchoolBackingObservation[]>> {
  const mergedInRowsBySurvivor =
    deps.mergedInRowsBySurvivor ??
    ((ids: readonly string[]) => listResearchEntityMergedInRowsBySurvivor([...ids]));
  const rowNamedByKeyObservations =
    deps.rowNamedByKeyObservations ?? defaultRowNamedByKeyObservations;
  const byRow = new Map<string, SchoolBackingObservation[]>();
  const keyedRows = rows.filter((row) => serializedDocumentId(row._id));
  for (const row of keyedRows) byRow.set(serializedDocumentId(row._id) as string, []);

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
        if (observationBelongsToMergedRow(identity, observation)) {
          byRow.get(rowId)?.push(observation);
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
      if (rowId) byRow.get(rowId)?.push(observation);
    }
  }
  return byRow;
}
