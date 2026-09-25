/**
 * Retract a departmental roster or programme page a person-scoped row cites as
 * evidence about the person, on every resolve.
 *
 * `sanitizeResearchEntitySourceUrlsForMaterialization` already refuses the arms that
 * are wrong for any citer - a CMS loader endpoint, a faceted index, an advancement
 * page, a map pin - but it is a per-URL filter with no entity, so the two arms that
 * depend on WHO is citing could not live there. Those arms existed only inside
 * `scripts/retireGraftedDirectoryUrlsCore.ts`, which is why 1,274 live rows still
 * carried 1,315 of these citations and 756 of them were `student_ready`: the predicate
 * was reachable from nothing but its own repair script (#3428).
 *
 * Serve-time refusal is the wrong place for it, and that was measured rather than
 * assumed (#2630): the visibility gate groups rows on STORED `sourceUrls`, so the N
 * people who cite the one page that lists them all read as N duplicates of each other
 * whatever the DTO hides. Emptying the stored list is what ends that, so this is a
 * projection stage.
 *
 * It is a derivation and not a repair. It reads the list the projection just staged as
 * well as the stored one, so a live observation asserting the roster URL is re-filtered
 * on every pass and needs no retirement; run it twice and the second pass plans nothing
 * because the list is clean rather than because a marker says the first pass happened.
 */
import {
  isDepartmentRosterProvenanceUrl,
  isDirectoryLoaderUrl,
  isPersonScopedHostTenant,
  isProgrammePageCitedByPerson,
  isSharedPeopleRosterUrl,
  type ResearchEntityHostOwnerIdentity,
} from '../utils/researchHomeWebsiteUrl';

export type DirectoryGraftRetractionRefusal = 'would-leave-the-row-citing-nothing';

export interface DirectoryGraftRetractionPlan {
  next: string[];
  removed: string[];
  refused: DirectoryGraftRetractionRefusal | null;
}

/**
 * A faculty roster or people index cited on a person-scoped row. Scoped by the citer
 * because a roster IS legitimate evidence about the department or centre that
 * publishes it, and `isPersonScopedHostTenant` is the repository's single definition
 * of that scope: a second copy lets this stage and the serve-time gate disagree about
 * the same stored field (#2579).
 */
export function isRosterPageCitedByPerson(
  url: string,
  entity: ResearchEntityHostOwnerIdentity,
): boolean {
  if (!isPersonScopedHostTenant(entity)) return false;
  return isSharedPeopleRosterUrl(url) || isDepartmentRosterProvenanceUrl(url);
}

export function isDirectoryGraftCitation(
  url: string,
  entity: ResearchEntityHostOwnerIdentity,
): boolean {
  return isProgrammePageCitedByPerson(url, entity) || isRosterPageCitedByPerson(url, entity);
}

/**
 * Never strand a row on the roster arm alone.
 *
 * A roster is a real page about the wrong subject, so removing a row's only citation
 * trades a duplicate-URL block for a missing-evidence block, which is not an
 * improvement: 318 rows would be stranded corpus-wide if this were unguarded (#2630).
 * A loader endpoint is different and is deliberately not protected, because it was
 * never a readable page at all, so correctly unsourced beats wrongly sourced. `views/ajax`
 * satisfies the roster predicates as well as the loader one, which is why the test is
 * "roster and NOT a loader" rather than "roster".
 */
export function planDirectoryGraftCitationRetraction(input: {
  entity: ResearchEntityHostOwnerIdentity;
  sourceUrls: readonly unknown[];
}): DirectoryGraftRetractionPlan {
  const urls = input.sourceUrls.filter(
    (url): url is string => typeof url === 'string' && url.trim().length > 0,
  );
  const removed = urls.filter((url) => isDirectoryGraftCitation(url, input.entity));
  if (removed.length === 0) return { next: urls, removed: [], refused: null };

  const next = urls.filter((url) => !isDirectoryGraftCitation(url, input.entity));
  const strandedByRosterOnly =
    next.length === 0 &&
    removed.every(
      (url) => isRosterPageCitedByPerson(url, input.entity) && !isDirectoryLoaderUrl(url),
    );
  if (strandedByRosterOnly) {
    return { next: urls, removed: [], refused: 'would-leave-the-row-citing-nothing' };
  }
  return { next, removed, refused: null };
}
