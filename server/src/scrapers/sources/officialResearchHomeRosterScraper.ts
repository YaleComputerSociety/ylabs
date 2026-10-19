/**
 * Bounded acquisition of current research-home rosters from reviewed official pages.
 *
 * This source deliberately uses an allowlist of entity/page/section contracts. A page
 * is not treated as a current roster merely because it contains person names. Each
 * accepted section must be explicitly configured as current, every publish date must
 * be recent enough, and every materializable person must have a source-specific
 * official profile URL. Names and contact details are never identity proof.
 */
import { RESEARCH_ENTITY_SLUG_OBSERVATION_FIELD } from '../entityMaterializer';
import axios from 'axios';
import { retryOnRetryableStatus } from '../utils/httpFetch';
import * as cheerio from 'cheerio';
import { createHash } from 'crypto';
import { redactDirectContactInfo } from '../../utils/contactRedaction';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';
import { getCached, setCached } from '../snapshotCache';
import type {
  OfficialRosterConfigOrigin,
  OfficialRosterUndergraduateStatus,
} from '../../models/storedVocabularies';
import { OFFICIAL_ROSTER_CONFIGS } from '../officialRosterConfigs';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import { derivedUndergradRostersServe } from '../../services/hostedUndergraduates';

export const OFFICIAL_RESEARCH_HOME_ROSTER_SOURCE = 'official-research-home-roster';
export const OFFICIAL_ROSTER_REFRESH_OWNER = 'Yale Research data operations';
export const OFFICIAL_ROSTER_REFRESH_CADENCE = 'weekly';
export const OFFICIAL_ROSTER_FRESHNESS_DAYS = 21;
export const OFFICIAL_ROSTER_MAX_PUBLISH_AGE_DAYS = 550;
export const OFFICIAL_ROSTER_MAX_MEMBERS_PER_ENTITY = 40;
export const OFFICIAL_ROSTER_MAX_UNDERGRADUATES_PER_ENTITY = 150;

export type OfficialRosterTemplate = 'profile-grid' | 'yalesites-directory' | 'heading-list';

export interface OfficialRosterConfig {
  researchEntityKey: string;
  url: string;
  template?: OfficialRosterTemplate;
  currency?: 'publish-date' | 'section-label';
  currentSectionLabels: string[];
  pastSectionLabels?: string[];
  /** Owner judgements on single listed names, recorded per lab in its review (#5039). */
  withheldNames?: string[];
  pastNames?: string[];
  alumniPageUrl?: string;
}

export interface OfficialRosterUndergraduate {
  name: string;
  status: OfficialRosterUndergraduateStatus;
  startYear?: number;
  endYear?: number;
  profileUrl?: string;
}

export interface ExtractedOfficialRosterMember {
  name: string;
  title: string;
  role: OfficialRosterRole;
  profileUrl: string;
  identityKey: string;
  membershipKey: string;
  sectionLabel: string;
}

export type OfficialRosterRole =
  'postdoc' | 'grad-student' | 'undergrad' | 'staff' | 'core-faculty' | 'affiliate';

export interface ExtractedOfficialRoster {
  state: 'current' | 'partial' | 'empty' | 'withheld' | 'stale';
  members: ExtractedOfficialRosterMember[];
  undergraduates: OfficialRosterUndergraduate[];
  withheldCount: number;
  undergraduateWithheldCount: number;
  duplicateCount: number;
  sourcePublishedAt?: Date;
  observedAt: Date;
  freshnessExpiresAt: Date;
  complete: boolean;
}

export { OFFICIAL_ROSTER_CONFIGS } from '../officialRosterConfigs';

const DAY_MS = 24 * 60 * 60 * 1000;

const normalizedText = (value: unknown): string =>
  redactDirectContactInfo(
    String(value || '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  ).slice(0, 300);

const normalizedLabel = (value: unknown): string =>
  normalizedText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function dateFromPublishMeta(value: string): Date | undefined {
  const text = value.trim();
  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  const parsed = slashMatch
    ? new Date(Date.UTC(Number(slashMatch[3]), Number(slashMatch[1]) - 1, Number(slashMatch[2])))
    : new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function officialProfileUrl(href: string, sourceUrl: string): string {
  if (!href) return '';
  try {
    const source = new URL(sourceUrl);
    const profile = new URL(href, source);
    if (profile.protocol !== 'https:' || profile.username || profile.password) return '';
    if (profile.hostname.toLowerCase() !== source.hostname.toLowerCase()) return '';
    if (!/(?:^|\/)profile(?:s)?\//i.test(profile.pathname)) return '';
    profile.hash = '';
    profile.search = '';
    return profile.toString();
  } catch {
    return '';
  }
}

const stableKey = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 24);

export function mapOfficialRosterRole(
  titleValue: unknown,
  sectionValue: unknown,
): OfficialRosterRole | null {
  const title = normalizedLabel(titleValue);
  const section = normalizedLabel(sectionValue);
  const evidence = `${section} ${title}`.replace(
    /\b(?:director|dean|directors) of undergraduate (?:studies|education|research)\b/g,
    ' ',
  );
  if (/\b(postdocs?|post docs?|post doctoral|postdoctoral)\b/.test(evidence)) return 'postdoc';
  if (
    /\b(graduate student|phd student|phd candidate|ph d student|ph d candidate|doctoral student|doctoral candidate|master s student|masters student|predoctoral)\b/.test(
      evidence,
    )
  ) {
    return 'grad-student';
  }
  if (/\b(undergraduates?|undergrads?)\b/.test(evidence)) return 'undergrad';
  if (
    /\b(lab manager|laboratory manager|research assistant|research associate|research scientist|postgraduate associate|post graduate associate|technician|coordinator|data manager|staff)\b/.test(
      evidence,
    )
  ) {
    return 'staff';
  }
  if (/\b(professor|faculty)\b/.test(evidence)) return 'core-faculty';
  if (/\b(member|affiliate|fellow|visitor|visiting)\b/.test(evidence)) return 'affiliate';
  return null;
}

interface RosterCard {
  name: string;
  title: string;
  profileHref: string;
}

interface RosterTableRow {
  name: string;
  position: string;
  departure: string;
}

interface ListedPersonEntry {
  name: string;
  title: string;
  years: string;
  profileHref: string;
}

interface RosterSection {
  label: string;
  /** A deeper heading inside the section that names no group, such as the school its people came from. */
  caption?: string;
  withinPastSection: boolean;
  headingWithinPastSection?: boolean;
  cards: RosterCard[];
  tableRows: RosterTableRow[];
  listItems: ListedPersonEntry[];
}

const headingLevel = (tagName: string): number => Number(tagName.slice(1));

const PAST_SECTION_LABEL = /\b(?:alumni|alumnae|alumnus|former|past|previous)\b/i;

const isPastSectionLabel = (label: string): boolean =>
  PAST_SECTION_LABEL.test(label) && !/\bcurrent\b/i.test(label);

interface HeadingTrailEntry {
  label: string;
  level: number;
}

function openSection(trail: HeadingTrailEntry[], label: string, level: number): RosterSection {
  while (trail.length > 0 && trail[trail.length - 1].level >= level) trail.pop();
  const withinPastSection = trail.some((heading) => isPastSectionLabel(heading.label));
  trail.push({ label, level });
  return { label, withinPastSection, cards: [], tableRows: [], listItems: [] };
}

function readProfileGridSections($: cheerio.CheerioAPI): RosterSection[] {
  return $('section.organization-member-listing')
    .toArray()
    .map((element) => {
      const section = $(element);
      return {
        label: normalizedText(section.attr('aria-label') || section.find('h2,h3').first().text()),
        cards: section
          .find('article.profile-grid-item')
          .toArray()
          .map((memberElement) => {
            const card = $(memberElement);
            return {
              name: normalizedText(
                card.find('.profile-grid-item__name').first().text() || card.attr('aria-label'),
              ).replace(/['’]s Profile$/i, ''),
              title: normalizedText(card.find('.profile-grid-item__title').first().text()),
              profileHref:
                card.find('a.profile-grid-item__link-details').first().attr('href') || '',
            };
          }),
        tableRows: [],
        listItems: [],
        withinPastSection: false,
      };
    });
}

const tableColumnIndex = (headers: string[], pattern: RegExp, fallback: number): number => {
  const index = headers.findIndex((header) => pattern.test(header));
  return index >= 0 ? index : fallback;
};

const TABLE_HEADER_LABEL =
  /^(?:name|member|members|role|role in lab|position|title|years?|dates?)\b/;

/**
 * A first row whose cells are all short column labels such as "Name" and "Role in Lab"
 * is the table's header even when the page writes it with td rather than th.
 */
function tableHeaderCells($: cheerio.CheerioAPI, table: cheerio.Cheerio<any>): string[] {
  const firstRow = table.find('tr').first();
  const th = firstRow.find('th').toArray();
  if (th.length > 0) return th.map((cell) => normalizedLabel($(cell).text()));
  const cells = firstRow
    .find('td')
    .toArray()
    .map((cell) => normalizedLabel($(cell).text()));
  return cells.length > 1 &&
    cells.some((cell) => /^(?:name|member)\b/.test(cell)) &&
    cells.every(
      (cell) =>
        !cell || (cell.length <= 30 && TABLE_HEADER_LABEL.test(cell)) || /\bcurrent\b/.test(cell),
    )
    ? cells
    : [];
}

function readRosterTableRows($: cheerio.CheerioAPI, table: cheerio.Cheerio<any>): RosterTableRow[] {
  const headers = tableHeaderCells($, table);
  const headerRowIsData = headers.length > 0 && table.find('tr').first().find('th').length === 0;
  const nameColumn = tableColumnIndex(headers, /\b(member|name)\b/, 0);
  const positionColumn = tableColumnIndex(
    headers.map((header) => (/\bcurrent\b/.test(header) ? '' : header)),
    /\b(position|role|title)\b/,
    -1,
  );
  const departureColumn = tableColumnIndex(
    headers,
    /\b(departure|departed|left|years?|dates?)\b/,
    -1,
  );
  return table
    .find('tr')
    .toArray()
    .slice(headerRowIsData ? 1 : 0)
    .map((row) =>
      $(row)
        .find('td')
        .toArray()
        .map((cell) => normalizedText($(cell).text())),
    )
    .filter((cells) => cells.length > 0)
    .map((cells) => ({
      name: cells[nameColumn] || (headers.length === 0 ? cells.find(Boolean) || '' : ''),
      position: positionColumn >= 0 ? cells[positionColumn] || '' : '',
      departure:
        departureColumn >= 0
          ? cells[departureColumn] || ''
          : cells.find((cell, index) => index !== nameColumn && /\b(?:19|20)\d{2}\b/.test(cell)) ||
            '',
    }));
}

/**
 * People listed before the page's first heading sit under the page itself, so that
 * section takes the page title as its label rather than no label at all.
 */
const pageTitleLabel = ($: cheerio.CheerioAPI): string => normalizedText($('title').first().text());

function readYaleSitesDirectorySections($: cheerio.CheerioAPI): RosterSection[] {
  const sections: RosterSection[] = [];
  const trail: HeadingTrailEntry[] = [];
  let section: RosterSection = openSection(trail, pageTitleLabel($), 0);
  let sectionLevel = 0;
  trail.length = 0;
  sections.push(section);
  const scope = $('main').length > 0 ? 'main ' : '';
  $(['h2', 'h3', 'h4', 'li', 'p', 'table'].map((tag) => scope + tag).join(', ')).each(
    (_index, element) => {
      const node = $(element);
      if (node.closest('nav, header, footer, aside').length > 0) return;
      if (node.is('li.directory-listing-card')) {
        const heading = node.find('.directory-listing-card__heading').first();
        const link = heading.find('a').first();
        section.cards.push({
          name: normalizedText(heading.text()),
          title: normalizedText(node.find('.directory-listing-card__subheading').first().text()),
          profileHref: link.attr('href') || '',
        });
        return;
      }
      if (node.closest('li.directory-listing-card').length > 0) return;
      if (!node.is('li') && node.parents('li').length > 0) return;
      if (node.is('table')) {
        if (!isLayoutTable($, node)) section.tableRows.push(...readRosterTableRows($, node));
        return;
      }
      const enclosingTable = node.closest('table');
      if (enclosingTable.length > 0 && !isLayoutTable($, enclosingTable)) return;
      if (node.is('li, p')) {
        section.listItems.push(blockEntry($, node));
        return;
      }
      const tagName = (element as { tagName?: string }).tagName || 'h3';
      const text = normalizedText(node.text());
      const level = headingLevel(tagName);
      section = isCaptionHeading(section, sectionLevel, text, level)
        ? captionedSection(section, text)
        : openSection(trail, text, level);
      if (!section.caption) sectionLevel = level;
      sections.push(section);
    },
  );
  return sections;
}

const ROSTER_CHROME_SUFFIX = /\s*(?:view full profile|copy link|read more|email|website)\s*$/i;
const NOT_A_PERSON_WORDS =
  /\b(?:students?|researchers?|assistants?|members?|alumni|alumnae|lab|laboratory|group|team|people|profile|link|email|contact|current|former|undergraduates?|graduates?|postdocs?|staff|faculty|fellows?|interns?|collaborators?|investigators?|scientists|engineers|technicians|associates|scholars|trainees|residents|clinicians|coordinators|managers|analysts|administrators|volunteers|affiliates|advisors|visitors|mentors)\b/i;

const SECTION_HEADING_WORDS = new Set(
  (
    'about academic activities affiliates areas awards biography collaborators contact courses ' +
    'directions education events funding gallery highlights home interests join location media ' +
    'methods mission news opportunities our overview photos positions press projects ' +
    'publications recent research resources selected software teaching the and for with ' +
    'welcome what where who why visiting summer program programs class ' +
    'major minor neuroscience psychology mathematics computer science physics chemistry ' +
    'biology engineering economics statistics protein folding organisms cells molecular ' +
    'cellular biochemistry biophysics applied environmental bs ba b.s. b.a. ms m.s. phd ph.d. md ' +
    'university college institute school hospital center centre academy ' +
    'plan plans postgrad postgraduate hometown hobbies hobby fact facts advisor mentor ' +
    'thesis concentration role status graduation interest fun favorite next position'
  ).split(' '),
);

const displayCase = (name: string): string =>
  name === name.toUpperCase() && /\p{Lu}{2}/u.test(name)
    ? name
        .toLowerCase()
        .replace(/(^|[\s'’-])(\p{L})/gu, (_match, lead, letter) => lead + letter.toUpperCase())
    : name;

/** Headings some sites set in lower case and capitalize with CSS ("yafet dawit"). */
const withCapitalizedWords = (text: string): string =>
  text.replace(/(^|[\s-])(\p{Ll})(\p{L}*)/gu, (match, lead, letter, rest) =>
    LOWERCASE_NAME_PARTICLES.has(`${letter}${rest}`)
      ? match
      : `${lead}${letter.toUpperCase()}${rest}`,
  );

const withoutRepeatedName = (name: string): string => {
  const tokens = name.split(/\s+/);
  const half = tokens.length / 2;
  return Number.isInteger(half) &&
    half > 0 &&
    tokens.slice(0, half).join(' ') === tokens.slice(half).join(' ')
    ? tokens.slice(0, half).join(' ')
    : name;
};

const withoutRosterChrome = (value: string): string =>
  value
    .replace(/^[^\p{L}]+/u, '')
    .replace(/^(?:Mr|Ms|Mrs|Mx|Miss)\.?\s+/, '')
    .replace(/['’]s Profile$/i, '')
    .replace(ROSTER_CHROME_SUFFIX, '')
    .trim();

const LOWERCASE_NAME_PARTICLES = new Set(
  'al bin binti da das de del della den der di do dos du e el la le ten ter van von y zu'.split(
    ' ',
  ),
);

export function looksLikeListedPersonName(value: string): boolean {
  const name = withoutRosterChrome(value);
  if (name.length < 3 || name.length > 60 || /[\d:;,&/]/.test(name)) return false;
  if (NOT_A_PERSON_WORDS.test(name) || mapOfficialRosterRole(name, '') !== null) return false;
  const tokens = name.split(/\s+/);
  if (tokens.some((token) => SECTION_HEADING_WORDS.has(token.toLowerCase()))) return false;
  return (
    tokens.length >= 2 &&
    tokens.length <= 5 &&
    /^\p{Lu}/u.test(tokens[0]) &&
    /^\p{Lu}/u.test(tokens[tokens.length - 1]) &&
    tokens.every(
      (token) => /^[\p{Lu}(“"'‘]/u.test(token) || LOWERCASE_NAME_PARTICLES.has(token.toLowerCase()),
    )
  );
}

const ENTRY_NAME_BOUNDARY = /\s*(?:[(,:;|]|\s[–—-]\s)/;

const listItemEntry = (text: string): ListedPersonEntry => {
  const boundary = ENTRY_NAME_BOUNDARY.exec(text);
  return boundary && boundary.index > 0
    ? {
        name: text.slice(0, boundary.index).trim(),
        title: '',
        years: text.slice(boundary.index),
        profileHref: '',
      }
    : { name: text, title: '', years: '', profileHref: '' };
};

const PAST_MEMBERS_TOGGLE =
  'summary, button, [role="button"], a[href^="#"], a[data-toggle], a[data-bs-toggle], a[aria-controls]';

function leadingLineText($: cheerio.CheerioAPI, element: cheerio.Cheerio<any>): string {
  const firstLine = (element.html() || '').split(/<br\s*\/?>/i)[0];
  return normalizedText(cheerio.load(`<div>${firstLine}</div>`)('div').text());
}

/**
 * A bold, heading or linked lead names the person only when the block opens with it: a
 * link further into the line is a destination or a page link ("Google Scholar Page"),
 * not the person the line lists.
 */
function blockEntry($: cheerio.CheerioAPI, element: cheerio.Cheerio<any>): ListedPersonEntry {
  const lead = element.find('h1, h2, h3, h4, h5, h6, strong, b, a').first();
  const link = element.is('a') ? element : element.find('a[href]').first();
  const leadText = normalizedText(lead.text()).replace(/[\s,;:]+$/, '');
  const text = leadingLineText($, element);
  const leadOpensBlock =
    Boolean(leadText) && withoutRosterChrome(text).startsWith(withoutRosterChrome(leadText));
  const entry =
    leadOpensBlock && looksLikeListedPersonName(leadText)
      ? { name: leadText, title: '', years: text, profileHref: '' }
      : listItemEntry(text);
  return { ...entry, profileHref: link.attr('href') || '' };
}

/**
 * Reads a page as headings and the people listed under each. A heading deeper than the
 * section it sits in is a person when it reads as a name (a card's name heading), and a
 * new nested section otherwise; a heading at or above the section's level ends it.
 */
const PAST_MEMBERS_MARKER =
  /^(?:view|show|see|our)?\s*(?:lab |group )?(?:alumni|alumnae|former|former members|past members|previous members)\s*:?$/i;
const DESCRIPTOR_LINE_MAX = 60;
const SINGULAR_ROLE_NOUN =
  /\b(?:investigator|student|researcher|associate|assistant|fellow|scientist|manager|intern|professor|director|coordinator|technician|candidate|scholar|resident|postdoc|lecturer|engineer|analyst|administrator|volunteer|undergrad|undergraduate)\b/i;
const COLLECTIVE_ROLE_NOUN =
  /\b(?:investigators|students|researchers|associates|assistants|fellows|scientists|managers|interns|professors|directors|coordinators|technicians|candidates|scholars|residents|postdocs|members|alumni|alumnae|team|staff|trainees|people|undergrads|undergraduates|collaborators|affiliates|visitors)\b/i;

/**
 * A heading that names a group of people. Inside such a section, a deeper heading that
 * names no group and no person ("Research interests", a pet's name, an empty heading) is
 * a caption within the section rather than a new one.
 */
const isRosterSectionLabel = (text: string): boolean =>
  COLLECTIVE_ROLE_NOUN.test(text) ||
  isPastSectionLabel(text) ||
  /\b(?:team|group|lab|laboratory|crew|students?)\b/i.test(text);

const isCaptionHeading = (
  section: RosterSection,
  sectionLevel: number,
  text: string,
  level: number,
): boolean =>
  level > sectionLevel && isRosterSectionLabel(section.label) && !isRosterSectionLabel(text);

const captionedSection = (section: RosterSection, caption: string): RosterSection => {
  const headingWithinPastSection = section.headingWithinPastSection ?? section.withinPastSection;
  return {
    label: section.label,
    caption,
    withinPastSection: headingWithinPastSection || isPastSectionLabel(caption),
    headingWithinPastSection,
    cards: [],
    tableRows: [],
    listItems: [],
  };
};

/**
 * A heading such as "Undergraduate Researcher" right after a name heading is that
 * person's role, while a plural one such as "Undergraduate Researchers" opens a section.
 */
const isSingularRoleLine = (text: string): boolean =>
  text.length <= 100 &&
  SINGULAR_ROLE_NOUN.test(text) &&
  !COLLECTIVE_ROLE_NOUN.test(text) &&
  !looksLikeListedPersonName(listItemEntry(text).name);
const PROFILE_FIELD_LINE =
  /^(?:interests?|hobbies|education(?: (?:&|and) training)?|background|hometown|majors?|fun facts?|projects?|role|position)\s*:/i;

/**
 * A table used for page layout rather than as a roster: one of its cells holds several
 * blocks (paragraphs, headings, list items). Its blocks are read like the page around it
 * instead of as one row per person.
 */
function isLayoutTable($: cheerio.CheerioAPI, table: cheerio.Cheerio<any>): boolean {
  return table
    .find('td')
    .toArray()
    .some((cell) => $(cell).find('p, div.paragraph, h1, h2, h3, h4, h5, h6, li').length >= 2);
}

const CLASS_YEAR_PHRASE =
  /\b(?:class of (?:19|20)\d{2}|Yale College\s*['’‘]?\d{2,4}|(?:19|20)\d{2}\s+graduate)\b/i;

/**
 * A dated line right under a name in the same paragraph is that person's own credential,
 * however long; its first sentence ("Department of Chemistry, Yale University, 2008-2012.")
 * is kept and the rest, usually where they went next, is not. An undated line there is
 * more often a biography than a credential.
 */
const firstSentence = (line: string): string => line.split(/\.\s+(?=\p{Lu}\p{Ll})/u)[0];
const isDatedCredentialLine = (line: string): boolean =>
  /\b(?:19|20)\d{2}\b/.test(firstSentence(line));

const BLOCK_DESCENDANTS = 'div, p, ul, ol, li, table, h1, h2, h3, h4, h5, h6';

/**
 * A section heading that names one role ("Undergraduate Students") rather than a whole
 * team or its alumni. A bold group label after it starts the next group; after a general
 * heading ("Lab Alumni") it names a group inside that section.
 */
const namesOneRole = (label: string): boolean => {
  const role = mapOfficialRosterRole(label, '');
  return role !== null && role !== 'affiliate';
};

/**
 * A paragraph that is nothing but a bold group label ("Research Collaborators") is a
 * heading the page did not mark up as one, so the people after it are not the section
 * above it.
 */
function isBoldGroupLabel(
  $: cheerio.CheerioAPI,
  node: cheerio.Cheerio<any>,
  text: string,
): boolean {
  if (!text || text.length > 60 || !node.is('p, div')) return false;
  const bold = normalizedText(node.find('strong, b').text());
  return (
    bold === text &&
    isRosterSectionLabel(text) &&
    !PAST_MEMBERS_MARKER.test(text) &&
    !looksLikeListedPersonName(listItemEntry(text).name) &&
    !isSingularRoleLine(text)
  );
}

/**
 * A div read as a paragraph: either the CMS's own paragraph block, or a div that holds
 * only inline text, which some pages use for every person line instead of p or li.
 */
const isTextOnlyDiv = (node: cheerio.Cheerio<any>): boolean =>
  node.is('div.paragraph') ||
  (node.find(BLOCK_DESCENDANTS).length === 0 &&
    node.parents('p, li, div.paragraph').length === 0 &&
    normalizedText(node.text()).length > 0);

function paragraphLines($: cheerio.CheerioAPI, element: cheerio.Cheerio<any>): string[] {
  return (element.html() || '')
    .split(/<br\s*\/?>/i)
    .map((fragment) => normalizedText(cheerio.load(`<div>${fragment}</div>`)('div').text()))
    .filter(Boolean);
}

function cardHeadingEntry($: cheerio.CheerioAPI, heading: cheerio.Cheerio<any>): ListedPersonEntry {
  const [, ...laterLines] = paragraphLines($, heading);
  const entry = blockEntry($, heading);
  return { ...entry, years: [entry.years, ...laterLines].join(' ').trim() };
}

const FACULTY_TITLE =
  /\b(?:professor|director|chair|principal investigator|lecturer|instructor)\b/i;

function nextHeadingTagName(heading: cheerio.Cheerio<any>): string {
  const next = heading.nextAll('h1, h2, h3, h4, h5, h6').first().get(0) as
    { tagName?: string } | undefined;
  return next?.tagName || '';
}

function readHeadingListSections($: cheerio.CheerioAPI): RosterSection[] {
  const sections: RosterSection[] = [];
  const trail: HeadingTrailEntry[] = [];
  const entryCells = new Map<ListedPersonEntry, unknown>();
  const cardHeadingLevels = new Map<ListedPersonEntry, number>();
  const pageSection = {
    label: pageTitleLabel($),
    withinPastSection: false,
    cards: [],
    tableRows: [],
    listItems: [],
    level: 7,
  };
  sections.push(pageSection);
  let section: (RosterSection & { level: number }) | null = pageSection.label ? pageSection : null;
  let nameHeading: ListedPersonEntry | undefined;
  const root = $('main').length > 0 ? $('main').first() : $('body');
  root
    .find(`h1, h2, h3, h4, h5, h6, li, p, div, table, ${PAST_MEMBERS_TOGGLE}`)
    .each((_index, element) => {
      const node = $(element);
      if (node.closest('nav, header, footer, aside').length > 0) return;
      const tagName = (element as { tagName?: string }).tagName || '';
      if (tagName === 'div' && !isTextOnlyDiv(node)) return;
      if (tagName === 'li' && node.find('li').length > 0) return;
      if (/^h[1-6]$/.test(tagName)) {
        const text = normalizedText(node.text());
        const level = headingLevel(tagName);
        const leadName = listItemEntry(leadingLineText($, node)).name;
        const opensDeeperHeadings = headingLevel(nextHeadingTagName(node)) > level;
        if (
          section &&
          nameHeading &&
          isSingularRoleLine(text) &&
          !looksLikeListedPersonName(leadName) &&
          !opensDeeperHeadings
        ) {
          nameHeading.years = `${nameHeading.years} ${text}`.trim();
          return;
        }
        const previous = section?.listItems[section.listItems.length - 1];
        const previousCardLevel = previous && cardHeadingLevels.get(previous);
        if (
          previous &&
          previousCardLevel &&
          level > previousCardLevel &&
          FACULTY_TITLE.test(text)
        ) {
          previous.years = `${previous.years} ${text}`.trim();
          return;
        }
        nameHeading = undefined;
        const isCardName = level > (section?.level ?? 7) || node.closest('li').length > 0;
        if (section && isCardName && looksLikeListedPersonName(leadName)) {
          const entry = cardHeadingEntry($, node);
          section.listItems.push(entry);
          cardHeadingLevels.set(entry, level);
          nameHeading = entry;
          return;
        }
        if (
          section &&
          isCaptionHeading(section, section.level, text, level) &&
          !(isSingularRoleLine(text) && opensDeeperHeadings) &&
          !looksLikeListedPersonName(listItemEntry(withCapitalizedWords(text)).name)
        ) {
          section = { ...captionedSection(section, text), level: section.level };
          sections.push(section);
          return;
        }
        const headingName = listItemEntry(withCapitalizedWords(text)).name;
        if (section && looksLikeListedPersonName(headingName)) {
          const entry = blockEntry($, node);
          if (!looksLikeListedPersonName(entry.name)) entry.name = headingName;
          section.listItems.push(entry);
          nameHeading = entry;
          return;
        }
        section = { ...openSection(trail, text, level), level };
        sections.push(section);
        return;
      }
      if (!section) return;
      if (normalizedText(node.text())) nameHeading = undefined;
      if (tagName === 'table') {
        if (!isLayoutTable($, node)) section.tableRows.push(...readRosterTableRows($, node));
        return;
      }
      const table = node.closest('table');
      if (table.length > 0 && !isLayoutTable($, table)) return;
      const text = normalizedText(node.text());
      const isToggle = node.is(PAST_MEMBERS_TOGGLE);
      if (PAST_MEMBERS_MARKER.test(text) && (isToggle || tagName === 'p' || tagName === 'li')) {
        trail.push({ label: text, level: section.level - 0.5 });
        section = { ...section, withinPastSection: true, cards: [], tableRows: [], listItems: [] };
        sections.push(section);
        return;
      }
      if (isToggle) return;
      if (isBoldGroupLabel($, node, text)) {
        const level = Math.min(section.level, 6);
        section = namesOneRole(section.label)
          ? { ...openSection(trail, text, level), level }
          : { ...captionedSection(section, text), level: section.level };
        sections.push(section);
        return;
      }
      if (/^\s*(?:\u00a0\s*){4,}/.test(node.text())) return;
      if (tagName === 'li') {
        section.listItems.push(blockEntry($, node));
        return;
      }
      const lines = paragraphLines($, node);
      const lead = blockEntry($, node);
      const leadIsName = looksLikeListedPersonName(lead.name);
      const cell = node.closest('td')[0];
      for (const [index, line] of lines.entries()) {
        const entry = index === 0 ? lead : listItemEntry(line);
        const previous = section.listItems[section.listItems.length - 1];
        const previousSharesCell = Boolean(previous) && entryCells.get(previous) === cell;
        if (index === 0 ? leadIsName : looksLikeListedPersonName(entry.name)) {
          section.listItems.push(entry);
          entryCells.set(entry, cell);
        } else if (previousSharesCell && line.length <= DESCRIPTOR_LINE_MAX) {
          previous.years = `${previous.years} ${line}`.trim();
        } else if (previousSharesCell && PROFILE_FIELD_LINE.test(line)) {
          previous.years = `${previous.years} ${line}`.trim();
        } else if (previousSharesCell && CLASS_YEAR_PHRASE.test(line)) {
          previous.years = `${previous.years} ${line.match(CLASS_YEAR_PHRASE)?.[0] ?? ''}`.trim();
        } else if (index === 1 && leadIsName && previous === lead && isDatedCredentialLine(line)) {
          previous.years = `${previous.years} ${firstSentence(line)}`.trim();
        } else if (index === 0) {
          section.listItems.push(entry);
          entryCells.set(entry, cell);
        }
      }
    });
  return sections;
}

const YEAR = '(?:19|20)\\d{2}';
const YEAR_RANGE_PATTERN = new RegExp(
  `(${YEAR})\\s*(?:[-–—]|to)\\s*(${YEAR}|current|present|now)`,
  'i',
);
const SINGLE_YEAR_PATTERN = new RegExp(`\\b(${YEAR})\\b`, 'g');
const CLASS_YEAR_PATTERN = /(?:^|\s)['’‘](\d{2})\b/g;

function yearSpan(value: string): { startYear?: number; endYear?: number; ongoing: boolean } {
  const range = YEAR_RANGE_PATTERN.exec(value);
  if (range) {
    const ongoing = !/^\d/.test(range[2]);
    return {
      startYear: Number(range[1]),
      ...(ongoing ? {} : { endYear: Number(range[2]) }),
      ongoing,
    };
  }
  const years = [
    ...(value.match(SINGLE_YEAR_PATTERN) || []).map(Number),
    ...Array.from(value.matchAll(CLASS_YEAR_PATTERN), (match) => 2000 + Number(match[1])),
  ];
  return years.length > 0 ? { endYear: Math.max(...years), ongoing: false } : { ongoing: false };
}

function listedPersonEntries(section: RosterSection): ListedPersonEntry[] {
  return [
    ...section.cards.map((card) => ({ ...card, years: card.title })),
    ...section.tableRows.map((row) => ({
      name: row.name,
      title: row.position,
      years: row.departure,
      profileHref: '',
    })),
    ...section.listItems,
  ];
}

export const OFFICIAL_ROSTER_MAX_UNDERGRADUATE_YEARS = 5;

const lastCompletedClassYear = (observedAt: Date): number =>
  observedAt.getUTCMonth() >= 6 ? observedAt.getUTCFullYear() : observedAt.getUTCFullYear() - 1;

const DATED_YEAR_FORM = new RegExp(
  `^\\s*[,(–—-]?\\s*\\(?\\s*${YEAR}\\b|(?:class of|graduat\\w*|B\\.?\\s?[AS]\\.?c?|A\\.?B\\.?|Yale College|\\bYC|\\bYale|summer|fall|spring|winter|autumn|jan\\w*|feb\\w*|mar\\w*|apr\\w*|may|jun\\w*|jul\\w*|aug\\w*|sep\\w*|oct\\w*|nov\\w*|dec\\w*)\\.?\\s*,?\\s*${YEAR}\\b|\\bB\\.?\\s?[AS]\\.?c?\\b[^.;()\\d]{0,60}?${YEAR}\\b|(?:^|\\s)['’‘]\\d{2}\\b`,
  'i',
);

/**
 * A lone year dates the person's time in the lab only where the line writes it that way:
 * right after the name, after a degree, "class of" or a term ("Summer 2022"), or as '27.
 * Elsewhere ("Lab: Lithium 2023") it is as likely the year the person joined, so it says
 * nothing about whether they have left.
 */
const yearDatesTheListing = (descriptor: string): boolean => DATED_YEAR_FORM.test(descriptor);

function undergraduateStatus(
  sectionStatus: OfficialRosterUndergraduateStatus,
  span: { startYear?: number; endYear?: number },
  observedAt: Date,
): OfficialRosterUndergraduateStatus {
  if (sectionStatus === 'past') return 'past';
  if (span.endYear && span.endYear <= lastCompletedClassYear(observedAt)) return 'past';
  const yearsSinceStart = span.startYear ? observedAt.getUTCFullYear() - span.startYear : 0;
  return yearsSinceStart > OFFICIAL_ROSTER_MAX_UNDERGRADUATE_YEARS ? 'past' : 'current';
}

const RESIDENTIAL_COLLEGE_CLASS_YEAR =
  /\((?:BF|BK|BR|DC|ES|GH|JE|MC|MY|PC|SM|SY|TC|TD)\s*['’‘]\d{2}\)/;
const YALE_COLLEGE_CLASS_EVIDENCE = new RegExp(
  `\\bYale College\\b|\\bclass of (?:19|20)\\d{2}\\b|\\bY(?:C|ale)\\s*['’‘]\\d{2}\\b|${RESIDENTIAL_COLLEGE_CLASS_YEAR.source}`,
  'i',
);
const CLASS_STANDING =
  /\b(?:rising )?(?:junior|sophomore|freshman)\b(?![ \t]+(?!(?:year|in|at|and|majoring|studying|undergrad\w*|student)\b)\p{L})|\bfirst[- ]year student\b/iu;
const BACHELORS_DEGREE = /\b(?:B\.?\s?S\.?|B\.?\s?A\.?)(?=[\s,'’‘(]|$)/i;
const UNDERGRADUATE_ROLE_EVIDENCE =
  /\bundergrad|\bsenior (?:thesis|essay|project)\b|\bthesis student\b/i;
const GRADUATE_DEGREE_EVIDENCE =
  /\b(?:Ph\.?\s?D|M\.?\s?S|M\.?\s?A|M\.?\s?D|M\.?\s?Phil|MPH|MSN|DNP|MBA|MEM|MESc|MFA|J\.?D|doctoral|master['’]?s|graduate student)\b/i;
const POST_UNDERGRADUATE_ROLE = /\b(?:post-?bac\w*|post[- ]?grad(?:uate)?|postdoc\w*|PGA)\b/i;
const LATER_OR_PLANNED =
  /\b(?:now|currently|current(?:ly)?\s+(?:position|at)|last seen|post-?grad(?:uate)? plans?|plans?|goals?|future|(?:md|ph\.?\s?d|md\/ph\.?\s?d|graduate|medical|law|business|doctoral|masters?)\s+(?:programs?|school))\b|(?:\b|(?<=[a-z)]))current(?:ly)?\s*(?:position|institution|affiliation)?\s*:/i;
const STILL_AN_UNDERGRADUATE =
  /\b(?:now|currently|current(?: institution| position| affiliation)?\s*:)[^.;]{0,80}?\bundergrad\w*(?:[^.;]{0,40})/gi;

/** "Currently an undergraduate at Elsewhere College": still an undergraduate, at another school. */
const stillAnUndergraduateElsewhere = (text: string): boolean =>
  [...text.matchAll(STILL_AN_UNDERGRADUATE)].some(
    (match) =>
      !/\bYale\b/i.test(match[0]) &&
      (ownLineNamesAnotherSchool(match[0]) || /\b(?:at|in)\s+\p{Lu}/u.test(match[0])),
  );

/**
 * The text before the first mention of where a person went next or plans to go. A marker
 * that opens the line ("Current: undergraduate researcher") labels the line itself, so it
 * does not cut it.
 */
function beforeLaterOrPlanned(text: string): string {
  const pattern = new RegExp(LATER_OR_PLANNED.source, 'gi');
  for (const match of text.matchAll(pattern)) {
    if (text.slice(0, match.index).trim()) return text.slice(0, match.index);
  }
  return text;
}

const descriptorAfterName = (entry: { name?: string; years: string }): string => {
  const name = entry.name ? withoutRosterChrome(entry.name) : '';
  const years = entry.years.trim();
  return name && years.startsWith(name) ? years.slice(name.length) : years;
};

/**
 * The person's line up to a spaced dash that follows their own descriptor, which on
 * alumni lists introduces where they went next ("(undergrad) - graduate research
 * assistant, Elsewhere"). A dash straight after the name, or after only the degrees they
 * hold ("Jordan Alder, BS - Undergraduate"), introduces the descriptor itself.
 */
function ownLineBeforeDestination(entry: { name?: string; years: string }): string {
  const descriptor = descriptorAfterName(entry);
  const dash = DESTINATION_DASH.exec(descriptor);
  if (!dash) return entry.years;
  const beforeDash = descriptor.slice(0, dash.index);
  return beforeDash.replace(/[\s,;:]/g, '') && !DEGREE_POSTNOMINALS_ONLY.test(beforeDash)
    ? beforeDash
    : entry.years;
}

const DEGREE_POSTNOMINALS_ONLY =
  /^[\s,]*(?:(?:[A-Z][a-z]?\.?){1,4}(?:\/(?:[A-Z][a-z]?\.?){1,4})?[\s,]*)+$/;

const EARNED_DEGREE_POSTNOMINAL =
  /^\s*,\s*(?:B\.?\s?S\.?c?|B\.?\s?A\.?|A\.?\s?B\.?)(?=$|[\s,;]|[A-Z][a-z])(?![,\s]*(?:candidate|expected|in progress|\(?\s*(?:19|20)\d{2}|['’‘]\d{2}))/i;

/**
 * A listed person's own line decides their role before the section does: a master's
 * student under an "Undergraduate" heading is not an undergraduate, and a former member
 * whose line reads "Yale College '22" is one. A Yale College class year written before a
 * graduate degree names the person's undergraduate years, so the degree is where they
 * went next. A degree written after the name ("Jordan Alder, B.S.") is one the person
 * already holds, so on its own it makes them a graduate, not an undergraduate, except
 * in an alumni section where the same line ties the degree to Yale: a Yale bachelor's
 * held by a former member is the degree they earned as a Yale undergraduate in the lab.
 */
export function listedEntryRole(
  entry: { name?: string; title: string; years: string },
  sectionLabel: string,
  withinPastSection = false,
): OfficialRosterRole | null {
  const ownText = beforeLaterOrPlanned(`${entry.title} ${ownLineBeforeDestination(entry)}`);
  const ownRole = mapOfficialRosterRole(ownText, '');
  if (ownRole && ownRole !== 'affiliate') return ownRole;
  const yaleCollege = YALE_COLLEGE_CLASS_EVIDENCE.exec(ownText);
  const graduateDegree = GRADUATE_DEGREE_EVIDENCE.exec(ownText);
  const graduate =
    Boolean(graduateDegree) && !(yaleCollege && yaleCollege.index < graduateDegree!.index);
  const holdsDegree =
    EARNED_DEGREE_POSTNOMINAL.test(descriptorAfterName(entry)) && !/\bundergrad/i.test(ownText);
  const yaleBachelorsOfAFormerMember = withinPastSection && /\bYale\b/i.test(ownText);
  if (holdsDegree && !yaleCollege && !yaleBachelorsOfAFormerMember) return null;
  const undergraduateRole =
    Boolean(yaleCollege) ||
    UNDERGRADUATE_ROLE_EVIDENCE.test(ownText) ||
    CLASS_STANDING.test(ownText);
  const undergraduate = undergraduateRole || BACHELORS_DEGREE.test(ownText);
  const postUndergraduate = POST_UNDERGRADUATE_ROLE.test(ownText) && !undergraduateRole;
  if (undergraduate && !graduate && !postUndergraduate) return 'undergrad';
  if (graduate || POST_UNDERGRADUATE_ROLE.test(ownText)) return null;
  return mapOfficialRosterRole(entry.title, sectionLabel);
}

const GRADUATE_OR_PROFESSIONAL_STUDENT =
  "(?<!\\b(?:medical|ph\\.?\\s?d\\.?|graduate|doctoral|m\\.?d\\.?|law|dental|master['’]?s|mba|nursing|pharmacy|rotation|rotating)\\s)";
const RESIDENTIAL_COLLEGE_NAMES =
  'Benjamin Franklin|Berkeley|Branford|Davenport|Ezra Stiles|Grace Hopper|Jonathan Edwards|Morse|Pauli Murray|Pierson|Saybrook|Silliman|Timothy Dwight|Trumbull';
const SCHOOL_NAME = `(?!(?:\\p{Lu}[\\w.&'’-]*\\s+){0,4}Yale\\b)(?!(?:\\p{Lu}[\\w.&'’-]*\\s+){0,3}(?:${RESIDENTIAL_COLLEGE_NAMES}) College\\b)(?:(?:\\p{Lu}[\\w.&'’-]*\\s+){0,4}(?:University|College|Institute)\\b|(?:University|Institute) of\\b)`;
const NOT_A_SCHOOL_BEFORE_UNDERGRADUATE = new Set(
  (
    'yale former current visiting summer senior junior research graduate postgraduate ' +
    'undergraduate student lab team fellow honors honor thesis the a an first second third ' +
    'fourth rising incoming returning exchange'
  ).split(' '),
);

/**
 * "Name, Emory Undergraduate Student": a capitalized word that opens the person's line
 * before their undergraduate role and is not itself a role or field names their school.
 */
function namesAnotherSchoolBeforeUndergraduateRole(text: string, name: string): boolean {
  const nameWords = new Set(name.toLowerCase().split(/[\s-]+/));
  const pattern =
    /(?:^|[,(;:]|\s[-–—]\s)\s*(\p{Lu}\p{Ll}+)\s+Undergraduate\s+(?:Student|Researcher|Intern)\b/gu;
  for (const match of text.matchAll(pattern)) {
    const word = match[1].toLowerCase();
    if (nameWords.has(word)) continue;
    if (!NOT_A_SCHOOL_BEFORE_UNDERGRADUATE.has(word) && !SECTION_HEADING_WORDS.has(word))
      return true;
  }
  return false;
}

const ANOTHER_SCHOOL_EVIDENCE = [
  /\bvisiting\b/i,
  /\bhigh school\b/i,
  new RegExp(
    `\\b(?:${GRADUATE_OR_PROFESSIONAL_STUDENT}student|undergraduate|undergrad|major|intern)\\s+(?:at|from)\\s+(?!Yale\\b)\\p{Lu}`,
    'iu',
  ),
  /\bundergrad(?:uate)?(?:\s+\p{L}+){1,2}\s+(?:at|from)\s+(?!Yale\b)\p{Lu}/u,
  new RegExp(
    `\\b[Uu]ndergrad(?:uate)?s?(?:\\s+(?:[Ss]tudent|[Rr]esearcher|[Ii]ntern))?\\s*,?\\s*${SCHOOL_NAME}`,
    'u',
  ),
  new RegExp(`\\b(?:B\\.?\\s?S|B\\.?\\s?A)\\.?,?\\s+${SCHOOL_NAME}`, 'u'),
  new RegExp(`\\b(?:B\\.?\\s?S|B\\.?\\s?A)\\.?,?\\s+[^.;()]{1,60}?,\\s*${SCHOOL_NAME}`, 'u'),
  /\b(?!Yale\b)\p{Lu}\w+\s+(?:University|College)\s+(?:\w+\s+){0,2}(?:undergraduate|undergrad|student)\b/u,
  /\bsummer (?:undergraduate )?(?:research )?(?:intern|scholar|student|fellow)\w*\b/i,
  /\bREV?U\b|\bAmgen Scholar|\bLicenciatura\b/,
  /\bHelios\b/,
];

const YALE_RESIDENTIAL_COLLEGE = new RegExp(`\\b(?:${RESIDENTIAL_COLLEGE_NAMES}) College$`);
const SCHOOL_PHRASE =
  /(?:\p{Lu}[\w.&'’-]*\s+){1,4}(?:University|College|Institute)\b|\b(?:University|Institute) of (?:the )?\p{Lu}[\w.&'’-]*/gu;
const DESTINATION_DASH =
  /(?:^|\s)[–—-]\s(?!\s*(?:\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|summer|fall|spring|winter|autumn|present|current|now)\b)/i;

/**
 * Whether the person's own line, up to where a spaced dash introduces where they went
 * next, names a school other than Yale. A Yale residential college is Yale.
 */
function ownLineNamesAnotherSchool(ownText: string): boolean {
  const own = ownText.split(DESTINATION_DASH)[0];
  if (/\bYale\b/i.test(own)) return false;
  return [...own.matchAll(SCHOOL_PHRASE)].some((match) => !YALE_RESIDENTIAL_COLLEGE.test(match[0]));
}

const YALE_NUS = /\bYale[- ](?:NUS|National University of Singapore)\b/i;

const ANOTHER_INSTITUTION_LABEL =
  /\b(?!Yale\b)\p{Lu}[\w&.-]*(?:\s+[\w&.-]+){0,3}\s+(?:University|Institute|College)\b|\b(?:University|Institute) of (?!Yale\b)\p{Lu}|\bGeorgia Tech\b|\b(?:UW|UC|SUNY|CUNY)[- ]\p{Lu}/u;

const bracketedAffiliation = (entry: ListedPersonEntry): string | undefined => {
  const match = /^\s*\(([^)]+)\)/.exec(entry.years);
  if (!match || /^\s*(?:19|20)\d{2}/.test(match[1])) return undefined;
  if (/\b(?:B\.?\s?S|B\.?\s?A|candidate|major|class)\b/i.test(match[1])) return undefined;
  return match[1].trim();
};

/**
 * Where most of a section's brackets read "(Yale)", they name each person's own school,
 * so another school there is the person's home school. Where no entry is marked "(Yale)",
 * a bracket is as likely to be where they went next, so it decides nothing.
 */
function sectionBracketsNameHomeSchool(entries: ListedPersonEntry[]): boolean {
  const affiliations = entries.map(bracketedAffiliation).filter(Boolean) as string[];
  const yale = affiliations.filter((affiliation) => /^Yale\b/i.test(affiliation)).length;
  return yale >= 2 && yale * 2 > affiliations.length;
}

/** The owner lists Yale undergraduates only (2026-10-16). */
export function listedEntryIsFromAnotherSchool(entry: {
  name?: string;
  title: string;
  years: string;
}): boolean {
  const ownText = beforeLaterOrPlanned(`${entry.title} ${entry.years}`);
  if (YALE_NUS.test(ownText)) return true;
  if (stillAnUndergraduateElsewhere(`${entry.title} ${entry.years}`)) return true;
  if (/\(\s*Yale[^)]*\)/i.test(ownText) || /\bYale College\b/i.test(ownText)) return false;
  return (
    ANOTHER_SCHOOL_EVIDENCE.some((pattern) => pattern.test(ownText)) ||
    namesAnotherSchoolBeforeUndergraduateRole(ownText, withoutRosterChrome(entry.name ?? ''))
  );
}

const NOT_AN_UNDERGRADUATE_ROLE = new Set<OfficialRosterRole>([
  'postdoc',
  'grad-student',
  'staff',
  'core-faculty',
]);

/**
 * Names a current part of the page also lists as a graduate student, postdoc, staff member
 * or faculty member. A page that lists the same person both ways is out of date in one of
 * them, so the undergraduate listing is not the one to show as current.
 */
function namesListedInAnotherCurrentRole(sections: RosterSection[]): Set<string> {
  const names = new Set<string>();
  for (const section of sections) {
    if (section.withinPastSection || isPastSectionLabel(section.label)) continue;
    for (const entry of listedPersonEntries(section)) {
      const role = listedEntryRole(entry, section.label);
      if (role && NOT_AN_UNDERGRADUATE_ROLE.has(role) && looksLikeListedPersonName(entry.name)) {
        names.add(
          normalizedLabel(displayCase(withoutRepeatedName(withoutRosterChrome(entry.name)))),
        );
      }
    }
  }
  return names;
}

function extractListedUndergraduates(
  sections: RosterSection[],
  config: OfficialRosterConfig,
  observedAt: Date,
): { undergraduates: OfficialRosterUndergraduate[]; undergraduateWithheldCount: number } {
  const statusByLabel = new Map<string, 'current' | 'past'>([
    ...config.currentSectionLabels.map((label) => [normalizedLabel(label), 'current'] as const),
    ...(config.pastSectionLabels ?? []).map((label) => [normalizedLabel(label), 'past'] as const),
  ]);
  const undergraduates: OfficialRosterUndergraduate[] = [];
  const seen = new Set<string>();
  const withheldNames = new Set((config.withheldNames ?? []).map(normalizedLabel));
  const pastNames = new Set((config.pastNames ?? []).map(normalizedLabel));
  let undergraduateWithheldCount = 0;
  const listedInAnotherCurrentRole = namesListedInAnotherCurrentRole(sections);
  for (const section of sections) {
    const labelStatus = statusByLabel.get(normalizedLabel(section.label));
    if (!labelStatus) continue;
    const entries = listedPersonEntries(section);
    const otherInstitutionSection =
      ANOTHER_INSTITUTION_LABEL.test(section.label) ||
      ANOTHER_INSTITUTION_LABEL.test(section.caption ?? '');
    const bracketsNameHomeSchool = sectionBracketsNameHomeSchool(entries);
    const sectionStatus = section.withinPastSection ? 'past' : labelStatus;
    for (const entry of entries) {
      if (listedEntryRole(entry, section.label, sectionStatus === 'past') !== 'undergrad') continue;
      const homeSchool = bracketsNameHomeSchool ? bracketedAffiliation(entry) : undefined;
      if (
        otherInstitutionSection ||
        (homeSchool && !/^Yale\b/i.test(homeSchool)) ||
        listedEntryIsFromAnotherSchool(entry)
      ) {
        undergraduateWithheldCount += 1;
        continue;
      }
      const name = displayCase(withoutRepeatedName(withoutRosterChrome(entry.name)));
      if (withheldNames.has(normalizedLabel(name))) {
        undergraduateWithheldCount += 1;
        continue;
      }
      if (
        !looksLikeListedPersonName(name) ||
        undergraduates.length >= OFFICIAL_ROSTER_MAX_UNDERGRADUATES_PER_ENTITY
      ) {
        undergraduateWithheldCount += 1;
        continue;
      }
      const span = yearSpan(entry.years);
      const { startYear, endYear } =
        sectionStatus === 'current' &&
        span.endYear &&
        !span.startYear &&
        (entry.years.match(SINGLE_YEAR_PATTERN) || []).length === 1 &&
        !yearDatesTheListing(descriptorAfterName(entry))
          ? {}
          : span;
      const status = pastNames.has(normalizedLabel(name))
        ? 'past'
        : undergraduateStatus(sectionStatus, { startYear, endYear }, observedAt);
      if (status === 'current' && listedInAnotherCurrentRole.has(normalizedLabel(name))) {
        undergraduateWithheldCount += 1;
        continue;
      }
      const dedupeKey = `${status}|${normalizedLabel(name)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const profileUrl = officialProfileUrl(entry.profileHref, config.url);
      undergraduates.push({
        name,
        status,
        ...(startYear ? { startYear } : {}),
        ...(endYear ? { endYear } : {}),
        ...(profileUrl ? { profileUrl } : {}),
      });
    }
  }
  const currentNames = new Set(
    undergraduates
      .filter((member) => member.status === 'current')
      .map((member) => normalizedLabel(member.name)),
  );
  return {
    undergraduates: undergraduates.filter(
      (member) => member.status === 'current' || !currentNames.has(normalizedLabel(member.name)),
    ),
    undergraduateWithheldCount,
  };
}

function readRosterSections(
  $: cheerio.CheerioAPI,
  template: OfficialRosterTemplate,
): RosterSection[] {
  if (template === 'yalesites-directory') return readYaleSitesDirectorySections($);
  if (template === 'heading-list') return readHeadingListSections($);
  const pastSections = readHeadingListSections($).filter(
    (section) => section.withinPastSection || isPastSectionLabel(section.label),
  );
  return [...readProfileGridSections($), ...pastSections];
}

const sectionListsPeople = (section: RosterSection): boolean =>
  section.cards.length + section.tableRows.length + section.listItems.length > 0;

export function officialRosterSectionLabels(
  html: string,
  template: OfficialRosterTemplate = 'profile-grid',
): string[] {
  return readRosterSections(cheerio.load(html), template)
    .filter((section) => template === 'profile-grid' || sectionListsPeople(section))
    .map((section) => section.label.slice(0, 120))
    .filter(Boolean);
}

/**
 * Every undergraduate a lab's alumni page lists is past, whatever headings the page uses,
 * so its sections are read as past sections under the same role, name and school rules.
 */
export function extractAlumniPageUndergraduates(
  html: string,
  config: OfficialRosterConfig,
  observedAt = new Date(),
): { undergraduates: OfficialRosterUndergraduate[]; undergraduateWithheldCount: number } {
  const alumniUrl = config.alumniPageUrl || config.url;
  const template = detectOfficialRosterTemplate(html);
  const sections = readRosterSections(cheerio.load(html), template);
  const labels = undergraduateSectionCandidates(html, template).map((candidate) => candidate.label);
  return extractListedUndergraduates(
    sections,
    { ...config, url: alumniUrl, currentSectionLabels: [], pastSectionLabels: labels },
    observedAt,
  );
}

export function withAlumniUndergraduates(
  roster: ExtractedOfficialRoster,
  alumni: OfficialRosterUndergraduate[],
): ExtractedOfficialRoster {
  if (!['current', 'partial', 'empty'].includes(roster.state) || alumni.length === 0) return roster;
  const listed = new Set(roster.undergraduates.map((member) => normalizedLabel(member.name)));
  const added = alumni
    .filter((member) => !listed.has(normalizedLabel(member.name)))
    .map((member) => ({ ...member, status: 'past' as const }));
  const undergraduates = [...roster.undergraduates, ...added].slice(
    0,
    OFFICIAL_ROSTER_MAX_UNDERGRADUATES_PER_ENTITY,
  );
  return {
    ...roster,
    undergraduates,
    state: roster.state === 'empty' && undergraduates.length > 0 ? 'current' : roster.state,
    complete: roster.state === 'empty' ? true : roster.complete,
  };
}

export function detectOfficialRosterTemplate(html: string): OfficialRosterTemplate {
  const $ = cheerio.load(html);
  if ($('section.organization-member-listing article.profile-grid-item').length > 0) {
    return 'profile-grid';
  }
  if ($('li.directory-listing-card').length > 0) return 'yalesites-directory';
  return 'heading-list';
}

/** Every name the page lists as a person, under any heading. */
export function listedPersonNames(html: string, template: OfficialRosterTemplate): string[] {
  return readRosterSections(cheerio.load(html), template)
    .flatMap((section) => listedPersonEntries(section))
    .map((entry) => displayCase(withoutRepeatedName(withoutRosterChrome(entry.name))))
    .filter((name) => looksLikeListedPersonName(name));
}

export interface UndergraduateSectionCandidate {
  label: string;
  past: boolean;
  undergraduateEntries: number;
}

export function undergraduateSectionCandidates(
  html: string,
  template: OfficialRosterTemplate,
): UndergraduateSectionCandidate[] {
  const byLabel = new Map<string, UndergraduateSectionCandidate>();
  for (const section of readRosterSections(cheerio.load(html), template)) {
    const undergraduateEntries = listedPersonEntries(section).filter(
      (entry) =>
        listedEntryRole(
          entry,
          section.label,
          isPastSectionLabel(section.label) || section.withinPastSection,
        ) === 'undergrad' && looksLikeListedPersonName(entry.name),
    ).length;
    if (!section.label || undergraduateEntries === 0) continue;
    const key = normalizedLabel(section.label);
    const existing = byLabel.get(key);
    const past = isPastSectionLabel(section.label) || section.withinPastSection;
    byLabel.set(key, {
      label: section.label,
      past: existing ? existing.past && past : past,
      undergraduateEntries: (existing?.undergraduateEntries ?? 0) + undergraduateEntries,
    });
  }
  return [...byLabel.values()];
}

function publishDateIsRecent(sourcePublishedAt: Date | undefined, observedAt: Date): boolean {
  if (!sourcePublishedAt) return false;
  const publishAgeDays = (observedAt.getTime() - sourcePublishedAt.getTime()) / DAY_MS;
  return publishAgeDays >= -2 && publishAgeDays <= OFFICIAL_ROSTER_MAX_PUBLISH_AGE_DAYS;
}

export function extractOfficialResearchHomeRoster(
  html: string,
  config: OfficialRosterConfig,
  observedAt = new Date(),
): ExtractedOfficialRoster {
  const $ = cheerio.load(html);
  const template = config.template ?? 'profile-grid';
  const freshnessExpiresAt = new Date(
    observedAt.getTime() + OFFICIAL_ROSTER_FRESHNESS_DAYS * DAY_MS,
  );
  const sourcePublishedAt = dateFromPublishMeta(
    $('meta[property="publish-date"], meta[name="publish-date"]').first().attr('content') || '',
  );
  const unreadRoster = (state: 'stale' | 'withheld', withheldCount: number) => ({
    state,
    members: [],
    undergraduates: [],
    withheldCount,
    undergraduateWithheldCount: 0,
    duplicateCount: 0,
    sourcePublishedAt,
    observedAt,
    freshnessExpiresAt,
    complete: false,
  });
  // Only the profile-grid template publishes a page date; the others take their currency
  // from the page's own section label, held to the re-read freshness window (#5039).
  const currencyFromPublishDate =
    template === 'profile-grid' && config.currency !== 'section-label';
  if (currencyFromPublishDate && !publishDateIsRecent(sourcePublishedAt, observedAt)) {
    return unreadRoster('stale', 0);
  }

  const sections = readRosterSections($, template);
  const acceptedLabels = new Set(config.currentSectionLabels.map(normalizedLabel));
  const matchedLabels = new Set<string>();
  const candidates: ExtractedOfficialRosterMember[] = [];
  let withheldCount = 0;

  for (const section of sections) {
    const label = normalizedLabel(section.label);
    if (!acceptedLabels.has(label)) continue;
    matchedLabels.add(label);
    for (const card of section.cards) {
      if (candidates.length >= OFFICIAL_ROSTER_MAX_MEMBERS_PER_ENTITY) {
        withheldCount += 1;
        continue;
      }
      const profileUrl = officialProfileUrl(card.profileHref, config.url);
      const role = mapOfficialRosterRole(card.title, section.label);
      if (!card.name || !profileUrl || !role) {
        withheldCount += 1;
        continue;
      }
      const identityKey = `official-profile:${profileUrl.toLowerCase()}`;
      candidates.push({
        name: card.name,
        title: card.title,
        role,
        profileUrl,
        identityKey,
        membershipKey: `${identityKey}|${role}`,
        sectionLabel: section.label,
      });
    }
  }

  if (matchedLabels.size !== acceptedLabels.size) {
    return unreadRoster('withheld', Math.max(1, withheldCount));
  }

  const byMembershipKey = new Map<string, ExtractedOfficialRosterMember[]>();
  for (const candidate of candidates) {
    byMembershipKey.set(candidate.membershipKey, [
      ...(byMembershipKey.get(candidate.membershipKey) || []),
      candidate,
    ]);
  }
  const members: ExtractedOfficialRosterMember[] = [];
  let duplicateCount = 0;
  for (const group of byMembershipKey.values()) {
    const names = new Set(group.map((member) => normalizedLabel(member.name)));
    if (names.size > 1) {
      withheldCount += group.length;
      continue;
    }
    members.push(group[0]);
    duplicateCount += Math.max(0, group.length - 1);
  }

  const { undergraduates, undergraduateWithheldCount } = extractListedUndergraduates(
    sections,
    config,
    observedAt,
  );
  const state =
    members.length > 0 || undergraduates.length > 0
      ? withheldCount > 0
        ? 'partial'
        : 'current'
      : withheldCount > 0
        ? 'withheld'
        : 'empty';
  return {
    state,
    members,
    undergraduates,
    withheldCount,
    undergraduateWithheldCount,
    duplicateCount,
    sourcePublishedAt,
    observedAt,
    freshnessExpiresAt,
    complete: state === 'current',
  };
}

export function officialRosterObservations(
  config: OfficialRosterConfig,
  roster: ExtractedOfficialRoster,
  configOrigin: OfficialRosterConfigOrigin = 'static',
): ObservationInput[] {
  const statusValue = {
    state: roster.state,
    configOrigin,
    complete: roster.complete,
    memberCount: roster.members.length,
    withheldCount: roster.withheldCount,
    duplicateCount: roster.duplicateCount,
    memberKeys: roster.members.map((member) => member.membershipKey),
    undergraduates: roster.undergraduates,
    undergraduateWithheldCount: roster.undergraduateWithheldCount,
    sourceUrl: config.url,
    ...(config.alumniPageUrl ? { alumniSourceUrl: config.alumniPageUrl } : {}),
    sourcePublishedAt: roster.sourcePublishedAt?.toISOString(),
    observedAt: roster.observedAt.toISOString(),
    freshnessExpiresAt: roster.freshnessExpiresAt.toISOString(),
    refreshOwner: OFFICIAL_ROSTER_REFRESH_OWNER,
    refreshCadence: OFFICIAL_ROSTER_REFRESH_CADENCE,
  };
  const observations: ObservationInput[] = [
    {
      entityType: 'researchEntity',
      entityKey: config.researchEntityKey,
      field: 'rosterEnrichment',
      value: statusValue,
      sourceUrl: config.url,
      observedAt: roster.observedAt,
    },
  ];

  if (configOrigin === 'derived') return observations;
  for (const member of roster.members) {
    const entityKey = `official-roster:${config.researchEntityKey}:${stableKey(member.membershipKey)}`;
    const base = {
      entityType: 'researchGroupMember' as const,
      entityKey,
      sourceUrl: config.url,
      observedAt: roster.observedAt,
    };
    observations.push(
      { ...base, field: RESEARCH_ENTITY_SLUG_OBSERVATION_FIELD, value: config.researchEntityKey },
      { ...base, field: 'name', value: member.name },
      { ...base, field: 'title', value: member.title },
      { ...base, field: 'role', value: member.role },
      { ...base, field: 'profileUrl', value: member.profileUrl },
      { ...base, field: 'identityKey', value: member.identityKey },
      { ...base, field: 'membershipKey', value: member.membershipKey },
      { ...base, field: 'currentStatus', value: 'current' },
      { ...base, field: 'evidenceStatus', value: 'verified' },
      { ...base, field: 'sectionLabel', value: member.sectionLabel },
      {
        ...base,
        field: 'sourcePublishedAt',
        value: roster.sourcePublishedAt?.toISOString(),
      },
      {
        ...base,
        field: 'freshnessExpiresAt',
        value: roster.freshnessExpiresAt.toISOString(),
      },
      { ...base, field: 'sourceName', value: OFFICIAL_RESEARCH_HOME_ROSTER_SOURCE },
    );
  }
  return observations;
}

function failedRosterObservation(config: OfficialRosterConfig, observedAt: Date): ObservationInput {
  return {
    entityType: 'researchEntity',
    entityKey: config.researchEntityKey,
    field: 'rosterEnrichment',
    value: {
      state: 'failed',
      configOrigin: 'static',
      complete: false,
      memberCount: 0,
      withheldCount: 0,
      duplicateCount: 0,
      memberKeys: [],
      sourceUrl: config.url,
      observedAt: observedAt.toISOString(),
      refreshOwner: OFFICIAL_ROSTER_REFRESH_OWNER,
      refreshCadence: OFFICIAL_ROSTER_REFRESH_CADENCE,
    },
    sourceUrl: config.url,
    observedAt,
  };
}

export type DerivedRosterOutcome =
  | {
      kind: 'derived';
      researchEntityKey: string;
      config: OfficialRosterConfig;
      roster: ExtractedOfficialRoster;
    }
  | { kind: 'withheld'; researchEntityKey: string; sourceUrl: string; reason: string }
  | { kind: 'not-found'; researchEntityKey: string; reason: string };

export interface DerivedRosterRequest {
  staticKeys: ReadonlySet<string>;
  only?: ReadonlySet<string>;
  limit?: number;
  observedAt: Date;
  fetchPage: (url: string) => Promise<string>;
}

export interface DerivedRosterRun {
  outcomes: DerivedRosterOutcome[];
  staticOverridden: number;
  ownerDenied: number;
}

export type OfficialRosterDeriver = (request: DerivedRosterRequest) => Promise<DerivedRosterRun>;

export function derivedRosterObservations(
  config: OfficialRosterConfig,
  roster: ExtractedOfficialRoster,
): ObservationInput[] {
  const observations = officialRosterObservations(config, roster, 'derived');
  return observations.map((observation) => ({
    ...observation,
    value: { ...(observation.value as Record<string, unknown>), memberCount: 0, memberKeys: [] },
  }));
}

export function withheldDerivedRosterObservation(
  researchEntityKey: string,
  sourceUrl: string,
  reason: string,
  observedAt: Date,
): ObservationInput {
  return {
    entityType: 'researchEntity',
    entityKey: researchEntityKey,
    field: 'rosterEnrichment',
    value: {
      state: 'withheld',
      configOrigin: 'derived',
      withheldReason: reason,
      complete: false,
      memberCount: 0,
      withheldCount: 0,
      duplicateCount: 0,
      memberKeys: [],
      undergraduates: [],
      sourceUrl,
      observedAt: observedAt.toISOString(),
      refreshOwner: OFFICIAL_ROSTER_REFRESH_OWNER,
      refreshCadence: OFFICIAL_ROSTER_REFRESH_CADENCE,
    },
    sourceUrl,
    observedAt,
  };
}

const countBy = (values: string[]): Record<string, number> =>
  values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});

async function fetchRosterPage(url: string, useCache: boolean): Promise<string> {
  const safeUrl = await assertPublicHttpUrl(url);
  const cacheKey = safeUrl.toString();
  if (useCache) {
    const cached = await getCached<string>(OFFICIAL_RESEARCH_HOME_ROSTER_SOURCE, cacheKey);
    if (cached) return cached;
  }
  const agents = ssrfSafeAgents();
  const response = await retryOnRetryableStatus(() =>
    axios.get(safeUrl.toString(), {
      timeout: 30_000,
      maxRedirects: 5,
      headers: { 'User-Agent': 'ylabs-scraper/1.0 (+https://yalelabs.io)' },
      httpAgent: agents.httpAgent,
      httpsAgent: agents.httpsAgent,
    }),
  );
  const html = String(response.data || '');
  if (useCache) await setCached(OFFICIAL_RESEARCH_HOME_ROSTER_SOURCE, cacheKey, html);
  return html;
}

export class OfficialResearchHomeRosterScraper implements IScraper {
  readonly name = OFFICIAL_RESEARCH_HOME_ROSTER_SOURCE;
  readonly displayName = 'Official research-home current rosters';

  constructor(
    private readonly configs: OfficialRosterConfig[] = OFFICIAL_ROSTER_CONFIGS,
    private readonly fetchPage: (
      url: string,
      useCache: boolean,
    ) => Promise<string> = fetchRosterPage,
    private readonly deriveRosters: OfficialRosterDeriver | null = null,
  ) {}

  async run(context: ScraperContext): Promise<ScraperResult> {
    const only = context.options.only?.length
      ? new Set(context.options.only.map((value) => value.trim().toLowerCase()))
      : undefined;
    const selected = this.configs
      .filter((config) => !only || only.has(config.researchEntityKey.toLowerCase()))
      .slice(0, context.options.limit || this.configs.length);
    let observationCount = 0;
    let entitiesObserved = 0;
    let failed = 0;
    let withheld = 0;

    for (const config of selected) {
      const observedAt = context.options.referenceDate ?? new Date();
      try {
        const html = await this.fetchPage(config.url, context.options.useCache);
        let roster = extractOfficialResearchHomeRoster(html, config, observedAt);
        if (config.alumniPageUrl) {
          try {
            const alumniHtml = await this.fetchPage(config.alumniPageUrl, context.options.useCache);
            roster = withAlumniUndergraduates(
              roster,
              extractAlumniPageUndergraduates(alumniHtml, config, observedAt).undergraduates,
            );
          } catch {
            context.log(`${config.researchEntityKey}: optional alumni page fetch failed`);
          }
        }
        const observations = officialRosterObservations(config, roster);
        await context.emit(observations);
        observationCount += observations.length;
        entitiesObserved += 1 + roster.members.length;
        withheld += roster.withheldCount;
        context.log(
          `${config.researchEntityKey}: ${roster.state}, ${roster.members.length} verified, ${roster.withheldCount} withheld`,
        );
      } catch {
        await context.emit(failedRosterObservation(config, observedAt));
        observationCount += 1;
        entitiesObserved += 1;
        failed += 1;
        context.log(`${config.researchEntityKey}: optional roster fetch failed`);
      }
    }

    if (selected.length > 0 && failed === selected.length) {
      throw new Error(
        `Every attempted official roster fetch failed (${failed} of ${selected.length}); the run read no roster and is a failure, not a success`,
      );
    }

    const derived = await this.runDerivedRosters(context, only);
    observationCount += derived.observationCount;
    entitiesObserved += derived.entitiesObserved;

    return {
      observationCount,
      entitiesObserved,
      notes: `Reviewed sources=${selected.length}; failed=${failed}; withheld=${withheld}; broad enablement remains audit-gated.${derived.notes}`,
    };
  }

  private async runDerivedRosters(
    context: ScraperContext,
    only: ReadonlySet<string> | undefined,
  ): Promise<{ observationCount: number; entitiesObserved: number; notes: string }> {
    if (!this.deriveRosters) return { observationCount: 0, entitiesObserved: 0, notes: '' };
    const observedAt = context.options.referenceDate ?? new Date();
    const useCache = context.options.useCache;
    const run = await this.deriveRosters({
      staticKeys: new Set(this.configs.map((config) => config.researchEntityKey)),
      only,
      limit: context.options.limit,
      observedAt,
      fetchPage: (url) => this.fetchPage(url, useCache),
    });
    let observationCount = 0;
    for (const outcome of run.outcomes) {
      const observations =
        outcome.kind === 'derived'
          ? derivedRosterObservations(outcome.config, outcome.roster)
          : outcome.kind === 'withheld'
            ? [
                withheldDerivedRosterObservation(
                  outcome.researchEntityKey,
                  outcome.sourceUrl,
                  outcome.reason,
                  observedAt,
                ),
              ]
            : [];
      if (observations.length === 0) continue;
      await context.emit(observations);
      observationCount += observations.length;
    }
    const passed = run.outcomes.filter((outcome) => outcome.kind === 'derived');
    const report = {
      attempted: run.outcomes.length,
      passed: passed.length,
      passedUndergraduates: passed.reduce(
        (sum, outcome) =>
          sum + (outcome.kind === 'derived' ? outcome.roster.undergraduates.length : 0),
        0,
      ),
      withheldByReason: countBy(
        run.outcomes.flatMap((outcome) => (outcome.kind === 'withheld' ? [outcome.reason] : [])),
      ),
      notFoundByReason: countBy(
        run.outcomes.flatMap((outcome) => (outcome.kind === 'not-found' ? [outcome.reason] : [])),
      ),
      staticOverridden: run.staticOverridden,
      ownerDenied: run.ownerDenied,
      serving: derivedUndergradRostersServe(),
    };
    context.log(`derived rosters: ${JSON.stringify(report)}`);
    return {
      observationCount,
      entitiesObserved: passed.length,
      notes: ` Derived rosters=${JSON.stringify(report)}.`,
    };
  }
}
