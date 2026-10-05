/**
 * A copied sentence can be on its page and still not be the row's own current research:
 * a clause cut out of a training sentence, or one co-founder's agenda on a shared unit
 * (#4915). Each check drops only the sentences it can attribute and keeps the rest.
 */
import { protectedSentenceList } from '../../utils/researchEntityBiographyDescriptionRepair';
import { splitDescriptionSentences } from '../../utils/careerBiographyDescription';

const foldedCharacters = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u02bc`]/g, "'")
    .replace(/[\u2010-\u2015]/g, '-')
    .toLowerCase();

const comparable = (value: string): string => foldedCharacters(value).replace(/\s+/g, ' ').trim();

const comparableKeepingLines = (value: string): string =>
  foldedCharacters(value)
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n');

const POSSESSIVE = String.raw`(?:his|her|their|my)`;
const POSTDOC = String.raw`post-?\s?doc(?:toral)?`;
const TRAINING_STAGE = String.raw`(?:${POSTDOC}|graduate|doctoral|ph\.?\s?d\.?|dissertation|thesis|residency)`;

const PAST_CONTEXT_MARKERS: RegExp[] = [
  new RegExp(
    String.raw`\b${POSTDOC}\s+(?:training|fellowship|work|research|studies|stint|position|appointment)\b`,
  ),
  new RegExp(
    String.raw`\b(?:during|throughout|while\s+completing)\s+${POSSESSIVE}\s+${TRAINING_STAGE}\b`,
  ),
  new RegExp(
    String.raw`\b(?:did|completed|pursued|undertook)\s+${POSSESSIVE}\s+${TRAINING_STAGE}\b`,
  ),
  new RegExp(
    String.raw`\b${POSSESSIVE}\s+(?:doctoral|dissertation|thesis|graduate)\s+(?:work|research|studies)\b`,
  ),
  new RegExp(
    String.raw`\bas\s+an?\s+(?:${POSTDOC}(?:\s+(?:fellow|scholar|researcher|associate))?|(?:graduate|doctoral|ph\.?\s?d\.?)\s+student)\b`,
  ),
  /\b(?:previously|formerly)\s+(?:an?|the|at|with|in|served|worked|held)\b/,
  /\b(?:was|were|had\s+been)\s+(?:previously|formerly)\b/,
  /\b(?:prior\s+to\s+joining|before\s+(?:joining|coming\s+to|moving\s+to))\b/,
  new RegExp(String.raw`\bearlier\s+in\s+${POSSESSIVE}\s+career\b`),
  /\bafter\s+(?:finishing|completing)\s+(?:his|her|their|my)\s+(?:scientific\s+)?training\b/,
];

const STATES_CURRENT_WORK = /\b(?:currently|now|presently|today|current)\b/;

export function carriesPastContextMarker(text: string): boolean {
  const value = comparable(text);
  return (
    !STATES_CURRENT_WORK.test(value) && PAST_CONTEXT_MARKERS.some((marker) => marker.test(value))
  );
}

const SENTENCE_END = /[.!?]["')\]]?\s|\n/g;
const FRAMING_WINDOW_CHARS = 400;

function framingBefore(page: string, index: number): string {
  const window = page.slice(Math.max(0, index - FRAMING_WINDOW_CHARS), index);
  let start = 0;
  for (const match of window.matchAll(SENTENCE_END)) start = (match.index ?? 0) + match[0].length;
  return window.slice(start);
}

/**
 * The page's framing of a copied sentence: the start of the page sentence it was cut
 * from, up to where the copy begins. `pageText` keeps a line break at every block
 * boundary, so a heading or a title line above the sentence is never its framing.
 * Empty when the copy opens its page sentence or is not found on the page.
 */
export function pageFramingOfSentence(sentence: string, pageText: string): string {
  const page = comparableKeepingLines(pageText);
  const copy = comparable(sentence);
  if (!copy) return '';
  const index = page.indexOf(copy);
  return index < 0 ? '' : framingBefore(page, index);
}

function sentencesOf(value: string): string[] {
  const protectedSentences = protectedSentenceList(value);
  const plainSentences = splitDescriptionSentences(value);
  return protectedSentences.length <= plainSentences.length ? protectedSentences : plainSentences;
}

function keptSentences(value: string, keep: (sentence: string) => boolean): string {
  const sentences = sentencesOf(value);
  const kept = sentences.filter(keep);
  return kept.length === sentences.length ? value : kept.join(' ').trim();
}

/**
 * The copy without the sentences cut out of a page sentence that frames them as past
 * training or a previous position. A sentence that states its own past framing keeps
 * it, so the reader still sees it; only a copy that lost its framing is dropped.
 */
export function withoutSentencesLiftedFromPastContext(value: string, pageText: string): string {
  if (!value || !pageText) return value;
  return keptSentences(
    value,
    (sentence) => !carriesPastContextMarker(pageFramingOfSentence(sentence, pageText)),
  );
}

const FIRST_PERSON_SINGULAR =
  /(?:^|[^\p{L}'])(?:I|I'm|I've|I'd|me|my|myself|My|Me)(?=$|[^\p{L}'])/u;
const UNIT_VOICE = /\b(?:we|our|us)\b|\bmy\s+(?:lab|laboratory|group|team)\b/;
const GENERIC_UNIT_NAME_WORDS = new Set([
  'the',
  'a',
  'an',
  'of',
  'for',
  'and',
  'in',
  'at',
  'on',
  'lab',
  'labs',
  'laboratory',
  'laboratories',
  'group',
  'center',
  'centre',
  'institute',
  'program',
  'programme',
  'initiative',
  'project',
  'unit',
  'yale',
]);

const nameWords = (value: string): string[] =>
  comparable(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

function namesUnit(sentence: string, unitName: string): boolean {
  const distinctive = nameWords(unitName).filter((word) => !GENERIC_UNIT_NAME_WORDS.has(word));
  if (distinctive.length === 0) return false;
  const words = ` ${nameWords(sentence).join(' ')} `;
  return words.includes(` ${distinctive.join(' ')} `);
}

const NOUN_LABELLED_BY_A_NUMERAL = String.raw`type|subtype|phase|class|stage|grade|title|part|chapter|section|volume|level|figure|table|appendix|group|war|step|trial|study|cohort|arm|tier|category|complex|factor|act|book|series|round`;
const ROMAN_NUMERAL_ONE = new RegExp(
  String.raw`\b(?:${NOUN_LABELLED_BY_A_NUMERAL})\s+I(?=$|[^\p{L}'])`,
  'giu',
);

export function isFirstPersonSingularSentence(sentence: string): boolean {
  return FIRST_PERSON_SINGULAR.test(
    sentence.replace(/[\u2018\u2019]/g, "'").replace(ROMAN_NUMERAL_ONE, ' '),
  );
}

const SHARED_LEADERSHIP =
  /\bco-?\s?(?:found(?:er|ers|ed|ing)?|direct(?:or|ors|s|ed)?|lead(?:s|er|ers)?|led|pis?|principal\s+investigators?|organi[sz]ers?|run(?:s)?)\b/;

/**
 * Whether the page states that its first-person author shares the unit with others, as
 * a co-founder or co-director does. Only then is the author's own agenda one member's
 * rather than the unit's: a single-lead lab's page in its lead's voice is the lab's.
 */
export function statesSharedLeadershipOfUnit(text: string, unitName: string): boolean {
  return sentencesOf(text).some(
    (sentence) =>
      isFirstPersonSingularSentence(sentence) &&
      namesUnit(sentence, unitName) &&
      SHARED_LEADERSHIP.test(comparable(sentence)),
  );
}

/**
 * The copy without one member's first-person sentences, for a unit the page says that
 * member shares with others. A sentence that names the unit, or speaks in the unit's
 * plural voice, is the unit's and is kept.
 */
export function withoutMemberFirstPersonSentences(
  value: string,
  unitName: string,
  pageText = '',
): string {
  if (!value || !isFirstPersonSingularSentence(value)) return value;
  if (!statesSharedLeadershipOfUnit(`${value}\n${pageText}`, unitName)) return value;
  return keptSentences(
    value,
    (sentence) =>
      !isFirstPersonSingularSentence(sentence) ||
      namesUnit(sentence, unitName) ||
      UNIT_VOICE.test(comparable(sentence)),
  );
}
