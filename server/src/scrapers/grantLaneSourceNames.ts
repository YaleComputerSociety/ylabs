// Every name here must be a registered scraper; grantLaneSourceNames.test.ts fails
// otherwise, because a misspelled name silently matches no observation (#4567).
export const GRANT_LANE_SOURCE_NAMES = [
  'nih-reporter',
  'nsf-award-search',
  'neh-funded-projects',
  'doe-osti',
  'crossref-grants',
] as const;

// Changing this set also requires changing what the grant lanes emit: a field missing
// here is discarded at materialize however recently a lane observed it.
export const GRANT_LANE_ENRICHMENT_FIELDS: ReadonlySet<string> = new Set([
  'recentGrants',
  'recentGrantPeriods',
  'recentGrantCount',
  'fundingAgencies',
  'lastObservedAt',
  'inferredPiUserId',
]);

const GRANT_LANE_SOURCE_NAME_SET: ReadonlySet<string> = new Set(GRANT_LANE_SOURCE_NAMES);

export function isGrantLaneObservationOutsideEnrichment(observation: {
  sourceName?: unknown;
  field?: unknown;
}): boolean {
  return (
    typeof observation.sourceName === 'string' &&
    GRANT_LANE_SOURCE_NAME_SET.has(observation.sourceName) &&
    typeof observation.field === 'string' &&
    !GRANT_LANE_ENRICHMENT_FIELDS.has(observation.field)
  );
}
