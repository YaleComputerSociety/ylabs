// Every name here must be a registered scraper; grantLaneSourceNames.test.ts fails
// otherwise, because a misspelled name silently matches no observation (#4567).
export const GRANT_LANE_SOURCE_NAMES = [
  'nih-reporter',
  'nsf-award-search',
  'neh-funded-projects',
  'doe-osti',
] as const;
