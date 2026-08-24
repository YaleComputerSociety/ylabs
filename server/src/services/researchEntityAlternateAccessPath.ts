import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchEntityRelationship } from '../models/researchEntityRelationship';
import { serializedDocumentId } from '../utils/idSerialization';

function toObjectId(value: unknown): mongoose.Types.ObjectId | null {
  const id = serializedDocumentId(value);
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
}

export async function countResearchEntityAlternateAccessPaths(
  entityIds: unknown[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const objectIds = entityIds.map(toObjectId).filter((id): id is mongoose.Types.ObjectId => Boolean(id));
  if (objectIds.length === 0) return counts;
  const inScopeIds = new Set(objectIds.map((id) => id.toString()));

  const relationships = (await ResearchEntityRelationship.find({
    archived: { $ne: true },
    $or: [
      { sourceResearchEntityId: { $in: objectIds } },
      { targetResearchEntityId: { $in: objectIds } },
    ],
  })
    .select('sourceResearchEntityId targetResearchEntityId')
    .lean()) as any[];

  const counterpartIds = new Set<string>();
  for (const relationship of relationships) {
    const source = serializedDocumentId(relationship.sourceResearchEntityId);
    const target = serializedDocumentId(relationship.targetResearchEntityId);
    if (source && !inScopeIds.has(source)) counterpartIds.add(source);
    if (target && !inScopeIds.has(target)) counterpartIds.add(target);
    if (source && inScopeIds.has(source) && target && inScopeIds.has(target)) {
      counterpartIds.add(source);
      counterpartIds.add(target);
    }
  }

  const liveCounterpartIds = counterpartIds.size
    ? new Set(
        (
          (await ResearchEntity.find({
            _id: { $in: Array.from(counterpartIds).map(toObjectId).filter(Boolean) },
            archived: { $ne: true },
          })
            .select('_id')
            .lean()) as any[]
        )
          .map((entity) => serializedDocumentId(entity._id))
          .filter((id): id is string => Boolean(id)),
      )
    : new Set<string>();

  const seenNeighborByEntity = new Map<string, Set<string>>();
  const recordPath = (entityId: string, counterpartId: string) => {
    let neighbors = seenNeighborByEntity.get(entityId);
    if (!neighbors) {
      neighbors = new Set<string>();
      seenNeighborByEntity.set(entityId, neighbors);
    }
    if (neighbors.has(counterpartId)) return;
    neighbors.add(counterpartId);
    counts.set(entityId, (counts.get(entityId) || 0) + 1);
  };

  for (const relationship of relationships) {
    const source = serializedDocumentId(relationship.sourceResearchEntityId);
    const target = serializedDocumentId(relationship.targetResearchEntityId);
    if (!source || !target) continue;
    if (inScopeIds.has(source) && liveCounterpartIds.has(target)) recordPath(source, target);
    if (inScopeIds.has(target) && liveCounterpartIds.has(source)) recordPath(target, source);
  }

  return counts;
}
