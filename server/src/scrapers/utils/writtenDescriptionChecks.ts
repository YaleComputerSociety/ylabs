import { sharesAnInflectionalStem } from '../../utils/groundedCardSynthesis';
import {
  foldWriterTextForms,
  researchPageHeadings,
  writerContentTerms,
  writerSpecificTerms,
  writerWordTokens,
} from './writerEvidenceText';

export interface WrittenDescriptionEvidence {
  text: string;
  isResearchPageText: boolean;
}

const hasWordSharingStem = (term: string, words: readonly string[]): boolean =>
  words.some((word) => sharesAnInflectionalStem(term, word));

const BRITISH_SPELLINGS: ReadonlyArray<[RegExp, string]> = [
  [/our(s|ed|ing|al|ally)?$/, 'or$1'],
  [/is(e|es|ed|ing|ation|ations)$/, 'iz$1'],
  [/ys(e|es|ed|ing)$/, 'yz$1'],
  [/tre(s)?$/, 'ter$1'],
  [/ogue(s)?$/, 'og$1'],
  [/amme(s)?$/, 'am$1'],
  [/ll(ed|ing|er|ers)$/, 'l$1'],
  [/aemi(a|as|c)$/, 'emi$1'],
  [/^haem/, 'hem'],
  [/^paed/, 'ped'],
  [/^orthopaed/, 'orthoped'],
  [/^gynaec/, 'gynec'],
  [/^oesoph/, 'esoph'],
  [/^oestr/, 'estr'],
  [/^oedem/, 'edem'],
  [/^foet/, 'fet'],
];

/**
 * One spelling for a word that British and American English spell differently, applied to
 * both sides, so "behaviour" and "behavior" are one word and two different words stay two.
 */
export function americanSpellingOf(word: string): string {
  let spelled = word;
  for (const [pattern, replacement] of BRITISH_SPELLINGS) {
    spelled = spelled.replace(pattern, replacement);
  }
  return spelled;
}

const MIN_COMPOUND_PART_CHARS = 3;

/** "BRCA" names the family the evidence's "BRCA1" and "BRCA2" are numbered members of. */
const numberedMemberOf = (symbol: string, word: string): boolean =>
  word.length > symbol.length &&
  word.startsWith(symbol) &&
  /^\d+[a-z]?$/.test(word.slice(symbol.length));

/** "development" and "developmental", "emotion" and "emotional": the same topic, one a modifier. */
function relationalAdjectivePairs(word: string): string[] {
  const noun = word.match(/^(.{3,}(?:ment|ion))(?:al|ally)$/)?.[1];
  if (noun) return [noun, `${noun}s`];
  return /(?:ment|ion)s?$/.test(word) ? [`${word.replace(/s$/, '')}al`] : [];
}
const CLASSICAL_PLURALS: ReadonlyArray<[RegExp, string]> = [
  [/omata$|omas$/, 'oma'],
  [/oses$/, 'osis'],
  [/itides$/, 'itis'],
  [/emias$/, 'emia'],
  [/(path|scop|graph|metr|ectom)ies$/, '$1y'],
  [/cocci$/, 'coccus'],
];

/** The singular of a classical plural ("carcinomas", "neuroses"), which the inflection rules leave alone. */
function classicalSingularOf(word: string): string {
  for (const [pattern, singular] of CLASSICAL_PLURALS) {
    if (pattern.test(word)) return word.replace(pattern, singular);
  }
  return word;
}

const DERIVED_STATE_NOUN = /^(.{4,})hood$/;

const acronymOf = (words: readonly string[]): string => words.map((word) => word[0]).join('');

function acronymsOf(words: readonly string[], maxWords = 6): Set<string> {
  const acronyms = new Set<string>();
  for (let start = 0; start < words.length; start += 1) {
    for (let length = 2; length <= maxWords && start + length <= words.length; length += 1) {
      acronyms.add(acronymOf(words.slice(start, start + length)));
    }
  }
  return acronyms;
}

const PARENTHESIZED_ABBREVIATION = /((?:[A-Za-z][\w-]*\s+){1,6})\(([A-Za-z]{2,10})\)/g;

/** An abbreviation the body defines by spelling it out right before it in parentheses. */
function abbreviationsDefinedIn(text: string): Set<string> {
  const defined = new Set<string>();
  for (const match of foldWriterTextForms(text).matchAll(PARENTHESIZED_ABBREVIATION)) {
    const abbreviation = match[2].toLowerCase();
    const words = writerWordTokens(match[1]);
    for (let length = 2; length <= words.length; length += 1) {
      if (acronymOf(words.slice(-length)) === abbreviation) defined.add(abbreviation);
    }
  }
  return defined;
}

/**
 * An evidence acronym grounds only a term the body writes in capitals, because any
 * four-letter word is the initials of some run of evidence words.
 */
function upperCaseAbbreviationsIn(text: string): Set<string> {
  return new Set(
    (foldWriterTextForms(text).match(/\b[A-Z][A-Z0-9]{1,9}\b/g) ?? []).map((word) =>
      word.toLowerCase(),
    ),
  );
}

interface EvidenceVocabulary {
  words: string[];
  joinedNeighbours: string[];
  acronyms: Set<string>;
}

function evidenceVocabulary(evidence: readonly WrittenDescriptionEvidence[]): EvidenceVocabulary {
  const words = new Set<string>();
  const joined = new Set<string>();
  const acronyms = new Set<string>();
  for (const entry of evidence) {
    const tokens = writerWordTokens(entry.text).map(americanSpellingOf).map(classicalSingularOf);
    for (const token of tokens) words.add(token);
    for (let index = 0; index + 1 < tokens.length; index += 1) {
      const parts = tokens.slice(index, index + 3);
      if (parts[0].length < MIN_COMPOUND_PART_CHARS) continue;
      for (let length = 2; length <= parts.length; length += 1) {
        if (parts.slice(0, length).every((part) => part.length >= MIN_COMPOUND_PART_CHARS)) {
          joined.add(parts.slice(0, length).join(''));
        }
      }
    }
    for (const acronym of acronymsOf(tokens)) acronyms.add(acronym);
  }
  return { words: [...words], joinedNeighbours: [...joined], acronyms };
}

function isGroundedTerm(
  term: string,
  vocabulary: EvidenceVocabulary,
  abbreviations: { definedInBody: ReadonlySet<string>; writtenUpperCase: ReadonlySet<string> },
): boolean {
  if (abbreviations.definedInBody.has(term)) return true;
  if (abbreviations.writtenUpperCase.has(term) && vocabulary.acronyms.has(term)) return true;
  if (
    abbreviations.writtenUpperCase.has(term) &&
    vocabulary.words.some((word) => numberedMemberOf(term, word))
  ) {
    return true;
  }
  const spelled = classicalSingularOf(americanSpellingOf(term));
  if (hasWordSharingStem(spelled, vocabulary.words)) return true;
  if (hasWordSharingStem(spelled, vocabulary.joinedNeighbours)) return true;
  const stateNoun = spelled.match(DERIVED_STATE_NOUN);
  if (stateNoun && hasWordSharingStem(stateNoun[1], vocabulary.words)) return true;
  return relationalAdjectivePairs(spelled).some((form) => vocabulary.words.includes(form));
}

export function ungroundedContentTerms(
  description: string,
  evidence: readonly WrittenDescriptionEvidence[],
): string[] {
  const vocabulary = evidenceVocabulary(evidence);
  const abbreviations = {
    definedInBody: abbreviationsDefinedIn(description),
    writtenUpperCase: upperCaseAbbreviationsIn(description),
  };
  return writerSpecificTerms(description)
    .map(({ term }) => term)
    .filter((term) => !isGroundedTerm(term, vocabulary, abbreviations));
}

export const RESEARCH_PAGE_FREQUENT_TERM_COUNT = 5;
const MIN_FREQUENT_TERM_OCCURRENCES = 2;

export function researchPageFrequentTerms(pageTexts: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const term of pageTexts.flatMap(writerContentTerms)) {
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= MIN_FREQUENT_TERM_OCCURRENCES)
    .sort(([a, left], [b, right]) => right - left || a.localeCompare(b))
    .slice(0, RESEARCH_PAGE_FREQUENT_TERM_COUNT)
    .map(([term]) => term);
}

export function coversResearchPage(
  description: string,
  evidence: readonly WrittenDescriptionEvidence[],
): boolean {
  const pageTexts = evidence.filter((entry) => entry.isResearchPageText).map((e) => e.text);
  if (pageTexts.length === 0) return true;
  const bodyWords = writerWordTokens(description);
  const headingTerms = [...new Set(pageTexts.flatMap(researchPageHeadings))]
    .map(writerContentTerms)
    .filter((terms) => terms.length > 0);
  const frequentTerms = researchPageFrequentTerms(pageTexts);
  if (headingTerms.length === 0 && frequentTerms.length === 0) return true;
  if (headingTerms.some((terms) => terms.every((term) => hasWordSharingStem(term, bodyWords)))) {
    return true;
  }
  return frequentTerms.some((term) => hasWordSharingStem(term, bodyWords));
}

const FIRST_PERSON = [
  /\b(?:we|our|ours|ourselves|my|mine|myself)\b/i,
  /\bus\b/,
  /\bme\b/,
  /\bI(?:'m|'ve|'d)?\s+(?:am|was|have|had|study|studied|research|work|lead|direct|use|develop|investigate|focus|also|aim|seek|explore|examine)\b/,
];

export function hasFirstPerson(description: string): boolean {
  const text = foldWriterTextForms(description);
  return FIRST_PERSON.some((pattern) => pattern.test(text));
}

const GENERIC_SECTION_HEADING =
  /(?:Research(?:\s+(?:Overview|Interests?|Areas?|Focus|Projects?|Themes?|Summary))?|About(?:\s+(?:Us|the\s+Lab))?|Overview|Our\s+Research|Mission|Current\s+Projects?|Welcome)/;
const SENTENCE_OPENER = '(?:The|We|Our|This|These|In|At|A|An|Using|Lab|Laboratory)\\b';
const FUSED_GENERIC_HEADING = new RegExp(
  `(?:^|[.!?]\\s+)${GENERIC_SECTION_HEADING.source}\\s+${SENTENCE_OPENER}`,
);

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Matched case-sensitively against a sentence opener, because the same words in running
 * prose ("studies coral reef recovery. The lab ...") are not a fused heading.
 */
export function hasFusedPageHeading(
  description: string,
  evidence: readonly WrittenDescriptionEvidence[],
): boolean {
  const text = foldWriterTextForms(description);
  if (FUSED_GENERIC_HEADING.test(text)) return true;
  const headings = [
    ...new Set(
      evidence
        .filter((entry) => entry.isResearchPageText)
        .flatMap((e) => researchPageHeadings(e.text)),
    ),
  ];
  return headings.some((heading) =>
    new RegExp(`${escapeRegExp(heading)}\\s+${SENTENCE_OPENER}`).test(text),
  );
}

const GREETING =
  /\bwelcome\s+to\b|^welcome\b|\bthanks?\s+(?:you\s+)?for\s+(?:visiting|your\s+interest|stopping\s+by)\b|\b(?:hello|greetings|hi)\s*[,!]/i;

export function hasGreetingText(description: string): boolean {
  return GREETING.test(foldWriterTextForms(description));
}
