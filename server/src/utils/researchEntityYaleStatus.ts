import { researchEntityHasDeceasedLead } from './researchEntityDeceasedLead';

const MARKER_SCAN_WINDOW = 200;
const MIN_HUMAN_LIFESPAN_YEARS = 15;
const MAX_HUMAN_LIFESPAN_YEARS = 120;
const NAME_LIFESPAN_ANYWHERE_RE = /((?:18|19|20)\d{2})\s*[-‒–—―−]\s*((?:19|20)\d{2})/;

const IN_MEMORIAM_URL_PATH_RE = /\bin-memoriam\b|\bobituar(?:y|ies)\b/i;
const IN_MEMORIAM_TEXT_RE = /\bin memoriam\b|\bpassed away\b/i;

export type ResearchEntityYaleStatusReason = 'deceased' | 'departed';

export interface ResearchEntityYaleStatusSignal {
  yaleStatusCache: 'departed';
  activeAtYaleCache: false;
  reason: ResearchEntityYaleStatusReason;
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sourceUrlPaths(entity: Record<string, any>): string[] {
  const sourceUrls = Array.isArray(entity.sourceUrls) ? entity.sourceUrls : [];
  const websiteUrl = textValue(entity.websiteUrl);
  return [...sourceUrls, websiteUrl].filter((value): value is string => typeof value === 'string');
}

function descriptionOpenings(entity: Record<string, any>): string[] {
  return [entity.fullDescription, entity.shortDescription, entity.profileSynthesisDescription]
    .map(textValue)
    .filter(Boolean)
    .map((text) => text.replace(/\s+/g, ' ').trim().slice(0, MARKER_SCAN_WINDOW));
}

function anyUrlMatches(urls: string[], pattern: RegExp): boolean {
  return urls.some((url) => pattern.test(url));
}

function anyOpeningMatches(openings: string[], pattern: RegExp): boolean {
  return openings.some((opening) => pattern.test(opening));
}

function nameCarriesLifespanAnywhere(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const match = name.match(NAME_LIFESPAN_ANYWHERE_RE);
  if (!match) return false;
  const startYear = Number(match[1]);
  const endYear = Number(match[2]);
  const span = endYear - startYear;
  return (
    span >= MIN_HUMAN_LIFESPAN_YEARS &&
    span <= MAX_HUMAN_LIFESPAN_YEARS &&
    endYear <= new Date().getUTCFullYear()
  );
}

function hasInMemoriamMarker(entity: Record<string, any>): boolean {
  return (
    anyUrlMatches(sourceUrlPaths(entity), IN_MEMORIAM_URL_PATH_RE) ||
    anyOpeningMatches(descriptionOpenings(entity), IN_MEMORIAM_TEXT_RE) ||
    nameCarriesLifespanAnywhere(entity.name) ||
    nameCarriesLifespanAnywhere(entity.displayName)
  );
}

/**
 * The recorded-closure marker. Written into `studentVisibilitySuppressionReason`
 * alongside the existing `research_infrastructure_only` convention, so no new
 * field is required (#2284).
 *
 * Why a recorded marker rather than a detector: nothing in the model could
 * express "this stopped existing", and nothing available can infer it either.
 * Measured on the two known-closed rows:
 *
 *  - `rudnick-lab-rudnickg` — link health HEALTHY/200 on both recorded links. A
 *    departed PI's Yale profile keeps returning 200 long after the lab is gone,
 *    so link death cannot express closure and the one instrument that looks like
 *    it should catch this actively reports the row as fine.
 *  - `dept-astronomy-debra-fischer` — still observed by `dept-faculty-roster` on
 *    2026-08-28, listed on `astronomy.yale.edu/people/faculty`, with a HEALTHY
 *    PRIMARY_IDENTITY profile link verified 2026-08-31. The PI has relocated to
 *    NASA. **Every Yale-derived signal says she is present**, because Yale's own
 *    page is stale, so no detector built from Yale sources can ever catch this
 *    class. It needs external evidence (an ORCID employment end date) or a human
 *    report.
 *
 * THIS GATE FAILS OPEN, DELIBERATELY, AND MUST STAY THAT WAY. Absence of closure
 * evidence is not evidence of closure: roughly 4,500 live rows carry no closure
 * evidence either way, so treating "unobserved" as "closed" would suppress most
 * of the corpus. Only a positively recorded marker suppresses. Do not "correct"
 * this toward fail-closed — that is the opposite of the right default here, and
 * it is the mirror of the inert-guard work in #2258.
 *
 * Deliberately NOT `NOT_CURRENTLY_AVAILABLE`, which is a live availability value
 * meaning "not recruiting right now". A student reads "not taking students this
 * term" and "this lab no longer exists" very differently, and collapsing them
 * would be its own defect.
 *
 * It lives in this util rather than in `studentVisibilityTier` because it is now
 * read by both the tier service and the Yale-status derivation below, and
 * `server/src/utils` never imports from `server/src/services`.
 */
export const PERMANENTLY_CLOSED_SUPPRESSION_REASON = 'permanently_closed';

export const hasRecordedClosureEvidence = (
  entity: Record<string, any> | null | undefined,
): boolean =>
  textValue(entity?.studentVisibilitySuppressionReason).includes(
    PERMANENTLY_CLOSED_SUPPRESSION_REASON,
  );

export function deriveResearchEntityYaleStatus(
  entity: Record<string, any> | null | undefined,
): ResearchEntityYaleStatusSignal | null {
  if (!entity) return null;
  if (researchEntityHasDeceasedLead(entity) || hasInMemoriamMarker(entity)) {
    return { yaleStatusCache: 'departed', activeAtYaleCache: false, reason: 'deceased' };
  }
  // A recorded closure is re-derived on every pass, exactly as the deceased
  // markers are, so the departure survives re-materialization instead of being
  // reset by `hasEvidencelessInactiveYaleStatus` below.
  //
  // Without this, a relocation repair had no durable home. Only
  // `facultyRosterDepartureReconciler` writes `yaleStatusReasonCache: 'departed'`
  // and it has written 0 rows corpus-wide, so a repair that set
  // `activeAtYaleCache: false` by hand was reverted on the next materialize
  // unless an operator also locked the field. That is what happened to
  // `holmes-ah724` (#1923): a relocated professor whose repair evaporated, left
  // suppressed only by the unrelated grant-only rule from #2281, and one added
  // `yale.edu` url away from returning to `operator_review`.
  //
  // The two mechanisms also disagreed before this: a row could carry a recorded
  // closure and an inactive cache, and the reset would silently clear the cache
  // while the suppression held through the other path.
  if (hasRecordedClosureEvidence(entity)) {
    return { yaleStatusCache: 'departed', activeAtYaleCache: false, reason: 'departed' };
  }
  return null;
}

export const CLEARED_RESEARCH_ENTITY_YALE_STATUS = {
  yaleStatusCache: 'unknown',
  activeAtYaleCache: true,
  yaleStatusReasonCache: '',
} as const;

export function yaleStatusCacheIsWritable(entity: Record<string, any> | null | undefined): boolean {
  const lockedFields = Array.isArray(entity?.manuallyLockedFields)
    ? entity?.manuallyLockedFields
    : [];
  return !lockedFields.includes('activeAtYaleCache') && !lockedFields.includes('yaleStatusCache');
}

// Callers must first confirm `deriveResearchEntityYaleStatus` yields no signal:
// this only decides whether an inactive cache with no live evidence behind it
// may be reset. A roster-departure cache (#2127) is owned by the reconciler and
// stays put, which is why the reason flag is checked rather than the tier.
export function hasEvidencelessInactiveYaleStatus(
  entity: Record<string, any> | null | undefined,
): boolean {
  if (!entity) return false;
  if (!yaleStatusCacheIsWritable(entity)) return false;
  if (entity.yaleStatusReasonCache === 'departed') return false;
  return entity.activeAtYaleCache === false || entity.yaleStatusCache === 'departed';
}
