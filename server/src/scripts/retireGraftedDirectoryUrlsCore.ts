import {
  isDirectoryLoaderUrl,
  isProgrammePageCitedByPerson,
} from '../utils/researchHomeWebsiteUrl';

export interface GraftedUrlCandidateEntity {
  entityType?: unknown;
  websiteUrl?: unknown;
  sourceUrls?: unknown;
}

export interface GraftedUrlRepairPlan {
  clearWebsiteUrl: boolean;
  retiredWebsiteUrl?: string;
  nextSourceUrls: string[];
  removedSourceUrls: string[];
}

const stringEntries = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/**
 * A URL neither guard can mint any more. `isDirectoryLoaderUrl` is unconditional
 * because a CMS internal endpoint is never a readable page, while the programme-page
 * arm is entity-scoped: the same page is legitimate evidence for an organizational
 * row and for the fellowship records `department-undergrad-research` writes, and is
 * a graft only on a person (#2609). So the entity is required, not optional.
 */
export function isGraftedDirectoryUrl(url: string, entity: GraftedUrlCandidateEntity): boolean {
  return isDirectoryLoaderUrl(url) || isProgrammePageCitedByPerson(url, entity);
}

/**
 * What one entity needs to stop carrying a grafted directory URL. Returns `null`
 * when the entity carries none, so the caller counts a genuine no-op separately
 * from a repair rather than reporting an inflated total.
 */
export function planGraftedUrlRepair(
  entity: GraftedUrlCandidateEntity,
): GraftedUrlRepairPlan | null {
  const websiteUrl = typeof entity.websiteUrl === 'string' ? entity.websiteUrl : undefined;
  const clearWebsiteUrl = websiteUrl !== undefined && isGraftedDirectoryUrl(websiteUrl, entity);

  const sourceUrls = stringEntries(entity.sourceUrls);
  const removedSourceUrls = sourceUrls.filter((url) => isGraftedDirectoryUrl(url, entity));
  const nextSourceUrls = sourceUrls.filter((url) => !isGraftedDirectoryUrl(url, entity));

  if (!clearWebsiteUrl && removedSourceUrls.length === 0) return null;

  return {
    clearWebsiteUrl,
    ...(clearWebsiteUrl && websiteUrl ? { retiredWebsiteUrl: websiteUrl } : {}),
    nextSourceUrls,
    removedSourceUrls,
  };
}

/**
 * Emptying `sourceUrls` changes a visibility-gate input, so it is reported rather
 * than folded into the repair count. Measured before this lane was written, zero of
 * the 19 reachable rows in the #2611 cohort hit this, unlike the #2460 cohort. A
 * non-zero count here means the cohort has changed and the run needs re-reading
 * before it is promoted.
 */
export function leavesEntityWithNoCitation(plan: GraftedUrlRepairPlan): boolean {
  return plan.removedSourceUrls.length > 0 && plan.nextSourceUrls.length === 0;
}

/**
 * Whether a stored observation is the one that put a grafted URL on the row, so the
 * lane retires the assertion instead of only clearing the projected field. Clearing
 * the field alone leaves the observation live and a later rematerialize re-projects
 * it (#2542).
 */
export function isGraftValuedObservation(
  field: string,
  value: unknown,
  entity: GraftedUrlCandidateEntity,
): boolean {
  if (field === 'websiteUrl')
    return typeof value === 'string' && isGraftedDirectoryUrl(value, entity);
  if (field === 'sourceUrls')
    return stringEntries(value).some((url) => isGraftedDirectoryUrl(url, entity));
  return false;
}
