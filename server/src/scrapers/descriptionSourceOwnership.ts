import type { ObservedEntityType } from '../models/observation';
import { isPersonProfileOrDirectoryUrl } from '../utils/researchHomeWebsiteUrl';
import { normalizeEvidenceUrl } from './utils/sharedEvidenceUrls';

/**
 * A page many rows cite cannot be the description of any one of them.
 *
 * `labMicrositeDescriptionLLMExtractor` already refuses this, but only for itself
 * (#3162). Measured after that landed, 37 served rows still carried an unowned
 * description, and every one came from a lane the refusal never reached:
 * `dept-faculty-roster` 29 and `ysm-atoz-index` 8 (#3481). So the judgement belongs
 * on the path every lane writes through, next to `isUncitableHostUrl`, rather than
 * copied into each extractor.
 *
 * ## Why the bar is a third citer and not a second
 *
 * Two rows citing one page is usually one subject stored twice: a person's LAB row
 * and their research-area row both cite their lab's site, and both are legitimately
 * described by it. 37 of the 91 unowned rows measured were that shape, and refusing
 * them would withhold a correct description to punish a duplicate-row defect that
 * belongs to dedupe. A third citer is what makes a page institutional: a faculty
 * directory cited by 20 rows cannot be about any of them.
 *
 * Measured against the same corpus, the third-citer bar refuses 31 of the 37
 * post-guard rows, which is all 29 from `dept-faculty-roster` plus 2, and declines
 * the 6 remaining, all of which are the two-row same-subject shape. So it is a
 * refusal with no measured false positive rather than the widest possible net.
 *
 * A person's own profile is exempt for the reason the extractor exempts it: it is
 * cited by that person's several rows and describes all of them.
 */
export const DESCRIPTION_SOURCE_MIN_FOREIGN_CITERS = 2;

export const OWNERSHIP_GUARDED_DESCRIPTION_FIELDS: ReadonlySet<string> = new Set([
  'fullDescription',
  'shortDescription',
  'description',
]);

/**
 * Typed against the model's own union rather than a string literal. The first cut of
 * this guard compared against `'research_entity'`, which no observation carries, so
 * the refusal was inert on every row and typechecked cleanly (#3481).
 */
export const OWNERSHIP_GUARDED_ENTITY_TYPE: ObservedEntityType = 'researchEntity';

export interface DescriptionOwnershipCandidate {
  entityType: string;
  field: string;
  sourceUrl?: unknown;
}

/** Whether this observation is one the ownership bar applies to at all. */
export function isOwnershipGuardedDescription(candidate: DescriptionOwnershipCandidate): boolean {
  if (candidate.entityType !== OWNERSHIP_GUARDED_ENTITY_TYPE) return false;
  if (!OWNERSHIP_GUARDED_DESCRIPTION_FIELDS.has(candidate.field)) return false;
  const url = normalizeEvidenceUrl(candidate.sourceUrl);
  return url.length > 0 && !isPersonProfileOrDirectoryUrl(url);
}

/**
 * Refuse when the cited page is already the description source for at least
 * `DESCRIPTION_SOURCE_MIN_FOREIGN_CITERS` other entities.
 *
 * `foreignCiters` counts entities other than the one being written, so the caller
 * never has to reason about whether the row being written is included.
 */
export function refusesDescriptionOnSharedPage(
  candidate: DescriptionOwnershipCandidate,
  foreignCiters: number,
): boolean {
  if (!isOwnershipGuardedDescription(candidate)) return false;
  return foreignCiters >= DESCRIPTION_SOURCE_MIN_FOREIGN_CITERS;
}

/**
 * The distinct cited URLs in a batch that the ownership bar could apply to.
 *
 * Returned normalized, so the count the caller looks up and the value the refusal
 * tests are the same string. A mismatch there is how a guard reads zero citers for a
 * page cited twenty times.
 */
export function ownershipGuardedCitedUrls(
  candidates: readonly DescriptionOwnershipCandidate[],
): string[] {
  const urls = new Set<string>();
  for (const candidate of candidates) {
    if (!isOwnershipGuardedDescription(candidate)) continue;
    urls.add(normalizeEvidenceUrl(candidate.sourceUrl));
  }
  return [...urls];
}
