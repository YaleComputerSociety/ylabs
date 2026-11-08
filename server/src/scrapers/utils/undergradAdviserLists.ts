import * as cheerio from 'cheerio';
import { normalizeName, splitName } from './scraperHelpers';

export interface AdviserListPair {
  advisorName: string;
  year: number;
  advisorSurnameOnly?: boolean;
  sourceDepartments?: string[];
}

export interface AdviserCellNames {
  names: string[];
  outsideAdvisersSkipped: number;
}

const PLACEHOLDER_CELL = /^(?:|-+|\u2013|\u2014|n\/?a|tbd|tba|none|unknown|\?+)$/i;
const ADVISER_ROLE_WORD = /,?\s*\b(?:co-?)?advis[eo]rs?\b\.?/gi;
const TRAILING_STAFF_ROLE =
  /\s+\b(?:post-?doc(?:toral)?(?:\s+(?:fellow|associate))?|lecturer|graduate student|grad student|ph\.?d\.? candidate|research scientist)\b.*$/i;
const LEADING_TITLE = /^(?:dr|prof|professor)\.?\s+/i;
const INSTITUTION_WORD =
  /\b(?:university|college|institute|institution|school|lab|laboratory|museum|center|centre|survey|observatory|department|hospital|foundation|society|agency)\b|\//i;
const YALE_AFFILIATION = /\bYale\b|\bY[A-Z]{1,4}\b|\bSOM\b|\bCGSC\b|\bPeabody\b|\bHaskins\b/;
const NAME_PARTICLE = /^(?:de|del|della|der|di|da|du|dos|van|von|la|le|al|bin|ibn|st\.?)$/i;
const MAX_NAME_TOKENS = 5;

const CREDENTIAL_TOKEN = /^(?:Ph\.?D\.?|M\.?D\.?|M\.?S\.?|M\.?P\.?H\.?|Sc\.?D\.?|D\.?Phil\.?)$/i;

function cleanAdviserName(raw: string): string {
  const withoutTitle = raw.trim().replace(LEADING_TITLE, '').replace(TRAILING_STAFF_ROLE, '');
  return normalizeName(withoutTitle)
    .split(/\s+/)
    .filter((token) => !CREDENTIAL_TOKEN.test(token.replace(/[,;]+$/, '')))
    .join(' ')
    .replace(/[.,;:]+$/, '')
    .trim();
}

function looksLikePersonName(value: string): boolean {
  if (!value || /\d/.test(value) || INSTITUTION_WORD.test(value)) return false;
  const tokens = value.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > MAX_NAME_TOKENS) return false;
  return tokens.every((token) => NAME_PARTICLE.test(token) || /^\p{Lu}/u.test(token));
}

/**
 * Two advisers share a cell as "A and B", "A & B" or "A, B, and C"; an outside co-adviser is
 * followed by their institution ("A and B, Boston University, advisers"), so a name followed by
 * a non-Yale affiliation is dropped rather than looked up.
 */
export function splitAdviserCell(cell: string): AdviserCellNames {
  const text = cell
    .replace(/\s+/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(ADVISER_ROLE_WORD, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (PLACEHOLDER_CELL.test(text)) return { names: [], outsideAdvisersSkipped: 0 };
  const segments = text
    .replace(/\bwith\b/gi, ',')
    .replace(/;/g, ',')
    .replace(/\s+(?:and|&)\s+/gi, ',')
    .split(',')
    .map((segment) => segment.trim().replace(/^(?:and|&)\s+/i, ''))
    .filter(Boolean);
  const names: string[] = [];
  let outsideAdvisersSkipped = 0;
  let previousNameIndex = -1;
  for (const segment of segments) {
    const cleaned = cleanAdviserName(segment);
    if (looksLikePersonName(cleaned)) {
      names.push(cleaned);
      previousNameIndex = names.length - 1;
      continue;
    }
    if (previousNameIndex >= 0 && !YALE_AFFILIATION.test(segment)) {
      names.splice(previousNameIndex, 1);
      outsideAdvisersSkipped += 1;
    }
    previousNameIndex = -1;
  }
  return { names: [...new Set(names)], outsideAdvisersSkipped };
}

export interface AdviserListParse {
  pairs: AdviserListPair[];
  outsideAdvisersSkipped: number;
}

const CLASS_YEAR_HEADING = /\bClass of ((?:19|20)\d{2})\b/i;

export function parseSeniorEssayAdviserTables(html: string): AdviserListParse {
  const $ = cheerio.load(html);
  const pairs: AdviserListPair[] = [];
  let outsideAdvisersSkipped = 0;
  let year: number | undefined;
  $('h1, h2, h3, h4, h5, p, table').each((_index, element) => {
    if (element.tagName !== 'table') {
      const heading = CLASS_YEAR_HEADING.exec($(element).text());
      if (heading) year = Number(heading[1]);
      return;
    }
    const table = $(element);
    const headers = table
      .find('tr')
      .first()
      .find('th, td')
      .map((_cell, cell) => $(cell).text().trim().toLowerCase())
      .get();
    const adviserColumn = headers.findIndex((header) => /advis[eo]r/.test(header));
    if (adviserColumn < 0 || !year) return;
    const tableYear = year;
    table
      .find('tr')
      .slice(1)
      .each((_rowIndex, row) => {
        const cells = $(row).find('td');
        if (cells.length <= adviserColumn) return;
        const split = splitAdviserCell(cells.eq(adviserColumn).text());
        outsideAdvisersSkipped += split.outsideAdvisersSkipped;
        for (const advisorName of split.names) pairs.push({ advisorName, year: tableYear });
      });
  });
  return { pairs, outsideAdvisersSkipped };
}

const YEAR_HEADING = /^\s*((?:19|20)\d{2})\s*$/;
const ADVISER_PARENTHETICAL = /\(([^()]*\badvis[eo]rs?\b[^()]*)\)/gi;

export function parseSeniorThesisAdviserParagraphs(html: string): AdviserListParse {
  const $ = cheerio.load(html);
  const pairs: AdviserListPair[] = [];
  let outsideAdvisersSkipped = 0;
  let year: number | undefined;
  $('h2, h3, h4, p, li').each((_index, element) => {
    const text = $(element).text().replace(/\s+/g, ' ').trim();
    if (element.tagName !== 'p' && element.tagName !== 'li') {
      const heading = YEAR_HEADING.exec(text);
      if (heading) year = Number(heading[1]);
      return;
    }
    if (!year) return;
    const adviserClauses = [...text.matchAll(ADVISER_PARENTHETICAL)];
    const clause = adviserClauses.at(-1)?.[1];
    if (!clause) return;
    const split = splitAdviserCell(clause);
    outsideAdvisersSkipped += split.outsideAdvisersSkipped;
    for (const advisorName of split.names) pairs.push({ advisorName, year });
  });
  return { pairs, outsideAdvisersSkipped };
}

const SUPERSCRIPT_LINE = /^\d{1,2}(?:\s*,\s*\d{1,2})*\s*\*?$/;
const SCHOLAR_AFFILIATION = /Science,?\s+Technology,?\s+(?:and|&)\s+Research\s+Scholars?\b/i;
const AUTHOR_CONTINUATION = /^(?:[,;]|and\s|&\s)/i;
const CREDENTIAL_ONLY =
  /^(?:(?:Ph\.?D\.?|M\.?D\.?|M\.?S\.?|M\.?P\.?H\.?|FRS|MD\/PhD|Sc\.?D\.?|D\.?Phil\.?)\s*)+$/i;
const TOC_LAB_LINE = /^(.+?),\s+(.+?)\s+lab$/i;
const MAX_AFFILIATION_LINES = 2;
const MAX_AUTHORS_PER_ABSTRACT = 12;

type BookletToken = { kind: 'marks'; marks: number[] } | { kind: 'text'; text: string };

interface BookletAuthor {
  name: string;
  marks: number[];
}

function bookletTokens(text: string): BookletToken[] {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line && !CREDENTIAL_ONLY.test(line.replace(/^[,;]\s*|[.,]$/g, '')))
    .map((line) =>
      SUPERSCRIPT_LINE.test(line)
        ? { kind: 'marks' as const, marks: line.replace('*', '').split(',').map(Number) }
        : { kind: 'text' as const, text: line },
    );
}

function authorsEndingAt(tokens: BookletToken[], lastMarkIndex: number): BookletAuthor[] {
  const authors: BookletAuthor[] = [];
  let index = lastMarkIndex;
  while (index >= 1 && authors.length < MAX_AUTHORS_PER_ABSTRACT) {
    const marksToken = tokens[index];
    const nameToken = tokens[index - 1];
    if (marksToken.kind !== 'marks' || nameToken.kind !== 'text') break;
    const before = tokens[index - 2];
    const afterBareComma = before?.kind === 'text' && /^[,;]$/.test(before.text);
    const continues = AUTHOR_CONTINUATION.test(nameToken.text) || afterBareComma;
    const names = nameToken.text
      .split(/[,;]/)
      .map((part) => part.trim().replace(/^(?:and|&)\s+/i, ''))
      .filter((part) => part && !CREDENTIAL_ONLY.test(part));
    authors.unshift(...names.map((name) => ({ name, marks: marksToken.marks })));
    if (!continues) break;
    index -= afterBareComma ? 3 : 2;
  }
  return authors;
}

function affiliationsFrom(tokens: BookletToken[], start: number): Map<number, string> {
  const affiliations = new Map<number, string>();
  let index = start;
  while (index < tokens.length) {
    const marksToken = tokens[index];
    if (marksToken.kind !== 'marks' || marksToken.marks.length !== 1) break;
    const lines: string[] = [];
    let next = index + 1;
    while (next < tokens.length && lines.length < MAX_AFFILIATION_LINES) {
      const token = tokens[next];
      if (token.kind !== 'text') break;
      const continuesPrevious =
        lines.length > 0 && /,\s*$/.test(lines[lines.length - 1]) && token.text.length < 80;
      if (lines.length > 0 && !continuesPrevious) break;
      lines.push(token.text);
      next += 1;
    }
    if (lines.length === 0) break;
    affiliations.set(marksToken.marks[0], lines.join(' '));
    index = next;
  }
  return affiliations;
}

function surnameKey(name: string): string {
  return (splitName(name).last || name).toLowerCase();
}

/**
 * The 2019 and 2021 STARS II booklets print each abstract with an author line ("Student^1,
 * Mentor^2, and PI^2") and numbered affiliations, with no `PI:` line. The presenter is the
 * author carrying the Research Scholar affiliation and the faculty lead is read as the last
 * other author, the booklet's convention; where the 2021 table of contents names the lab
 * ("Student, Surname lab") the author with that surname is taken instead, and a lab surname
 * no author carries is matched on the surname alone.
 */
export function parseStarsAuthorListBooklet(text: string, year: number): AdviserListPair[] {
  const tokens = bookletTokens(text);
  const labByStudent = new Map<string, string>();
  for (const token of tokens) {
    if (token.kind !== 'text') continue;
    const tocLine = TOC_LAB_LINE.exec(token.text);
    if (tocLine) labByStudent.set(normalizeName(tocLine[1]).toLowerCase(), tocLine[2].trim());
  }
  const pairs: AdviserListPair[] = [];
  const seenStudents = new Set<string>();
  tokens.forEach((token, scholarIndex) => {
    if (token.kind !== 'text' || !SCHOLAR_AFFILIATION.test(token.text)) return;
    let boundary = scholarIndex - 1;
    while (boundary >= 1) {
      const current = tokens[boundary];
      const previous = tokens[boundary - 1];
      if (current.kind === 'marks' && previous.kind === 'marks') break;
      boundary -= 1;
    }
    if (boundary < 1) return;
    const authors = authorsEndingAt(tokens, boundary - 1);
    if (authors.length < 2) return;
    const affiliations = affiliationsFrom(tokens, boundary);
    const scholarMark = [...affiliations].find(([, line]) => SCHOLAR_AFFILIATION.test(line))?.[0];
    const student =
      authors.find((author) => scholarMark !== undefined && author.marks.includes(scholarMark)) ??
      authors[0];
    const studentKey = normalizeName(student.name).toLowerCase();
    if (seenStudents.has(studentKey)) return;
    seenStudents.add(studentKey);
    const others = authors.filter((author) => author !== student);
    const labLabel = labByStudent.get(studentKey);
    const labSurname = labLabel && !/\s/.test(labLabel) ? labLabel.toLowerCase() : undefined;
    const labAuthor = labSurname
      ? others.find((author) => surnameKey(cleanAdviserName(author.name)) === labSurname)
      : undefined;
    const lead = labAuthor ?? (labSurname ? undefined : others[others.length - 1]);
    const sourceDepartmentsFor = (author: BookletAuthor | undefined): string[] =>
      (author?.marks ?? [])
        .filter((mark) => mark !== scholarMark)
        .map((mark) => affiliations.get(mark))
        .filter((line): line is string => Boolean(line));
    if (lead) {
      const advisorName = cleanAdviserName(lead.name.split(',')[0]);
      if (!looksLikePersonName(advisorName)) return;
      pairs.push({ advisorName, year, sourceDepartments: sourceDepartmentsFor(lead) });
      return;
    }
    if (labSurname && labLabel) {
      const nonStudentDepartments = [
        ...new Set(others.flatMap((author) => sourceDepartmentsFor(author))),
      ];
      pairs.push({
        advisorName: labLabel,
        year,
        advisorSurnameOnly: true,
        sourceDepartments: nonStudentDepartments,
      });
    }
  });
  return pairs;
}
