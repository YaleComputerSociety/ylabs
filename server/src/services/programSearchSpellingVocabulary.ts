import { Fellowship } from '../models/fellowship';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { foldLatinDiacritics } from '../utils/latinDiacritics';
import { PROGRAM_QUERY_ALIAS_PHRASES } from './programTopicService';
import { getResearchSearchSpellingVocabulary } from './researchSearchSpellingVocabulary';
import {
  buildSearchSpellingVocabulary,
  correctSearchQuerySpelling,
  type CorrectedSearchQuery,
  type SearchSpellingProtectedTerms,
  type SearchSpellingVocabulary,
} from './searchQuerySpellingCorrection';

export const PROGRAM_SEARCH_SPELLING_FIELDS = [
  'title',
  'summary',
  'description',
  'eligibility',
  'competitionType',
  'applicationInformation',
  'additionalInformation',
  'purpose',
  'studentFacingCategory',
] as const;

export const PROGRAM_SEARCH_SPELLING_TTL_MS = 10 * 60 * 1000;
const RESEARCH_WORD_MIN_DOCUMENTS = 3;

export const PROGRAM_QUERY_STOP_WORDS = ['a', 'an', 'and', 'for', 'in', 'of', 'on', 'or', 'the', 'to'];

const PROGRAM_PROTECTED_QUERY_TERMS: ReadonlySet<string> = new Set(
  [...PROGRAM_QUERY_ALIAS_PHRASES, ...PROGRAM_QUERY_STOP_WORDS].flatMap(
    (phrase) => foldLatinDiacritics(phrase.toLowerCase()).match(/[a-z]+/g) ?? [],
  ),
);

let cached: { vocabulary: SearchSpellingVocabulary; loadedAt: number } | null = null;
const sortedWordsByVocabulary = new WeakMap<SearchSpellingVocabulary, string[]>();

const sortedWords = (vocabulary: SearchSpellingVocabulary, minDocuments: number): string[] => {
  const known = sortedWordsByVocabulary.get(vocabulary);
  if (known) return known;
  const words = [...vocabulary.documentFrequency]
    .filter(([, frequency]) => frequency >= minDocuments)
    .map(([word]) => word)
    .sort();
  sortedWordsByVocabulary.set(vocabulary, words);
  return words;
};

const startsALongerWord = (words: readonly string[], prefix: string): boolean => {
  let low = 0;
  let high = words.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (words[middle] <= prefix) low = middle + 1;
    else high = middle;
  }
  return low < words.length && words[low].startsWith(prefix);
};
let inFlightLoad: Promise<SearchSpellingVocabulary | null> | null = null;

export const loadProgramSearchSpellingVocabulary = async (): Promise<SearchSpellingVocabulary> => {
  const programs = (await Fellowship.find(
    { archived: false, studentVisibilityTier: { $in: publicStudentVisibilityTiers } },
    Object.fromEntries(PROGRAM_SEARCH_SPELLING_FIELDS.map((field) => [field, 1])),
  ).lean()) as Array<Record<string, unknown>>;
  return buildSearchSpellingVocabulary(
    programs.map((program) => ({
      nameText: [],
      bodyText: PROGRAM_SEARCH_SPELLING_FIELDS.map((field) => program[field]),
      served: true,
    })),
  );
};

const refreshProgramSearchSpellingVocabulary = (
  load: () => Promise<SearchSpellingVocabulary>,
): Promise<SearchSpellingVocabulary | null> => {
  if (inFlightLoad) return inFlightLoad;
  inFlightLoad = load()
    .then((vocabulary) => {
      cached = { vocabulary, loadedAt: Date.now() };
      return vocabulary;
    })
    .catch((error: unknown) => {
      console.error(
        '[programs] spelling vocabulary load failed, so misspelled queries are searched as typed:',
        sanitizeLogValue(error),
      );
      return cached?.vocabulary ?? null;
    })
    .finally(() => {
      inFlightLoad = null;
    });
  return inFlightLoad;
};

export const getProgramSearchSpellingVocabulary = async (
  load: () => Promise<SearchSpellingVocabulary> = loadProgramSearchSpellingVocabulary,
  now = Date.now(),
): Promise<SearchSpellingVocabulary | null> => {
  if (!cached) return refreshProgramSearchSpellingVocabulary(load);
  if (now - cached.loadedAt > PROGRAM_SEARCH_SPELLING_TTL_MS) {
    void refreshProgramSearchSpellingVocabulary(load);
  }
  return cached.vocabulary;
};

export const resetProgramSearchSpellingVocabularyForTests = (): void => {
  cached = null;
  inFlightLoad = null;
};

// A word the research corpus carries in several rows is a real word even when no program uses
// it, so it is never rewritten into a program word one edit away: `econ` must not become
// `icon`. A single research row is not enough, because research prose carries its own typos.
// See #4537.
// The program search box searches as the student types, so a word that starts a real word is
// unfinished rather than misspelled and is left to the word-prefix match: `fres` is the start of
// `freshman`, not a typo for `fees`.
const programProtectedTerms = (
  programs: SearchSpellingVocabulary,
  research: SearchSpellingVocabulary,
): SearchSpellingProtectedTerms => {
  const programWords = sortedWords(programs, 1);
  const researchWords = sortedWords(research, RESEARCH_WORD_MIN_DOCUMENTS);
  return {
    has: (term: string) =>
      PROGRAM_PROTECTED_QUERY_TERMS.has(term) ||
      (research.documentFrequency.get(term) ?? 0) >= RESEARCH_WORD_MIN_DOCUMENTS ||
      research.nameTerms.has(term) ||
      startsALongerWord(programWords, term) ||
      startsALongerWord(researchWords, term),
  };
};

export const correctProgramSearchQuerySpelling = async (
  query: string,
): Promise<CorrectedSearchQuery> => {
  if (!query.trim()) return { query, corrections: [] };
  const research = getResearchSearchSpellingVocabulary();
  if (!research) return { query, corrections: [] };
  const vocabulary = await getProgramSearchSpellingVocabulary();
  if (!vocabulary) return { query, corrections: [] };
  return correctSearchQuerySpelling(
    query,
    vocabulary,
    programProtectedTerms(vocabulary, research),
  );
};
