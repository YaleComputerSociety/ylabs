import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import { getMeiliSearchIndex } from '../utils/meiliClient';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  buildSearchSpellingVocabulary,
  type SearchSpellingVocabulary,
  type SearchVocabularyDocument,
} from './searchQuerySpellingCorrection';

export const RESEARCH_SEARCH_SPELLING_NAME_FIELDS = [
  'name',
  'displayName',
  'leadProfessorNames',
  'professorNames',
] as const;

export const RESEARCH_SEARCH_SPELLING_BODY_FIELDS = [
  'researchAreas',
  'methods',
  'studentSearchTerms',
  'departments',
  'orgAffiliationLabels',
  'shortDescription',
  'fullDescription',
  'school',
  'entityTypeSearchTerms',
] as const;

const PAGE_SIZE = 1000;
const MAX_DOCUMENTS = 100000;
export const RESEARCH_SEARCH_SPELLING_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

interface VocabularySearchIndex {
  search: (
    query: string,
    params: Record<string, unknown>,
  ) => Promise<{ hits: Array<Record<string, unknown>>; estimatedTotalHits?: number }>;
}

let currentVocabulary: SearchSpellingVocabulary | null = null;
let inFlightWarm: Promise<SearchSpellingVocabulary | null> | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const SERVED_TIERS = new Set<unknown>(publicStudentVisibilityTiers);

const toVocabularyDocument = (hit: Record<string, unknown>): SearchVocabularyDocument => ({
  nameText: RESEARCH_SEARCH_SPELLING_NAME_FIELDS.map((field) => hit[field]),
  bodyText: RESEARCH_SEARCH_SPELLING_BODY_FIELDS.map((field) => hit[field]),
  served: SERVED_TIERS.has(hit.studentVisibilityTier),
});

export const loadResearchSearchSpellingVocabulary = async (
  getIndex: () => Promise<VocabularySearchIndex> = () =>
    getMeiliSearchIndex('researchentities') as Promise<VocabularySearchIndex>,
): Promise<SearchSpellingVocabulary> => {
  const index = await getIndex();
  const documents: SearchVocabularyDocument[] = [];
  for (let offset = 0; offset < MAX_DOCUMENTS; offset += PAGE_SIZE) {
    const page = await index.search('', {
      filter: 'archived = false',
      limit: PAGE_SIZE,
      offset,
      attributesToRetrieve: [
        ...RESEARCH_SEARCH_SPELLING_NAME_FIELDS,
        ...RESEARCH_SEARCH_SPELLING_BODY_FIELDS,
        'studentVisibilityTier',
      ],
    });
    documents.push(...page.hits.map(toVocabularyDocument));
    if (page.hits.length < PAGE_SIZE) break;
  }
  return buildSearchSpellingVocabulary(documents);
};

export const getResearchSearchSpellingVocabulary = (): SearchSpellingVocabulary | null =>
  currentVocabulary;

export const warmResearchSearchSpellingVocabulary = (
  load: () => Promise<SearchSpellingVocabulary> = loadResearchSearchSpellingVocabulary,
): Promise<SearchSpellingVocabulary | null> => {
  if (inFlightWarm) return inFlightWarm;
  inFlightWarm = load()
    .then((vocabulary) => {
      currentVocabulary = vocabulary;
      return vocabulary;
    })
    .catch((error: unknown) => {
      console.error(
        '[search] spelling vocabulary load failed, so misspelled queries are searched as typed:',
        sanitizeLogValue(error),
      );
      return currentVocabulary;
    })
    .finally(() => {
      inFlightWarm = null;
    });
  return inFlightWarm;
};

export const startResearchSearchSpellingVocabularyRefresh = (
  intervalMs = RESEARCH_SEARCH_SPELLING_REFRESH_INTERVAL_MS,
): void => {
  void warmResearchSearchSpellingVocabulary();
  if (refreshTimer) return;
  refreshTimer = setInterval(() => void warmResearchSearchSpellingVocabulary(), intervalMs);
  refreshTimer.unref?.();
};

export const setResearchSearchSpellingVocabularyForTests = (
  vocabulary: SearchSpellingVocabulary | null,
): void => {
  currentVocabulary = vocabulary;
};
