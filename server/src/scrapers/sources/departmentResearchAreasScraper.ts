/**
 * DepartmentResearchAreasScraper
 *
 * Yale FAS science and quantitative departments each publish a
 * department-authored "Research" / "Research Areas" overview page that groups
 * the department's faculty into a small set of curated topical themes, usually
 * with a paragraph of descriptive prose per theme and the faculty listed either
 * under it or on the same-host theme page it links to (physics.yale.edu/research,
 * chem.yale.edu/research-areas, mcdb.yale.edu/research, ...). Each theme is a human-curated topical grouping that maps directly onto a
 * research-area browse facet - the class of evidence #1717/#1700/#1412 flag as
 * missing on much of the FAS science corpus.
 *
 * This is the FAS analogue of the biomedical BBS lane (#1703): a
 * "department research page -> curated topical evidence" acquisition source for
 * the non-biomedical science departments. It enriches, it does not roster and it
 * never mints. Following the `center-affiliation-llm` conservatism model, it
 * grafts a theme's research-area label onto an existing faculty/lab home only
 * when the listed faculty member uniquely resolves to one; anyone who does not
 * uniquely resolve emits nothing (fail-closed, no name-only rows, no new
 * umbrella/department entity).
 *
 * Crawl shape (mirrors `bbs-research-track` / `dept-faculty-roster`):
 *   - Each department research-overview page is a SEED listing, never cited as a
 *     source. The bare `/people` faculty index is likewise never cited.
 *   - Each faculty member's own profile link on the overview page is the
 *     individual source cited for the theme research-area evidence (#516/#549).
 *   - Contact is fail-closed: no emails are read or emitted; identity resolves
 *     from the faculty member's own profile URL and name, never a surname search.
 *
 * The per-theme descriptive prose is parsed for the Dev dry-run spot-check and
 * to keep the lane extensible, but it is deliberately NOT emitted as a
 * per-faculty description: a single shared theme paragraph grafted onto every
 * faculty under it would be exactly the cross-graft defect (#1580/#1730). The
 * net-new signal this lane emits is the department-curated research-area chip.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { ResearchEntity } from '../../models/researchEntity';
import { serializedDocumentId } from '../../utils/idSerialization';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';
import { isListingOrIndexUrl } from '../../utils/researchHomeWebsiteUrl';
import { getCached, setCached } from '../snapshotCache';
import {
  isFullProseParagraph,
  isPageSectionHeadingPhrase,
  isProseNotTopicPhrase,
  isResearchSectionLabel,
  stripResearchSectionLabelPrefix,
} from '../researchAreaLabels';
import { facultyNameMatchKey } from './ysmMeshKeywordScraper';
import { normalizeMatchUrl } from './bbsResearchTrackScraper';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';

const SOURCE_KEY = 'department-research-areas';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;
const RESEARCH_AREA_CONFIDENCE = 0.7;
const MAX_CANDIDATE_SCAN = 4000;
const MAX_THEME_LABEL_WORDS = 8;
const MAX_THEME_LABEL_CHARS = 80;
const NON_TOPIC_THEME_HEADING =
  /^(?:our\s+)?research$|\b(?:undergraduate|graduate|facilit(?:y|ies)|centers?|institutes?|seminars?|colloqui(?:a|um)|people|faculty|staff|students?|programs?|opportunit(?:y|ies)|admissions?|contact)\b/i;

export interface DepartmentResearchAreaPage {
  /** Department key, also used to filter with `--only` (e.g. `--only physics,chemistry`). */
  deptKey: string;
  /** Canonical department name used to scope existing-entity candidates. */
  deptName: string;
  schoolName: string;
  /** Department-authored research/research-areas overview page (the crawl seed). */
  overviewUrl: string;
  /** The bare `/people` faculty index; must be distinct from `overviewUrl`. */
  peopleIndexUrl: string;
}

/**
 * The initial STEM department set. Each `overviewUrl` is the department's curated
 * research-theme page, deliberately distinct from its `/people` faculty index
 * (the index is a roster, not a topical taxonomy). Add a department by appending
 * a row - the scraper class is closed for modification. MB&B, Statistics & Data
 * Science, EEB and Applied Physics were removed in #3532 because they no longer
 * publish a research-theme overview; re-add one only once such a page exists.
 */
export const DEPARTMENT_RESEARCH_AREA_PAGES: DepartmentResearchAreaPage[] = [
  {
    deptKey: 'physics',
    deptName: 'Physics',
    schoolName: 'Yale Faculty of Arts and Sciences',
    overviewUrl: 'https://physics.yale.edu/research',
    peopleIndexUrl: 'https://physics.yale.edu/people/faculty',
  },
  {
    deptKey: 'chemistry',
    deptName: 'Chemistry',
    schoolName: 'Yale Faculty of Arts and Sciences',
    overviewUrl: 'https://chem.yale.edu/research-areas',
    peopleIndexUrl: 'https://chem.yale.edu/people/faculty',
  },
  {
    deptKey: 'mcdb',
    deptName: 'Molecular, Cellular and Developmental Biology',
    schoolName: 'Yale Faculty of Arts and Sciences',
    overviewUrl: 'https://mcdb.yale.edu/research',
    peopleIndexUrl: 'https://mcdb.yale.edu/people/faculty',
  },
  {
    deptKey: 'astronomy',
    deptName: 'Astronomy',
    schoolName: 'Yale Faculty of Arts and Sciences',
    overviewUrl: 'https://astronomy.yale.edu/research',
    peopleIndexUrl: 'https://astronomy.yale.edu/people/faculty',
  },
];

const text = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const uniqueStrings = (values: Array<string | undefined | null>): string[] =>
  Array.from(new Set(values.map((value) => text(value)).filter(Boolean)));

function absolutize(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/**
 * A theme heading is a real research-area chip only when it reads as a concise
 * topic: not a bare section label ("Research Areas"), not page furniture ("In
 * the News"), not a program, audience or facility heading ("Undergraduate
 * Research", "Facilities"), not prose, and inside a sane word/char budget. Mirrors the shared
 * area-label hygiene (#1613/#1734) so a heading that is not a topic never
 * becomes a chip.
 */
export function isResearchAreaThemeLabel(value: unknown): boolean {
  const cleaned = stripResearchSectionLabelPrefix(value);
  if (!cleaned) return false;
  if (cleaned.length > MAX_THEME_LABEL_CHARS) return false;
  if (cleaned.split(/\s+/).filter(Boolean).length > MAX_THEME_LABEL_WORDS) return false;
  if (/[:.!?]$/.test(cleaned)) return false;
  if (!/[A-Za-z]/.test(cleaned)) return false;
  if (isResearchSectionLabel(cleaned)) return false;
  if (isProseNotTopicPhrase(cleaned)) return false;
  if (isPageSectionHeadingPhrase(cleaned)) return false;
  if (NON_TOPIC_THEME_HEADING.test(cleaned)) return false;
  if (isFullProseParagraph(cleaned)) return false;
  return true;
}

/**
 * A link is a citable individual faculty profile when it points at a
 * person-profile path (`/people/<slug>`, `/profile/<slug>`, `/faculty/<slug>`)
 * with a real terminal slug - never a bare `/people` / `/faculty` index or a
 * paginated/facet listing root (#516/#549).
 */
export function isFacultyProfileUrl(value: unknown): boolean {
  const raw = text(value);
  if (!/^https?:\/\//i.test(raw)) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (isListingOrIndexUrl(url.toString())) return false;
  const match = url.pathname.match(/\/(?:people|person|profile|faculty)\/([^/?#]+)\/?$/i);
  const slug = match?.[1]?.toLowerCase();
  if (!slug) return false;
  const generic = new Set([
    'faculty',
    'people',
    'person',
    'profile',
    'index',
    'directory',
    'members',
    'staff',
    'primary',
    'affiliates',
  ]);
  if (generic.has(slug)) return false;
  return true;
}

export interface DeptFacultyRef {
  name: string;
  profileUrl: string;
}

export interface ResearchTheme {
  label: string;
  prose: string;
  faculty: DeptFacultyRef[];
}

function facultyRefFromAnchor(
  $: cheerio.CheerioAPI,
  el: AnyNode,
  pageUrl: string,
): DeptFacultyRef | null {
  const link = $(el);
  const href = link.attr('href') || '';
  if (!href) return null;
  const absolute = absolutize(href, pageUrl);
  if (!isFacultyProfileUrl(absolute)) return null;
  const name = text(link.text());
  if (!name || name.split(/\s+/).filter(Boolean).length < 2) return null;
  return { name, profileUrl: absolute };
}

/**
 * Parse a department research-overview page into curated themes. A theme is a
 * heading (h2/h3) whose text reads as a research-area topic, followed by its
 * descriptive prose and the faculty profile links listed under it (the sibling
 * content up to the next heading). Themes with no citable faculty link are
 * dropped - the lane only ever emits when it can attribute a chip to a resolvable
 * person and cite that person's own page.
 */
export function parseDepartmentResearchThemes(html: string, pageUrl: string): ResearchTheme[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const themes: ResearchTheme[] = [];

  $('h2, h3').each((_i, heading) => {
    const label = stripResearchSectionLabelPrefix($(heading).text());
    if (!isResearchAreaThemeLabel(label)) return;

    const section = $(heading).nextUntil('h2, h3');
    const faculty = new Map<string, DeptFacultyRef>();

    section.each((_j, node) => {
      const el = $(node);
      el.find('a[href]')
        .addBack('a[href]')
        .each((_k, anchor) => {
          const ref = facultyRefFromAnchor($, anchor, pageUrl);
          if (ref) {
            const key = normalizeMatchUrl(ref.profileUrl);
            if (key && !faculty.has(key)) faculty.set(key, ref);
          }
        });
    });

    if (faculty.size === 0) return;
    const proseParts: string[] = [];
    section
      .filter('p')
      .add(section.find('p'))
      .each((_j, node) => {
        const paragraph = text($(node).text());
        if (paragraph) proseParts.push(paragraph);
      });
    themes.push({
      label,
      prose: uniqueStrings(proseParts).join(' ').slice(0, 2000),
      faculty: Array.from(faculty.values()),
    });
  });

  return themes;
}

const THEME_HEADING_SELECTOR = 'h2, h3, h4';
const PROFILE_COLLECTION_SELECTOR = '[data-collection-source="profile"]';
const PROFILE_CARD_SELECTOR = '.directory-listing-card';
const FACULTY_REFERENCE_FIELD_SELECTOR = '.field-name-field-faculty';
const COLLECTION_HEADING_SELECTOR = '.component-wrapper__heading';
const NON_FACULTY_COLLECTION_HEADING = /\b(?:staff|see also|students?|alumni)\b/i;
const FACULTY_TITLE = /\b(?:professor|lecturer|instructor)\b/i;
const MAX_THEME_PAGE_PAGINATION = 10;
const PAGE_CHROME_SELECTOR =
  'nav, header, footer, aside, [role="navigation"], [role="complementary"], [role="contentinfo"], .sidebar';
const NON_THEME_PATH = /^\/(?:posts?|news|events?|calendar)(?:\/|$)/i;

export interface OverviewThemeLink {
  label: string;
  themeUrls: string[];
}

function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isThemePageUrl(candidate: string, overviewUrl: string, excluded: Set<string>): boolean {
  if (!/^https?:\/\//i.test(candidate)) return false;
  if (hostOf(candidate) !== hostOf(overviewUrl)) return false;
  if (isFacultyProfileUrl(candidate) || isListingOrIndexUrl(candidate)) return false;
  const key = normalizeMatchUrl(candidate);
  if (!key || excluded.has(key)) return false;
  const path = new URL(candidate).pathname.replace(/\/+$/, '');
  return path !== '' && !NON_THEME_PATH.test(path);
}

/**
 * Current department sites (YaleSites cards, legacy Drupal views) list only the
 * theme headings on the overview and link each one to a theme page that carries
 * the faculty listing. Collect each topic heading with its same-host theme page
 * links: the heading's own link plus the calls to action in its section.
 */
export function parseOverviewThemeLinks(
  html: string,
  page: Pick<DepartmentResearchAreaPage, 'overviewUrl' | 'peopleIndexUrl'>,
): OverviewThemeLink[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const excluded = new Set(
    [page.overviewUrl, page.peopleIndexUrl].map((url) => normalizeMatchUrl(url)).filter(Boolean),
  );
  const byLabel = new Map<string, Set<string>>();

  $(THEME_HEADING_SELECTOR).each((_i, heading) => {
    if ($(heading).closest(PAGE_CHROME_SELECTOR).length > 0) return;
    const label = stripResearchSectionLabelPrefix($(heading).text());
    if (!isResearchAreaThemeLabel(label)) return;
    const anchors = $(heading)
      .find('a[href]')
      .add($(heading).nextUntil(THEME_HEADING_SELECTOR).find('a[href]'))
      .add($(heading).nextUntil(THEME_HEADING_SELECTOR).filter('a[href]'));
    anchors.each((_j, anchor) => {
      const href = $(anchor).attr('href') || '';
      if (!href) return;
      const absolute = absolutize(href, page.overviewUrl);
      if (!isThemePageUrl(absolute, page.overviewUrl, excluded)) return;
      if (!byLabel.has(label)) byLabel.set(label, new Set());
      byLabel.get(label)!.add(normalizeMatchUrl(absolute));
    });
  });

  return Array.from(byLabel.entries()).map(([label, urls]) => ({
    label,
    themeUrls: Array.from(urls),
  }));
}

export interface ThemePageListing {
  faculty: DeptFacultyRef[];
  listedProfileUrls: string[];
}

/**
 * Read the faculty a theme page lists in its structured faculty listing (a
 * YaleSites profile-directory collection or a Drupal faculty reference field).
 * Theme listings also carry graduate students, postdocs and administrative
 * staff, so a YaleSites card counts only when its role reads as a faculty
 * title. Prose mentions elsewhere on the page are ignored, and only profiles on
 * the department's own host are citable. `listedProfileUrls` holds every listed
 * card, faculty or not, so pagination can tell an exhausted pager from a page
 * of students.
 */
export function parseThemePageListing(html: string, pageUrl: string): ThemePageListing {
  if (!html) return { faculty: [], listedProfileUrls: [] };
  const $ = cheerio.load(html);
  const host = hostOf(pageUrl);
  const faculty = new Map<string, DeptFacultyRef>();
  const listed = new Set<string>();
  const add = (anchor: AnyNode) => {
    const ref = facultyRefFromAnchor($, anchor, pageUrl);
    if (!ref || hostOf(ref.profileUrl) !== host) return;
    const key = normalizeMatchUrl(ref.profileUrl);
    if (key && !faculty.has(key)) faculty.set(key, ref);
  };

  $(PROFILE_COLLECTION_SELECTOR).each((_i, collection) => {
    const heading = text(
      $(collection)
        .closest('.component-wrapper__inner')
        .find(COLLECTION_HEADING_SELECTOR)
        .first()
        .text(),
    );
    if (NON_FACULTY_COLLECTION_HEADING.test(heading)) return;
    $(collection)
      .find(PROFILE_CARD_SELECTOR)
      .each((_j, card) => {
        $(card)
          .find('.directory-listing-card__heading-link[href]')
          .each((_k, anchor) => {
            const key = normalizeMatchUrl(absolutize($(anchor).attr('href') || '', pageUrl));
            if (key) listed.add(key);
          });
        const role = text($(card).find('.directory-listing-card__subheading').text());
        if (!FACULTY_TITLE.test(role)) return;
        $(card)
          .find('.directory-listing-card__heading-link[href]')
          .each((_k, anchor) => add(anchor));
      });
  });
  $(FACULTY_REFERENCE_FIELD_SELECTOR)
    .find('a[href]')
    .each((_i, anchor) => {
      const key = normalizeMatchUrl(absolutize($(anchor).attr('href') || '', pageUrl));
      if (key) listed.add(key);
      add(anchor);
    });

  return { faculty: Array.from(faculty.values()), listedProfileUrls: Array.from(listed) };
}

export function nextThemePageUrl(html: string, pageUrl: string): string | null {
  if (!html) return null;
  const $ = cheerio.load(html);
  const href = $('.pager a[rel="next"], .pager__item--next a[href], li.pager-next a[href]')
    .first()
    .attr('href');
  if (!href) return null;
  const next = absolutize(href, pageUrl);
  if (hostOf(next) !== hostOf(pageUrl) || next === pageUrl) return null;
  return next;
}

export interface DeptFacultyThemeAreas {
  name: string;
  profileUrl: string;
  researchAreas: string[];
}

/**
 * Fold parsed themes into per-faculty area sets keyed by normalized profile URL,
 * unioning the labels of every theme a faculty member is listed under.
 */
export function aggregateFacultyThemeAreas(
  themes: ResearchTheme[],
): Map<string, DeptFacultyThemeAreas> {
  const byProfile = new Map<string, DeptFacultyThemeAreas>();
  for (const theme of themes) {
    for (const ref of theme.faculty) {
      const key = normalizeMatchUrl(ref.profileUrl);
      if (!key) continue;
      const existing = byProfile.get(key);
      if (existing) {
        if (!existing.researchAreas.includes(theme.label)) existing.researchAreas.push(theme.label);
      } else {
        byProfile.set(key, {
          name: ref.name,
          profileUrl: ref.profileUrl,
          researchAreas: [theme.label],
        });
      }
    }
  }
  return byProfile;
}

export interface DeptAreaCandidateEntity {
  _id?: unknown;
  slug?: string;
  name: string;
  matchUrls: string[];
  nameKey: string;
}

export interface DeptAreaMatchIndex {
  entityIdByUrl: Map<string, Set<string>>;
  entityIdByNameKey: Map<string, Set<string>>;
}

export function buildDeptAreaMatchIndex(candidates: DeptAreaCandidateEntity[]): DeptAreaMatchIndex {
  const entityIdByUrl = new Map<string, Set<string>>();
  const entityIdByNameKey = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const entityId = serializedDocumentId(candidate._id);
    if (!entityId) continue;
    for (const rawUrl of candidate.matchUrls) {
      const url = normalizeMatchUrl(rawUrl);
      if (!url) continue;
      if (!entityIdByUrl.has(url)) entityIdByUrl.set(url, new Set());
      entityIdByUrl.get(url)!.add(entityId);
    }
    if (candidate.nameKey) {
      if (!entityIdByNameKey.has(candidate.nameKey)) {
        entityIdByNameKey.set(candidate.nameKey, new Set());
      }
      entityIdByNameKey.get(candidate.nameKey)!.add(entityId);
    }
  }
  return { entityIdByUrl, entityIdByNameKey };
}

export type DeptHomeResolution =
  | { status: 'matched'; entityId: string }
  | { status: 'ambiguous' }
  | { status: 'unmatched' };

/**
 * Resolve a listed faculty member to a single existing research home. A profile
 * URL match is exact and preferred; a name-key match is a last-resort fallback
 * used only when unambiguous within the department-scoped candidate set. Fails
 * closed (ambiguous) whenever more than one distinct entity is implicated so no
 * theme label is ever grafted onto the wrong home.
 */
export function resolveDeptFacultyHome(
  faculty: DeptFacultyThemeAreas,
  index: DeptAreaMatchIndex,
): DeptHomeResolution {
  const url = normalizeMatchUrl(faculty.profileUrl);
  if (url) {
    const byUrl = index.entityIdByUrl.get(url);
    if (byUrl && byUrl.size === 1) return { status: 'matched', entityId: [...byUrl][0] };
    if (byUrl && byUrl.size > 1) return { status: 'ambiguous' };
  }
  const nameKey = facultyNameMatchKey(faculty.name);
  if (nameKey) {
    const byName = index.entityIdByNameKey.get(nameKey);
    if (byName && byName.size === 1) return { status: 'matched', entityId: [...byName][0] };
    if (byName && byName.size > 1) return { status: 'ambiguous' };
  }
  return { status: 'unmatched' };
}

export function deptAreaGraftObservations(
  entityId: string,
  researchAreas: string[],
  sourceUrl: string,
): ObservationInput[] {
  const areas = uniqueStrings(researchAreas).filter((area) => isResearchAreaThemeLabel(area));
  if (!entityId || !sourceUrl || areas.length === 0) return [];
  return [
    {
      entityType: 'researchEntity',
      entityId,
      sourceUrl,
      field: 'researchAreas',
      value: areas,
      confidenceOverride: RESEARCH_AREA_CONFIDENCE,
    },
  ];
}

export type FetchDeptAreaPageFn = (url: string, useCache: boolean) => Promise<string | null>;

export type DeptAreaEntityFinderFn = (
  page: DepartmentResearchAreaPage,
) => Promise<DeptAreaCandidateEntity[]>;

export interface DepartmentResearchAreasScraperDeps {
  fetchPage?: FetchDeptAreaPageFn;
  entityFinder?: DeptAreaEntityFinderFn;
}

async function defaultFetchPage(url: string, useCache: boolean): Promise<string | null> {
  if (useCache) {
    const cached = await getCached<string>(SOURCE_KEY, `page:${url}`);
    if (cached) return cached;
  }
  const safeUrl = await assertPublicHttpUrl(url);
  const agents = ssrfSafeAgents();
  const res = await axios.get(safeUrl.toString(), {
    timeout: FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT },
    maxRedirects: 5,
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
  });
  const html = String(res.data || '');
  if (useCache) await setCached(SOURCE_KEY, `page:${url}`, html);
  return html;
}

interface DeptAreaCandidateDoc {
  _id?: unknown;
  slug?: string;
  name?: string;
  displayName?: string;
  contactName?: string;
  websiteUrl?: string;
  sourceUrls?: unknown;
}

function candidateFromDoc(doc: DeptAreaCandidateDoc): DeptAreaCandidateEntity {
  const matchUrls = uniqueStrings([
    doc.websiteUrl,
    ...(Array.isArray(doc.sourceUrls) ? (doc.sourceUrls as unknown[]).map(text) : []),
  ]);
  const name = text(doc.displayName || doc.name || doc.slug);
  return {
    _id: doc._id,
    slug: doc.slug,
    name,
    matchUrls,
    nameKey: facultyNameMatchKey(doc.contactName || name),
  };
}

function overviewHostPattern(page: DepartmentResearchAreaPage): RegExp | null {
  try {
    const host = new URL(page.overviewUrl).hostname.toLowerCase();
    return new RegExp(`^https?://${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`, 'i');
  } catch {
    return null;
  }
}

function defaultEntityFinder(page: DepartmentResearchAreaPage): Promise<DeptAreaCandidateEntity[]> {
  const hostPattern = overviewHostPattern(page);
  const or: Record<string, unknown>[] = [{ departments: page.deptName }];
  if (hostPattern) {
    or.push({ websiteUrl: hostPattern }, { sourceUrls: hostPattern });
  }
  return ResearchEntity.find(
    { archived: { $ne: true }, $or: or },
    {
      _id: 1,
      slug: 1,
      name: 1,
      displayName: 1,
      contactName: 1,
      websiteUrl: 1,
      sourceUrls: 1,
    },
  )
    .sort({ _id: 1 })
    .limit(MAX_CANDIDATE_SCAN)
    .lean()
    .then((docs) => (docs as DeptAreaCandidateDoc[]).map(candidateFromDoc));
}

export class DepartmentResearchAreasScraper implements IScraper {
  readonly name = SOURCE_KEY;
  readonly displayName = 'FAS science department research-area topical evidence for faculty';

  private readonly fetchPage: FetchDeptAreaPageFn;
  private readonly entityFinder: DeptAreaEntityFinderFn;
  private readonly pages: DepartmentResearchAreaPage[];

  constructor(
    deps: DepartmentResearchAreasScraperDeps = {},
    pages: DepartmentResearchAreaPage[] = DEPARTMENT_RESEARCH_AREA_PAGES,
  ) {
    this.fetchPage = deps.fetchPage || defaultFetchPage;
    this.entityFinder = deps.entityFinder || defaultEntityFinder;
    this.pages = pages;
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const onlyFilter =
      ctx.options.only && ctx.options.only.length > 0
        ? new Set(ctx.options.only.map((value) => value.trim().toLowerCase()))
        : null;
    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }
    const limit = limitOption ?? Infinity;

    let observationCount = 0;
    let grafted = 0;
    let ambiguous = 0;
    let unresolved = 0;
    let facultyConsidered = 0;
    let fetchFailures = 0;

    for (const page of this.pages) {
      if (onlyFilter && !onlyFilter.has(page.deptKey.toLowerCase())) continue;
      if (grafted >= limit) break;

      const html = await this.fetchOrLog(ctx, page, page.overviewUrl, 'overview page');
      if (html === null) {
        fetchFailures += 1;
        continue;
      }
      if (!html) continue;

      const linked = await this.linkedThemes(ctx, page, html);
      fetchFailures += linked.fetchFailures;
      const themes = [...parseDepartmentResearchThemes(html, page.overviewUrl), ...linked.themes];
      const facultyAreas = aggregateFacultyThemeAreas(themes);
      ctx.log(
        `[${page.deptKey}] ${themes.length} themes, ${facultyAreas.size} faculty with topical evidence`,
      );
      if (facultyAreas.size === 0) continue;

      const candidates = await this.entityFinder(page);
      const index = buildDeptAreaMatchIndex(candidates);

      for (const faculty of facultyAreas.values()) {
        if (grafted >= limit) break;
        facultyConsidered += 1;
        const resolution = resolveDeptFacultyHome(faculty, index);
        if (resolution.status === 'ambiguous') {
          ambiguous += 1;
          continue;
        }
        if (resolution.status === 'unmatched') {
          unresolved += 1;
          continue;
        }
        const observations = deptAreaGraftObservations(
          resolution.entityId,
          faculty.researchAreas,
          faculty.profileUrl,
        );
        if (observations.length === 0) continue;
        await ctx.emit(observations);
        observationCount += observations.length;
        grafted += 1;
      }
    }

    return {
      observationCount,
      entitiesObserved: grafted,
      notes:
        `Grafted department research-area themes onto ${grafted} existing homes; ` +
        `${ambiguous} held (ambiguous home), ${unresolved} unresolved of ${facultyConsidered} listed faculty; ` +
        `${fetchFailures} page fetches failed.`,
    };
  }

  private async fetchOrLog(
    ctx: ScraperContext,
    page: DepartmentResearchAreaPage,
    url: string,
    what: string,
  ): Promise<string | null> {
    try {
      return (await this.fetchPage(url, ctx.options.useCache)) ?? '';
    } catch (error) {
      ctx.log(`[${page.deptKey}] ${what} fetch failed (${url}): ${sanitizeLogValue(error)}`);
      return null;
    }
  }

  private async linkedThemes(
    ctx: ScraperContext,
    page: DepartmentResearchAreaPage,
    overviewHtml: string,
  ): Promise<{ themes: ResearchTheme[]; fetchFailures: number }> {
    const themes: ResearchTheme[] = [];
    let fetchFailures = 0;
    for (const link of parseOverviewThemeLinks(overviewHtml, page)) {
      const faculty = new Map<string, DeptFacultyRef>();
      for (const themeUrl of link.themeUrls) {
        const visited = new Set<string>();
        const chainProfiles = new Set<string>();
        let pageUrl: string | null = themeUrl;
        while (pageUrl && !visited.has(pageUrl) && visited.size < MAX_THEME_PAGE_PAGINATION) {
          visited.add(pageUrl);
          const html = await this.fetchOrLog(ctx, page, pageUrl, 'theme page');
          if (html === null) {
            fetchFailures += 1;
            break;
          }
          const listing = parseThemePageListing(html, pageUrl);
          const seenInChain = chainProfiles.size;
          for (const url of listing.listedProfileUrls) chainProfiles.add(url);
          for (const ref of listing.faculty) {
            const key = normalizeMatchUrl(ref.profileUrl);
            if (key && !faculty.has(key)) faculty.set(key, ref);
          }
          if (chainProfiles.size === seenInChain) break;
          pageUrl = nextThemePageUrl(html, pageUrl);
        }
      }
      if (faculty.size > 0) {
        themes.push({ label: link.label, prose: '', faculty: Array.from(faculty.values()) });
      }
    }
    return { themes, fetchFailures };
  }
}
