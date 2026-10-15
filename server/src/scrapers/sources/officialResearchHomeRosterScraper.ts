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
import type { OfficialRosterUndergraduateStatus } from '../../models/storedVocabularies';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';

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

export const OFFICIAL_ROSTER_CONFIGS: OfficialRosterConfig[] = [
  {
    researchEntityKey: 'ysm-turk',
    url: 'https://medicine.yale.edu/lab/turk/labmembers/',
    currentSectionLabels: ['Current Members'],
  },
  {
    researchEntityKey: 'ysm-haeny',
    url: 'https://medicine.yale.edu/lab/haeny/people/',
    currentSectionLabels: ['Postdoctoral Fellows', 'Lab Manager'],
  },
  {
    researchEntityKey: 'dept-seas-john-fortner',
    url: 'https://fortnerlab.yale.edu/people',
    template: 'yalesites-directory',
    currentSectionLabels: ['Lab Members'],
    pastSectionLabels: ['Lab Alumni'],
  },
  {
    researchEntityKey: 'dept-seas-drew-r-gentner',
    url: 'https://gentnerlab.yale.edu/research-team',
    template: 'heading-list',
    currentSectionLabels: ['Undergraduate Researchers'],
    pastSectionLabels: ['Undergraduate Alumni'],
  },
];

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
  const evidence = `${section} ${title}`;
  if (/\b(postdoc|post doctoral|postdoctoral)\b/.test(evidence)) return 'postdoc';
  if (
    /\b(graduate student|phd student|phd candidate|ph d student|ph d candidate|doctoral student|doctoral candidate|master s student|masters student|predoctoral)\b/.test(
      evidence,
    )
  ) {
    return 'grad-student';
  }
  if (/\b(undergraduate|undergrad)\b/.test(evidence)) return 'undergrad';
  if (
    /\b(lab manager|laboratory manager|research assistant|research associate|research scientist|postgraduate associate|technician|coordinator|data manager|staff)\b/.test(
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
  withinPastSection: boolean;
  cards: RosterCard[];
  tableRows: RosterTableRow[];
  listItems: ListedPersonEntry[];
}

const headingLevel = (tagName: string): number => Number(tagName.slice(1));

const PAST_SECTION_LABEL = /\b(?:alumni|alumnae|alumnus|former|past|previous)\b/i;

interface HeadingTrailEntry {
  label: string;
  level: number;
}

function openSection(trail: HeadingTrailEntry[], label: string, level: number): RosterSection {
  while (trail.length > 0 && trail[trail.length - 1].level >= level) trail.pop();
  const withinPastSection = trail.some((heading) => PAST_SECTION_LABEL.test(heading.label));
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

function readRosterTableRows($: cheerio.CheerioAPI, table: cheerio.Cheerio<any>): RosterTableRow[] {
  const headers = table
    .find('tr')
    .first()
    .find('th')
    .toArray()
    .map((cell) => normalizedLabel($(cell).text()));
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
    .map((row) =>
      $(row)
        .find('td')
        .toArray()
        .map((cell) => normalizedText($(cell).text())),
    )
    .filter((cells) => cells.length > 0)
    .map((cells) => ({
      name: cells[nameColumn] || '',
      position: positionColumn >= 0 ? cells[positionColumn] || '' : '',
      departure:
        departureColumn >= 0
          ? cells[departureColumn] || ''
          : cells.find((cell, index) => index !== nameColumn && /\b(?:19|20)\d{2}\b/.test(cell)) ||
            '',
    }));
}

function readYaleSitesDirectorySections($: cheerio.CheerioAPI): RosterSection[] {
  const sections: RosterSection[] = [];
  const trail: HeadingTrailEntry[] = [];
  let section: RosterSection = openSection(trail, '', 0);
  trail.length = 0;
  sections.push(section);
  const scope = $('main').length > 0 ? 'main ' : '';
  $(['h2', 'h3', 'li.directory-listing-card', 'table'].map((tag) => scope + tag).join(', ')).each(
    (_index, element) => {
      const node = $(element);
      if (node.is('li')) {
        const heading = node.find('.directory-listing-card__heading').first();
        const link = heading.find('a').first();
        section.cards.push({
          name: normalizedText(heading.text()),
          title: normalizedText(node.find('.directory-listing-card__subheading').first().text()),
          profileHref: link.attr('href') || '',
        });
        return;
      }
      if (node.is('table')) {
        section.tableRows.push(...readRosterTableRows($, node));
        return;
      }
      if (node.closest('li.directory-listing-card').length > 0) return;
      const tagName = (element as { tagName?: string }).tagName || 'h3';
      section = openSection(trail, normalizedText(node.text()), headingLevel(tagName));
      sections.push(section);
    },
  );
  return sections;
}

const ROSTER_CHROME_SUFFIX = /\s*(?:view full profile|copy link|read more|email|website)\s*$/i;
const NOT_A_PERSON_WORDS =
  /\b(?:students?|researchers?|assistants?|members?|alumni|alumnae|lab|laboratory|group|team|people|profile|link|email|contact|current|former|undergraduates?|graduates?|postdocs?|staff|faculty|fellows?|interns?|collaborators?)\b/i;

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
    'university college institute school hospital center centre academy'
  ).split(' '),
);

const displayCase = (name: string): string =>
  name === name.toUpperCase() && /\p{Lu}{2}/u.test(name)
    ? name
        .toLowerCase()
        .replace(/(^|[\s'’-])(\p{L})/gu, (_match, lead, letter) => lead + letter.toUpperCase())
    : name;

const withoutRosterChrome = (value: string): string =>
  value
    .replace(/['’]s Profile$/i, '')
    .replace(ROSTER_CHROME_SUFFIX, '')
    .trim();

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
    /^\p{Lu}/u.test(tokens[tokens.length - 1])
  );
}

const listItemEntry = (text: string): ListedPersonEntry => {
  const parenthesis = text.indexOf('(');
  return parenthesis > 0
    ? {
        name: text.slice(0, parenthesis).trim(),
        title: '',
        years: text.slice(parenthesis),
        profileHref: '',
      }
    : { name: text, title: '', years: '', profileHref: '' };
};

function leadingLineText($: cheerio.CheerioAPI, element: cheerio.Cheerio<any>): string {
  const firstLine = (element.html() || '').split(/<br\s*\/?>/i)[0];
  return normalizedText(cheerio.load(`<div>${firstLine}</div>`)('div').text());
}

function blockEntry($: cheerio.CheerioAPI, element: cheerio.Cheerio<any>): ListedPersonEntry {
  const lead = element.find('h1, h2, h3, h4, h5, h6, strong, b, a').first();
  const link = element.is('a') ? element : element.find('a[href]').first();
  const leadText = normalizedText(lead.text());
  const text = leadingLineText($, element);
  const entry =
    leadText && looksLikeListedPersonName(leadText)
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
  /^(?:view|show|see|our)?\s*(?:lab |group )?(?:alumni|alumnae|former members|past members|previous members)$/i;
const TRAILING_YEAR_LINE = /\b(?:19|20)\d{2}\b/;

function readHeadingListSections($: cheerio.CheerioAPI): RosterSection[] {
  const sections: RosterSection[] = [];
  const trail: HeadingTrailEntry[] = [];
  let section: (RosterSection & { level: number }) | null = null;
  const root = $('main').length > 0 ? $('main').first() : $('body');
  root.find('h1, h2, h3, h4, h5, h6, li, p, table, summary, button').each((_index, element) => {
    const node = $(element);
    if (node.closest('nav, header, footer, aside').length > 0) return;
    const tagName = (element as { tagName?: string }).tagName || '';
    if (/^h[1-6]$/.test(tagName)) {
      const text = normalizedText(node.text());
      const level = headingLevel(tagName);
      const isCardName = level > (section?.level ?? 7) || node.closest('li').length > 0;
      if (section && isCardName && looksLikeListedPersonName(text)) {
        section.listItems.push(blockEntry($, node));
        return;
      }
      section = { ...openSection(trail, text, level), level };
      sections.push(section);
      return;
    }
    if (!section) return;
    if (tagName === 'table') {
      section.tableRows.push(...readRosterTableRows($, node));
      return;
    }
    if (node.closest('table').length > 0) return;
    const text = normalizedText(node.text());
    if (PAST_MEMBERS_MARKER.test(text)) {
      section = { ...section, withinPastSection: true, cards: [], tableRows: [], listItems: [] };
      sections.push(section);
      return;
    }
    if (tagName === 'summary' || tagName === 'button') return;
    if (/^\s*(?:\u00a0\s*){4,}/.test(node.text())) return;
    const entry = blockEntry($, node);
    const previous = section.listItems[section.listItems.length - 1];
    if (
      previous &&
      tagName === 'p' &&
      !looksLikeListedPersonName(entry.name) &&
      text.length <= 40 &&
      TRAILING_YEAR_LINE.test(text)
    ) {
      previous.years = `${previous.years} ${text}`.trim();
      return;
    }
    section.listItems.push(entry);
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
  let undergraduateWithheldCount = 0;
  for (const section of sections) {
    const labelStatus = statusByLabel.get(normalizedLabel(section.label));
    if (!labelStatus) continue;
    const sectionStatus = section.withinPastSection ? 'past' : labelStatus;
    for (const entry of listedPersonEntries(section)) {
      if (mapOfficialRosterRole(entry.title, section.label) !== 'undergrad') continue;
      const name = displayCase(withoutRosterChrome(entry.name));
      if (
        !looksLikeListedPersonName(name) ||
        undergraduates.length >= OFFICIAL_ROSTER_MAX_UNDERGRADUATES_PER_ENTITY
      ) {
        undergraduateWithheldCount += 1;
        continue;
      }
      const { startYear, endYear } = yearSpan(entry.years);
      const status = undergraduateStatus(sectionStatus, { startYear, endYear }, observedAt);
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
  return readProfileGridSections($);
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

export function detectOfficialRosterTemplate(html: string): OfficialRosterTemplate {
  const $ = cheerio.load(html);
  if ($('section.organization-member-listing article.profile-grid-item').length > 0) {
    return 'profile-grid';
  }
  if ($('li.directory-listing-card').length > 0) return 'yalesites-directory';
  return 'heading-list';
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
        mapOfficialRosterRole(entry.title, section.label) === 'undergrad' &&
        looksLikeListedPersonName(entry.name),
    ).length;
    if (!section.label || undergraduateEntries === 0) continue;
    const key = normalizedLabel(section.label);
    const existing = byLabel.get(key);
    const past = PAST_SECTION_LABEL.test(section.label) || section.withinPastSection;
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
): ObservationInput[] {
  const statusValue = {
    state: roster.state,
    complete: roster.complete,
    memberCount: roster.members.length,
    withheldCount: roster.withheldCount,
    duplicateCount: roster.duplicateCount,
    memberKeys: roster.members.map((member) => member.membershipKey),
    undergraduates: roster.undergraduates,
    undergraduateWithheldCount: roster.undergraduateWithheldCount,
    sourceUrl: config.url,
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
        const roster = extractOfficialResearchHomeRoster(html, config, observedAt);
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

    return {
      observationCount,
      entitiesObserved,
      notes: `Reviewed sources=${selected.length}; failed=${failed}; withheld=${withheld}; broad enablement remains audit-gated.`,
    };
  }
}
