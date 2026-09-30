import { serializedDocumentId } from './idSerialization';

export interface ResearchEntityRelationshipEndpoints {
  sourceResearchEntityId?: unknown;
  targetResearchEntityId?: unknown;
}

export const relationshipEndpointsAreSameEntity = (
  sourceResearchEntityId: unknown,
  targetResearchEntityId: unknown,
): boolean => {
  const source = serializedDocumentId(sourceResearchEntityId);
  return Boolean(source) && source === serializedDocumentId(targetResearchEntityId);
};

export const relatesTwoDistinctResearchEntities = (
  relationship: ResearchEntityRelationshipEndpoints,
): boolean =>
  !relationshipEndpointsAreSameEntity(
    relationship.sourceResearchEntityId,
    relationship.targetResearchEntityId,
  );
