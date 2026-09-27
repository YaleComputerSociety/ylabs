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

/**
 * The canonical person-scoped research-record type, and the two retired spellings that
 * mean the same thing on rows written before the consolidation.
 *
 * Lives here rather than beside the repair that once rewrote them, which is where it was:
 * `models/__tests__/researchAccessModels.test.ts` imported it out of `scripts/`, so the
 * models layer depended on a one-off script and the vocabulary could not outlive it. The
 * retired spellings are stored data, so they are the models layer's to name (#3675).
 *
 * No lane under `scrapers/sources/` emits either retired value, and Development holds 0
 * rows carrying one, so nothing consolidates them any more. Several readers still tolerate
 * them deliberately, and that tolerance is what this vocabulary is for.
 */
export const CANONICAL_FACULTY_RESEARCH_ENTITY_TYPE = 'FACULTY_RESEARCH_AREA' as const;

export const LEGACY_FACULTY_RESEARCH_ENTITY_TYPES = [
  'INDIVIDUAL_RESEARCH',
  'FACULTY_RESEARCH',
] as const;
export type LegacyFacultyResearchEntityType = (typeof LEGACY_FACULTY_RESEARCH_ENTITY_TYPES)[number];

const LEGACY_FACULTY_RESEARCH_ENTITY_TYPE_SET: ReadonlySet<string> = new Set(
  LEGACY_FACULTY_RESEARCH_ENTITY_TYPES,
);

export function isLegacyFacultyResearchEntityType(value?: string | null): boolean {
  return typeof value === 'string' && LEGACY_FACULTY_RESEARCH_ENTITY_TYPE_SET.has(value.trim());
}
