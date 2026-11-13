/**
 * Lead statements a research home's own site makes about ITSELF (#5962).
 *
 * A lead statement is a person named with a lead role. It counts for or against an
 * attached lead only when it is anchored to the row it is read for: the sentence names
 * the row as its subject, a qualified title names the row, or a bare title sits in a
 * person card on the row's own page. A statement about another unit ("labs led by",
 * "the X Core, directed by") is ignored on any page.
 *
 * SAFETY: an omission is never evidence (#2647). Every reading here is a positive
 * statement on a page; a page that states nothing yields no statement.
 */

import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { removeRelatedEntityTeaserCards } from '../../utils/relatedEntityTeaserCards';
import { isTraineeLevelTitle } from '../../utils/traineeLevelTitle';
import { titleStatesOnlyAStaffRole } from '../sources/yaleDirectoryScraper';
import { extractElementTextWithLineBreaks } from './htmlText';
import { givenNamesCouldNameOnePerson } from './piNameMatch';

export interface LabSitePage {
  url: string;
  html: string;
}

export type RowLeadStatementForm = 'SUBJECT' | 'ROW_TITLE' | 'CARD_TITLE';

export interface RowLeadStatement {
  personName: string;
  pageUrl: string;
  form: RowLeadStatementForm;
  personEvidenced: boolean;
}

export interface RowNonLeadListing {
  personName: string;
  title: string;
  pageUrl: string;
}

export interface RowLeadEvidence {
  statements: RowLeadStatement[];
  nonLeadListings: RowNonLeadListing[];
  leadTitledNames: string[];
}

const fold = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const GENERIC_ROW_NAME_TOKENS = new Set([
  'the',
  'lab',
  'labs',
  'laboratory',
  'laboratories',
  'center',
  'centre',
  'centers',
  'for',
  'of',
  'and',
  'at',
  'yale',
  'program',
  'group',
  'institute',
  'initiative',
  'research',
  'in',
  'on',
  'a',
  'an',
  'faculty',
  'school',
  'medicine',
  'university',
]);

/**
 * The ways a page can name the row: its full name, its parenthesised acronym, and the
 * acronym head of an `<ACRONYM> Lab` name. A name made only of generic words anchors
 * nothing, because "the Lab" would then match every lab.
 */
export function rowNameAliases(rowName: unknown): string[] {
  const raw = String(rowName ?? '').trim();
  if (!raw) return [];
  const aliases = new Set<string>();
  const full = fold(raw.replace(/\([^)]*\)/g, ' ')).replace(/^the /, '');
  const fullTokens = full.split(' ');
  if (fullTokens.length >= 2 && fullTokens.some((token) => !GENERIC_ROW_NAME_TOKENS.has(token))) {
    aliases.add(full);
  }
  for (const match of raw.matchAll(/\(([A-Za-z][A-Za-z0-9&-]{1,11})\)/g)) {
    const acronym = fold(match[1]);
    if (acronym.length >= 2) aliases.add(acronym);
  }
  const head = raw.match(/^([A-Z][A-Za-z0-9&-]{2,})\s+(?:Lab|Laboratory|Center|Centre)\b/);
  if (head && head[1] === head[1].toUpperCase()) aliases.add(fold(head[1]));
  return [...aliases];
}

const containsAlias = (text: string, aliases: readonly string[]): boolean => {
  const haystack = ` ${fold(text)} `;
  return aliases.some((alias) => haystack.includes(` ${alias} `));
};

export function pageHeadingNamesRow($: cheerio.CheerioAPI, aliases: readonly string[]): boolean {
  const headings = [
    $('title').first().text(),
    ...$('h1')
      .toArray()
      .map((element) => $(element).text()),
    $('meta[property="og:site_name"]').attr('content') ?? '',
  ];
  return headings.some((heading) => containsAlias(heading, aliases));
}

const CREDENTIAL =
  /^(?:ph\.?\s?d\.?|m\.?d\.?|m\.?s\.?|m\.?sc\.?|m\.?p\.?h\.?|m\.?a\.?|b\.?a\.?|b\.?s\.?|m\.?b\.?a\.?|j\.?d\.?|r\.?n\.?|lcsw|psy\.?d\.?|dr\.?p\.?h\.?|mhs|mmsc|ms|facc|faap|mbbs|apr?n|np|pa-?c|sc\.?d\.?|ed\.?d\.?|dphil|mfa|mpa|mph|jr\.?|sr\.?|ii|iii|iv)$/i;

const NAME_TOKEN =
  /^(?:[A-Z][\p{L}'’.-]*|[A-Z]\.|(?:van|von|de|del|della|di|da|du|der|den|la|le|al|bin|ibn|ter|ten)|[\p{Lu}][\p{L}'’-]*)$/u;

const NOT_A_NAME_WORD =
  /^(?:pi|prof|dr|drs|read|more|view|full|profile|contact|us|our|team|people|lab|laboratory|center|centre|director|principal|investigator|professor|associate|assistant|research|faculty|staff|students?|alumni|news|home|about|the|of|and|yale|school|medicine|department|program|members?|postdoctoral|fellows?|publications?|join|email|phone|copy|link|back|top|menu|skip|main|content|senior|junior|lecturer|instructor|scientist|manager|coordinator|chair|dean|emeritus|adjunct|visiting|clinical|executive|interim|founder|open|positions?|current|former|like|loading|share|subscribe|follow|events?|courses?|leadership|contacts?|overview|mission|history|resources|opportunities)$/i;

/** A person name opening a line, with any credentials after a comma dropped. */
export function personNameFromLine(line: string): { name: string; rest: string } | null {
  const cleaned = line
    .replace(/^(?:drs?\.?|prof\.?|professor)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const [head, ...tail] = cleaned.split(',');
  const tokens = head.trim().split(' ').filter(Boolean);
  if (tokens.length < 2 || tokens.length > 5) return null;
  if (!tokens.every((token) => NAME_TOKEN.test(token))) return null;
  if (tokens.some((token) => NOT_A_NAME_WORD.test(token.replace(/[.,]/g, '')))) return null;
  if (tokens.filter((token) => /^\p{Lu}/u.test(token)).length < 2) return null;
  const restParts: string[] = [];
  let inCredentials = true;
  for (const part of tail) {
    const trimmed = part.trim();
    const leadingCredential = trimmed.split(' ')[0] ?? '';
    if (inCredentials && CREDENTIAL.test(trimmed)) continue;
    if (inCredentials && CREDENTIAL.test(leadingCredential)) {
      restParts.push(trimmed.slice(leadingCredential.length).trim());
      inCredentials = false;
      continue;
    }
    inCredentials = false;
    restParts.push(trimmed);
  }
  return { name: tokens.join(' '), rest: restParts.join(', ').trim() };
}

/**
 * Lead titles. `executive director` is one because the gold-v4 consensus judges a
 * center's executive director a correct lead; `associate`, `assistant`, `deputy` and
 * `medical` directors are not, and neither is `director of <another unit>`.
 */
const LEAD_TITLE_CORE =
  '(?:(?:acting|interim)\\s+)?(?:(?:lab(?:oratory)?|faculty|founding|center|centre|program)\\s+)?(?:executive\\s+)?(?:co-?)?director(?:\\s+and\\s+principal\\s+investigator)?|principal\\s+investigator|pi|lab\\s+head|head\\s+of\\s+(?:the\\s+)?lab(?:oratory)?';

const LEAD_TITLE_SEGMENT = new RegExp(
  `^(?:${LEAD_TITLE_CORE})(?:\\s*(?:,|\\bof\\b(?:\\s+the)?|\\bfor\\b(?:\\s+the)?)\\s*(.+)|\\s+(?:and|&)\\s+.+)?$`,
  'i',
);

const LEAD_TITLE_LABEL = new RegExp(`^(${LEAD_TITLE_CORE})s?\\s*[:\\-–]?\\s+(.+)$`, 'i');

const MAX_TITLE_WORDS = 16;

const LEAD_WORD = /\b(?:director|principal\s+investigator|pi|head|founder|co-?founder|chair)\b/i;

const MAX_RANK_WORDS = 8;

const FACULTY_RANK = /\b(?:professor|lecturer|dean|faculty)\b/i;

const CONTACT_DETAIL =
  /@|\d{3}[\s.-]\d{3,4}|\b(?:building|bldg|room|rm|suite|floor|street|st|avenue|ave|drive|road|hall|box|office|contact|email|phone|fax)\b/i;

/**
 * A rank is a few words naming an appointment. An address, a contact line or a sentence
 * that mentions an intern is not one, and the staff reader reads "Building" as a
 * facilities title, so neither may make a lead a non-lead.
 */
const isNonLeadRank = (text: string) =>
  wordCount(text) <= MAX_RANK_WORDS &&
  !CONTACT_DETAIL.test(text) &&
  (isTraineeLevelTitle(text) || titleStatesOnlyAStaffRole(text));

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

const ROW_KIND_NOUNS = ['lab', 'laboratory', 'group', 'center', 'centre'];

const ROW_PHRASE_END =
  /^(?:(?:lab|labs|laboratory|group|center|centre) )?(?:(?:at|in|of|on|since|and|which|that|where|who|for|from|with|within|to|is|was|has|had|its|their)\b|$)/;

const ROW_POSSESSIVE = /^(?:(?:lab|labs|laboratory|group|center|centre) )?s\b/;

const restAfterHead = (folded: string, head: string): string | null =>
  folded === head || folded.startsWith(`${head} `) ? folded.slice(head.length).trim() : null;

const phraseIsRow = (phrase: string, heads: readonly string[]): boolean => {
  const folded = fold(phrase).replace(/^the /, '');
  return heads.some((head) => {
    const rest = restAfterHead(folded, head);
    return rest !== null && ROW_PHRASE_END.test(rest);
  });
};

const qualifierIsRow = (qualifier: string, aliases: readonly string[]): boolean =>
  phraseIsRow(qualifier.split(/[,;(]/)[0], aliases);

type ListingTitleLead = 'BARE' | 'ROW' | 'OTHER' | null;

/**
 * How a card's title reads. A qualified lead title is about the row only when the
 * qualifier starts with the row's name. Non-lead reuses the trainee and staff-rank
 * readers unchanged, and never fires on a title carrying a lead word, so a card a
 * site labels "Director" or "Scientific Director" is never read as staff. A card that
 * pairs a lead title with a trainee or staff rank is ambiguous and states neither.
 * `contact` and `member` are deliberately not non-lead: faculty contacts on a multi-PI
 * site are its co-leads, and "Lab Member" is often the PI's own card heading (#5979).
 */
export function readListingTitle(
  title: string,
  aliases: readonly string[],
): { lead: ListingTitleLead; nonLead: boolean; leadTitled: boolean } {
  const segments = title
    .split(/\s*[;|]\s*|\s+and\s+(?=(?:associate|assistant)?\s*professor)/i)
    .map((segment) => segment.trim())
    .filter(Boolean);
  let lead: ListingTitleLead = null;
  for (const segment of segments) {
    const match = segment.match(LEAD_TITLE_SEGMENT);
    if (!match) continue;
    const qualifier = match[1];
    const reading = !qualifier ? 'BARE' : qualifierIsRow(qualifier, aliases) ? 'ROW' : 'OTHER';
    if (reading === 'ROW' || (reading === 'BARE' && lead !== 'ROW') || !lead) lead = reading;
  }
  const leadTitled = LEAD_WORD.test(title);
  if (lead && segments.some((segment) => !LEAD_WORD.test(segment) && isNonLeadRank(segment))) {
    return { lead: null, nonLead: false, leadTitled };
  }
  const nonLead =
    lead === null && !leadTitled && !FACULTY_RANK.test(title) && segments.some(isNonLeadRank);
  return { lead, nonLead, leadTitled };
}

const SELF_REFERENCE =
  '(?:the|our|this)\\s+(?:lab|laboratory|group|center|centre|program|initiative|institute|team|clinic|core)';

const BY_VERB =
  '(?:[Cc]o-?)?(?:[Ll]ed|[Oo]verseen|[Dd]irected|[Hh]eaded|[Rr]un|[Ss]upervised|[Ff]ounded\\s+and\\s+(?:led|directed))\\s+by';

const PERSON_AFTER =
  "(?:(?:PI|[Dd]rs?\\.?|[Pp]rof(?:essor)?\\.?|[Dd]irector)\\s+){0,3}((?:[A-Z][\\p{L}'’-]+|[A-Z]\\.)(?:\\s+(?:[A-Z]\\.|[A-Z][\\p{L}'’-]+|van|von|de|del|di|da|du|la|le)){1,3})";

const BY_PHRASE = new RegExp(`\\b${BY_VERB}\\s+${PERSON_AFTER}`, 'gu');

const UNDER_PHRASE = new RegExp(
  `\\b[Uu]nder\\s+the\\s+(?:direction|leadership|supervision)\\s+of\\s+${PERSON_AFTER}`,
  'gu',
);

const ACTIVE_TITLE_PHRASE = new RegExp(
  `${PERSON_AFTER}(?:,\\s*[^,]{1,40},)?\\s+(?:is|serves\\s+as)\\s+(?:the\\s+)?(?:founding\\s+|faculty\\s+)?(?:lab(?:oratory)?\\s+)?(?:director|principal\\s+investigator|head)\\s+of\\s+(?:the\\s+)?([^.,;]{2,80})`,
  'gu',
);

const ACTIVE_VERB_PHRASE = new RegExp(
  `${PERSON_AFTER}\\s+(?:leads|directs|oversees|heads|founded\\s+and\\s+(?:leads|directs))\\s+(?:the\\s+)?([^.,;]{2,80})`,
  'gu',
);

const NEXT_PERSON = new RegExp(`^\\s*(?:,|and|&)\\s*${PERSON_AFTER}`, 'u');

function sentenceAround(line: string, index: number, length: number) {
  const start = Math.max(
    line.lastIndexOf('. ', index),
    line.lastIndexOf('! ', index),
    line.lastIndexOf('? ', index),
  );
  const ends = ['. ', '! ', '? ']
    .map((mark) => line.indexOf(mark, index + length))
    .filter((at) => at >= 0);
  const end = ends.length ? Math.min(...ends) : line.length;
  return {
    before: line.slice(start < 0 ? 0 : start + 2, index),
    after: line.slice(index + length, end),
  };
}

const MODIFIER_PREPOSITION =
  '(?:in|of|at|within|from|for|with|across|on|by|to|into|throughout|beyond|outside|inside)';

const PROPER_UNIT_NAME = new RegExp(
  `^(?:the\\s+)?(?:Lab|Laboratory|Group|Center|Centre)\\s+(?:of|for|in|on)\\s+(?:the\\s+)?[A-Z]`,
  'u',
);

const subjectBeforeNamesRow = (text: string, aliases: readonly string[], ownPage: boolean) => {
  const tail = text
    .replace(/[\s,]+$/, '')
    .replace(/\s+(?:is|are|was|were|has been|have been|will be|currently|also)$/i, '')
    .replace(/[\s,]+$/, '');
  if (!tail) return false;
  const lastWords = tail.split(/\s+/).slice(-8).join(' ');
  if (new RegExp(`\\b${MODIFIER_PREPOSITION}\\s+${SELF_REFERENCE}$`, 'i').test(lastWords)) {
    return false;
  }
  if (ownPage && new RegExp(`${SELF_REFERENCE}$`, 'i').test(lastWords)) return true;
  const folded = ` ${fold(lastWords)}`;
  const modifierTail = new RegExp(` ${MODIFIER_PREPOSITION}(?: the)?$`);
  return aliases.some(
    (alias) =>
      folded.endsWith(` ${alias}`) &&
      !modifierTail.test(folded.slice(0, folded.length - alias.length - 1)),
  );
};

const fronterSubjectNamesRow = (text: string, aliases: readonly string[], ownPage: boolean) => {
  const head = text
    .replace(/^[\s,]+/, '')
    .split(/\s+/)
    .slice(0, 6)
    .join(' ');
  if (ownPage && new RegExp(`^(?:${SELF_REFERENCE}\\b(?!['’]s\\b)|we\\b)`, 'i').test(head)) {
    return true;
  }
  const folded = fold(head).replace(/^the /, '');
  return aliases.some((alias) => {
    const rest = restAfterHead(folded, alias);
    return rest !== null && !ROW_POSSESSIVE.test(rest);
  });
};

/**
 * Lead statements a sentence makes with a subject phrase ("led by", "overseen by",
 * "under the direction of", "X directs Y"). The noun phrase the phrase governs, in the
 * same sentence, must be the row, or on the row's own page a self-reference such as
 * "our lab". A fronted form ("Overseen by Dr. X, the DSL is ...") reads the subject
 * after the name.
 */
export function subjectStatements(
  line: string,
  aliases: readonly string[],
  ownPage: boolean,
  pageUrl: string,
): RowLeadStatement[] {
  const found: RowLeadStatement[] = [];
  for (const pattern of [BY_PHRASE, UNDER_PHRASE]) {
    for (const match of line.matchAll(pattern)) {
      const { before, after } = sentenceAround(line, match.index ?? 0, match[0].length);
      const anchored = before.trim()
        ? subjectBeforeNamesRow(before, aliases, ownPage)
        : fronterSubjectNamesRow(after, aliases, ownPage);
      if (!anchored) continue;
      const names = [match[1]];
      let rest = after;
      for (let more = rest.match(NEXT_PERSON); more; more = rest.match(NEXT_PERSON)) {
        names.push(more[1]);
        rest = rest.slice(more[0].length);
      }
      for (const name of names) {
        if (personNameFromLine(name)) {
          found.push({ personName: name, pageUrl, form: 'SUBJECT', personEvidenced: true });
        }
      }
    }
  }
  for (const pattern of [ACTIVE_TITLE_PHRASE, ACTIVE_VERB_PHRASE]) {
    for (const match of line.matchAll(pattern)) {
      const object = match[2] || '';
      const anchored =
        phraseIsRow(object, aliases) ||
        (ownPage && !PROPER_UNIT_NAME.test(object.trim()) && phraseIsRow(object, ROW_KIND_NOUNS));
      if (anchored && personNameFromLine(match[1])) {
        found.push({ personName: match[1], pageUrl, form: 'SUBJECT', personEvidenced: true });
      }
    }
  }
  return found;
}

const NAME_ELEMENT_SELECTOR =
  'a, span, strong, b, h2, h3, h4, h5, h6, p, div, li, td, dt, figcaption';

const MAX_CARD_DEPTH = 6;

/**
 * A person card holds a name, a few short lines and a short bio of a few paragraphs. An
 * ancestor holding several paragraphs or two dozen lines is a page section that happens
 * to name one person, and reading its contact block or a job advert as that person's
 * title is how a PI read as a postdoc.
 */
const MAX_CARD_LINES = 25;
const MAX_CARD_LINE_WORDS = 30;
const MAX_CARD_PROSE_LINES = 4;

const elementLines = (element: AnyNode | undefined): string[] =>
  extractElementTextWithLineBreaks(element)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

interface PersonCard {
  name: string;
  rest: string;
  lines: string[];
  inPeopleListing: boolean;
}

/**
 * Person cards: the largest DOM ancestor of a name element that holds no other person's
 * name; a card repeating its own person's name (a link and a modal) is still one card.
 * Only a card among other people's cards is a listing, so a page's lone byline or
 * contact block never lists its lead in the role a job advert below it names. Scoping by card rather than by line order or a character window is what lets a
 * label above the name and a title below it both attach to the right person.
 */
function personCards($: cheerio.CheerioAPI): PersonCard[] {
  const nameElements = $(NAME_ELEMENT_SELECTOR)
    .toArray()
    .filter((element) => {
      const lines = elementLines(element);
      return (
        lines.length === 1 && wordCount(lines[0]) <= 10 && Boolean(personNameFromLine(lines[0]))
      );
    })
    .filter(
      (element, _, all) => !all.some((other) => other !== element && $(element).find(other).length),
    );
  const nameOf = new Map<AnyNode, string>(
    nameElements.map((element) => [
      element,
      fold(personNameFromLine(elementLines(element)[0])?.name ?? ''),
    ]),
  );
  const peopleIn = (node: AnyNode | undefined) =>
    node
      ? new Set(
          $(node)
            .find('*')
            .toArray()
            .map((inner) => nameOf.get(inner))
            .filter(Boolean),
        ).size
      : 0;
  const cards: PersonCard[] = [];
  const seen = new Set<AnyNode>();
  for (const element of nameElements) {
    const nameLine = elementLines(element)[0];
    const person = personNameFromLine(nameLine);
    if (!person) continue;
    let card: AnyNode = element;
    for (let depth = 0; depth < MAX_CARD_DEPTH; depth += 1) {
      const parent: AnyNode | undefined = $(card).parent()[0];
      if (!parent || parent.type !== 'tag' || ['body', 'html', 'main'].includes(parent.name)) {
        break;
      }
      if (peopleIn(parent) > 1) break;
      card = parent;
    }
    if (seen.has(card)) continue;
    seen.add(card);
    const lines = elementLines(card).filter((line) => line !== nameLine);
    const proseLines = lines.filter((line) => wordCount(line) > MAX_CARD_LINE_WORDS).length;
    if (lines.length > MAX_CARD_LINES || proseLines > MAX_CARD_PROSE_LINES) continue;
    cards.push({
      name: person.name,
      rest: person.rest,
      lines,
      inPeopleListing: peopleIn($(card).parent()[0]) > 1,
    });
  }
  return cards;
}

function listingEvidence(
  $: cheerio.CheerioAPI,
  lines: readonly string[],
  aliases: readonly string[],
  ownPage: boolean,
  pageUrl: string,
): RowLeadEvidence {
  const evidence: RowLeadEvidence = { statements: [], nonLeadListings: [], leadTitledNames: [] };
  if (ownPage) {
    for (const line of lines) {
      const label = line.match(LEAD_TITLE_LABEL);
      const person = label ? personNameFromLine(label[2]) : null;
      if (person) {
        evidence.statements.push({
          personName: person.name,
          pageUrl,
          form: 'CARD_TITLE',
          personEvidenced: false,
        });
      }
    }
  }
  for (const card of personCards($)) {
    const title = [card.rest, ...card.lines]
      .flatMap((line) => line.split(/\s*[;|]\s*/))
      .filter((segment) => segment && wordCount(segment) <= MAX_TITLE_WORDS)
      .slice(0, 4)
      .join('; ');
    if (!title) continue;
    const reading = readListingTitle(title, aliases);
    if (reading.leadTitled) evidence.leadTitledNames.push(card.name);
    if (reading.lead === 'ROW' || (reading.lead === 'BARE' && ownPage)) {
      evidence.statements.push({
        personName: card.name,
        pageUrl,
        form: reading.lead === 'ROW' ? 'ROW_TITLE' : 'CARD_TITLE',
        personEvidenced: false,
      });
    } else if (reading.nonLead && ownPage && card.inPeopleListing) {
      evidence.nonLeadListings.push({ personName: card.name, title, pageUrl });
    }
  }
  return evidence;
}

const escapeForRegExp = (token: string) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const CREDENTIAL_AFTER_NAME =
  '(?:,\\s*|\\s+)(?:ph\\.?\\s?d|m\\.?d|m\\.?p\\.?h|sc\\.?d|dr\\.?p\\.?h|psy\\.?d|ed\\.?d|j\\.?d|m\\.?b\\.?a|m\\.?s|m\\.?a|mbbs|dphil)\\b';

/**
 * Whether the page shows that a name read from a title is a person (a subject sentence
 * already says a person leads): a credential or an honorific
 * written with it, or an email address or a person-page link carrying the surname. A
 * two-word heading such as a job title or a research topic parses like a name and has
 * none of these, and an outsider read from one is the costliest false contradiction.
 */
export function pageEvidencesPerson(personName: string, pageText: string, html: string): boolean {
  const tokens = nameTokens(personName);
  if (tokens.length < 2) return false;
  const surname = tokens[tokens.length - 1];
  const name = escapeForRegExp(personName);
  if (new RegExp(`(?:\\b(?:dr|drs|prof|professor)\\.?\\s+)${name}`, 'i').test(pageText))
    return true;
  if (new RegExp(`${name}${CREDENTIAL_AFTER_NAME}`, 'i').test(pageText)) return true;
  const raw = String(html ?? '').toLowerCase();
  if (new RegExp(`[a-z0-9._-]*${escapeForRegExp(surname)}[a-z0-9._-]*@[a-z0-9-]+\\.`).test(raw)) {
    return true;
  }
  return new RegExp(
    `/(?:profile|profiles|people|person|faculty|members?|team|bio)/[a-z0-9._-]*${escapeForRegExp(surname)}`,
  ).test(raw);
}

const FORMER_MEMBERS =
  /\b(?:alumni|alumnae|former|past)[\s_-]*(?:lab[\s_-]*)?(?:members?|people)?\b/i;

const ITEM_COLLECTION_PATH =
  /\/(?:news|news-article|news-articles|events?|blog|posts?|press|stories|publications?|spotlights?)(?:\/|$)/i;

/**
 * Pages that are not about who leads the row now. An alumni page lists where former
 * members went, so "Principal Investigator" there is a former trainee's later job, and a
 * news or event item says who led an initiative or a symposium, not the row.
 */
function isNotAboutCurrentLeads($: cheerio.CheerioAPI, pageUrl: string): boolean {
  let path = '';
  try {
    path = new URL(pageUrl).pathname;
  } catch {
    path = '';
  }
  return (
    ITEM_COLLECTION_PATH.test(path) ||
    FORMER_MEMBERS.test(path) ||
    FORMER_MEMBERS.test($('h1').first().text())
  );
}

/**
 * Every row-anchored lead statement and non-lead listing on the pages the lane read.
 * A page is the row's own when the landing page's title, an `<h1>` or `og:site_name`
 * names the row (every followed subpage then inherits it), or when its own title or
 * `<h1>` does. `header` is kept on purpose, because CMS person cards put the name and
 * title inside one.
 */
export function rowLeadEvidence(pages: readonly LabSitePage[], rowName: unknown): RowLeadEvidence {
  const aliases = rowNameAliases(rowName);
  const evidence: RowLeadEvidence = { statements: [], nonLeadListings: [], leadTitledNames: [] };
  if (!aliases.length || !pages.length) return evidence;
  let landingIsOwn = false;
  pages.forEach((page, index) => {
    const $ = cheerio.load(String(page.html ?? ''));
    const headingNamesRow = pageHeadingNamesRow($, aliases);
    if (index === 0) landingIsOwn = headingNamesRow;
    const ownPage = landingIsOwn || headingNamesRow;
    if (isNotAboutCurrentLeads($, page.url)) return;
    $('script, style, noscript, nav, footer, template, svg').remove();
    removeRelatedEntityTeaserCards($, page.url);
    const lines = elementLines($('body')[0] ?? $.root()[0]);
    for (const line of lines) {
      evidence.statements.push(...subjectStatements(line, aliases, ownPage, page.url));
    }
    const listed = listingEvidence($, lines, aliases, ownPage, page.url);
    evidence.statements.push(...listed.statements);
    const pageText = lines.join('\n');
    for (const statement of evidence.statements) {
      if (statement.pageUrl === page.url && !statement.personEvidenced) {
        statement.personEvidenced = pageEvidencesPerson(statement.personName, pageText, page.html);
      }
    }
    evidence.nonLeadListings.push(...listed.nonLeadListings);
    evidence.leadTitledNames.push(...listed.leadTitledNames);
  });
  return evidence;
}

export interface LeadIdentity {
  displayName: string;
  officialProfileUrls: string[];
}

const nameTokens = (value: unknown) =>
  fold(value)
    .split(' ')
    .filter((token) => token.length >= 2 && !CREDENTIAL.test(token));

function profileSlugTokens(urls: readonly string[]): string[][] {
  return urls
    .map((url) => {
      try {
        const segments = new URL(url).pathname.replace(/\/+$/, '').split('/');
        return (segments[segments.length - 1] || '').toLowerCase();
      } catch {
        return '';
      }
    })
    .filter((slug) => /^[a-z]+(?:-[a-z]+)+$/.test(slug))
    .map((slug) => slug.split('-'));
}

/**
 * Whether a stated name is this lead: a given name that could be one person's and a
 * surname that is the lead's, or one token of a compound surname either side writes in
 * full, or the lead's own `given-surname` profile slug, which covers a lead record whose
 * display name carries only a given name.
 */
export function statementNamesLead(personName: string, lead: LeadIdentity): boolean {
  const named = nameTokens(personName);
  if (named.length < 2) return false;
  const namedSurname = named[named.length - 1];
  const leadTokens = nameTokens(lead.displayName);
  if (leadTokens.length >= 2 && givenNamesCouldNameOnePerson(leadTokens[0], named[0])) {
    const leadSurname = leadTokens[leadTokens.length - 1];
    if (
      namedSurname === leadSurname ||
      leadTokens.slice(1).includes(namedSurname) ||
      named.slice(1).includes(leadSurname)
    ) {
      return true;
    }
  }
  return profileSlugTokens(lead.officialProfileUrls).some(
    (slug) => slug[slug.length - 1] === namedSurname && slug[0] === named[0],
  );
}

/**
 * Whether a stated name could still be this lead. A shared surname, or one token of a
 * compound surname, blocks a contradiction even when it cannot confirm, so an
 * initial-only lead stays unstated rather than contradicted by a fuller spelling of
 * their own name.
 */
export function statementCouldBeLead(personName: string, lead: LeadIdentity): boolean {
  if (statementNamesLead(personName, lead)) return true;
  const named = nameTokens(personName);
  const leadTokens = nameTokens(lead.displayName);
  if (!named.length || !leadTokens.length) return true;
  if (leadTokens.length < 2) return named.includes(leadTokens[0]);
  const leadSurnames = leadTokens.slice(1);
  return named.slice(1).some((token) => leadSurnames.includes(token));
}
