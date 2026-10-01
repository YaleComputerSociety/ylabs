import {
  careerBiographyOpening,
  isCareerBiographyDescription,
  opensOnResearchHomeSubject,
} from './careerBiographyDescription';
import { isDemotablePersonBio } from './researchHomeDescriptionSelection';

// Calibrated by hand against 169 served Development bodies (#4288): the career tests alone
// also flag research prose that opens on an orienting role ("is a cardiologist whose
// research focuses on"), so a research statement in the opening withdraws the verdict.
const CAREER_OPENING_MARKERS: readonly RegExp[] = [
  /\b(?:was\s+educated|education\s+began)\s+at\b/i,
  /\bprior\s+to\s+(?:joining|coming|arriving)\b/i,
  /\bjoined\s+(?:the\s+)?[A-Z][\p{L}&.’'()-]*(?:\s+(?:[A-Z(][\p{L}&.’'()-]*|and|of|for|on|the)){0,8},?\s+(?:as|in\s+\d{4})\b/u,
  /\b(?:received|earned|earn|obtained)\s+(?:his|her|their|an?|the)?\s*[^.]{0,40}\bM\.?F\.?A\b/i,
  /\bwent\s+on\s+to\s+earn\b/i,
  /\bcompleted\s+(?:medical|law|graduate|nursing)\s+school\b/i,
  /\bgraduated\s+[^.]{0,60}\b(?:fellowship|residency)\b/i,
  /\b(?:currently\s+)?serv(?:es|ed)\s+as\s+(?:an?|the)?\s*[^.]{0,40}\b(?:director|co-director|chair|dean|chief|head|editor|president|trustee|member)\b/i,
  /\b(?:has\s+)?(?:previously\s+)?taught\s+at\b/i,
  /\b(?:a|the)\s+(?:winner|recipient)\s+of\s+the\b/i,
  /\b(?:did|performed|completed|pursued)\s+(?:a|an|his|her|their)\s+(?:Ph\.?\s?D|doctorate|post-?doc)/i,
  /(?:^|[.!?]\s+)Previously,?\s+(?:[A-Z][\p{L}'’-]+\s+)?(?:was|served|held)\b/u,
  /\b(?:honou?rs|awards)\s+include\b|\belection\s+to\s+(?:membership\s+in\s+)?the\b/i,
];

const DEGREE_LEVEL_STUDIES_PROGRAM =
  /\b(?:Graduate|Undergraduate|Postgraduate|Doctoral|Professional)\s+Studies\b/g;

const RESEARCH_SUBJECT_STATEMENT = new RegExp(
  '(?<!clinical\\s)\\b(?:research|work|scholarship|investigations?|projects?|interests?|lab(?:oratory)?|group)\\b' +
    '[^.!?]{0,40}?\\b(?:focus(?:es|ed)?|cent(?:er|re)(?:s|d|ed)?\\s+(?:on|around)|spans?|address(?:es)?|examines?|' +
    'explores?|investigates?|concerns?|includes?|aims?|seeks?|uses|develops|applies|combines|studies|' +
    'is\\s+on|are\\s+on)\\b' +
    '|\\bspeciali[sz](?:es|ing)\\s+in\\b' +
    '|\\bto\\s+(?:investigate|study|examine|explore|understand)\\b' +
    '|\\b(?:works?|working)\\s+on\\b|\\bwho\\s+(?:focuses|works|specializes)\\s+(?:on|in)\\b' +
    '|\\b(?:areas?|fields?)\\s+of\\s+(?:[\\w-]+\\s+){0,3}?(?:expertise|interest|research)\\b|\\binterested\\s+in\\b' +
    '|\\bresearch\\s+(?:interests?|focus)\\b|\\b(?:focused|focusing)\\s+on\\b',
  'i',
);

const RESEARCH_VERB =
  /(?<!\b(?:in|of|and)\s+(?:[\p{L}-]+\s+){0,3})\b(?:studies|investigates|examines|explores|researches)\b(?!\s+(?:from|at|program|department|degree)\b)/u;

const statesResearch = (sentence: string): boolean =>
  RESEARCH_SUBJECT_STATEMENT.test(sentence.replace(DEGREE_LEVEL_STUDIES_PROGRAM, ' ')) ||
  RESEARCH_VERB.test(sentence);

function opensOnCareerFacts(text: string, opening: string): boolean {
  if (isDemotablePersonBio(text) || isCareerBiographyDescription(text)) return true;
  if (opensOnResearchHomeSubject(opening)) return false;
  return CAREER_OPENING_MARKERS.some((marker) => marker.test(opening));
}

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export function opensByStatingResearch(value: unknown): boolean {
  return careerBiographyOpening(textOf(value)).some(statesResearch);
}

export function isBiographyRatherThanResearch(value: unknown): boolean {
  const text = textOf(value);
  if (!text) return false;
  if (!opensOnCareerFacts(text, careerBiographyOpening(text).join(' '))) return false;
  return !opensByStatingResearch(text);
}
