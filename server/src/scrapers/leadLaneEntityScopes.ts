import { isPersonScopedResearchEntityType } from '../models/storedVocabularies';
import { CENTER_DIRECTOR_SOURCE_NAME } from './centerDirectorReadSnapshot';

export const ORG_ENTITY_TYPES = ['CENTER', 'INSTITUTE', 'INITIATIVE', 'CORE_FACILITY'] as const;

export const CENTER_DIRECTOR_LLM_SOURCE_NAME = 'center-director-llm';

/**
 * The row types each director lane reads. A lane's assertion about a row outside its own
 * scope is left over from before the row was retyped (#6327): the lane would never read that
 * row today, so its director is not evidence about the row as it now is.
 */
export const LEAD_LANE_ENTITY_TYPE_SCOPES: Readonly<Record<string, readonly string[]>> = {
  [CENTER_DIRECTOR_LLM_SOURCE_NAME]: ORG_ENTITY_TYPES,
  [CENTER_DIRECTOR_SOURCE_NAME]: [...ORG_ENTITY_TYPES, 'LAB'],
};

export function laneReadsEntityType(sourceName: unknown, entityType: unknown): boolean {
  const scope = LEAD_LANE_ENTITY_TYPE_SCOPES[String(sourceName ?? '')];
  return !scope || scope.includes(String(entityType ?? ''));
}

export function laneLeadCountsOnEntityType(sourceName: unknown, entityType: unknown): boolean {
  return (
    laneReadsEntityType(sourceName, entityType) || !isPersonScopedResearchEntityType(entityType)
  );
}
