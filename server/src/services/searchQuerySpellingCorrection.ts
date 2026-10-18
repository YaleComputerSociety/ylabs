import { foldLatinDiacritics } from '../utils/latinDiacritics';

export interface SearchVocabularyDocument {
  nameText: readonly unknown[];
  personNameText?: readonly unknown[];
  bodyText: readonly unknown[];
  served: boolean;
}

export interface SearchSpellingVocabulary {
  documentCount: number;
  documentFrequency: ReadonlyMap<string, number>;
  nameTerms: ReadonlySet<string>;
  personNameWords: readonly string[];
  candidatesByLength: ReadonlyMap<number, ReadonlyArray<readonly [string, number]>>;
}

export interface SearchQueryCorrection {
  from: string;
  to: string;
}

export interface CorrectedSearchQuery {
  query: string;
  corrections: SearchQueryCorrection[];
}

export type SearchSpellingProtectedTerms = Pick<ReadonlySet<string>, 'has'>;

export const SPELLING_CANDIDATE_MIN_DOCUMENTS = 3;

const WORD_PATTERN = /[\p{L}\p{M}]+/gu;
const ASCII_WORD = /^[a-z]+$/;

const foldWord = (word: string): string => foldLatinDiacritics(word.toLowerCase());

const termsOf = (values: readonly unknown[]): string[] => {
  const terms: string[] = [];
  for (const value of values) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item !== 'string') continue;
      for (const match of item.matchAll(WORD_PATTERN)) {
        const term = foldWord(match[0]);
        if (ASCII_WORD.test(term)) terms.push(term);
      }
    }
  }
  return terms;
};

export const buildSearchSpellingVocabulary = (
  documents: readonly SearchVocabularyDocument[],
): SearchSpellingVocabulary => {
  const documentFrequency = new Map<string, number>();
  const nameTerms = new Set<string>();
  const personNameTerms = new Set<string>();
  let documentCount = 0;
  for (const document of documents) {
    const names = termsOf(document.nameText);
    for (const term of names) nameTerms.add(term);
    for (const term of termsOf(document.personNameText ?? [])) personNameTerms.add(term);
    if (!document.served) continue;
    documentCount += 1;
    for (const term of new Set([...names, ...termsOf(document.bodyText)])) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  const candidatesByLength = new Map<number, Array<readonly [string, number]>>();
  for (const [term, frequency] of documentFrequency) {
    if (frequency < SPELLING_CANDIDATE_MIN_DOCUMENTS) continue;
    const bucket = candidatesByLength.get(term.length) ?? [];
    bucket.push([term, frequency]);
    candidatesByLength.set(term.length, bucket);
  }
  return {
    documentCount,
    documentFrequency,
    nameTerms,
    personNameWords: [...personNameTerms].sort(),
    candidatesByLength,
  };
};

export const allowedSpellingEdits = (wordLength: number): number => {
  if (wordLength >= 9) return 2;
  if (wordLength >= 4) return 1;
  return 0;
};

/**
 * Optimal-string-alignment distance, so a swapped pair of letters costs one edit
 * rather than two: a transposition is the most common real typing error. Returns
 * `maxEdits + 1` as soon as the distance is known to exceed `maxEdits`.
 */
export const boundedEditDistance = (a: string, b: string, maxEdits: number): number => {
  if (Math.abs(a.length - b.length) > maxEdits) return maxEdits + 1;
  let previousPrevious: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMinimum = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      let distance = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        distance = Math.min(distance, previousPrevious[j - 2] + 1);
      }
      current.push(distance);
      rowMinimum = Math.min(rowMinimum, distance);
    }
    if (rowMinimum > maxEdits) return maxEdits + 1;
    previousPrevious = previous;
    previous = current;
  }
  return previous[b.length];
};

// A word in a name field is never corrected, however rare: a rare surname is exactly the
// shape of a typo, and rewriting one hides the person searched for. See #4536.
// The start of a person's name is a name being typed, and a word one edit from a
// person's name is a misspelled name: rewriting either to a topic word ("hongy" to
// "hong", "nyon" to "non", "dolar" to "solar") hid the person the student was
// looking for, while Meilisearch's own prefix and typo matching finds them.
const PERSON_NAME_PREFIX_MIN_LENGTH = 3;

const startsAPersonName = (personNameWords: readonly string[], word: string): boolean => {
  if (word.length < PERSON_NAME_PREFIX_MIN_LENGTH) return false;
  let low = 0;
  let high = personNameWords.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (personNameWords[middle] < word) low = middle + 1;
    else high = middle;
  }
  return low < personNameWords.length && personNameWords[low].startsWith(word);
};

const isNearAPersonName = (personNameWords: readonly string[], word: string): boolean => {
  const maxEdits = allowedSpellingEdits(word.length);
  return (
    startsAPersonName(personNameWords, word) ||
    personNameWords.some(
      (name) =>
        Math.abs(name.length - word.length) <= maxEdits &&
        boundedEditDistance(word, name, maxEdits) <= maxEdits,
    )
  );
};

// A word typed in capitals is an acronym the student means exactly: "CEID" is a
// makespace, not a misspelled "reid".
const ACRONYM_PATTERN = /^\p{Lu}{2,}$/u;

const correctWord = (
  word: string,
  vocabulary: SearchSpellingVocabulary,
  protectedTerms: SearchSpellingProtectedTerms,
): string | null => {
  if (!ASCII_WORD.test(word) || protectedTerms.has(word) || vocabulary.nameTerms.has(word)) {
    return null;
  }
  if (vocabulary.documentFrequency.has(word)) return null;
  const maxEdits = allowedSpellingEdits(word.length);
  if (maxEdits === 0) return null;
  if (isNearAPersonName(vocabulary.personNameWords, word)) return null;

  let best: { term: string; frequency: number; distance: number } | null = null;
  for (let length = word.length - maxEdits; length <= word.length + maxEdits; length += 1) {
    for (const [term, frequency] of vocabulary.candidatesByLength.get(length) ?? []) {
      const distance = boundedEditDistance(word, term, maxEdits);
      if (distance > maxEdits) continue;
      if (
        !best ||
        distance < best.distance ||
        (distance === best.distance && frequency > best.frequency) ||
        (distance === best.distance && frequency === best.frequency && term < best.term)
      ) {
        best = { term, frequency, distance };
      }
    }
  }
  return best?.term ?? null;
};

export const correctSearchQuerySpelling = (
  query: string,
  vocabulary: SearchSpellingVocabulary | null,
  protectedTerms: SearchSpellingProtectedTerms = new Set(),
): CorrectedSearchQuery => {
  if (!vocabulary || !query) return { query, corrections: [] };
  const corrections: SearchQueryCorrection[] = [];
  const corrected = query.replace(WORD_PATTERN, (typed) => {
    if (ACRONYM_PATTERN.test(typed)) return typed;
    const replacement = correctWord(foldWord(typed), vocabulary, protectedTerms);
    if (!replacement) return typed;
    corrections.push({ from: typed, to: replacement });
    return replacement;
  });
  return { query: corrections.length > 0 ? corrected : query, corrections };
};
