import { foldLatinDiacritics } from '../utils/latinDiacritics';

export const INITIALISM_ENTITY_TYPES: ReadonlySet<unknown> = new Set(['CENTER', 'INSTITUTE']);

export const INITIALISM_MIN_LETTERS = 3;
export const INITIALISM_MAX_LETTERS = 8;

// Function words institutions leave out of their own initialisms: the Institution for
// Social and Policy Studies is ISPS, not IFSAPS.
const TITLE_WORDS_WITHOUT_A_LETTER: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'at',
  'for',
  'in',
  'of',
  'on',
  'the',
  'to',
]);

const INSTITUTION_WORD = 'yale';
const PARENTHETICAL = /\([^)]*\)/g;
const LEADING_ONE_WORD_LABEL = /^\s*[\p{L}]+:\s+/u;
const TITLE_WORD = /[\p{L}\p{N}]+/gu;

export const centerTitleSearchPhrase = (title: string): string =>
  title.replace(PARENTHETICAL, ' ').replace(LEADING_ONE_WORD_LABEL, '').replace(/\s+/g, ' ').trim();

const significantTitleWords = (phrase: string): string[] =>
  [...foldLatinDiacritics(phrase.toLowerCase()).matchAll(TITLE_WORD)]
    .map((match) => match[0])
    .filter((word) => !TITLE_WORDS_WITHOUT_A_LETTER.has(word));

const initialismOf = (words: readonly string[]): string | null => {
  const letters = words.map((word) => word[0]).join('');
  return /^[a-z]+$/.test(letters) &&
    letters.length >= INITIALISM_MIN_LETTERS &&
    letters.length <= INITIALISM_MAX_LETTERS
    ? letters
    : null;
};

// Yale's own centers are known both with and without the Y (YCGA and CGA), so both
// forms are offered, and the guards decide which of them is safe to rewrite.
export const centerTitleInitialisms = (title: string): string[] => {
  const words = significantTitleWords(centerTitleSearchPhrase(title));
  const forms = [
    initialismOf(words),
    initialismOf(words.filter((word) => word !== INSTITUTION_WORD)),
  ];
  return [...new Set(forms.filter((form): form is string => form !== null))];
};

export interface CenterTitleInitialismSource {
  titles: readonly unknown[];
  entityType: unknown;
  served: boolean;
}

export type CenterTitleInitialismCandidates = ReadonlyMap<string, ReadonlySet<string>>;

export const collectCenterTitleInitialismCandidates = (
  sources: readonly CenterTitleInitialismSource[],
): CenterTitleInitialismCandidates => {
  const phrasesByInitialism = new Map<string, Set<string>>();
  for (const source of sources) {
    if (!source.served || !INITIALISM_ENTITY_TYPES.has(source.entityType)) continue;
    const titles = source.titles.filter(
      (title): title is string => typeof title === 'string' && title.trim() !== '',
    );
    const searchPhrase = titles.length > 0 ? centerTitleSearchPhrase(titles[0]) : '';
    if (!searchPhrase) continue;
    for (const initialism of new Set(titles.flatMap(centerTitleInitialisms))) {
      const phrases = phrasesByInitialism.get(initialism) ?? new Set<string>();
      phrases.add(searchPhrase);
      phrasesByInitialism.set(initialism, phrases);
    }
  }
  return phrasesByInitialism;
};

export const CENTER_INITIALISM_GUARDS = [
  'namesSeveralCenters',
  'reservedQueryWord',
  'englishWord',
  'corpusWord',
] as const;

export type CenterInitialismGuard = (typeof CENTER_INITIALISM_GUARDS)[number];

export interface CenterInitialismGuardChecks {
  isReservedQueryWord: (word: string) => boolean;
  isEnglishWord: (word: string) => boolean;
  isCorpusWord: (word: string) => boolean;
}

export interface CenterInitialismTable {
  phraseByInitialism: ReadonlyMap<string, string>;
  refusals: Readonly<Record<CenterInitialismGuard, number>>;
}

const sameSearchPhrase = (phrases: ReadonlySet<string>): boolean =>
  new Set([...phrases].map((phrase) => phrase.toLowerCase())).size === 1;

// Each refused initialism is counted once, under the first guard it fails, in the order of
// CENTER_INITIALISM_GUARDS.
export const resolveCenterInitialismTable = (
  candidates: CenterTitleInitialismCandidates,
  checks: CenterInitialismGuardChecks,
): CenterInitialismTable => {
  const refusals = Object.fromEntries(
    CENTER_INITIALISM_GUARDS.map((guard) => [guard, 0]),
  ) as Record<CenterInitialismGuard, number>;
  const phraseByInitialism = new Map<string, string>();
  for (const [initialism, phrases] of candidates) {
    const refusedBy: CenterInitialismGuard | null = !sameSearchPhrase(phrases)
      ? 'namesSeveralCenters'
      : checks.isReservedQueryWord(initialism)
        ? 'reservedQueryWord'
        : checks.isEnglishWord(initialism)
          ? 'englishWord'
          : checks.isCorpusWord(initialism)
            ? 'corpusWord'
            : null;
    if (refusedBy) refusals[refusedBy] += 1;
    else phraseByInitialism.set(initialism, [...phrases][0]);
  }
  return { phraseByInitialism, refusals };
};
