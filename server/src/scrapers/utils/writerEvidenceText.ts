import { computeContentHash } from '../contentHashGate';

/**
 * Part of the writer's input hash: a change to `normalizeWriterText` or to how evidence is
 * split into sentences and headings changes every key once, instead of comparing hashes
 * produced by two different normalizers.
 */
export const WRITER_TEXT_NORMALIZER_VERSION = 'writer-text-normalizer-v4';

const SINGLE_QUOTES = /[\u2018\u2019\u201A\u201B\u2032\u2035`\u00B4]/g;
const DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F\u2033\u2036\u00AB\u00BB]/g;
const DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;

export function foldWriterTextForms(value: string): string {
  return value
    .normalize('NFKC')
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeWriterText(value: string): string {
  return foldWriterTextForms(value).toLowerCase();
}

const shortHash = (text: string): string => computeContentHash(text).slice(0, 16);

const SENTENCE_END = /(?<=[.!?])["')\]]?\s+(?=["'([]?[A-Z0-9])/;
const MIN_SENTENCE_WORDS = 2;
const wordsOf = (text: string): string[] => text.split(/\s+/).filter(Boolean);

function linesOf(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => foldWriterTextForms(line))
    .filter(Boolean);
}

export function writerEvidenceSentences(text: string): string[] {
  return linesOf(text)
    .flatMap((line) => line.split(SENTENCE_END))
    .map((sentence) => sentence.trim())
    .filter((sentence) => wordsOf(sentence).length >= MIN_SENTENCE_WORDS);
}

export function writerEvidenceSentenceHashes(text: string): string[] {
  return [...new Set(writerEvidenceSentences(text).map((s) => shortHash(normalizeWriterText(s))))];
}

const MAX_HEADING_WORDS = 8;
const MAX_HEADING_CHARS = 80;

/**
 * A stored research page keeps each heading as its own line (`researchStatementTextOfPage`),
 * so a heading is a short line that ends without sentence punctuation and does not start
 * in lower case.
 */
export function isResearchPageHeadingLine(line: string): boolean {
  const text = foldWriterTextForms(line);
  if (!text || text.length > MAX_HEADING_CHARS) return false;
  const words = wordsOf(text);
  if (words.length < 1 || words.length > MAX_HEADING_WORDS) return false;
  if (/[.!?:;,]["')\]]?$/.test(text)) return false;
  return /^[^a-z]/.test(text);
}

export function researchPageHeadings(text: string): string[] {
  return [...new Set(linesOf(text).filter(isResearchPageHeadingLine))];
}

export function researchPageHeadingHashes(text: string): string[] {
  return [...new Set(researchPageHeadings(text).map((h) => shortHash(normalizeWriterText(h))))];
}

const FUNCTION_WORDS = [
  'about',
  'above',
  'across',
  'after',
  'again',
  'against',
  'along',
  'also',
  'among',
  'around',
  'because',
  'been',
  'before',
  'being',
  'below',
  'between',
  'both',
  'but',
  'by',
  'can',
  'could',
  'does',
  'doing',
  'during',
  'each',
  'either',
  'even',
  'every',
  'from',
  'further',
  'have',
  'having',
  'here',
  'hers',
  'herself',
  'himself',
  'into',
  'itself',
  'just',
  'many',
  'more',
  'most',
  'much',
  'must',
  'neither',
  'often',
  'only',
  'other',
  'others',
  'over',
  'same',
  'should',
  'since',
  'some',
  'such',
  'than',
  'that',
  'their',
  'theirs',
  'them',
  'themselves',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'throughout',
  'thus',
  'toward',
  'towards',
  'under',
  'until',
  'upon',
  'very',
  'well',
  'were',
  'what',
  'when',
  'where',
  'whether',
  'which',
  'while',
  'whom',
  'whose',
  'will',
  'with',
  'within',
  'without',
  'would',
  'your',
];

const GENERIC_RESEARCH_WORDS = [
  'address',
  'addresses',
  'addressing',
  'advance',
  'advances',
  'advancing',
  'aims',
  'analyses',
  'analyse',
  'analyze',
  'analyzes',
  'applies',
  'apply',
  'applying',
  'approach',
  'approaches',
  'area',
  'areas',
  'based',
  'broad',
  'build',
  'builds',
  'center',
  'centers',
  'centre',
  'combine',
  'combines',
  'combining',
  'conduct',
  'conducts',
  'contribute',
  'contributes',
  'current',
  'currently',
  'design',
  'designs',
  'develop',
  'developing',
  'develops',
  'different',
  'diverse',
  'efforts',
  'employ',
  'employs',
  'especially',
  'examine',
  'examines',
  'examining',
  'explore',
  'explores',
  'exploring',
  'field',
  'fields',
  'focus',
  'focused',
  'focuses',
  'focusing',
  'group',
  'groups',
  'help',
  'helps',
  'improve',
  'improves',
  'include',
  'includes',
  'including',
  'insight',
  'insights',
  'institute',
  'interest',
  'interests',
  'investigate',
  'investigates',
  'investigating',
  'involves',
  'issues',
  'laboratories',
  'laboratory',
  'labs',
  'lead',
  'leads',
  'make',
  'makes',
  'making',
  'method',
  'methods',
  'multiple',
  'novel',
  'ongoing',
  'particular',
  'particularly',
  'program',
  'programs',
  'project',
  'projects',
  'question',
  'questions',
  'range',
  'ranging',
  'recent',
  'related',
  'research',
  'researcher',
  'researchers',
  'researches',
  'role',
  'roles',
  'seek',
  'seeks',
  'several',
  'span',
  'spanning',
  'spans',
  'specific',
  'studies',
  'study',
  'studying',
  'support',
  'supports',
  'team',
  'topic',
  'topics',
  'understand',
  'understanding',
  'university',
  'using',
  'various',
  'work',
  'working',
  'works',
  'yale',
];

const NON_CONTENT_WORDS: ReadonlySet<string> = new Set([
  ...FUNCTION_WORDS,
  ...GENERIC_RESEARCH_WORDS,
]);

export const MIN_CONTENT_TERM_CHARS = 4;

export function writerWordTokens(text: string): string[] {
  return normalizeWriterText(text)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

export function writerContentTerms(text: string): string[] {
  return writerWordTokens(text).filter(
    (word) =>
      word.length >= MIN_CONTENT_TERM_CHARS && /[a-z]/.test(word) && !NON_CONTENT_WORDS.has(word),
  );
}

const SPECIFIC_SUFFIX_CLASSES: ReadonlyArray<{ kind: string; suffixes: readonly string[] }> = [
  {
    kind: 'condition',
    suffixes: [
      'itis',
      'itides',
      'oma',
      'omas',
      'omata',
      'osis',
      'oses',
      'emia',
      'emias',
      'aemia',
      'pathy',
      'pathies',
      'iasis',
      'algia',
      'plasia',
      'penia',
      'uria',
      'ia',
    ],
  },
  {
    kind: 'technique',
    suffixes: [
      'scopy',
      'scopies',
      'graphy',
      'graphies',
      'metry',
      'metries',
      'omics',
      'omic',
      'ectomy',
      'ectomies',
      'otomy',
      'plasty',
      'genesis',
      'genetics',
    ],
  },
  {
    kind: 'drug',
    suffixes: [
      'mab',
      'nib',
      'parib',
      'ciclib',
      'sertib',
      'platin',
      'cycline',
      'mycin',
      'cillin',
      'vir',
      'azole',
      'olol',
      'pril',
      'sartan',
      'statin',
      'oxacin',
    ],
  },
  {
    kind: 'organism',
    suffixes: ['virus', 'viruses', 'phage', 'phages', 'coccus', 'cocci', 'bacter', 'myces', 'fish'],
  },
];

export const MIN_SUFFIX_CLASS_WORD_CHARS = 6;

const SENTENCE_OPENING = /(?:^|[.!?]["')\]]?\s+|[:;]\s+|\(\s*)$/;

export type SpecificTermKind =
  'acronym' | 'proper-noun' | 'condition' | 'technique' | 'drug' | 'organism';

export interface SpecificTerm {
  term: string;
  kind: SpecificTermKind;
}

function suffixClassOf(word: string): SpecificTermKind | undefined {
  if (word.length < MIN_SUFFIX_CLASS_WORD_CHARS) return undefined;
  for (const { kind, suffixes } of SPECIFIC_SUFFIX_CLASSES) {
    if (suffixes.some((suffix) => word.endsWith(suffix) && word.length > suffix.length)) {
      return kind as SpecificTermKind;
    }
  }
  return undefined;
}

/**
 * The words of a text that name something specific enough to be invented: an acronym or a
 * mixed letter-and-digit symbol, a capitalized word that does not open a sentence, or a
 * word whose suffix marks a condition, a technique or an organism. Every other word is
 * ordinary vocabulary a faithful paraphrase is free to choose.
 */
export function writerSpecificTerms(text: string): SpecificTerm[] {
  const folded = foldWriterTextForms(text);
  const terms = new Map<string, SpecificTermKind>();
  for (const match of folded.matchAll(/[A-Za-z0-9]+/g)) {
    const word = match[0];
    const term = word.toLowerCase();
    if (!/[a-z]/i.test(word) || terms.has(term)) continue;
    const upperCount = (word.match(/[A-Z]/g) ?? []).length;
    if (upperCount >= 2 || (/\d/.test(word) && word.length >= 2)) {
      terms.set(term, 'acronym');
      continue;
    }
    const opensSentence = SENTENCE_OPENING.test(folded.slice(0, match.index));
    if (/^[A-Z]/.test(word) && word.length >= 3 && !opensSentence && word !== 'I') {
      terms.set(term, 'proper-noun');
      continue;
    }
    const kind = suffixClassOf(term);
    if (kind) terms.set(term, kind);
  }
  return [...terms].map(([term, kind]) => ({ term, kind }));
}
