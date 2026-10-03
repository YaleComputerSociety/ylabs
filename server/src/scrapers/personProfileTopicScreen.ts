import { isPersonScopedResearchEntityShape } from '../models/storedVocabularies';

export const PERSON_PROFILE_TOPIC_SOURCE_NAMES: ReadonlySet<string> = new Set([
  'ysm-mesh-keyword',
  'ysm-faculty-directory',
]);

interface ResearchEntityShape {
  entityType?: unknown;
  kind?: unknown;
  fieldProvenance?: unknown;
}

interface TopicObservationShape {
  field?: unknown;
  sourceName?: unknown;
}

function isPersonProfileTopicSource(sourceName: unknown): boolean {
  return typeof sourceName === 'string' && PERSON_PROFILE_TOPIC_SOURCE_NAMES.has(sourceName);
}

function isOrganizationRow(row: ResearchEntityShape | null | undefined): boolean {
  return Boolean(row) && !isPersonScopedResearchEntityShape(row ?? {});
}

export function withoutPersonProfileTopicsOnOrganizationRow<T extends TopicObservationShape>(
  observations: T[],
  row: ResearchEntityShape | null | undefined,
): T[] {
  if (!isOrganizationRow(row)) return observations;
  return observations.filter(
    (observation) =>
      !(
        observation.field === 'researchAreas' && isPersonProfileTopicSource(observation.sourceName)
      ),
  );
}

export function storedResearchAreasCameFromAPersonProfileOnAnOrganizationRow(
  row: ResearchEntityShape | null | undefined,
): boolean {
  if (!isOrganizationRow(row)) return false;
  const provenance = row?.fieldProvenance;
  if (!provenance || typeof provenance !== 'object') return false;
  const entry = (provenance as Record<string, unknown>).researchAreas;
  if (!entry || typeof entry !== 'object') return false;
  return isPersonProfileTopicSource((entry as Record<string, unknown>).sourceName);
}
