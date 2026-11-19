import { isDescriptionGroundedInSource } from '../../utils/officialResearchDescription';
import { LAB_SITE_DESCRIPTION_SOURCE } from '../../utils/researchStatementPassage';
import type { StoredPageTextByUrl } from './nonYaleMicrositeDescriptionScreen';
import { normalizeEvidenceUrl } from './sharedEvidenceUrls';

interface LabSiteObservation {
  field?: unknown;
  value?: unknown;
  sourceName?: unknown;
  sourceUrl?: unknown;
}

const comparableText = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().toLowerCase() : '';

const isLabSiteBodyObservation = (observation: LabSiteObservation): boolean =>
  observation.sourceName === LAB_SITE_DESCRIPTION_SOURCE &&
  observation.field === 'fullDescription' &&
  typeof observation.sourceUrl === 'string' &&
  observation.sourceUrl !== '';

/**
 * The pages a lab-site body cites: the observation that carries this exact text when one
 * does, and otherwise every page the lane read a body from, because the resolver narrows
 * a person row's body (#5648) and the narrowed passage matches no stored value.
 */
export function labSiteBodyPageUrls(
  body: unknown,
  observations: readonly LabSiteObservation[],
): string[] {
  const bodies = observations.filter(isLabSiteBodyObservation);
  const exact = bodies.filter(
    (observation) => comparableText(observation.value) === comparableText(body),
  );
  return [...new Set((exact.length > 0 ? exact : bodies).map((obs) => String(obs.sourceUrl)))];
}

/**
 * Whether a lab-site body is on a stored copy of a page it cites (#4869, #5961). A body
 * with no stored page is not grounded, because nothing the row keeps shows it is the page's.
 */
export function isLabSiteBodyGroundedOnItsPage(input: {
  body: unknown;
  pageUrls: readonly string[];
  pageTextByUrl: StoredPageTextByUrl;
}): boolean {
  return input.pageUrls.some((pageUrl) => {
    const pageText = input.pageTextByUrl.get(normalizeEvidenceUrl(pageUrl));
    return Boolean(pageText) && isDescriptionGroundedInSource(input.body, pageText);
  });
}
