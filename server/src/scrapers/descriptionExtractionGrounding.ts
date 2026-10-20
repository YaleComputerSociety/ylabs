import { isDescriptionGroundedInSource } from '../utils/officialResearchDescription';
import { evidenceValueTexts } from '../utils/evidenceValueTexts';

/**
 * The model description lane began requiring its body to be a verbatim substring of the
 * fetched page with #528, merged to beta at this instant. A body or card it stored before
 * then was never checked against its page, and the 2026-10-19 sample found the only
 * invented bodies this lane serves in exactly that class (#5296).
 */
export const DESCRIPTION_EXTRACTION_SOURCE_NAME = 'lab-microsite-description-llm';
export const PAGE_GROUNDING_VERIFIED_SINCE = new Date('2026-08-22T19:15:50Z');

const PRE_GROUNDING_REFUSED_FIELDS: ReadonlySet<string> = new Set([
  'fullDescription',
  'shortDescription',
]);

let preGroundingRefusalCutoff = PAGE_GROUNDING_VERIFIED_SINCE;

/**
 * Fixtures written before this class existed date the model lane's prose freely, so a test
 * that is about something else opts out explicitly rather than having its dates rewritten.
 */
export function setPreGroundingRefusalCutoffForTesting(cutoff: Date | null): void {
  preGroundingRefusalCutoff = cutoff ?? PAGE_GROUNDING_VERIFIED_SINCE;
}

function observedTime(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value as string | number).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function isPreGroundingExtractionProse(observation: {
  sourceName?: unknown;
  field?: unknown;
  observedAt?: unknown;
}): boolean {
  if (observation.sourceName !== DESCRIPTION_EXTRACTION_SOURCE_NAME) return false;
  if (!PRE_GROUNDING_REFUSED_FIELDS.has(String(observation.field))) return false;
  const time = observedTime(observation.observedAt);
  return Number.isFinite(time) && time < preGroundingRefusalCutoff.getTime();
}

export const PAGE_RESEARCH_TEXT_SOURCE_NAME = 'lab-site-research-read';
export const PAGE_RESEARCH_TEXT_FIELD = 'researchSummary';

/**
 * The row's page research text as the deterministic lane stored it, which is the page a
 * pre-grounding body can be checked against at resolve without a fetch.
 */
export function storedPageResearchText(
  observations: readonly { sourceName?: unknown; field?: unknown; value?: unknown }[],
): string {
  return observations
    .filter(
      (observation) =>
        observation.sourceName === PAGE_RESEARCH_TEXT_SOURCE_NAME &&
        observation.field === PAGE_RESEARCH_TEXT_FIELD,
    )
    .flatMap((observation) => evidenceValueTexts(observation.value))
    .join('\n');
}

/**
 * A pre-grounding body or card is refused unless the row's stored page research text
 * carries it verbatim. On the sampled rows 6 of 8 such bodies and all 11 such cards were
 * not on their page; the other 2 bodies were, and they keep serving once the code lane
 * has read the page.
 */
export function isUngroundedPreGroundingExtractionProse(
  observation: { sourceName?: unknown; field?: unknown; observedAt?: unknown; value?: unknown },
  pageResearchText: string,
): boolean {
  if (!isPreGroundingExtractionProse(observation)) return false;
  return !(pageResearchText && isDescriptionGroundedInSource(observation.value, pageResearchText));
}
