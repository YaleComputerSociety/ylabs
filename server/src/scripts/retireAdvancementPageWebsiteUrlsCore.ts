import { isInstitutionalAdvancementUrl } from '../utils/researchHomeWebsiteUrl';

export interface AdvancementRepairCandidateEntity {
  websiteUrl?: unknown;
  sourceUrls?: unknown;
}

export interface AdvancementRepairPlan {
  clearWebsiteUrl: boolean;
  retiredWebsiteUrl?: string;
  nextSourceUrls: string[];
  removedSourceUrls: string[];
}

const stringEntries = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/**
 * What a single entity needs to stop serving a fundraising page as its research
 * home. Returns `null` when the entity carries no advancement URL, so the caller
 * counts a genuine no-op separately from a repair.
 */
export function planAdvancementWebsiteRepair(
  entity: AdvancementRepairCandidateEntity,
): AdvancementRepairPlan | null {
  const websiteUrl = typeof entity.websiteUrl === 'string' ? entity.websiteUrl : undefined;
  const clearWebsiteUrl = websiteUrl !== undefined && isInstitutionalAdvancementUrl(websiteUrl);

  const sourceUrls = stringEntries(entity.sourceUrls);
  const removedSourceUrls = sourceUrls.filter((url) => isInstitutionalAdvancementUrl(url));
  const nextSourceUrls = sourceUrls.filter((url) => !isInstitutionalAdvancementUrl(url));

  if (!clearWebsiteUrl && removedSourceUrls.length === 0) return null;

  return {
    clearWebsiteUrl,
    ...(clearWebsiteUrl && websiteUrl ? { retiredWebsiteUrl: websiteUrl } : {}),
    nextSourceUrls,
    removedSourceUrls,
  };
}

/**
 * A repair that empties `sourceUrls` leaves the row with no citation at all. That
 * is the intended outcome for the #2460 cohort - correctly unsourced beats wrongly
 * sourced - but it changes a visibility-gate input, so the caller reports it
 * separately rather than folding it into the repair count.
 */
export function leavesEntityWithNoCitation(plan: AdvancementRepairPlan): boolean {
  return plan.removedSourceUrls.length > 0 && plan.nextSourceUrls.length === 0;
}

export function isAdvancementValuedObservation(field: string, value: unknown): boolean {
  if (field === 'websiteUrl') return typeof value === 'string' && isInstitutionalAdvancementUrl(value);
  if (field === 'sourceUrls') return stringEntries(value).some(isInstitutionalAdvancementUrl);
  return false;
}
