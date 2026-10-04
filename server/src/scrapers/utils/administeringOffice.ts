/**
 * The office a program page says administers the program, read only from an explicit
 * statement (#4589): "This fellowship is administered by the X", "Funds are administered by
 * the X at the Y", "The nomination process is coordinated by the X", "Administered by the X,
 * the award...", or a sentence that opens with the office inviting applications.
 *
 * The name must read as a Yale organization, with an organizational head noun before any
 * "in", "at" or "of", so neither a person nor a person placed in an office can pass, and with
 * no email address, phone number, URL, digit or staff title, because contact data fails
 * closed. An outside funder (a trust or foundation) is not the office a student deals with,
 * and a page that names two different offices states neither.
 */
import { partitionSentencesForFiltering } from '../../utils/descriptionHygiene';

const MAX_OFFICE_CHARS = 120;

const NAME_WORD = /^[A-Z][\w'’.&-]*$/;

const NAME_CONNECTORS: ReadonlySet<string> = new Set([
  'of',
  'for',
  'and',
  'the',
  'on',
  'in',
  'at',
  '&',
  'de',
  'du',
]);

const LEADING_ARTICLES = /^(?:the\s+)+/i;

const ACRONYM_ASIDE = /^\s*\([A-Z][A-Za-z&-]{1,11}\)/;

const PROGRAM_SUBJECT =
  /\b(?:fellowships?|grants?|awards?|funds?|prizes?|scholarships?|programs?|competitions?|internships?|stipends?|opportunit(?:y|ies))\b/i;

const ADMINISTERED_BY =
  /\b(?:is|are)\s+(?:jointly\s+)?(?:administered|managed|coordinated|overseen|run)\s+(?:by|through)\s+/;

const ADMINISTERED_BY_OPENING = /^Administered\s+(?:by|through)\s+/;

const INVITES_APPLICATIONS =
  /^\s*(?:invites?|welcomes?|is\s+(?:now\s+)?accepting|is\s+pleased\s+to\s+invite|seeks?)\s+applications\b/;

interface NameReading {
  name: string;
  rest: string;
}

/**
 * Reads a capitalized name off the front of `text`, word by word: capitalized words joined by
 * lower-case connectors ("of", "for", "and", "at the"), or by ", at", ending on a capitalized
 * word. Read by hand rather than by one pattern, because a pattern of optional words over a
 * long sentence backtracks without bound.
 */
function leadingName(text: string): NameReading | null {
  const body = text.replace(LEADING_ARTICLES, '');
  const tokens = [...body.matchAll(/\S+/g)];
  let nameEnd = 0;
  for (const [index, token] of tokens.entries()) {
    const [raw] = token;
    const word = raw.replace(/,$/, '');
    const isName = NAME_WORD.test(word);
    if (!isName && !NAME_CONNECTORS.has(word)) break;
    if (isName) nameEnd = (token.index ?? 0) + word.length;
    if (raw.endsWith(',') && tokens[index + 1]?.[0] !== 'at') break;
  }
  return nameEnd > 0 ? { name: body.slice(0, nameEnd), rest: body.slice(nameEnd) } : null;
}

const PROCESS_SUBJECT =
  /\b(?:nomination|application|selection|award|review)\s+(?:and\s+\w+\s+)?process\b/i;

const SUBJECT_IS_ANOTHER_PROGRAM =
  /\b(?:you|your|may|must|submit|apply|other|another|not|outside)\b/i;

const ORGANIZATION_HEAD =
  /\b(?:Office|Offices|Center|Centre|Centers|Council|Councils|Program|Programs|Programme|Department|Institute|Institution|College|School|Committee|Initiative|Forum|Library|Libraries|Society|Association|Museum|Gallery|Studies|Project|Laboratory|Division|Board)\b/;

const OUTSIDE_FUNDER = /\b(?:Foundation|Trust|Fund|Endowment|Corporation|Inc|LLC)\b/;

const PERSON_OR_CONTACT =
  /@|https?:|www\.|\d|\b(?:Dr|Mr|Mrs|Ms|Mx|Prof|Professor|Director|Coordinator|Manager|Assistant|Administrator|Advis[eo]r|Chair|President|Lecturer|Fellow)\b|\bDean\b(?!'s|’s)/;

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

function officeName(raw: string): string | undefined {
  const name = normalizeWhitespace(raw)
    .replace(/,\s+at\b/g, ' at')
    .replace(/[.,;:]+$/, '');
  if (name.length > MAX_OFFICE_CHARS || name.split(' ').length < 2) return undefined;
  const [leadingUnit] = name.split(/\s(?:in|at|of)\s/);
  if (
    !ORGANIZATION_HEAD.test(leadingUnit) ||
    OUTSIDE_FUNDER.test(name) ||
    PERSON_OR_CONTACT.test(name)
  ) {
    return undefined;
  }
  return name;
}

function withoutAcronymAside(rest: string): string {
  return rest.replace(ACRONYM_ASIDE, '');
}

function statedOfficeIn(sentence: string): string | undefined {
  const opening = sentence.match(ADMINISTERED_BY_OPENING);
  if (opening) {
    const reading = leadingName(sentence.slice(opening[0].length));
    return reading && /^\s*,/.test(withoutAcronymAside(reading.rest))
      ? officeName(reading.name)
      : undefined;
  }
  const inviting = leadingName(sentence);
  if (inviting && INVITES_APPLICATIONS.test(withoutAcronymAside(inviting.rest))) {
    return officeName(inviting.name);
  }
  const administered = ADMINISTERED_BY.exec(sentence);
  if (!administered) return undefined;
  const subject = sentence.slice(0, administered.index);
  const namesThisProgram = PROGRAM_SUBJECT.test(subject) || PROCESS_SUBJECT.test(subject);
  if (!namesThisProgram || SUBJECT_IS_ANOTHER_PROGRAM.test(subject)) return undefined;
  const reading = leadingName(sentence.slice(administered.index + administered[0].length));
  return reading ? officeName(reading.name) : undefined;
}

const NAME_FILLER: ReadonlySet<string> = new Set([...NAME_CONNECTORS, 'yale']);

function nameWords(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[’']s\b/g, '')
      .split(/[\s,]+/)
      .filter((word) => word && !NAME_FILLER.has(word)),
  );
}

/**
 * The same office is often named two ways on one page ("the MacMillan Center" and its full
 * name, "Council on Middle East Studies" and "Middle East Studies Council"), so two names
 * whose words one contains are one office, named as the page first named it.
 */
function namesOneOffice(a: string, b: string): boolean {
  const [wordsA, wordsB] = [nameWords(a), nameWords(b)];
  const [smaller, larger] = wordsA.size <= wordsB.size ? [wordsA, wordsB] : [wordsB, wordsA];
  return [...smaller].every((word) => larger.has(word));
}

export function statedAdministeringOffice(
  sections: ReadonlyArray<string | undefined>,
): string | undefined {
  const offices: string[] = [];
  for (const section of sections) {
    if (!section) continue;
    for (const raw of partitionSentencesForFiltering(section)) {
      const office = statedOfficeIn(normalizeWhitespace(raw));
      if (office && !offices.some((named) => namesOneOffice(named, office))) offices.push(office);
    }
  }
  return offices.length === 1 ? offices[0] : undefined;
}
