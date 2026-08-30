/**
 * DepartmentResearchAreasScraper
 *
 * Yale FAS science and quantitative departments each publish a
 * department-authored "Research" / "Research Areas" overview page that groups
 * the department's faculty into a small set of curated topical themes, usually
 * with a paragraph of descriptive prose per theme and the faculty listed under
 * it (physics.yale.edu/research, chem.yale.edu/research, mcdb.yale.edu/research,
 * ...). Each theme is a human-curated topical grouping that maps directly onto a
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
 * a row - the scraper class is closed for modification.
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
    overviewUrl: 'https://chem.yale.edu/research',
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
    deptKey: 'mbb',
    deptName: 'Molecular Biophysics & Biochemistry',
    schoolName: 'Yale Faculty of Arts and Sciences',
    overviewUrl: 'https://mbb.yale.edu/research',
    peopleIndexUrl: 'https://mbb.yale.edu/people/faculty',
  },
  {
    deptKey: 'astronomy',
    deptName: 'Astronomy',
    schoolName: 'Yale Faculty of Arts and Sciences',
    overviewUrl: 'https://astronomy.yale.edu/research',
    peopleIndexUrl: 'https://astronomy.yale.edu/people/faculty',
  },
  {
    deptKey: 'applied-physics',
    deptName: 'Applied Physics',
    schoolName: 'Yale School of Engineering & Applied Science',
    overviewUrl: 'https://appliedphysics.yale.edu/research',
    peopleIndexUrl: 'https://appliedphysics.yale.edu/people',
  },
  {
    deptKey: 'statistics',
    deptName: 'Statistics & Data Science',
    schoolName: 'Yale Faculty of Arts and Sciences',
    overviewUrl: 'https://statistics.yale.edu/research',
    peopleIndexUrl: 'https://statistics.yale.edu/people/faculty',
  },
  {
    deptKey: 'eeb',
    deptName: 'Ecology and Evolutionary Biology',
    schoolName: 'Yale Faculty of Arts and Sciences',
    overviewUrl: 'https://eeb.yale.edu/research',
    peopleIndexUrl: 'https://eeb.yale.edu/people/faculty',
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
 * the News"), not prose, and inside a sane word/char budget. Mirrors the shared
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

    for (const page of this.pages) {
      if (onlyFilter && !onlyFilter.has(page.deptKey.toLowerCase())) continue;
      if (grafted >= limit) break;

      let html: string | null = null;
      try {
        html = await this.fetchPage(page.overviewUrl, ctx.options.useCache);
      } catch (error) {
        ctx.log(`[${page.deptKey}] overview page fetch failed: ${sanitizeLogValue(error)}`);
        continue;
      }
      if (!html) continue;

      const themes = parseDepartmentResearchThemes(html, page.overviewUrl);
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
        `${ambiguous} held (ambiguous home), ${unresolved} unresolved of ${facultyConsidered} listed faculty.`,
    };
  }
}
