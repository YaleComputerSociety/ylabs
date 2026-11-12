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

export const MICROSITE_PAGE_DERIVED_FIELDS_BY_SOURCE: ReadonlyMap<
  string,
  ReadonlySet<string>
> = new Map([
  ['lab-microsite-description-llm', new Set(['shortDescription', 'researchAreas', 'methods'])],
  [
    'lab-microsite-undergrad-llm',
    new Set([
      'undergradAccessEvidence',
      'currentUndergradCount',
      'pastUndergradAdvisees',
      'undergradEvidenceQuote',
      'joinPageUrl',
      'undergradRoleEvidenceQuote',
      'contactInstructionsQuote',
      'undergradConstraintQuote',
    ]),
  ],
]);

export const isMicrositePageDerivedField = (
  observation: MicrositeDescriptionObservation,
): boolean =>
  typeof observation.sourceName === 'string' &&
  typeof observation.field === 'string' &&
  (MICROSITE_PAGE_DERIVED_FIELDS_BY_SOURCE.get(observation.sourceName)?.has(observation.field) ??
    false);

const isMicrositeLaneObservation = (observation: MicrositeDescriptionObservation): boolean =>
  typeof observation.sourceName === 'string' &&
  MICROSITE_PAGE_DERIVED_FIELDS_BY_SOURCE.has(observation.sourceName);

const isUrlText = (value: string): boolean => /^https?:\/\//i.test(value.trim());

const observedTextOf = (value: unknown): string[] => {
  if (typeof value === 'string') return isUrlText(value) ? [] : [value];
  if (Array.isArray(value)) return value.flatMap(observedTextOf);
  if (value && typeof value === 'object') return Object.values(value).flatMap(observedTextOf);
  return [];
};

const micrositeSiteOf = (pageUrl: unknown): string => {
  const normalized = normalizeEvidenceUrl(pageUrl);
  return normalized ? new URL(normalized).hostname : '';
};

export type MicrositeTextBySite = ReadonlyMap<string, string>;

function micrositeTextBySite(
  observations: readonly MicrositeDescriptionObservation[],
): MicrositeTextBySite {
  const textBySite = new Map<string, string>();
  const append = (pageUrl: unknown, text: string) => {
    const site = micrositeSiteOf(pageUrl);
    if (site && text) textBySite.set(site, [textBySite.get(site), text].filter(Boolean).join('\n'));
  };
  for (const [pageUrl, text] of storedPageTextByUrl(observations)) append(pageUrl, text);
  for (const observation of observations) {
    if (!isMicrositeLaneObservation(observation)) continue;
    append(observation.sourceUrl, observedTextOf(observation.value).join('\n'));
  }
  return textBySite;
}

export function isRefusedNonYaleMicrositePageField(
  observation: MicrositeDescriptionObservation,
  leadNames: readonly (string | undefined | null)[],
  pageTextBySite: MicrositeTextBySite = new Map(),
): boolean {
  if (!isMicrositePageDerivedField(observation)) return false;
  const sourceUrl = typeof observation.sourceUrl === 'string' ? observation.sourceUrl : '';
  if (!sourceUrl) return false;
  return (
    nonYaleMicrositeOwnership({
      sourceUrl,
      text: pageTextBySite.get(micrositeSiteOf(sourceUrl)) ?? '',
      lead: { names: leadNames },
    }).decision === 'refuse'
  );
}

export function withoutRefusedNonYaleMicrositePageFields<T extends MicrositeDescriptionObservation>(
  observations: readonly T[],
  leadNames: readonly (string | undefined | null)[],
  pageTextSource: readonly MicrositeDescriptionObservation[] = observations,
): T[] {
  const pageTextBySite = micrositeTextBySite(pageTextSource);
  return observations.filter(
    (observation) => !isRefusedNonYaleMicrositePageField(observation, leadNames, pageTextBySite),
  );
}
