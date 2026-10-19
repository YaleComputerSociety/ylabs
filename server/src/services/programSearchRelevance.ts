import { foldLatinDiacritics } from '../utils/latinDiacritics';
import {
  PROGRAM_QUERY_STOP_WORDS,
  PROGRAM_SEARCH_SPELLING_FIELDS,
} from './programSearchSpellingVocabulary';
import { PROGRAM_TOPIC_TAXONOMY, yearOfStudyWordAlternatives } from './programTopicService';

export const PROGRAM_SEARCH_FIELDS = PROGRAM_SEARCH_SPELLING_FIELDS;

type ProgramSearchField = (typeof PROGRAM_SEARCH_FIELDS)[number];

const PROGRAM_SEARCH_FIELD_WEIGHTS: Record<ProgramSearchField, number> = {
  title: 8,
  competitionType: 3,
  summary: 3,
  purpose: 3,
  studentFacingCategory: 3,
  eligibility: 2,
  description: 1,
  applicationInformation: 1,
  additionalInformation: 1,
};

const MIN_QUERY_WORD_LENGTH = 2;
const MIN_STEM_LENGTH = 4;
const STOP_WORDS: ReadonlySet<string> = new Set(PROGRAM_QUERY_STOP_WORDS);
const STEM_SUFFIXES: ReadonlyArray<{ suffix: string; replacement: string }> = [
  { suffix: 'ities', replacement: 'ity' },
  { suffix: 'ations', replacement: '' },
  { suffix: 'ation', replacement: '' },
  { suffix: 'ings', replacement: '' },
  { suffix: 'ing', replacement: '' },
  { suffix: 'ies', replacement: 'y' },
  { suffix: 'ied', replacement: 'y' },
  { suffix: 'ics', replacement: '' },
  { suffix: 'ic', replacement: '' },
  { suffix: 'ed', replacement: '' },
];
const SIBILANT_PLURAL = /(?:s|x|z|ch|sh)es$/;

export const programSearchWords = (text: string): string[] =>
  foldLatinDiacritics(text.toLowerCase()).match(/[a-z0-9]+/g) ?? [];

const stripWordSuffix = (word: string): string => {
  for (const { suffix, replacement } of STEM_SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= MIN_STEM_LENGTH) {
      return word.slice(0, word.length - suffix.length) + replacement;
    }
  }
  if (SIBILANT_PLURAL.test(word) && word.length - 2 >= MIN_STEM_LENGTH) return word.slice(0, -2);
  if (/[^su]s$/.test(word) && word.length > MIN_STEM_LENGTH) return word.slice(0, -1);
  return word;
};

export const programSearchWordStem = (word: string): string => {
  const stem = stripWordSuffix(word);
  return stem.endsWith('e') && stem.length > MIN_STEM_LENGTH ? stem.slice(0, -1) : stem;
};

const isContentWord = (word: string): boolean =>
  word.length >= MIN_QUERY_WORD_LENGTH && !STOP_WORDS.has(word);

export const programQueryContentWords = (query: string): string[] => [
  ...new Set(programSearchWords(query).filter(isContentWord)),
];

const ABBREVIATION_ALIAS = /^\s.+\s$/;

const subjectPhrases = (subject: string, aliases: string[]): string[][] =>
  [subject, ...aliases].map(programQueryContentWords).filter((phrase) => phrase.length > 0);

const umbrellaSubjectPhrases = (
  contentWords: string[],
): { named: string[][]; aliased: string[][] } => {
  const typed = contentWords.join(' ');
  const named = PROGRAM_TOPIC_TAXONOMY.filter(
    (topic) =>
      programQueryContentWords(topic.subject).join(' ') === typed ||
      topic.aliases.some(
        (alias) => ABBREVIATION_ALIAS.test(alias) && programSearchWords(alias).join(' ') === typed,
      ),
  );
  const aliased = PROGRAM_TOPIC_TAXONOMY.filter((topic) =>
    topic.aliases.some((alias) => programQueryContentWords(alias).join(' ') === typed),
  );
  return {
    named: named.flatMap((topic) => subjectPhrases(topic.subject, topic.aliases)),
    aliased: aliased.flatMap((topic) => subjectPhrases(topic.subject, topic.aliases)),
  };
};

interface IndexedProgramField {
  field: ProgramSearchField;
  words: string[];
  stems: Set<string>;
  text: string;
}

const indexProgramFields = (program: Record<string, unknown>): IndexedProgramField[] =>
  PROGRAM_SEARCH_FIELDS.map((field) => {
    const value = program[field];
    const text = (Array.isArray(value) ? value : [value])
      .filter((part): part is string => typeof part === 'string')
      .join(' ');
    const words = programSearchWords(text);
    return {
      field,
      words,
      stems: new Set(words.map(programSearchWordStem)),
      text: ` ${words.join(' ')} `,
    };
  });

const WHOLE_WORD_ABBREVIATIONS: ReadonlySet<string> = new Set(
  PROGRAM_TOPIC_TAXONOMY.flatMap((topic) =>
    topic.aliases.filter((alias) => ABBREVIATION_ALIAS.test(alias)).flatMap(programSearchWords),
  ),
);

const fieldCoversWord = (field: IndexedProgramField, word: string): boolean =>
  field.stems.has(programSearchWordStem(word)) ||
  (!WHOLE_WORD_ABBREVIATIONS.has(word) &&
    field.words.some((candidate) => candidate.startsWith(word)));

const fieldContainsPhrase = (field: IndexedProgramField, phrase: string[]): boolean =>
  phrase.length > 0 && field.text.includes(` ${phrase.join(' ')} `);

const bestWeightCovering = (
  fields: IndexedProgramField[],
  covers: (field: IndexedProgramField) => boolean,
): number =>
  fields.reduce(
    (best, field) =>
      covers(field) ? Math.max(best, PROGRAM_SEARCH_FIELD_WEIGHTS[field.field]) : best,
    0,
  );

const wordWeight = (fields: IndexedProgramField[], word: string): number =>
  Math.max(
    bestWeightCovering(fields, (field) => fieldCoversWord(field, word)),
    ...yearOfStudyWordAlternatives(word).map((alternative) =>
      alternative.every((part) => fields.some((field) => fieldCoversWord(field, part)))
        ? Math.min(
            ...alternative.map((part) =>
              bestWeightCovering(fields, (field) => fieldCoversWord(field, part)),
            ),
          )
        : 0,
    ),
  );

const titleTier = (title: IndexedProgramField, contentWords: string[]): number => {
  const titleWords = title.words.filter(isContentWord).join(' ');
  const typed = contentWords.join(' ');
  if (titleWords === typed) return 3;
  if (` ${titleWords} `.includes(` ${typed} `)) return 2;
  if (contentWords.every((word) => fieldCoversWord(title, word))) return 1;
  return 0;
};

const MATCH_KIND_RANK = { allWords: 0, subject: 1, allButOneWord: 2 } as const;

type ProgramMatchKind = keyof typeof MATCH_KIND_RANK;

interface ScoredProgram<T> {
  program: T;
  order: number;
  kind: ProgramMatchKind | null;
  titleTier: number;
  fieldScore: number;
}

const MIN_WORDS_FOR_PARTIAL_MATCH = 3;

const scoreProgram = <T extends Record<string, unknown>>(
  program: T,
  order: number,
  contentWords: string[],
  subjectPhrasesToMatch: string[][],
): ScoredProgram<T> => {
  const fields = indexProgramFields(program);
  const weights = contentWords.map((word) => wordWeight(fields, word));
  const coveredWords = weights.filter((weight) => weight > 0).length;
  const wordScore = weights.reduce((sum, weight) => sum + weight, 0);
  const subjectScore = Math.max(
    0,
    ...subjectPhrasesToMatch.map((phrase) =>
      bestWeightCovering(fields, (field) => fieldContainsPhrase(field, phrase)),
    ),
  );
  const base = { program, order, titleTier: 0 };
  if (coveredWords === contentWords.length) {
    return {
      ...base,
      kind: 'allWords',
      titleTier: titleTier(fields[0], contentWords),
      fieldScore: wordScore,
    };
  }
  if (subjectScore > 0) return { ...base, kind: 'subject', fieldScore: subjectScore };
  if (
    contentWords.length >= MIN_WORDS_FOR_PARTIAL_MATCH &&
    coveredWords === contentWords.length - 1
  ) {
    return { ...base, kind: 'allButOneWord', fieldScore: wordScore };
  }
  return { ...base, kind: null, fieldScore: 0 };
};

const byRelevance = <T>(a: ScoredProgram<T>, b: ScoredProgram<T>): number =>
  MATCH_KIND_RANK[a.kind!] - MATCH_KIND_RANK[b.kind!] ||
  b.titleTier - a.titleTier ||
  b.fieldScore - a.fieldScore ||
  a.order - b.order;

export interface RankedProgramSearch<T> {
  programs: T[];
  missingOneWord: boolean;
}

export const rankProgramSearch = <T extends Record<string, unknown>>(
  query: string,
  programs: readonly T[],
): RankedProgramSearch<T> => {
  const contentWords = programQueryContentWords(query);
  if (contentWords.length === 0) return { programs: [], missingOneWord: false };
  const umbrella = umbrellaSubjectPhrases(contentWords);
  const score = (subjectPhrasesToMatch: string[][]) =>
    programs
      .map((program, order) => scoreProgram(program, order, contentWords, subjectPhrasesToMatch))
      .filter((entry) => entry.kind !== null);
  let scored = score(umbrella.named);
  if (!scored.some((entry) => entry.kind === 'allWords') && umbrella.aliased.length > 0) {
    scored = score([...umbrella.named, ...umbrella.aliased]);
  }
  const missingOneWord =
    scored.length > 0 && scored.every((entry) => entry.kind === 'allButOneWord');
  const strongest = missingOneWord
    ? scored
    : scored.filter((entry) => entry.kind !== 'allButOneWord');
  return {
    programs: strongest.sort(byRelevance).map((entry) => entry.program),
    missingOneWord,
  };
};
