/**
 * The value sets a canonical schema enumerates, owned by the model layer.
 *
 * A stored enum is part of the storage contract, so it cannot live in the service or
 * scraper that happens to write it: `models/` is the bottom of the import order and may
 * not import upward, and a schema reaching into `services/` for its own `enum` list
 * inverted that order for `sourceLinkHealth`, `descriptionGrounding` and the lab-site
 * lead lane. Each of those modules now re-exports from here, keeping the prose that
 * explains how a value is CHOSEN next to the logic that chooses it, while the list of
 * what MAY be stored lives with the schema that enforces it.
 */

export const sourceLinkHealthStatuses = [
  'HEALTHY',
  'REDIRECTED',
  'UNAVAILABLE',
  'UNKNOWN',
] as const;
export type SourceLinkHealthStatus = (typeof sourceLinkHealthStatuses)[number];

export const descriptionGroundingVerdicts = [
  'GROUNDED',
  'REWORDED',
  'UNSUPPORTED',
  'UNREACHABLE',
  'UNKNOWN',
] as const;
export type DescriptionGroundingVerdict = (typeof descriptionGroundingVerdicts)[number];

export const labSiteLeadVerdicts = ['CONFIRMED', 'CONTRADICTED', 'UNSTATED'] as const;
export type LabSiteLeadVerdict = (typeof labSiteLeadVerdicts)[number];

export const labSiteLeadMatchReasons = [
  'OFFICIAL_PROFILE_LINK',
  'NAMED_ON_PAGE',
  'SURNAME_IN_SITE_URL',
  'NONE',
] as const;
export type LabSiteLeadMatchReason = (typeof labSiteLeadMatchReasons)[number];

export const labSiteVerificationStates = [
  'verified',
  'partial',
  'contradicted',
  'unstated',
  'unreachable',
] as const;
export type LabSiteVerificationState = (typeof labSiteVerificationStates)[number];
