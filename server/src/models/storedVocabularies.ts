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

export const labSiteLeadContradictionShapes = ['NAMESAKE', 'NAMED_AS_LEAD'] as const;
export type LabSiteLeadContradictionShape = (typeof labSiteLeadContradictionShapes)[number];

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

export const scrapeRunStatuses = [
  'running',
  'success',
  'failure',
  'partial',
  'interrupted',
] as const;
export type ScrapeRunStatus = (typeof scrapeRunStatuses)[number];

export const weeklySweepModes = ['development-full', 'fellowship-development-full'] as const;
export type WeeklySweepMode = (typeof weeklySweepModes)[number];

export const weeklySweepRunStatuses = ['running', 'succeeded', 'failed', 'refused'] as const;
export type WeeklySweepRunStatus = (typeof weeklySweepRunStatuses)[number];

export const weeklySweepCorpusSnapshotStatuses = ['written', 'failed', 'skipped'] as const;
export type WeeklySweepCorpusSnapshotStatus = (typeof weeklySweepCorpusSnapshotStatuses)[number];

export const weeklySweepSearchIndexStatuses = ['written', 'resync-required'] as const;
export type WeeklySweepSearchIndexStatus = (typeof weeklySweepSearchIndexStatuses)[number];

export const weeklySweepStageFailureKinds = ['crashed', 'regression', 'violation'] as const;
export type WeeklySweepStageFailureKind = (typeof weeklySweepStageFailureKinds)[number];

export const scrapeRunInterruptionReasons = [
  'signal',
  'heartbeat_stale',
  'legacy_abandoned',
] as const;
export type ScrapeRunInterruptionReason = (typeof scrapeRunInterruptionReasons)[number];

/**
 * Whether a stored row is one person's research rather than the collective that publishes
 * its page.
 *
 * The single owner of that question, and it lives here because the question is a property
 * of the stored `entityType` vocabulary. Nine `PERSON_SCOPED_*` declarations existed before
 * this, across `utils/`, `services/` and `scripts/`, and six of them meant this and
 * disagreed anyway (#3602).
 *
 * The disagreements were measured on real rows rather than reconciled by union, because the
 * whole failure mode here is a set that widened by accident:
 *
 * - Only two person-scoped types exist in the corpus at all: 3,526 live `FACULTY_RESEARCH_AREA`
 *   and 877 live `LAB`. `FACULTY_RESEARCH`, `INDIVIDUAL_RESEARCH` and `FACULTY_PROJECT` have
 *   **zero rows, ever**, so every difference confined to those three was unexercised, including
 *   the one `researchHomeNameIdentityAuthority` documented as a deliberate widening.
 * - The one difference that was exercised is `LAB`, by 877 rows, and it appeared in the
 *   visibility gate's copy. Including `LAB` there changes nothing: the shared-citation signal
 *   flags 277 rows with it and 277 without, 0 newly flagged and 0 lost, so the exclusion was
 *   inert rather than load-bearing.
 *
 * The retired spellings stay in the set because rows written before the consolidation may
 * still carry them and this question must answer the same way for those rows; see
 * [[LEGACY_FACULTY_RESEARCH_ENTITY_TYPES]] above.
 *
 * Three sets are deliberately NOT folded in, because they ask a different question and their
 * names now say so: `NON_LAB_PERSON_SCOPED_ENTITY_TYPES` in two repairs that rewrite a row
 * whose NAME claims a lab while its type does not, and `LAB_ENTITY_TYPES` in the lab-website
 * retarget, which picks which of a lead's homes is the lab. Folding either into this one would
 * make a repair rewrite legitimate `LAB` rows. `labDescriptionSynthesis` asks the same
 * non-lab question to choose a person prompt over a lab prompt, and names it the same way.
 *
 * The client cannot import this module, so `PERSON_SCOPED_CITING_ENTITY_TYPES` in
 * client/src/utils/researchDetailSources.ts mirrors this set; changing it here requires
 * updating that copy.
 */
export const PERSON_SCOPED_RESEARCH_ENTITY_TYPES: ReadonlySet<string> = new Set([
  'LAB',
  'FACULTY_RESEARCH_AREA',
  'FACULTY_PROJECT',
  'FACULTY_RESEARCH',
  'INDIVIDUAL_RESEARCH',
]);

export const PERSON_SCOPED_RESEARCH_ENTITY_KINDS: ReadonlySet<string> = new Set([
  'lab',
  'individual',
  'solo',
]);

export function isPersonScopedResearchEntityType(entityType: unknown): boolean {
  return (
    typeof entityType === 'string' &&
    PERSON_SCOPED_RESEARCH_ENTITY_TYPES.has(entityType.trim().toUpperCase())
  );
}

/**
 * `entityType` decides when the row states one, and `kind` is the fallback for a row that
 * does not. Reading `kind` first would let a derived value outrank the stored type.
 */
export function isPersonScopedResearchEntityShape(row: {
  entityType?: unknown;
  kind?: unknown;
}): boolean {
  const entityType = typeof row.entityType === 'string' ? row.entityType.trim() : '';
  if (entityType) return isPersonScopedResearchEntityType(entityType);
  const kind = typeof row.kind === 'string' ? row.kind.trim().toLowerCase() : '';
  return kind !== '' && PERSON_SCOPED_RESEARCH_ENTITY_KINDS.has(kind);
}

export const loginSignalBuckets = [
  'undergrad_usable_major',
  'undergrad_undeclared',
  'undergrad_no_major',
  'undergrad_leave_or_visitor',
  'grad_with_curriculum',
  'grad_without_curriculum',
  'other_or_faculty',
  'yalies_not_found',
  'yalies_unavailable',
] as const;
export type LoginSignalBucket = (typeof loginSignalBuckets)[number];
