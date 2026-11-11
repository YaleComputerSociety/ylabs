import { isNarrowedLabSiteDescription } from '../../utils/researchStatementPassage';
import { nonYaleMicrositeOwnership } from './nonYaleMicrositeOwnership';
import { RESEARCH_PAGE_TEXT_FIELD, researchPageTextEntries } from './researchPageText';
import { normalizeEvidenceUrl } from './sharedEvidenceUrls';

interface MicrositeDescriptionObservation {
  sourceName?: unknown;
  field?: unknown;
  value?: unknown;
  sourceUrl?: unknown;
}

export type StoredPageTextByUrl = ReadonlyMap<string, string>;

export function storedPageTextByUrl(
  observations: readonly MicrositeDescriptionObservation[],
): StoredPageTextByUrl {
  const textByUrl = new Map<string, string>();
  for (const observation of observations) {
    if (observation.field !== RESEARCH_PAGE_TEXT_FIELD) continue;
    for (const page of researchPageTextEntries(observation.value)) {
      const key = normalizeEvidenceUrl(page.url || observation.sourceUrl);
      if (!key) continue;
      textByUrl.set(key, [textByUrl.get(key), page.text].filter(Boolean).join('\n'));
    }
  }
  return textByUrl;
}

export function isRefusedNonYaleMicrositeDescription(
  observation: MicrositeDescriptionObservation,
  leadNames: readonly (string | undefined | null)[],
  pageTextByUrl: StoredPageTextByUrl = new Map(),
): boolean {
  if (!isNarrowedLabSiteDescription(observation)) return false;
  const sourceUrl = typeof observation.sourceUrl === 'string' ? observation.sourceUrl : '';
  if (!sourceUrl) return false;
  const pageText = pageTextByUrl.get(normalizeEvidenceUrl(sourceUrl)) ?? '';
  return (
    nonYaleMicrositeOwnership({
      sourceUrl,
      text: [pageText, observation.value as string].filter(Boolean).join('\n'),
      lead: { names: leadNames },
    }).decision === 'refuse'
  );
}

export function withoutRefusedNonYaleMicrositeDescriptions<
  T extends MicrositeDescriptionObservation,
>(
  observations: readonly T[],
  leadNames: readonly (string | undefined | null)[],
  pageTextSource: readonly MicrositeDescriptionObservation[] = observations,
): T[] {
  const pageTextByUrl = storedPageTextByUrl(pageTextSource);
  return observations.filter(
    (observation) => !isRefusedNonYaleMicrositeDescription(observation, leadNames, pageTextByUrl),
  );
}
