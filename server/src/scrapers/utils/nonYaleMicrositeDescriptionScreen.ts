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

const NO_LEAD_GRANT_AWARD_RECORDS: ReadonlySet<string> = new Set();

export function isRefusedNonYaleMicrositeDescription(
  observation: MicrositeDescriptionObservation,
  leadNames: readonly (string | undefined | null)[],
  pageTextByUrl: StoredPageTextByUrl = new Map(),
  leadGrantAwardRecordKeys: ReadonlySet<string> = NO_LEAD_GRANT_AWARD_RECORDS,
): boolean {
  if (!isNarrowedLabSiteDescription(observation)) return false;
  const sourceUrl = typeof observation.sourceUrl === 'string' ? observation.sourceUrl : '';
  if (!sourceUrl) return false;
  const pageText = pageTextByUrl.get(normalizeEvidenceUrl(sourceUrl)) ?? '';
  return (
    nonYaleMicrositeOwnership({
      sourceUrl,
      text: [pageText, observation.value as string].filter(Boolean).join('\n'),
      lead: { names: leadNames, grantAwardRecordKeys: leadGrantAwardRecordKeys },
    }).decision === 'refuse'
  );
}

export function withoutRefusedNonYaleMicrositeDescriptions<
  T extends MicrositeDescriptionObservation,
>(
  observations: readonly T[],
  leadNames: readonly (string | undefined | null)[],
  pageTextSource: readonly MicrositeDescriptionObservation[] = observations,
  leadGrantAwardRecordKeys: ReadonlySet<string> = NO_LEAD_GRANT_AWARD_RECORDS,
): T[] {
  const pageTextByUrl = storedPageTextByUrl(pageTextSource);
  return observations.filter(
    (observation) =>
      !isRefusedNonYaleMicrositeDescription(
        observation,
        leadNames,
        pageTextByUrl,
        leadGrantAwardRecordKeys,
      ),
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

const isUndergradLaneMultiPageSummary = (observation: MicrositeDescriptionObservation): boolean =>
  observation.sourceName === 'lab-microsite-undergrad-llm' &&
  (observation.field === 'fullDescription' || observation.field === 'shortDescription');

type PageText = readonly [page: unknown, text: unknown];

function observedTextByPage(observation: MicrositeDescriptionObservation): PageText[] {
  if (!isMicrositeLaneObservation(observation)) return [];
  if (isUndergradLaneMultiPageSummary(observation)) return [];
  if (observation.field === 'undergradAccessEvidence') {
    const value = (observation.value ?? {}) as Record<string, unknown>;
    return [
      [value.quoteSourceUrl, value.evidenceQuote],
      [value.joinPageUrl, value.joinPageInvitation],
    ];
  }
  return [[observation.sourceUrl, observedTextOf(observation.value).join('\n')]];
}

function micrositeTextByPage(
  observations: readonly MicrositeDescriptionObservation[],
): StoredPageTextByUrl {
  const textByPage = new Map(storedPageTextByUrl(observations));
  for (const [pageUrl, observedText] of observations.flatMap(observedTextByPage)) {
    const page = normalizeEvidenceUrl(pageUrl);
    const text = observedTextOf(observedText).join('\n');
    if (page && text) textByPage.set(page, [textByPage.get(page), text].filter(Boolean).join('\n'));
  }
  return textByPage;
}

export function isRefusedNonYaleMicrositePageField(
  observation: MicrositeDescriptionObservation,
  leadNames: readonly (string | undefined | null)[],
  pageTextByUrl: StoredPageTextByUrl = new Map(),
  leadGrantAwardRecordKeys: ReadonlySet<string> = NO_LEAD_GRANT_AWARD_RECORDS,
): boolean {
  if (!isMicrositePageDerivedField(observation)) return false;
  const sourceUrl = typeof observation.sourceUrl === 'string' ? observation.sourceUrl : '';
  if (!sourceUrl) return false;
  return (
    nonYaleMicrositeOwnership({
      sourceUrl,
      text: pageTextByUrl.get(normalizeEvidenceUrl(sourceUrl)) ?? '',
      lead: { names: leadNames, grantAwardRecordKeys: leadGrantAwardRecordKeys },
    }).decision === 'refuse'
  );
}

export function withoutRefusedNonYaleMicrositePageFields<T extends MicrositeDescriptionObservation>(
  observations: readonly T[],
  leadNames: readonly (string | undefined | null)[],
  pageTextSource: readonly MicrositeDescriptionObservation[] = observations,
  leadGrantAwardRecordKeys: ReadonlySet<string> = NO_LEAD_GRANT_AWARD_RECORDS,
): T[] {
  const pageTextByUrl = micrositeTextByPage(pageTextSource);
  return observations.filter(
    (observation) =>
      !isRefusedNonYaleMicrositePageField(
        observation,
        leadNames,
        pageTextByUrl,
        leadGrantAwardRecordKeys,
      ),
  );
}
