/**
 * Pure planning helpers for the #1580 `researchAreas` listing-page facet-graft purge.
 *
 * `research-area-source-extractor` falls back to scanning a candidate entity's
 * remaining source URLs when its own website yields no labeled/prose research-area
 * signal. Before the `isRejectedAreaSourceUrl` guard covered listing pages, that
 * fallback could land on a shared directory/listing page (e.g.
 * `research.yale.edu/cores?f[0]=result_type:1`, a faculty directory, or a
 * membership roster) and derive research areas from the page's aggregate content
 * instead of the one entity it was scoped to - grafting the same generic area set
 * onto every entity that shared the listing as a candidate URL. This hit facility
 * CENTERs (MRRC, YCGA, and dozens of other core facilities) as well as individual
 * LAB and FACULTY_RESEARCH_AREA entities discovered off the same rosters. The
 * scraper guard now rejects listing/index pages outright, but records minted
 * before that guard landed still carry the grafted observation, so it needs an
 * explicit rollback.
 */

const FACET_GRAFT_SOURCE_NAME = 'research-area-source-extractor';

export interface ResearchAreaObservationLike {
  entityType?: string;
  field?: string;
  sourceName?: string;
  sourceUrl?: string;
  superseded?: boolean;
}

export function isResearchAreaFacetGraftObservation(
  observation: ResearchAreaObservationLike,
  isListingUrl: (value: unknown) => boolean,
): boolean {
  return (
    observation.entityType === 'researchEntity' &&
    observation.field === 'researchAreas' &&
    observation.superseded !== true &&
    observation.sourceName === FACET_GRAFT_SOURCE_NAME &&
    isListingUrl(observation.sourceUrl)
  );
}

export interface UnbackedResearchAreaClearInput {
  slug: string;
  currentResearchAreas: unknown;
  activeResearchAreaObservationCount: number;
}

export interface UnbackedResearchAreaClearResult {
  slug: string;
  shouldClear: boolean;
  reason: string;
}

/**
 * A center whose `researchAreas` value has no backing observation at all (never
 * went through the append-only observation pipeline, e.g. #585-style residue from
 * an entityType conversion) has nothing to roll back - there is no observation to
 * supersede. The only safe fix is a direct, explicitly-scoped clear, and only when
 * the invariant (zero active observations for the field) holds; a slug with any
 * active observation is left untouched so this never clobbers a genuinely backed
 * value.
 */
export function planUnbackedResearchAreaClear(
  input: UnbackedResearchAreaClearInput,
): UnbackedResearchAreaClearResult {
  const hasValue = Array.isArray(input.currentResearchAreas)
    ? input.currentResearchAreas.length > 0
    : Boolean(input.currentResearchAreas);
  if (!hasValue) {
    return { slug: input.slug, shouldClear: false, reason: 'already empty' };
  }
  if (input.activeResearchAreaObservationCount > 0) {
    return { slug: input.slug, shouldClear: false, reason: 'has a backing observation' };
  }
  return { slug: input.slug, shouldClear: true, reason: 'unbacked value with no active observation' };
}

export interface GenericTaxonomyBucketStripInput {
  slug: string;
  currentResearchAreas: unknown;
}

export interface GenericTaxonomyBucketStripResult {
  slug: string;
  cleaned: string[];
  removed: string[];
  changed: boolean;
}

/**
 * research.yale.edu's own top-level domain-filter buckets ("Sciences &
 * engineering", "Medical & health sciences", ...) sometimes ride along in the
 * same `.item__type` chip list as an entity's real, specific research areas.
 * A bucket this broad describes every entity in the domain, not this one, so
 * it is dropped rather than served as a chip (#1580 delta 1 / #1584) - unlike
 * the graft rollback above, the surviving specific areas on the same entity
 * are kept as-is.
 */
export function planGenericTaxonomyBucketStrip(
  input: GenericTaxonomyBucketStripInput,
  isGenericLabel: (value: string) => boolean,
): GenericTaxonomyBucketStripResult {
  const current = Array.isArray(input.currentResearchAreas)
    ? input.currentResearchAreas.filter((value): value is string => typeof value === 'string')
    : [];
  const removed = current.filter((value) => isGenericLabel(value));
  const cleaned = current.filter((value) => !isGenericLabel(value));
  return { slug: input.slug, cleaned, removed, changed: removed.length > 0 };
}
