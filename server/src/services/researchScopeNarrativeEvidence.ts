import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { serializedDocumentId } from '../utils/idSerialization';
import { isPublicHttpUrl } from '../utils/urlSafety';

const narrativeFields = ['summary', 'description', 'shortDescription', 'fullDescription'] as const;

function provenanceValue(entity: Record<string, any>, field: string): Record<string, any> | null {
  const provenance = entity.fieldProvenance;
  const value = provenance instanceof Map ? provenance.get(field) : provenance?.[field];
  return value && typeof value === 'object' ? value : null;
}

export async function trustedResearchScopeNarrativeFieldsByEntityId(
  entities: Array<Record<string, any>>,
): Promise<Map<string, ReadonlySet<string>>> {
  const candidates = entities.flatMap((entity) =>
    narrativeFields.flatMap((field) => {
      const provenance = provenanceValue(entity, field);
      if (
        !provenance ||
        !(provenance.observationId instanceof mongoose.Types.ObjectId) ||
        !(provenance.sourceId instanceof mongoose.Types.ObjectId)
      ) {
        return [];
      }
      return [{ entity, field, provenance }];
    }),
  );
  if (candidates.length === 0) return new Map();

  const observations = await Observation.find({
    _id: { $in: candidates.map(({ provenance }) => provenance.observationId) },
    superseded: { $ne: true },
    'rollback.rolledBackAt': { $exists: false },
    sourceId: { $type: 'objectId' },
  })
    .select('_id entityType entityId field value sourceId sourceUrl')
    .lean();
  const observationsById = new Map(
    (observations as any[]).map((observation) => [
      serializedDocumentId(observation._id),
      observation,
    ]),
  );
  const trusted = new Map<string, Set<string>>();

  for (const { entity, field, provenance } of candidates) {
    const observation = observationsById.get(serializedDocumentId(provenance.observationId) || '');
    const entityId = serializedDocumentId(entity._id);
    if (
      !entityId ||
      !['researchEntity', 'researchGroup'].includes(observation?.entityType) ||
      serializedDocumentId(observation.entityId) !== entityId ||
      observation.field !== field ||
      observation.value !== entity[field] ||
      serializedDocumentId(observation.sourceId) !== serializedDocumentId(provenance.sourceId) ||
      !isPublicHttpUrl(observation.sourceUrl) ||
      provenance.sourceUrl !== observation.sourceUrl
    ) {
      continue;
    }
    const fields = trusted.get(entityId) || new Set<string>();
    fields.add(field);
    trusted.set(entityId, fields);
  }

  return trusted;
}
