import mongoose from 'mongoose';
import { Observation, type ObservedEntityType } from '../models/observation';
import {
  listResearchEntityMergedInRowsBySurvivor,
  type MergedInResearchEntityRow,
} from '../services/researchEntityCanonicalTombstone';
import { serializedDocumentId } from '../utils/idSerialization';

const RESEARCH_AREAS_FIELD = 'researchAreas';
const RESEARCH_ENTITY_TYPE: ObservedEntityType = 'researchEntity';
const LOADER_CHUNK_SIZE = 500;

export interface ResearchAreaEvidenceRow {
  _id?: unknown;
  slug?: unknown;
  manuallyLockedFields?: unknown;
}

export interface ResearchAreaEvidenceIdentity {
  entityIds: ReadonlySet<string>;
  entityKeys: ReadonlySet<string>;
}

export interface ResearchAreaEvidenceObservation {
  entityId?: unknown;
  entityKey?: unknown;
  field?: unknown;
  value?: unknown;
  superseded?: unknown;
  rollback?: { rolledBackAt?: unknown } | null;
}

const slugText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function researchAreaEvidenceIdentity(
  row: ResearchAreaEvidenceRow,
  mergedIn: ReadonlyArray<Pick<MergedInResearchEntityRow, '_id' | 'slug'>> = [],
): ResearchAreaEvidenceIdentity {
  const members = [row, ...mergedIn];
  return {
    entityIds: new Set(
      members.map((member) => serializedDocumentId(member._id) || '').filter(Boolean),
    ),
    entityKeys: new Set(members.map((member) => slugText(member.slug)).filter(Boolean)),
  };
}

export function researchAreasAreManuallyLocked(row: ResearchAreaEvidenceRow): boolean {
  return (
    Array.isArray(row.manuallyLockedFields) &&
    row.manuallyLockedFields.includes(RESEARCH_AREAS_FIELD)
  );
}

export function isLiveResearchAreaStatement(observation: ResearchAreaEvidenceObservation): boolean {
  if (observation.field !== RESEARCH_AREAS_FIELD) return false;
  if (observation.superseded === true) return false;
  if (observation.rollback?.rolledBackAt) return false;
  return (
    Array.isArray(observation.value) &&
    observation.value.some((area) => typeof area === 'string' && area.trim().length > 0)
  );
}

export function observationBelongsToIdentity(
  observation: ResearchAreaEvidenceObservation,
  identity: ResearchAreaEvidenceIdentity,
): boolean {
  const entityId = serializedDocumentId(observation.entityId);
  // An observation anchored to an id belongs to that id alone, so a shared or re-minted slug
  // cannot borrow another row's evidence (#1131).
  if (entityId) return identity.entityIds.has(entityId);
  const entityKey = slugText(observation.entityKey);
  return entityKey.length > 0 && identity.entityKeys.has(entityKey);
}

export function hasLiveResearchAreaEvidence(
  identity: ResearchAreaEvidenceIdentity,
  observations: ReadonlyArray<ResearchAreaEvidenceObservation>,
): boolean {
  return observations.some(
    (observation) =>
      isLiveResearchAreaStatement(observation) &&
      observationBelongsToIdentity(observation, identity),
  );
}

async function loadLiveResearchAreaObservations(
  identities: ReadonlyArray<ResearchAreaEvidenceIdentity>,
): Promise<ResearchAreaEvidenceObservation[]> {
  const entityIds = [...new Set(identities.flatMap((identity) => [...identity.entityIds]))]
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  const entityKeys = [...new Set(identities.flatMap((identity) => [...identity.entityKeys]))];
  if (entityIds.length === 0 && entityKeys.length === 0) return [];
  return (await Observation.find({
    entityType: RESEARCH_ENTITY_TYPE,
    field: RESEARCH_AREAS_FIELD,
    superseded: { $ne: true },
    'rollback.rolledBackAt': { $exists: false },
    $or: [{ entityId: { $in: entityIds } }, { entityId: null, entityKey: { $in: entityKeys } }],
  })
    .select('entityId entityKey field value superseded rollback')
    .lean()) as ResearchAreaEvidenceObservation[];
}

export async function loadResearchAreaEvidenceBackedRowIds(
  rows: ReadonlyArray<ResearchAreaEvidenceRow>,
): Promise<Set<string>> {
  const backed = new Set<string>();
  const keyedRows = rows.filter((row) => serializedDocumentId(row._id));
  for (let start = 0; start < keyedRows.length; start += LOADER_CHUNK_SIZE) {
    const chunk = keyedRows.slice(start, start + LOADER_CHUNK_SIZE);
    const mergedInBySurvivor = await listResearchEntityMergedInRowsBySurvivor(
      chunk.map((row) => serializedDocumentId(row._id) as string),
    );
    const identities = chunk.map((row) => {
      const rowId = serializedDocumentId(row._id) as string;
      return {
        rowId,
        identity: researchAreaEvidenceIdentity(row, mergedInBySurvivor.get(rowId) ?? []),
      };
    });
    const observations = await loadLiveResearchAreaObservations(
      identities.map(({ identity }) => identity),
    );
    for (const { rowId, identity } of identities) {
      if (hasLiveResearchAreaEvidence(identity, observations)) backed.add(rowId);
    }
  }
  return backed;
}
