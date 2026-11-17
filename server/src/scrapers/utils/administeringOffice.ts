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
  /\b(?:is|are)\s+(?:jointly\s+)?(?:(?:administered|managed|coordinated|overseen|run)\s+(?:by|through)|awarded\s+through)\s+/;

const ADMINISTERED_BY_OPENING = /^Administered\s+(?:by|through)\s+/;

const INVITES_APPLICATIONS =
  /^\s*(?:(?:invites?|welcomes?|accepts?|is\s+(?:now\s+)?accepting|is\s+pleased\s+to\s+invite|seeks?)\s+applications\b|is\s+pleased\s+to\s+(?:award|offer)\b)/;

const APPLICATION_ROUTE =
  /\bapplications?\b([^.]{0,80}?)\b(?:is|are|will\s+be|be)\s+(?:accepted\s+|submitted\s+|made\s+)?(?:via|through)\s+/i;

const ROUTE_NEGATION = /\b(?:not|cannot|can't|never|no\s+longer)\b/i;

const NAMES_AN_APPLICATION_SYSTEM = /\bApplications?$/;

const FOLLOWS_AS_A_SYSTEM =
  /^\s+(?:website|web\s+site|portal|site|application|common\s+application)\b/i;

const SUBMITS_TO_AN_OFFICE =
  /\b(?:proposals?|applications?)\b[^.]{0,80}?\bsubmit(?:ted)?\s+(?:it\s+|them\s+)?to\s+(?:the\s+)?/i;

const REPORT_NOT_APPLICATION = /\breports?\b/i;

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

/**
 * The office a named application system belongs to, read off the front of the system's name:
 * the words up to the first organizational head noun and its "of", "for" or "on" complement,
 * so "Office of Fellowships Summer Research Common Application" is the Office of Fellowships
 * and "Slifka Center Israel Summer Travel Fellowships Common Application" is the Slifka Center.
 */
const SYSTEM_PART_OPENER = /^(?:Summer|Fall|Spring|Winter|Autumn|Annual|Common|Applications?)$/;

const MODIFIER_ENDING =
  /^(?:International|Undergraduate|Graduate|Global|National|Professional|Regional|Public|Advanced|General|Special)$/;

const PROGRAM_NOUN =
  /^(?:Fellowships?|Grants?|Awards?|Prizes?|Scholarships?|Internships?|Stipends?|Funds?|Competitions?)$/;

/**
 * The office a named application system belongs to: the system name's words up to its first
 * organizational head noun, then that head's "of", "for" or "on" complement, which runs until a
 * word that opens the system's own part (a season, "Common", "Application", or a program noun
 * after at least one complement word). "Office of Fellowships Summer Research Common
 * Application" is the Office of Fellowships, "Program in Agrarian Studies Fellowship
 * Application" keeps "Agrarian Studies", and "Slifka Center Israel Summer Travel Fellowships
 * Common Application" is the Slifka Center. A complement with no such boundary is undecidable,
 * so it states no office rather than a fragment.
 */
function officeOwningSystem(systemName: string): string | undefined {
  const words = normalizeWhitespace(systemName).split(' ');
  const headIndex = words.findIndex((word) => ORGANIZATION_HEAD.test(word));
  if (headIndex < 0) return undefined;
  let end = headIndex + 1;
  while (NAME_CONNECTORS.has(words[end] ?? '') && NAME_WORD.test(words[end + 1] ?? '')) {
    let next = end + 1;
    let complementWords = 0;
    while (
      next < words.length &&
      NAME_WORD.test(words[next]) &&
      !SYSTEM_PART_OPENER.test(words[next]) &&
      !(complementWords > 0 && PROGRAM_NOUN.test(words[next]))
    ) {
      next += 1;
      complementWords += 1;
    }
    if (complementWords === 0) break;
    const boundary = words[next];
    if (boundary === undefined) return undefined;
    end = next;
    if (!NAME_CONNECTORS.has(boundary)) break;
  }
  if (end > headIndex + 1 && MODIFIER_ENDING.test(words[end - 1])) return undefined;
  return officeName(words.slice(0, end).join(' '));
}

function officeAnApplicationGoesThrough(sentence: string): string | undefined {
  const route = APPLICATION_ROUTE.exec(sentence);
  if (!route || ROUTE_NEGATION.test(route[1])) return undefined;
  const reading = leadingName(sentence.slice(route.index + route[0].length));
  if (!reading) return undefined;
  const systemName = reading.name.replace(/[.,;:]+$/, '');
  if (NAMES_AN_APPLICATION_SYSTEM.test(systemName)) return officeOwningSystem(systemName);
  return FOLLOWS_AS_A_SYSTEM.test(reading.rest) ? officeName(systemName) : undefined;
}

function officeAnApplicationIsSubmittedTo(sentence: string): string | undefined {
  const submits = SUBMITS_TO_AN_OFFICE.exec(sentence);
  if (!submits || REPORT_NOT_APPLICATION.test(sentence)) return undefined;
  const reading = leadingName(sentence.slice(submits.index + submits[0].length));
  const name = normalizeWhitespace(reading?.name ?? '').replace(/[.,;:]+$/, '');
  if (!/\bOffices?$/.test(name)) return undefined;
  return name.split(' ').length >= 2 &&
    name.length <= MAX_OFFICE_CHARS &&
    !OUTSIDE_FUNDER.test(name) &&
    !PERSON_OR_CONTACT.test(name)
    ? name
    : undefined;
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
  const route =
    officeAnApplicationGoesThrough(sentence) ?? officeAnApplicationIsSubmittedTo(sentence);
  if (route) return route;
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
