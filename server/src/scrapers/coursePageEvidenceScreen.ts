import { isCoursePageUrl } from '../utils/researchHomeWebsiteUrl';

interface CitedObservationShape {
  sourceUrl?: unknown;
}

export function withoutCoursePageEvidence<T extends CitedObservationShape>(observations: T[]): T[] {
  return observations.filter((observation) => !isCoursePageUrl(observation.sourceUrl));
}

export function storedFieldIsCreditedToACoursePage(
  row: { fieldProvenance?: unknown } | null | undefined,
  field: string,
): boolean {
  const provenance = row?.fieldProvenance;
  if (!provenance || typeof provenance !== 'object') return false;
  const entry = (provenance as Record<string, unknown>)[field];
  if (!entry || typeof entry !== 'object') return false;
  return isCoursePageUrl((entry as Record<string, unknown>).sourceUrl);
}
