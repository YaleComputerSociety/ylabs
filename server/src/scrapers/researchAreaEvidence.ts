import { Observation, type ObservedEntityType } from '../models/observation';
import {
  listResearchEntityMergedInRowsBySurvivor,
  type MergedInResearchEntityRow,
} from '../services/researchEntityCanonicalTombstone';
import { serializedDocumentId } from '../utils/idSerialization';
import {
  mergedRowEvidenceIdentity,
  mergedRowEvidenceQueryClauses,
  observationBelongsToMergedRow,
  type MergedRowEvidenceIdentity,
} from './mergedRowEvidenceIdentity';
import {
  admissibleResearchAreas,
  getResearchAreaCanonicalizer,
  type ResearchAreaCanonicalizer,
} from './researchAreaCanonicalization';

const RESEARCH_AREAS_FIELD = 'researchAreas';
const RESEARCH_ENTITY_TYPE: ObservedEntityType = 'researchEntity';
const LOADER_CHUNK_SIZE = 500;

export interface ResearchAreaEvidenceRow {
  _id?: unknown;
  slug?: unknown;
  departments?: unknown;
  manuallyLockedFields?: unknown;
}

export type ResearchAreaAdmission = (areas: unknown) => boolean;

export type ResearchAreaEvidenceIdentity = MergedRowEvidenceIdentity;

export interface ResearchAreaEvidenceObservation {
  sourceUrl?: unknown;
  entityId?: unknown;
  entityKey?: unknown;
  field?: unknown;
  value?: unknown;
  superseded?: unknown;
  rollback?: { rolledBackAt?: unknown } | null;
}

export function researchAreaEvidenceIdentity(
  row: ResearchAreaEvidenceRow,
  mergedIn: ReadonlyArray<Pick<MergedInResearchEntityRow, '_id' | 'slug'>> = [],
): ResearchAreaEvidenceIdentity {
  return mergedRowEvidenceIdentity(row, mergedIn);
}

export function researchAreasAreManuallyLocked(row: ResearchAreaEvidenceRow): boolean {
  return (
    Array.isArray(row.manuallyLockedFields) &&
    row.manuallyLockedFields.includes(RESEARCH_AREAS_FIELD)
  );
}

export function researchAreaAdmissionForRow(
  canonicalizer: ResearchAreaCanonicalizer,
  row: Pick<ResearchAreaEvidenceRow, 'departments'>,
): ResearchAreaAdmission {
  return (areas) => admissibleResearchAreas(canonicalizer, areas, row.departments).length > 0;
}

// A statement whose every area the row rejects is no evidence, because the materializer
// will not let it displace the stored list either (#3836).
export function isLiveResearchAreaStatement(
  observation: ResearchAreaEvidenceObservation,
  admits: ResearchAreaAdmission,
): boolean {
  if (observation.field !== RESEARCH_AREAS_FIELD) return false;
  if (observation.superseded === true) return false;
  if (observation.rollback?.rolledBackAt) return false;
  return (
    Array.isArray(observation.value) &&
    observation.value.some((area) => typeof area === 'string' && area.trim().length > 0) &&
    admits(observation.value)
  );
}

export function observationBelongsToIdentity(
  observation: ResearchAreaEvidenceObservation,
  identity: ResearchAreaEvidenceIdentity,
): boolean {
  return observationBelongsToMergedRow(identity, observation);
}

export function hasLiveResearchAreaEvidence(
  identity: ResearchAreaEvidenceIdentity,
  observations: ReadonlyArray<ResearchAreaEvidenceObservation>,
  admits: ResearchAreaAdmission,
  refusesSource: (sourceUrl: string) => boolean = () => false,
): boolean {
  return observations.some(
    (observation) =>
      isLiveResearchAreaStatement(observation, admits) &&
      observationBelongsToIdentity(observation, identity) &&
      !refusesSource(typeof observation.sourceUrl === 'string' ? observation.sourceUrl : ''),
  );
}

async function loadLiveResearchAreaObservations(
  identities: ReadonlyArray<ResearchAreaEvidenceIdentity>,
): Promise<ResearchAreaEvidenceObservation[]> {
  const clauses = mergedRowEvidenceQueryClauses(identities);
  if (clauses.length === 0) return [];
  return (await Observation.find({
    entityType: RESEARCH_ENTITY_TYPE,
    field: RESEARCH_AREAS_FIELD,
    superseded: { $ne: true },
    'rollback.rolledBackAt': { $exists: false },
    $or: clauses,
  })
    .select('entityId entityKey field value superseded rollback sourceUrl')
    .lean()) as ResearchAreaEvidenceObservation[];
}

export async function loadResearchAreaEvidenceBackedRowIds<Row extends ResearchAreaEvidenceRow>(
  rows: ReadonlyArray<Row>,
  refusesSource: (row: Row, sourceUrl: string) => boolean = () => false,
): Promise<Set<string>> {
  const backed = new Set<string>();
  const canonicalizer = await getResearchAreaCanonicalizer();
  const keyedRows = rows.filter((row) => serializedDocumentId(row._id));
  for (let start = 0; start < keyedRows.length; start += LOADER_CHUNK_SIZE) {
    const chunk = keyedRows.slice(start, start + LOADER_CHUNK_SIZE);
    const mergedInBySurvivor = await listResearchEntityMergedInRowsBySurvivor(
      chunk.map((row) => serializedDocumentId(row._id) as string),
    );
    const identities = chunk.map((row) => {
      const rowId = serializedDocumentId(row._id) as string;
      return {
        row,
        rowId,
        identity: researchAreaEvidenceIdentity(row, mergedInBySurvivor.get(rowId) ?? []),
        admits: researchAreaAdmissionForRow(canonicalizer, row),
      };
    });
    const observations = await loadLiveResearchAreaObservations(
      identities.map(({ identity }) => identity),
    );
    for (const { row, rowId, identity, admits } of identities) {
      const refusesRowSource = (sourceUrl: string) => refusesSource(row, sourceUrl);
      if (hasLiveResearchAreaEvidence(identity, observations, admits, refusesRowSource)) {
        backed.add(rowId);
      }
    }
  }
  return backed;
}
