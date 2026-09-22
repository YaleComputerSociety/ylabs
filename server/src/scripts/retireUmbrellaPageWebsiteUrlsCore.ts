import { isUmbrellaPageCitedByPerson } from '../utils/researchHomeWebsiteUrl';

export interface UmbrellaWebsiteUrlCandidateEntity {
  entityType?: unknown;
  kind?: unknown;
  websiteUrl?: unknown;
  sourceUrls?: unknown;
}

export interface UmbrellaWebsiteUrlRepairPlan {
  retiredWebsiteUrl: string;
  citationRetained: boolean;
}

const stringEntries = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/**
 * What one row needs to stop offering a page about a collective as its own research
 * website. Only the typed `websiteUrl` slot is retired; `sourceUrls` is untouched,
 * because a group root or a department page that names the person IS legitimate
 * provenance and the row would otherwise trade a wrong link for missing evidence
 * (#2579).
 */
export function planUmbrellaWebsiteUrlRepair(
  entity: UmbrellaWebsiteUrlCandidateEntity,
): UmbrellaWebsiteUrlRepairPlan | null {
  const websiteUrl = typeof entity.websiteUrl === 'string' ? entity.websiteUrl.trim() : '';
  if (!websiteUrl) return null;
  if (!isUmbrellaPageCitedByPerson(websiteUrl, entity)) return null;
  return {
    retiredWebsiteUrl: websiteUrl,
    citationRetained: stringEntries(entity.sourceUrls).includes(websiteUrl),
  };
}

/**
 * Whether a stored observation is the assertion that put the umbrella page in the
 * `websiteUrl` slot. Clearing the field alone leaves the assertion live and the next
 * materialize pass re-projects it (#2542), so the lane retires the observation too -
 * but only the `websiteUrl`-valued ones, never the `sourceUrls` citation.
 */
export function isUmbrellaValuedWebsiteUrlObservation(
  field: string,
  value: unknown,
  entity: UmbrellaWebsiteUrlCandidateEntity,
): boolean {
  if (field !== 'websiteUrl') return false;
  return typeof value === 'string' && isUmbrellaPageCitedByPerson(value, entity);
}
