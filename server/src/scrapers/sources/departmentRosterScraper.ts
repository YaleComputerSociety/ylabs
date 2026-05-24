/**
 * DepartmentRosterScraper
 *
 * One scraper class that pulls faculty rosters from multiple Yale department
 * websites. Each department's HTML differs, so we use a per-department config
 * row that pairs a URL with a pure extractor function. Adding a new department
 * is a single config-row change — the orchestrator class itself is closed for
 * modification.
 *
 * The initial official-profile batch targets Economics, MCDB, Computer Science,
 * Psychology, Math, Physics, Statistics & Data Science, and Astronomy. CS uses a
 * client-rendered faculty component, so the scraper first tries the component's
 * JSON endpoint and falls back to rendered HTML when needed.
 *
 * Output observations:
 *   - For each faculty member: User observations keyed by netid (when an
 *     @yale.edu email is on the page) or by a synthetic
 *     `dept:<deptKey>:<slug>` entityKey otherwise. The materializer creates
 *     stub Users from synthetic keys.
 *   - For each PI-owned lab/personal website discovered: a ResearchEntity
 *     observation keyed by `dept-<deptKey>-<slug>`.
 *   - For non-owner roster rows that point at a known PI-owned lab URL in the
 *     same batch: ResearchGroupMember observations attached to that lab.
 *
 * Honors `--use-cache`, `--limit` (caps total faculty across all depts), and
 * `--only` (filter by deptKey, e.g. `--only econ,mcdb`).
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import {
  createScraplingRenderedFetcher,
  measureRenderedFetch,
  summarizeFetchMetrics,
  type RenderedFetcher,
  type RenderedFetchResult,
} from '../renderedFetch';
import { getCached, setCached } from '../snapshotCache';
import { normalizeOrcid } from '../../utils/orcid';
import type {
  IScraper,
  ScraperContext,
  ScraperResult,
  ObservationInput,
  ScraperFetchMetric,
} from '../types';
import { canOwnResearchEntity, classifyResearchPersonRole } from '../roleClassifier';
import { netidFromEmail, normalizeName, slugify, splitName } from '../utils/scraperHelpers';
import { isUsableResearchWebsiteUrl } from '../../utils/researchWebsiteUrl';
import { sanitizeProfileResearchTerms } from '../../utils/profileResearchTerms';

const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;
const MAX_PAGES_PER_DEPT = 20; // safety cap on pagination crawl

/** Minimal structured row produced by every per-department extractor. */
export interface FacultyEntry {
  name: string;
  /** Yale profile URL (relative or absolute) if present on the listing. */
  profileUrl?: string;
  /** Title / position string ("Sterling Professor of …") if present. */
  title?: string;
  /** Email address if present (used to derive netid). */
  email?: string;
  /** External lab / personal website URL discovered on the listing. */
  labUrl?: string;
  /** Whether the discovered URL represents a collective lab/group or a personal faculty site. */
  labUrlKind?: 'lab' | 'personal';
  /** ORCID extracted from an official Yale profile page. */
  orcid?: string;
  /** Short bio or research summary extracted from an official Yale profile page. */
  bio?: string;
  /** Profile/headshot image URL extracted from an official Yale profile page. */
  imageUrl?: string;
  /** Research interests extracted from official profile or roster topic fields. */
  researchInterests?: string[];
  /** Search/topic labels extracted from official profile or roster topic fields. */
  topics?: string[];
  /** Entry-specific department labels when a combined roster row carries its own department evidence. */
  departments?: string[];
  /** Review-only Google Scholar profile URLs; never materialized as accepted Scholar IDs. */
  scholarCandidateProfileUrls?: string[];
  /** Bounded publication links explicitly selected on an official profile page. */
  selectedPublicationLinks?: Array<{
    title: string;
    url: string;
    doi?: string;
    destinationKind: 'DOI' | 'PUBLISHER' | 'PUBMED' | 'PMC' | 'ARXIV' | 'OTHER';
    displaySource: string;
    year?: number;
    venue?: string;
  }>;
  /** Official profile page that supplied profile-level enrichment fields. */
  profileSourceUrl?: string;
}

/** Context passed to each per-department extractor for URL resolution and logging. */
export interface ExtractorCtx {
  /** Absolute URL the HTML was fetched from — used to resolve relative hrefs. */
  pageUrl: string;
}

/** Pure extractor: HTML in, structured rows out. No I/O. */
export type FacultyExtractor = (html: string, ctx: ExtractorCtx) => FacultyEntry[];
export type FacultyDataExtractor = (payload: unknown, ctx: ExtractorCtx) => FacultyEntry[];
export type HtmlFetcher = (url: string, useCache: boolean, sourceName: string) => Promise<string>;

export interface DeptConfig {
  deptKey: string;
  deptName: string;
  schoolName: string;
  /** Initial page URL. The scraper will follow `?page=N` style pagination if `paginated` is true. */
  url: string;
  /** When true, the scraper crawls `?page=1`, `?page=2`, … until an empty page or the safety cap. */
  paginated?: boolean;
  extractor: FacultyExtractor;
  /** Optional parser to use after a rendered fetch. Keeps browser fetching separate from domain parsing. */
  renderedExtractor?: FacultyExtractor;
  /** Selector that should exist after hydration; used for rendered-fetch waits/metrics. */
  renderWaitSelector?: string;
  /** Optional JSON endpoint for client-rendered faculty components. */
  dataUrl?: string;
  dataRequest?: Record<string, string>;
  dataExtractor?: FacultyDataExtractor;
  /** Set when the page is JS-rendered and the extractor is intentionally a stub. */
  jsRenderedSkip?: boolean;
}

// ---------------------------------------------------------------------------
// Per-department extractors (pure functions over HTML)
// ---------------------------------------------------------------------------

/**
 * Yale Economics — Drupal "node-teaser--person" cards. Twelve cards per page.
 *   <article class="node-teaser node-teaser--person …">
 *     <div class="node-teaser__heading"><a href="/people/<slug>"><span>Name</span></a></div>
 *     <div class="node-teaser__professional-title"><span>Title…</span></div>
 *   </article>
 * Email and lab URL are NOT exposed on the listing page.
 */
export const econExtractor: FacultyExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const out: FacultyEntry[] = [];
  $('article.node-teaser--person').each((_i, el) => {
    const card = $(el);
    const link = card.find('.node-teaser__heading a').first();
    const name = link.text().trim();
    if (!name) return;
    const href = link.attr('href') || '';
    const profileUrl = href ? absolutize(href, ctx.pageUrl) : undefined;
    const title = card.find('.node-teaser__professional-title').first().text().trim() || undefined;
    out.push({ name, profileUrl, title });
  });
  return out;
};

/**
 * MCDB — modern Yale "directory-listing-card" component. ~25 cards per page.
 *   <div class="directory-listing-card">
 *     <div class="directory-listing-card__content">
 *       <h3 class="directory-listing-card__heading">
 *         <a class="directory-listing-card__heading-link" href="/profile/<slug>">Name, Ph.D.</a>
 *       </h3>
 *       <div class="directory-listing-card__subheading">…title…</div>
 *       <a class="directory-listing-card__link" href="mailto:…">Email</a>
 *     </div>
 *   </div>
 */
export const mcdbExtractor: FacultyExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const out: FacultyEntry[] = [];
  $('.directory-listing-card').each((_i, el) => {
    const card = $(el);
    const link = card.find('.directory-listing-card__heading-link').first();
    const name = link.text().trim();
    if (!name) return;
    const profileHref = link.attr('href') || '';
    const profileUrl = profileHref ? absolutize(profileHref, ctx.pageUrl) : undefined;
    const title = card.find('.directory-listing-card__subheading').first().text().trim() || undefined;
    let email: string | undefined;
    let labUrl: string | undefined;
    card.find('.directory-listing-card__link').each((_j, a) => {
      const href = $(a).attr('href') || '';
      if (/^mailto:/i.test(href)) {
        email = href.replace(/^mailto:/i, '').trim() || email;
      } else if (/^https?:\/\//i.test(href) && !labUrl) {
        labUrl = href;
      }
    });
    const bio = cleanText(card.find('.directory-listing-card__snippet').first().text()) || undefined;
    out.push({ name, profileUrl, title, email, labUrl, bio });
  });
  return out;
};

/**
 * Yale Psychology — classic Drupal Views table. Multiple <table class="views-table">
 * sections (Primary, Research Scientists, Lecturers, Affiliated). Each row:
 *   <tr>
 *     <td class="views-field-name"><a href="/people/<slug>">Name</a></td>
 *     <td class="views-field-field-phone">…</td>
 *     <td class="views-field-mail"><a href="mailto:…">…</a></td>
 *     <td class="views-field-field-office">…</td>
 *   </tr>
 */
export const psychExtractor: FacultyExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const out: FacultyEntry[] = [];
  $('table.views-table tbody tr, table.views-view-grid td[class*="col-"]').each((_i, el) => {
    const row = $(el);
    const nameCell = row.find('.views-field-name').first();
    const nameLink = nameCell.find('a.username, a[href*="/people/"]').first();
    const profileLink = nameLink.length > 0
      ? nameLink
      : row.find('.views-field-picture a[href*="/people/"], a.username, a[href*="/people/"]').first();
    const name =
      cleanText(nameLink.text()) ||
      cleanText(nameCell.find('.field-content').first().text()) ||
      cleanText(profileLink.text());
    if (!name) return;
    const profileHref = profileLink.attr('href') || '';
    const profileUrl = profileHref ? absolutize(profileHref, ctx.pageUrl) : undefined;
    const emailHref =
      row.find('.views-field-mail a[href^="mailto:"]').first().attr('href') ||
      nameCell.find('a[href^="mailto:"]').first().attr('href') ||
      row.find('a[href^="mailto:"]').first().attr('href') ||
      '';
    const email = /^mailto:/i.test(emailHref) ? emailHref.replace(/^mailto:/i, '').trim() : undefined;

    let title: string | undefined;
    let seenNameLink = false;
    if (nameLink.length > 0) {
      nameCell.contents().each((_j, node) => {
        if (title) return false;
        if (node.type === 'tag' && node === nameLink[0]) {
          seenNameLink = true;
          return;
        }
        if (!seenNameLink || node.type !== 'text') return;
        const text = cleanText($(node).text());
        if (text) title = text;
      });
    }
    title =
      title ||
      cleanText(
        row
          .find('.views-field-field-title .field-content, .views-field-field-title')
          .first()
          .text(),
      ) ||
      undefined;

    let labUrl: string | undefined;
    row.find('a[href]').each((_j, a) => {
      if (labUrl) return;
      const link = $(a);
      const href = link.attr('href') || '';
      if (!href || /^mailto:|^tel:|^#|^javascript:/i.test(href)) return;
      if (profileHref && href === profileHref) return;
      if (profileUrl && normalizeUrlForDedupe(absolutize(href, ctx.pageUrl)) === normalizeUrlForDedupe(profileUrl)) {
        return;
      }
      const text = link.text().replace(/\s+/g, ' ').trim();
      const signal = `${text} ${link.attr('aria-label') || ''} ${link.attr('title') || ''} ${href}`;
      if (!/\b(website|lab|laboratory|homepage|research group)\b/i.test(signal) && !/^https?:\/\//i.test(href)) {
        return;
      }
      labUrl = absolutize(href, ctx.pageUrl);
    });

    const topics = splitTopicText(
      row
        .find(
          '.views-field-field-field-of-study, [class*="field-of-study"], .views-field-field-term-reference',
        )
        .text(),
    );

    out.push({
      name,
      profileUrl,
      title,
      email,
      labUrl,
      topics: topics.length > 0 ? topics : undefined,
      researchInterests: topics.length > 0 ? topics : undefined,
    });
  });
  return out;
};

/**
 * Yale CS — engineering.yale.edu computer-science faculty page is a Next.js
 * client-rendered SPA: the raw HTML contains no faculty data, only an empty
 * shell that hydrates client-side. Marked with `jsRenderedSkip` so the runner
 * logs a warning instead of returning an empty roster.
 *
 * TODO: when we add headless-browser support (puppeteer/playwright) plug it in
 * here. Until then this stub throws if invoked directly.
 */
export const csJsRenderedStub: FacultyExtractor = () => {
  throw new Error('Yale CS faculty page is JS-rendered; needs headless browser');
};

export const csRenderedExtractor: FacultyExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const out: FacultyEntry[] = [];
  const seen = new Set<string>();

  $('a').each((_i, el) => {
    const link = $(el);
    const href = link.attr('href') || '';
    const text = link.text().replace(/\s+/g, ' ').trim();
    if (!text || !href) return;
    if (!/\/faculty\/|\/profile\/|people|directory/i.test(href)) return;
    if (!/^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)+/.test(text)) return;

    const name = normalizeName(text.replace(/\s*,?\s*(Ph\.?D\.?|M\.?D\.?)$/i, ''));
    const key = `${name}:${href}`;
    if (!name || seen.has(key)) return;
    seen.add(key);

    const container = link.closest('article, li, tr, .card, .views-row, div').first();
    const title =
      container
        .find('[class*="title"], [class*="position"], [class*="role"]')
        .first()
        .text()
        .replace(/\s+/g, ' ')
        .trim() || undefined;
    const emailHref = container.find('a[href^="mailto:"]').first().attr('href') || '';
    const email = emailHref ? emailHref.replace(/^mailto:/i, '').trim() : undefined;

    out.push({
      name,
      profileUrl: absolutize(href, ctx.pageUrl),
      title,
      email,
    });
  });

  return out;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

const ENGINEERING_DEPARTMENT_LABELS: Array<{ titleLabel: string; department: string }> = [
  { titleLabel: 'Applied & Computational Mathematics', department: 'Applied Mathematics' },
  { titleLabel: 'Applied Physics', department: 'Applied Physics' },
  { titleLabel: 'Biomedical Engineering', department: 'Biomedical Engineering' },
  {
    titleLabel: 'Chemical & Environmental Engineering',
    department: 'Chemical & Environmental Engineering',
  },
  { titleLabel: 'Computer Science', department: 'Computer Science' },
  {
    titleLabel: 'Electrical & Computer Engineering',
    department: 'Electrical & Computer Engineering',
  },
  {
    titleLabel: 'Materials Science',
    department: 'Mechanical Engineering & Materials Science',
  },
  {
    titleLabel: 'Mechanical Engineering',
    department: 'Mechanical Engineering & Materials Science',
  },
];

function inferredEngineeringDepartments(title: string | undefined): string[] {
  const normalizedTitle = String(title || '');
  return uniqueStrings(
    ENGINEERING_DEPARTMENT_LABELS.filter(({ titleLabel }) =>
      normalizedTitle.toLowerCase().includes(titleLabel.toLowerCase()),
    ).map(({ department }) => department),
  );
}

function facultyMembersFromPayload(payload: unknown): Record<string, unknown>[] {
  if (!isRecord(payload) || !isRecord(payload.pages)) return [];

  const out: Record<string, unknown>[] = [];
  const pages = payload.pages;
  for (const page of Object.values(pages)) {
    if (isRecord(page) && Array.isArray(page.facultyMembers)) {
      out.push(...page.facultyMembers.filter(isRecord));
    }
  }

  if (isRecord(pages.letters)) {
    for (const letterRows of Object.values(pages.letters)) {
      if (Array.isArray(letterRows)) out.push(...letterRows.filter(isRecord));
    }
  }

  return out;
}

export const csFacultyDataExtractor: FacultyDataExtractor = (payload, ctx) => {
  const out: FacultyEntry[] = [];
  const seen = new Set<string>();
  for (const member of facultyMembersFromPayload(payload)) {
    const name = normalizeName(stringValue(member.name) || '');
    if (!name) continue;
    const url = stringValue(member.url);
    const profileUrl = url ? absolutize(url, ctx.pageUrl) : undefined;
    const key = `${name}:${profileUrl || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const title = stringValue(member.fullTitle) || stringValue(member.title);
    const labUrl =
      profileUrl && !isOfficialYaleUrl(profileUrl) ? profileUrl : undefined;
    out.push({ name, profileUrl, title, labUrl });
  }

  return out;
};

export const engineeringFacultyDirectoryDataExtractor: FacultyDataExtractor = (payload, ctx) => {
  const out: FacultyEntry[] = [];
  const seen = new Set<string>();
  for (const member of facultyMembersFromPayload(payload)) {
    const name = normalizeName(stringValue(member.name) || '');
    if (!name) continue;
    const title = stringValue(member.fullTitle) || stringValue(member.title);
    const departments = inferredEngineeringDepartments(title);
    const nonCsDepartments = departments.filter((department) => department !== 'Computer Science');
    if (nonCsDepartments.length === 0) continue;

    const url = stringValue(member.url);
    const profileUrl = url ? absolutize(url, ctx.pageUrl) : undefined;
    const key = `${name}:${profileUrl || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const labUrl =
      profileUrl && !isOfficialYaleUrl(profileUrl) ? profileUrl : undefined;
    out.push({ name, profileUrl, title, labUrl, departments });
  }

  return out;
};

// ---------------------------------------------------------------------------
// Default config (mutable so callers can swap or extend in tests if needed,
// though the typical add-a-dept path is just a new entry below).
// ---------------------------------------------------------------------------

export const DEFAULT_DEPT_CONFIGS: DeptConfig[] = [
  {
    deptKey: 'econ',
    deptName: 'Economics',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://economics.yale.edu/people',
    paginated: true,
    extractor: econExtractor,
  },
  {
    deptKey: 'mcdb',
    deptName: 'Molecular, Cellular and Developmental Biology',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://mcdb.yale.edu/people/faculty',
    paginated: true,
    extractor: mcdbExtractor,
  },
  {
    deptKey: 'cs',
    deptName: 'Computer Science',
    schoolName: 'Yale School of Engineering & Applied Science',
    url: 'https://engineering.yale.edu/academic-study/departments/computer-science/faculty',
    paginated: false,
    extractor: csJsRenderedStub,
    dataUrl:
      'https://engineering.yale.edu/academic-study/departments/computer-science/faculty/load_faculty/4841',
    dataRequest: {
      template: 'department',
      maxpages: '0',
    },
    dataExtractor: csFacultyDataExtractor,
    renderedExtractor: csRenderedExtractor,
    renderWaitSelector: 'a[href*="faculty"], a[href*="profile"], main',
    jsRenderedSkip: true,
  },
  {
    deptKey: 'seas',
    deptName: 'Yale Engineering',
    schoolName: 'Yale School of Engineering & Applied Science',
    url: 'https://engineering.yale.edu/research-and-faculty/faculty-directory',
    paginated: false,
    extractor: csJsRenderedStub,
    dataUrl: 'https://engineering.yale.edu/research-and-faculty/faculty-directory/load_faculty/172',
    dataRequest: {
      template: 'full',
      maxpages: '0',
    },
    dataExtractor: engineeringFacultyDirectoryDataExtractor,
    renderedExtractor: csRenderedExtractor,
    renderWaitSelector: 'a[href*="faculty"], main',
    jsRenderedSkip: true,
  },
  {
    deptKey: 'psych',
    deptName: 'Psychology',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://psychology.yale.edu/people/faculty/primary',
    paginated: false,
    extractor: psychExtractor,
  },
  {
    deptKey: 'math',
    deptName: 'Mathematics',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://math.yale.edu/people/faculty',
    paginated: false,
    extractor: mcdbExtractor,
  },
  {
    deptKey: 'physics',
    deptName: 'Physics',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://physics.yale.edu/people/faculty',
    paginated: false,
    extractor: psychExtractor,
  },
  {
    deptKey: 'statistics',
    deptName: 'Statistics & Data Science',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://statistics.yale.edu/people/faculty',
    paginated: false,
    extractor: mcdbExtractor,
  },
  {
    deptKey: 'astronomy',
    deptName: 'Astronomy',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://astronomy.yale.edu/people/faculty',
    paginated: false,
    extractor: psychExtractor,
  },
  {
    deptKey: 'eeb',
    deptName: 'Ecology & Evolutionary Biology',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://eeb.yale.edu/people/faculty',
    paginated: false,
    extractor: psychExtractor,
  },
];

// ---------------------------------------------------------------------------
// Internal helpers (network + emission shape)
// ---------------------------------------------------------------------------

function absolutize(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function cleanText(value: string | undefined | null): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanTextPreservingParagraphs(value: string | undefined | null): string {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const TOPIC_NOISE_PATTERNS = [
  /\b(?:orcid\s*)?\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{3}[\dX]\b/i,
  /streamline\s+icon/i,
  /streamlinehq\.com/i,
  /^view\s+lab\s+website$/i,
  /view\s+lab\s+website/i,
  /view\s+(?:\d+\s+)?related\s+publications?/i,
  /\d+\s*YSM\s+Researchers?\b/i,
  /Research topics .+ is interested in exploring/i,
  /^(?:[\d,]+|publications?|citations?)$/i,
];

function isTopicLikeText(value: string): boolean {
  return !TOPIC_NOISE_PATTERNS.some((pattern) => pattern.test(value));
}

function splitTopicText(value: string | undefined | null): string[] {
  const cleaned = String(value || '').trim();
  if (!cleaned) return [];
  const parts = cleaned
    .split(/[,;|•\n\r]+/)
    .map((part) =>
      cleanText(part).replace(
        /^(?:Research Areas?|Research Type|Current Projects|Interests?):\s*/i,
        '',
      ),
    )
    .filter((part) => part.length > 1 && !/^[-–—]+$/.test(part))
    .filter(isTopicLikeText);
  return uniqueStrings(parts);
}

function splitResearchListText(value: string): string[] {
  return value
    .split(/[,;]|\s+\band\b\s+/i)
    .map((part) =>
      cleanText(
        part.trim().replace(
          /^(?:and|including|contributions?\s+to\s+the\s+understanding\s+of|the understanding of)\s+/i,
          '',
        ),
      ),
    )
    .filter((part) => part.length > 3)
    .filter(isTopicLikeText);
}

function splitFocusedPrimaryResearchText(value: string): string[] {
  const cleaned = cleanText(value);
  const onMatch = cleaned.match(/^(.+\bon\s+)(.+)$/i);
  if (!onMatch?.[1] || !onMatch[2] || !/[,;]|\s+\band\s+\S+/i.test(onMatch[2])) {
    return cleaned ? [cleaned] : [];
  }

  const prefix = onMatch[1];
  const parts = splitResearchListText(onMatch[2]);
  if (parts.length <= 1) return cleaned ? [cleaned] : [];
  return [cleanText(`${prefix}${parts[0]}`), ...parts.slice(1)];
}

function researchInterestsFromBioText(value: string | undefined): string[] {
  const text = cleanText(value);
  if (!text) return [];

  const values: string[] = [];
  const sentenceMatches = text.match(/[^.!?]*(?:research|work)[^.!?]*[.!?]/gi) || [];
  for (const sentence of sentenceMatches) {
    const focusedMatch = sentence.match(
      /\b(?:research(?:\s+program|\s+over\s+the\s+past\s+\d+\s+years)?\s+has\s+focused\s+on|research (?:focuses|focused) on|work (?:focuses|focused) on)\s+(.+?)(?:\.|$)/i,
    );
    if (!focusedMatch?.[1]) continue;

    const [primaryClause, includingClause = ''] = focusedMatch[1].split(/\bincluding\b/i);
    const primary = cleanText(primaryClause.replace(/^(?:the|a|an)\s+/i, '').replace(/[,\s]+$/, ''));
    values.push(...splitFocusedPrimaryResearchText(primary));
    values.push(...splitResearchListText(includingClause));
  }

  return uniqueStrings(values).slice(0, 8);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = cleanText(raw);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function pageUrlForIndex(baseUrl: string, pageIndex: number): string {
  if (pageIndex === 0) return baseUrl;
  try {
    const u = new URL(baseUrl);
    u.searchParams.set('page', String(pageIndex));
    return u.toString();
  } catch {
    return baseUrl;
  }
}

function sameOrSubdomain(hostname: string, rootHostname: string): boolean {
  return hostname === rootHostname || hostname.endsWith(`.${rootHostname}`);
}

function isOfficialYaleUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return sameOrSubdomain(hostname, 'yale.edu');
  } catch {
    return false;
  }
}

function normalizeOfficialYaleHttpsUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (sameOrSubdomain(parsed.hostname.toLowerCase(), 'yale.edu')) {
      parsed.protocol = 'https:';
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function isGenericYaleChromeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return hostname === 'yale.edu' && pathname === '/';
  } catch {
    return false;
  }
}

function isSameSiteHomepageUrl(url: string, siteUrl: string): boolean {
  try {
    const parsed = new URL(url);
    const site = new URL(siteUrl);
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.hostname.toLowerCase() === site.hostname.toLowerCase() && pathname === '/';
  } catch {
    return false;
  }
}

function isOfficialYaleProfilePageUrl(url: string): boolean {
  if (!isOfficialYaleUrl(url)) return false;
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    if (/\/lab\//i.test(pathname)) return false;
    if (
      parsed.hostname.toLowerCase() === 'som.yale.edu' &&
      /^\/[a-z0-9-]+\/?$/i.test(pathname)
    ) {
      return true;
    }
    return /\/(profile|people|person|faculty|directory|faculty-directory)(?:\/|$|-)/i.test(
      pathname,
    );
  } catch {
    return false;
  }
}

function normalizeUrlForDedupe(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    if (u.pathname !== '/') u.pathname = u.pathname.replace(/\/+$/, '');
    return u.toString();
  } catch {
    return url;
  }
}

function canonicalProfileUrlFromHtml($: cheerio.CheerioAPI, fallbackUrl: string): string {
  const canonicalHref =
    $('link[rel="canonical"]').first().attr('href') ||
    $('meta[property="og:url"]').first().attr('content') ||
    '';
  return normalizeOfficialYaleHttpsUrl(
    canonicalHref ? absolutize(canonicalHref, fallbackUrl) : fallbackUrl,
  );
}

function isPlaceholderProfileImageUrl(value: string): boolean {
  return /blank[-_]?profile[-_]?picture|placeholder[-_]?profile|no[-_]?image[-_]?available/i.test(
    value,
  );
}

function imageUrlFromElement($: cheerio.CheerioAPI, el: any, baseUrl: string): string {
  const node = $(el);
  const src =
    node.attr('src') ||
    node.attr('data-src') ||
    node.attr('data-lazy-src') ||
    node.attr('data-original') ||
    '';
  const srcset = node.attr('srcset') || node.attr('data-srcset') || '';
  const raw = src || srcset.split(',')[0]?.trim().split(/\s+/)[0] || '';
  if (!raw || /^data:/i.test(raw)) return '';

  const absolute = absolutize(raw, baseUrl);
  try {
    const parsed = new URL(absolute);
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    if (/\.(svg|gif)(?:$|\?)/i.test(parsed.pathname)) return '';
    if (isPlaceholderProfileImageUrl(parsed.pathname)) {
      return '';
    }
    return absolute;
  } catch {
    return '';
  }
}

function extractProfileImageUrlFromHtml(
  $: cheerio.CheerioAPI,
  profileUrl: string,
): string | undefined {
  const visibleProfileSelectors = [
    '[class*="headshot"] img',
    'img[class*="headshot"]',
    '[class*="profile"] img',
    '[class*="person"] img',
    '[class*="photo"] img',
    'img[class*="profile"]',
    'img[class*="person"]',
    'img[class*="photo"]',
  ];

  for (const selector of visibleProfileSelectors) {
    const image = $(selector)
      .toArray()
      .map((el) => imageUrlFromElement($, el, profileUrl))
      .find(Boolean);
    if (image) return image;
  }

  const metaImage =
    $('meta[property="og:image"]').first().attr('content') ||
    $('meta[name="twitter:image"]').first().attr('content') ||
    $('link[rel="image_src"]').first().attr('href') ||
    '';
  if (metaImage) {
    const absolute = absolutize(metaImage, profileUrl);
    try {
      const parsed = new URL(absolute);
      if (
        /^https?:$/i.test(parsed.protocol) &&
        !/\.(svg|gif)(?:$|\?)/i.test(parsed.pathname) &&
        !isPlaceholderProfileImageUrl(parsed.pathname)
      ) {
        return absolute;
      }
    } catch {
      // Continue to visible image selectors below.
    }
  }

  for (const selector of ['main img', 'article img']) {
    const image = $(selector)
      .toArray()
      .map((el) => imageUrlFromElement($, el, profileUrl))
      .find(Boolean);
    if (image) return image;
  }

  return undefined;
}

function scholarProfileUrlFromHref(href: string, baseUrl: string): string | undefined {
  if (!href) return undefined;
  const absolute = absolutize(href, baseUrl);
  try {
    const url = new URL(absolute);
    if (!url.hostname.toLowerCase().includes('scholar.google.')) return undefined;
    if (!url.pathname.includes('/citations')) return undefined;
    if (!url.searchParams.get('user')) return undefined;
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

function extractOrcidFromHtml($: cheerio.CheerioAPI): string | undefined {
  const candidates: string[] = [];
  $('a[href*="orcid.org"], a[href^="orcid:"]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text();
    candidates.push(href, text);
  });
  const labeledText = $('body').text();
  const labeledOrcidRe = /\bORCID\b[\s:#[\]().-]{0,24}(\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{3}[\dX])\b/gi;
  let match: RegExpExecArray | null;
  while ((match = labeledOrcidRe.exec(labeledText)) !== null) {
    candidates.push(match[1]);
  }

  for (const candidate of candidates) {
    const normalized = normalizeOrcid(candidate);
    if (normalized) return normalized;
  }
  return undefined;
}

function walkJsonObjects(value: unknown, visit: (node: Record<string, any>) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item) => walkJsonObjects(item, visit));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const node = value as Record<string, any>;
  visit(node);
  Object.values(node).forEach((child) => walkJsonObjects(child, visit));
}

function jsonLdProfilePerson($: cheerio.CheerioAPI): Record<string, any> | undefined {
  let person: Record<string, any> | undefined;
  $('script[type*="ld+json"], script[data-schema]').each((_i, el) => {
    if (person) return;
    const raw = $(el).html() || $(el).text() || '';
    if (!raw.trim()) return;
    try {
      const parsed = JSON.parse(raw.trim());
      walkJsonObjects(parsed, (node) => {
        if (person) return;
        const type = node['@type'];
        const types = Array.isArray(type) ? type : [type];
        if (types.some((value) => String(value || '').toLowerCase() === 'person')) {
          person = node;
        }
      });
    } catch {
      /* ignore malformed structured data */
    }
  });
  return person;
}

function stringFromJsonLdValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value.map((item) => cleanText(String(item || ''))).find(Boolean);
  }
  if (typeof value === 'string') return cleanText(value);
  return undefined;
}

function looksLikeProfileChromeOrContactBio(value: string): boolean {
  const text = cleanText(value);
  if (!text) return true;

  const hasExternalLinkChrome = /\b(?:link is external|link opens in new window)\b/i.test(text);
  const hasAddressSignal =
    /\b(?:ct\s*0\d{4}|prospect street|college street|kline tower)\b/i.test(
      text,
    ) ||
    /\broom\b.+\b(?:street|avenue|new haven)\b/i.test(text) ||
    /\d+\s+[A-Z][A-Za-z]+\s+(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Place|Pl\.?)/.test(text);
  const hasBioSignal =
    /\b(?:research|stud(?:y|ies|ied)|works?|focus(?:es|ed)?|professor|director|received|earned|ph\.?d|laboratory|lab|teaches|scholar)\b/i.test(
      text,
    );

  if (hasExternalLinkChrome && !hasBioSignal) return true;
  if (hasAddressSignal && !hasBioSignal) return true;
  return false;
}

function cleanExtractedProfileBio(value: string | undefined): string | undefined {
  const cleaned = cleanTextPreservingParagraphs(value)
    .replace(/([a-z0-9]\.)(?=[A-Z][a-z])/g, '$1 ')
    .replace(/\s*(?:Website|Web site):\s*\S+(?:\s+\S+)?\s*$/i, '')
    .replace(/^Bio:\s*/i, '')
    .trim();
  return cleaned || undefined;
}

function extractBioFromHtml($: cheerio.CheerioAPI): string | undefined {
  const labeledBio = textFromNamedField($, 'field-name-field-bio', {
    preserveParagraphs: true,
  });
  if (labeledBio && !looksLikeProfileChromeOrContactBio(labeledBio)) {
    return cleanExtractedProfileBio(labeledBio)?.slice(0, 2000);
  }

  const selectors = [
    '[class*="profile-body"]',
    '[class*="profile"][class*="body"]',
    '[class*="profile"] [class*="body"]',
    '[class*="person"] [class*="bio"]',
    '[class*="biography"]',
    '[class*="research"] [class*="summary"]',
    '[class*="field--name-body"]',
    '[class*="field-name-field-faculty-interests"]',
    '.text-field .text',
    'article [class*="body"]',
    'main p',
  ];

  const candidates: string[] = [];
  for (const selector of selectors) {
    const text =
      selector === '.text-field .text'
        ? cleanTextPreservingParagraphs($(selector).first().text())
        : cleanText($(selector).first().text());
    const textForChecks = cleanText(text);
    const wordCount = textForChecks.split(/\s+/).filter(Boolean).length;
    if (
      textForChecks.length >= 40 &&
      wordCount >= 8 &&
      !looksLikeProfileChromeOrContactBio(textForChecks)
    ) {
      candidates.push(text);
    }
  }
  const researchCandidate =
    candidates.find((text) => /\b(?:research|studies|work|program)\b/i.test(text)) ||
    candidates[0];
  return cleanExtractedProfileBio(researchCandidate)?.slice(0, 2000);
}

function extractResearchInterestsFromHtml($: cheerio.CheerioAPI): string[] {
  const values: string[] = [];
  values.push(...splitTopicText(textFromNamedField($, 'field-name-field-field-of-study')));
  values.push(...splitTopicText(textFromNamedField($, 'field-name-field-research-type')));
  values.push(...splitTopicText(textFromNamedField($, 'field-name-field-list-of-experiments')));

  const selectors = [
    '[class*="research-interest"]',
    '[class*="field-of-study"]',
    '[class*="field--name-field-research"]',
    '[class*="field--name-field-interests"]',
    '[class*="field-name-field-faculty-interests"]',
    '[class*="interests"]',
  ];

  for (const selector of selectors) {
    $(selector).each((_i, el) => {
      const text = cleanText($(el).text());
      values.push(...splitTopicText(text));
    });
  }

  $('h2,h3,h4,strong').each((_i, heading) => {
    const label = cleanText($(heading).text()).toLowerCase();
    if (!/\b(research interests?|fields? of study|topics?)\b/.test(label)) return;
    const next = $(heading).next();
    values.push(...splitTopicText(next.text()));
  });

  return uniqueStrings(values).slice(0, 20);
}

function profileBioWordCount(value: unknown): number {
  return cleanText(String(value || '')).split(/\s+/).filter(Boolean).length;
}

function richerProfileBio(
  entryBio: string | undefined,
  enrichmentBio: string | undefined,
): string | undefined {
  if (!enrichmentBio) return entryBio;
  if (!entryBio) return enrichmentBio;

  const entryWords = profileBioWordCount(entryBio);
  const enrichmentWords = profileBioWordCount(enrichmentBio);
  if (entryWords < 10 && enrichmentWords >= 25) return enrichmentBio;
  if (enrichmentWords >= entryWords + 25 && enrichmentWords >= entryWords * 1.5) {
    return enrichmentBio;
  }
  return entryBio;
}

function textFromNamedField(
  $: cheerio.CheerioAPI,
  className: string,
  options: { preserveParagraphs?: boolean } = {},
): string {
  const field = $(`.${className}`).first();
  if (field.length === 0) return '';
  const item = field.find('.field-items, .field-item').first();
  const source = item.length > 0 ? item : field.clone().find('.field-label').remove().end();
  if (options.preserveParagraphs) {
    const blocks: string[] = [];
    source.find('p, li').each((_i, el) => {
      const text = cleanText($(el).text());
      if (text) blocks.push(text);
    });
    if (blocks.length > 0) return blocks.join('\n\n');
  }
  const raw = source.text();
  return cleanText(raw);
}

function displaySourceFromUrl(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, '');
  } catch {
    return 'Official profile';
  }
}

function destinationKindFromPublicationUrl(
  value: string,
): 'DOI' | 'PUBLISHER' | 'PUBMED' | 'PMC' | 'ARXIV' | 'OTHER' {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    if (host === 'doi.org' || /\/doi\//i.test(parsed.pathname)) return 'DOI';
    if (host.includes('pubmed.ncbi.nlm.nih.gov')) return 'PUBMED';
    if (host.includes('ncbi.nlm.nih.gov') && /\/pmc\//i.test(parsed.pathname)) return 'PMC';
    if (host.includes('arxiv.org')) return 'ARXIV';
    return 'PUBLISHER';
  } catch {
    return 'OTHER';
  }
}

function normalizeDoi(value: unknown): string {
  return cleanText(String(value || ''))
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/[.,;:\])}]+$/g, '')
    .toLowerCase();
}

function extractDoiFromText(value: unknown): string {
  const text = cleanText(String(value || ''));
  const urlMatch = text.match(/https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/[^\s"'<>]+)/i);
  if (urlMatch?.[1]) return normalizeDoi(urlMatch[1]);
  const doiMatch = text.match(/\b10\.\d{4,9}\/[^\s"'<>]+/i);
  return doiMatch?.[0] ? normalizeDoi(doiMatch[0]) : '';
}

function cleanPublicationTitle(value: string): string {
  return cleanText(value)
    .replace(/^["“]|["”]$/g, '')
    .replace(
      /\s*,\s*(?:[A-Z][A-Za-z .&-]+ Collaboration|Nature|Phys\.?|Astropart\.?|Science|Proc\.?).*$/i,
      '',
    )
    .replace(/[,\s"“”]+$/g, '')
    .trim();
}

function publicationTitleKey(value: string): string {
  return cleanPublicationTitle(value)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”"]/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/g, '')
    .trim();
}

function buildPublicationLinkIndex(
  $: cheerio.CheerioAPI,
  profileUrl: string,
): Map<string, string> {
  const links = new Map<string, string>();
  $('a[href]').each((_i, a) => {
    const link = $(a);
    const href = link.attr('href') || '';
    if (!href || /^mailto:|^tel:|^#|^javascript:/i.test(href)) return;
    const text = cleanPublicationTitle(link.text());
    if (!text || text.length < 8) return;
    const url = absolutize(href, profileUrl);
    if (!/^https?:\/\//i.test(url)) return;
    const key = publicationTitleKey(text);
    if (key && !links.has(key)) links.set(key, url);
  });
  return links;
}

function commonPrefixLength(left: string, right: string): number {
  const max = Math.min(left.length, right.length);
  let index = 0;
  while (index < max && left[index] === right[index]) index++;
  return index;
}

function resolvePublicationLink(linkIndex: Map<string, string>, title: string): string {
  const key = publicationTitleKey(title);
  if (!key) return '';
  const exact = linkIndex.get(key);
  if (exact) return exact;

  for (const [candidateKey, url] of linkIndex.entries()) {
    const prefixLength = commonPrefixLength(key, candidateKey);
    if (prefixLength >= 32 && /\s$|:/.test(key[prefixLength - 1] || '')) {
      return url;
    }
  }
  return '';
}

function selectedPublicationTextItemsFromHeadings($: cheerio.CheerioAPI): string[] {
  const titles: string[] = [];
  $('h2,h3,h4,strong').each((_i, heading) => {
    const label = cleanText($(heading).text());
    if (!/^selected publications?:?$/i.test(label)) return;

    let next = $(heading).next();
    while (next.length > 0) {
      const tagName = String(next.prop('tagName') || '').toLowerCase();
      if (/^h[1-6]$/.test(tagName)) break;

      if (tagName === 'p' || tagName === 'li') {
        const title = cleanPublicationTitle(next.text());
        if (title && title.length >= 8) titles.push(title);
      } else {
        next.find('p,li').each((_j, child) => {
          const title = cleanPublicationTitle($(child).text());
          if (title && title.length >= 8) titles.push(title);
        });
      }

      next = next.next();
    }
  });
  return uniqueStrings(titles);
}

function extractSelectedPublicationLinksFromHtml(
  $: cheerio.CheerioAPI,
  profileUrl: string,
): Array<NonNullable<FacultyEntry['selectedPublicationLinks']>[number]> | undefined {
  const linkIndex = buildPublicationLinkIndex($, profileUrl);
  const fields = $('.field-name-field-selected-publications');
  const plainTitles = selectedPublicationTextItemsFromHeadings($);
  if (fields.length === 0 && plainTitles.length === 0) return undefined;

  const links: Array<NonNullable<FacultyEntry['selectedPublicationLinks']>[number]> = [];

  const addPublication = (titleText: string, href: string, itemText: string) => {
    const title = cleanPublicationTitle(titleText);
    if (!title || title.length < 8) return;
    const hrefUrl = href ? absolutize(href, profileUrl) : '';
    const matchedUrl = resolvePublicationLink(linkIndex, title);
    const doi = extractDoiFromText(hrefUrl) || extractDoiFromText(itemText);
    const url = doi ? `https://doi.org/${doi}` : hrefUrl || matchedUrl;
    if (!/^https?:\/\//i.test(url)) return;
    const yearMatch = itemText.match(/\b(19|20)\d{2}\b/);
    links.push({
      title,
      url,
      ...(doi ? { doi } : {}),
      destinationKind: doi ? 'DOI' : destinationKindFromPublicationUrl(url),
      displaySource: doi ? 'DOI' : displaySourceFromUrl(url),
      ...(yearMatch ? { year: Number(yearMatch[0]) } : {}),
    });
  };

  fields.find('li').each((_i, li) => {
    const item = $(li);
    const itemText = item.text();
    const href = item.find('a[href]').first().attr('href') || '';
    addPublication(
      itemText.split(/\s+(?:Nature|Phys\.|Astropart\.|Science|Proc\.)\b/i)[0] || itemText,
      href,
      itemText,
    );
  });

  plainTitles.forEach((title) => {
    addPublication(title, '', title);
  });

  if (links.length === 0) return undefined;
  return uniqueStrings(links.map((link) => link.url)).map(
    (url) => links.find((link) => link.url === url)!,
  );
}

async function fetchHtml(url: string, useCache: boolean, sourceName: string): Promise<string> {
  const cacheKey = `page:${url}`;
  if (useCache) {
    const cached = await getCached<string>(sourceName, cacheKey);
    if (cached) return cached;
  }
  const res = await axios.get(url, {
    timeout: FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT },
    maxRedirects: 5,
  });
  const html = res.data as string;
  if (useCache) await setCached(sourceName, cacheKey, html);
  return html;
}

async function fetchDeptData(
  dept: DeptConfig,
  useCache: boolean,
  sourceName: string,
): Promise<unknown | null> {
  if (!dept.dataUrl || !dept.dataExtractor) return null;
  const request = dept.dataRequest || {};
  const cacheKey = `data:${dept.dataUrl}:${JSON.stringify(request)}`;
  if (useCache) {
    const cached = await getCached<unknown>(sourceName, cacheKey);
    if (cached) return cached;
  }

  const body = new URLSearchParams(request);
  const res = await axios.post(dept.dataUrl, body, {
    timeout: FETCH_TIMEOUT_MS,
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    maxRedirects: 5,
  });
  const data = res.data;
  if (useCache) await setCached(sourceName, cacheKey, data);
  return data;
}

function classifyDiscoveredResearchWebsite(
  url: string,
  signal = '',
): 'lab' | 'personal' {
  const normalizedSignal = signal.toLowerCase();
  if (/\b(lab|laboratory|research group|group site)\b/i.test(normalizedSignal)) {
    return 'lab';
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (
      host.includes('lab') ||
      /\blab(oratory)?\b/i.test(host) ||
      /(?:^|[-.])lab(?:[-.]|$)/i.test(host) ||
      /\/(?:lab|labs|laboratory|research-group|group)(?:\/|$|-)/i.test(path)
    ) {
      return 'lab';
    }
    if (/\/(?:homes?|~[^/]+)(?:\/|$)/i.test(path)) {
      return 'personal';
    }
  } catch {
    if (/\blab(oratory)?\b/i.test(url)) return 'lab';
  }

  return 'personal';
}

export function profileEnrichmentFromHtml(
  html: string,
  profileUrl: string,
): Partial<Pick<
  FacultyEntry,
  | 'profileUrl'
  | 'email'
  | 'labUrl'
  | 'labUrlKind'
  | 'title'
  | 'orcid'
  | 'bio'
  | 'imageUrl'
  | 'researchInterests'
  | 'topics'
  | 'scholarCandidateProfileUrls'
  | 'selectedPublicationLinks'
  | 'profileSourceUrl'
>> {
  const $ = cheerio.load(html);
  const canonicalUrl = canonicalProfileUrlFromHtml($, profileUrl);
  const jsonLdPerson = jsonLdProfilePerson($);

  const metaEmail =
    $('meta[property="og:email"]').first().attr('content') ||
    $('meta[name="email"]').first().attr('content') ||
    '';
  const emailHref = $('main a[href^="mailto:"], body a[href^="mailto:"]').first().attr('href') || '';
  const email = emailHref ? emailHref.replace(/^mailto:/i, '').trim() : undefined;

  const title =
    $('[class*="professional-title"], [class*="person-title"], [class*="job-title"], [class*="position"]')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim() ||
    stringFromJsonLdValue(jsonLdPerson?.jobTitle) ||
    undefined;

  const labUrlCandidates: Array<{ url: string; kind: 'lab' | 'personal' }> = [];
  const scholarCandidateProfileUrls: string[] = [];
  const profileHost = (() => {
    try {
      return new URL(profileUrl).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();

  const linkScope = $('main').length > 0 ? $('main') : $('body');
  linkScope.find('a[href]').each((_i, el) => {
    const link = $(el);
    const href = link.attr('href') || '';
    if (!href || /^mailto:|^tel:|^#|^javascript:/i.test(href)) return;

    const absolute = absolutize(href, profileUrl);
    let parsed: URL;
    try {
      parsed = new URL(absolute);
    } catch {
      return;
    }
    if (!/^https?:$/i.test(parsed.protocol)) return;
    const scholarUrl = scholarProfileUrlFromHref(absolute, profileUrl);
    if (scholarUrl) {
      scholarCandidateProfileUrls.push(scholarUrl);
      return;
    }
    if (parsed.hostname.toLowerCase().includes('orcid.org')) return;
    if (normalizeUrlForDedupe(absolute) === normalizeUrlForDedupe(canonicalUrl)) return;
    if (isGenericYaleChromeUrl(absolute)) return;
    if (isSameSiteHomepageUrl(absolute, profileUrl)) return;

    const text = link.text().replace(/\s+/g, ' ').trim();
    const aria = link.attr('aria-label') || '';
    const titleAttr = link.attr('title') || '';
    const signal = `${text} ${aria} ${titleAttr} ${parsed.hostname} ${parsed.pathname}`;
    const hasWebsiteSignal =
      /\b(lab|laboratory|website|personal|homepage|research group|group site)\b/i.test(signal);
    if (!hasWebsiteSignal) return;

    const candidateHost = parsed.hostname.toLowerCase();
    const isProfileSite = profileHost && candidateHost === profileHost;
    const isDirectoryPath = /\/(people|person|profile|faculty|directory)\//i.test(parsed.pathname);
    if (isProfileSite && isDirectoryPath) return;

    const normalizedCandidate = normalizeOfficialYaleHttpsUrl(absolute);
    if (!isUsableResearchWebsiteUrl(normalizedCandidate)) return;

    labUrlCandidates.push({
      url: normalizedCandidate,
      kind: classifyDiscoveredResearchWebsite(normalizedCandidate, signal),
    });
  });

  const researchInterests = extractResearchInterestsFromHtml($);
  const domBio = extractBioFromHtml($);
  const jsonLdBio = stringFromJsonLdValue(jsonLdPerson?.description)?.slice(0, 2000);
  const selectedBio =
    jsonLdBio &&
    (!domBio ||
      jsonLdBio.length > domBio.length * 1.5 ||
      !/\b(?:research|studies|work|program|focused)\b/i.test(domBio))
      ? jsonLdBio
      : domBio || jsonLdBio;
  const bio = cleanExtractedProfileBio(selectedBio);
  const bioResearchInterests =
    researchInterests.length > 0 ? [] : researchInterestsFromBioText(bio);
  const profileResearchInterests =
    researchInterests.length > 0 ? researchInterests : bioResearchInterests;

  return {
    profileUrl: canonicalUrl,
    profileSourceUrl: canonicalUrl,
    email: cleanText(metaEmail) || email || stringFromJsonLdValue(jsonLdPerson?.email),
    title,
    labUrl: labUrlCandidates[0]?.url,
    labUrlKind: labUrlCandidates[0]?.kind,
    orcid: extractOrcidFromHtml($),
    bio,
    imageUrl: extractProfileImageUrlFromHtml($, canonicalUrl),
    researchInterests:
      profileResearchInterests.length > 0 ? profileResearchInterests : undefined,
    topics: profileResearchInterests.length > 0 ? profileResearchInterests : undefined,
    scholarCandidateProfileUrls:
      scholarCandidateProfileUrls.length > 0
        ? uniqueStrings(scholarCandidateProfileUrls)
        : undefined,
    selectedPublicationLinks: extractSelectedPublicationLinksFromHtml($, canonicalUrl),
  };
}

function mergeProfileEnrichment(
  entry: FacultyEntry,
  enrichment: Partial<Pick<
    FacultyEntry,
    | 'profileUrl'
    | 'email'
    | 'labUrl'
    | 'labUrlKind'
    | 'title'
    | 'orcid'
    | 'bio'
    | 'imageUrl'
    | 'researchInterests'
    | 'topics'
    | 'scholarCandidateProfileUrls'
    | 'profileSourceUrl'
  >>,
): FacultyEntry {
  return {
    ...entry,
    profileUrl: enrichment.profileUrl || entry.profileUrl,
    profileSourceUrl: enrichment.profileSourceUrl || entry.profileSourceUrl,
    title: entry.title || enrichment.title,
    email: entry.email || enrichment.email,
    labUrl: entry.labUrl || enrichment.labUrl,
    labUrlKind: entry.labUrlKind || enrichment.labUrlKind,
    orcid: entry.orcid || enrichment.orcid,
    bio: richerProfileBio(entry.bio, enrichment.bio),
    imageUrl:
      entry.imageUrl && !isPlaceholderProfileImageUrl(entry.imageUrl)
        ? entry.imageUrl
        : enrichment.imageUrl,
    researchInterests:
      uniqueStrings([...(entry.researchInterests || []), ...(enrichment.researchInterests || [])])
        .length > 0
        ? uniqueStrings([...(entry.researchInterests || []), ...(enrichment.researchInterests || [])])
        : undefined,
    topics:
      uniqueStrings([...(entry.topics || []), ...(enrichment.topics || [])]).length > 0
        ? uniqueStrings([...(entry.topics || []), ...(enrichment.topics || [])])
        : undefined,
    scholarCandidateProfileUrls:
      uniqueStrings([
        ...(entry.scholarCandidateProfileUrls || []),
        ...(enrichment.scholarCandidateProfileUrls || []),
      ]).length > 0
        ? uniqueStrings([
            ...(entry.scholarCandidateProfileUrls || []),
            ...(enrichment.scholarCandidateProfileUrls || []),
          ])
        : undefined,
  };
}

async function enrichEntryFromOfficialProfile(
  entry: FacultyEntry,
  sourceName: string,
  useCache: boolean,
  htmlFetcher: HtmlFetcher,
  log: ScraperContext['log'],
): Promise<FacultyEntry> {
  if (!entry.profileUrl || !isOfficialYaleUrl(entry.profileUrl)) return entry;

  try {
    const html = await htmlFetcher(entry.profileUrl, useCache, sourceName);
    const enrichment = profileEnrichmentFromHtml(html, entry.profileUrl);
    const merged = mergeProfileEnrichment(entry, enrichment);
    const linkedProfileUrl = enrichment.labUrl || '';
    if (
      linkedProfileUrl &&
      isOfficialYaleProfilePageUrl(linkedProfileUrl) &&
      normalizeUrlForDedupe(linkedProfileUrl) !== normalizeUrlForDedupe(entry.profileUrl) &&
      (!merged.bio || !merged.imageUrl)
    ) {
      try {
        const linkedHtml = await htmlFetcher(linkedProfileUrl, useCache, sourceName);
        const linkedEnrichment = profileEnrichmentFromHtml(linkedHtml, linkedProfileUrl);
        const canonicalLinkedProfileUrl = linkedEnrichment.profileUrl || linkedProfileUrl;
        return mergeProfileEnrichment({
          ...merged,
          labUrl: canonicalLinkedProfileUrl,
        }, {
          ...linkedEnrichment,
          profileUrl: undefined,
          labUrl: undefined,
        });
      } catch (err: any) {
        log(
          `[profile] linked profile fetch failed for ${linkedProfileUrl}: ${err?.message || err}`,
        );
      }
    }
    return merged;
  } catch (err: any) {
    log(`[profile] fetch failed for ${entry.profileUrl}: ${err?.message || err}`);
    return entry;
  }
}

function userEntityKeyForEntry(entry: FacultyEntry, dept: DeptConfig): string {
  const cleaned = normalizeName(entry.name);
  const netid = netidFromEmail(entry.email);
  const slug = slugify(cleaned);
  return netid ? `netid:${netid}` : `dept:${dept.deptKey}:${slug || 'unknown'}`;
}

function departmentsForEntry(entry: FacultyEntry, dept: DeptConfig): string[] {
  return entry.departments && entry.departments.length > 0 ? entry.departments : [dept.deptName];
}

function entryToUserObservations(
  entry: FacultyEntry,
  dept: DeptConfig,
  sourceUrl: string,
): { observations: ObservationInput[]; entityKey: string } {
  const cleaned = normalizeName(entry.name);
  const { first, last } = splitName(cleaned);
  const netid = netidFromEmail(entry.email);
  const entityKey = userEntityKeyForEntry(entry, dept);

  const rosterBase = { entityType: 'user' as const, entityKey, sourceUrl };
  const profileBase = {
    entityType: 'user' as const,
    entityKey,
    sourceUrl: entry.profileSourceUrl || entry.profileUrl || sourceUrl,
  };
  const role = classifyResearchPersonRole(entry.title);
  const userType =
    role.category === 'pi' ? 'faculty' : role.category === 'unknown' ? 'unknown' : 'staff';
  const researchInterests = sanitizeProfileResearchTerms(entry.researchInterests || []);
  const topics = sanitizeProfileResearchTerms(entry.topics || []);
  const departments = departmentsForEntry(entry, dept);
  const primaryDepartment = departments[0] || dept.deptName;
  const obs: ObservationInput[] = [];

  if (netid) obs.push({ ...rosterBase, field: 'netid', value: netid });
  if (first) obs.push({ ...rosterBase, field: 'fname', value: first });
  if (last) obs.push({ ...rosterBase, field: 'lname', value: last });
  obs.push({ ...rosterBase, field: 'userType', value: userType });
  obs.push({ ...rosterBase, field: 'primaryDepartment', value: primaryDepartment });
  obs.push({ ...rosterBase, field: 'departments', value: departments });
  if (entry.email) obs.push({ ...profileBase, field: 'email', value: entry.email });
  if (entry.title) obs.push({ ...profileBase, field: 'title', value: entry.title });
  if (entry.profileUrl) {
    obs.push({ ...profileBase, field: 'profileUrls', value: { departmental: entry.profileUrl } });
  }
  if (entry.labUrl) obs.push({ ...profileBase, field: 'website', value: entry.labUrl });
  if (entry.imageUrl) obs.push({ ...profileBase, field: 'imageUrl', value: entry.imageUrl });
  if (entry.orcid) obs.push({ ...profileBase, field: 'orcid', value: entry.orcid });
  if (entry.bio) obs.push({ ...profileBase, field: 'bio', value: entry.bio });
  if (researchInterests.length > 0) {
    obs.push({ ...profileBase, field: 'researchInterests', value: researchInterests });
  }
  if (topics.length > 0) {
    obs.push({ ...profileBase, field: 'topics', value: topics });
  }
  if (entry.scholarCandidateProfileUrls && entry.scholarCandidateProfileUrls.length > 0) {
    obs.push({
      ...profileBase,
      field: 'scholarCandidateProfileUrls',
      value: entry.scholarCandidateProfileUrls,
    });
  }
  obs.push({ ...rosterBase, field: 'dataSources', value: ['dept-faculty-roster'] });

  return { observations: obs, entityKey };
}

function entryToLabObservations(
  entry: FacultyEntry,
  dept: DeptConfig,
  sourceUrl: string,
  ownerEntityKey: string,
): ObservationInput[] {
  const role = classifyResearchPersonRole(entry.title);
  if (!canOwnResearchEntity(role)) return [];
  if (!entry.labUrl) return [];
  const cleanedName = normalizeName(entry.name);
  const nameSlug = slugify(cleanedName) || slugify(entry.labUrl);
  const slug = `dept-${dept.deptKey}-${nameSlug}`.slice(0, 100);
  const websiteKind = entry.labUrlKind || classifyDiscoveredResearchWebsite(entry.labUrl);
  const entityKind = websiteKind === 'lab' ? 'lab' : 'individual';
  const entityType = entityKind === 'lab' ? 'LAB' : 'INDIVIDUAL_RESEARCH';
  const entityName =
    entityKind === 'lab'
      ? cleanedName
        ? `${cleanedName} Lab`
        : entry.labUrl
      : cleanedName
        ? `${cleanedName} — Research`
        : entry.labUrl;
  const base = { entityType: 'researchEntity' as const, entityKey: slug, sourceUrl };
  const profileSourceUrl = entry.profileSourceUrl || entry.profileUrl || sourceUrl;
  const profileBase = { entityType: 'researchEntity' as const, entityKey: slug, sourceUrl: profileSourceUrl };
  const researchInterests = sanitizeProfileResearchTerms(entry.researchInterests || []);
  const topics = sanitizeProfileResearchTerms(entry.topics || []);
  const researchAreas = uniqueStrings([...researchInterests, ...topics]);
  const sourceUrls = uniqueStrings([sourceUrl, entry.profileUrl, entry.labUrl]);
  const departments = departmentsForEntry(entry, dept);

  const observations: ObservationInput[] = [
    { ...base, field: 'slug', value: slug },
    { ...base, field: 'name', value: entityName },
    { ...base, field: 'kind', value: entityKind },
    { ...base, field: 'entityType', value: entityType },
    { ...base, field: 'school', value: dept.schoolName },
    { ...base, field: 'departments', value: departments },
    { ...base, field: 'websiteUrl', value: entry.labUrl },
    { ...base, field: 'sourceUrls', value: sourceUrls },
    {
      ...base,
      field: 'inferredPiUserKey',
      value: ownerEntityKey,
      confidenceOverride: 0.7,
    },
  ];

  if (researchAreas.length > 0) {
    observations.push({ ...profileBase, field: 'researchAreas', value: researchAreas });
  }

  return observations;
}

function entryToMemberObservations(
  entry: FacultyEntry,
  dept: DeptConfig,
  sourceUrl: string,
  memberEntityKey: string,
  ownerLabEntityKey: string,
): ObservationInput[] {
  void dept;
  const role = classifyResearchPersonRole(entry.title);
  if (!role.memberRole || role.category === 'pi') return [];

  const entityKey = `${ownerLabEntityKey}:${memberEntityKey}`.slice(0, 160);
  const base = { entityType: 'researchGroupMember' as const, entityKey, sourceUrl };
  const cleaned = normalizeName(entry.name);
  const obs: ObservationInput[] = [
    { ...base, field: 'researchEntityKey', value: ownerLabEntityKey },
    { ...base, field: 'userEntityKey', value: memberEntityKey },
    { ...base, field: 'name', value: cleaned },
    { ...base, field: 'role', value: role.memberRole },
    { ...base, field: 'isCurrentMember', value: true },
  ];
  if (entry.email) obs.push({ ...base, field: 'email', value: entry.email });
  if (entry.title) obs.push({ ...base, field: 'title', value: entry.title });
  return obs;
}

function serializedObservationValue(value: unknown): string {
  if (value === null || value === undefined) return '__null__';
  if (typeof value === 'string') return `s:${value.trim().toLowerCase()}`;
  if (typeof value === 'number' || typeof value === 'boolean') return `p:${String(value)}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function nextDepartmentalProfileUrlKey(profileUrls: Record<string, string>): string {
  if (!profileUrls.departmental) return 'departmental';
  let index = 2;
  while (profileUrls[`departmental${index}`]) index++;
  return `departmental${index}`;
}

function addDepartmentalProfileUrl(
  profileUrls: Record<string, string>,
  preferredKey: string,
  rawUrl: unknown,
): void {
  const url = cleanText(rawUrl === undefined || rawUrl === null ? '' : String(rawUrl));
  if (!url) return;
  if (Object.values(profileUrls).some((existing) => normalizeUrlForDedupe(existing) === normalizeUrlForDedupe(url))) {
    return;
  }
  if (!profileUrls[preferredKey]) {
    profileUrls[preferredKey] = url;
    return;
  }
  profileUrls[nextDepartmentalProfileUrlKey(profileUrls)] = url;
}

function mergedUserArrayValue(values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      const cleaned = cleanText(item === undefined || item === null ? '' : String(item));
      if (!cleaned) continue;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cleaned);
    }
  }
  return out;
}

function chooseDepartmentRosterScalarObservation(observations: ObservationInput[]): ObservationInput[] {
  const distinct = new Map<string, ObservationInput>();
  for (const observation of observations) {
    distinct.set(serializedObservationValue(observation.value), observation);
  }
  if (distinct.size <= 1) return observations.slice(0, 1);

  const field = observations[0]?.field;
  if (field === 'primaryDepartment') return observations.slice(0, 1);
  if (field === 'title' || field === 'bio') {
    return [
      observations.reduce((best, next) =>
        cleanText(String(next.value || '')).length > cleanText(String(best.value || '')).length
          ? next
          : best,
      ),
    ];
  }
  if (field === 'imageUrl') {
    return [
      observations.find((observation) => !isPlaceholderProfileImageUrl(String(observation.value || ''))) ||
        observations[0],
    ];
  }

  return observations;
}

export function mergeDepartmentRosterUserObservations(observations: ObservationInput[]): ObservationInput[] {
  const byUserField = new Map<string, ObservationInput[]>();
  for (const observation of observations) {
    if (observation.entityType !== 'user' || !observation.entityKey) continue;
    const key = `${observation.entityKey}:${observation.field}`;
    const existing = byUserField.get(key) || [];
    existing.push(observation);
    byUserField.set(key, existing);
  }

  const out: ObservationInput[] = [];
  for (const fieldObservations of byUserField.values()) {
    const first = fieldObservations[0];
    if (!first) continue;

    if (['departments', 'secondaryDepartments', 'researchInterests', 'topics', 'dataSources'].includes(first.field)) {
      out.push({ ...first, value: mergedUserArrayValue(fieldObservations.map((observation) => observation.value)) });
      continue;
    }

    if (first.field === 'profileUrls') {
      const profileUrls: Record<string, string> = {};
      for (const observation of fieldObservations) {
        if (!observation.value || typeof observation.value !== 'object' || Array.isArray(observation.value)) {
          continue;
        }
        for (const [key, url] of Object.entries(observation.value as Record<string, unknown>)) {
          addDepartmentalProfileUrl(profileUrls, key, url);
        }
      }
      if (Object.keys(profileUrls).length > 0) out.push({ ...first, value: profileUrls });
      continue;
    }

    out.push(...chooseDepartmentRosterScalarObservation(fieldObservations));
  }

  return out;
}

// ---------------------------------------------------------------------------
// Scraper
// ---------------------------------------------------------------------------

export class DepartmentRosterScraper implements IScraper {
  readonly name = 'dept-faculty-roster';
  readonly displayName = 'Department faculty rosters and official profile enrichment';

  /** Configs are injectable for testing; default to the v1 four-department set. */
  constructor(
    private readonly configs: DeptConfig[] = DEFAULT_DEPT_CONFIGS,
    private readonly renderedFetcher: RenderedFetcher | null = createScraplingRenderedFetcher(),
    private readonly htmlFetcher: HtmlFetcher = fetchHtml,
  ) {}

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const onlyFilter = ctx.options.only && ctx.options.only.length > 0
      ? new Set(ctx.options.only.map((s) => s.trim().toLowerCase()))
      : null;
    const limit = ctx.options.limit && ctx.options.limit > 0 ? ctx.options.limit : Infinity;
    const offset =
      ctx.options.offset && Number.isFinite(ctx.options.offset) && ctx.options.offset > 0
        ? Math.floor(ctx.options.offset)
        : 0;

    let totalObs = 0;
    let totalFaculty = 0;
    let skippedFaculty = 0;
    let totalLabs = 0;
    const perDept: Array<{ deptKey: string; count: number; status: string }> = [];
    const fetchAttempts: ScraperFetchMetric[] = [];
    const userObservations: ObservationInput[] = [];
    const seenUserKeys = new Set<string>();
    const seenLabKeys = new Set<string>();
    const processEntries = async (
      entries: FacultyEntry[],
      dept: DeptConfig,
      sourceUrl: string,
    ): Promise<{ faculty: number; labs: number; observations: number }> => {
      let faculty = 0;
      let labs = 0;
      let observations = 0;
      const enrichedEntries: FacultyEntry[] = [];
      const rawUserKeysInBatch = new Set<string>();
      const enrichedUserKeysInBatch = new Set<string>();

      for (const rawEntry of entries) {
        if (totalFaculty + enrichedUserKeysInBatch.size >= limit) break;
        const rawEntityKey = userEntityKeyForEntry(rawEntry, dept);
        const rawDedupeKey = `${dept.deptKey}:${rawEntityKey}`;
        if (seenUserKeys.has(rawDedupeKey) || rawUserKeysInBatch.has(rawDedupeKey)) continue;
        rawUserKeysInBatch.add(rawDedupeKey);
        if (skippedFaculty < offset) {
          skippedFaculty++;
          continue;
        }
        const enrichedEntry = await enrichEntryFromOfficialProfile(
          rawEntry,
          this.name,
          ctx.options.useCache,
          this.htmlFetcher,
          ctx.log,
        );
        const enrichedDedupeKey = `${dept.deptKey}:${userEntityKeyForEntry(enrichedEntry, dept)}`;
        if (seenUserKeys.has(enrichedDedupeKey) || enrichedUserKeysInBatch.has(enrichedDedupeKey)) {
          continue;
        }
        enrichedUserKeysInBatch.add(enrichedDedupeKey);
        enrichedEntries.push(enrichedEntry);
      }

      const labOwnerByUrl = new Map<string, string>();
      for (const entry of enrichedEntries) {
        const role = classifyResearchPersonRole(entry.title);
        if (!entry.labUrl || !canOwnResearchEntity(role)) continue;
        const cleanedName = normalizeName(entry.name);
        const nameSlug = slugify(cleanedName) || slugify(entry.labUrl);
        labOwnerByUrl.set(
          normalizeUrlForDedupe(entry.labUrl),
          `dept-${dept.deptKey}-${nameSlug}`.slice(0, 100),
        );
      }

      for (const entry of enrichedEntries) {
        if (totalFaculty >= limit) break;
        const { observations: userObs, entityKey } = entryToUserObservations(
          entry,
          dept,
          sourceUrl,
        );
        const userDedupeKey = `${dept.deptKey}:${entityKey}`;
        if (seenUserKeys.has(userDedupeKey)) continue;
        seenUserKeys.add(userDedupeKey);
        userObservations.push(...userObs);

        const labObs = entryToLabObservations(entry, dept, sourceUrl, entityKey);
        const labKey = labObs[0]?.entityKey;
        if (labObs.length > 0 && labKey && !seenLabKeys.has(labKey)) {
          seenLabKeys.add(labKey);
          await ctx.emit(labObs);
          observations += labObs.length;
          labs++;
        }
        const attachedLabKey = entry.labUrl
          ? labOwnerByUrl.get(normalizeUrlForDedupe(entry.labUrl))
          : undefined;
        if (attachedLabKey) {
          const memberObs = entryToMemberObservations(
            entry,
            dept,
            sourceUrl,
            entityKey,
            attachedLabKey,
          );
          if (memberObs.length > 0) {
            await ctx.emit(memberObs);
            observations += memberObs.length;
          }
        }
        faculty++;
        totalFaculty++;
      }

      return { faculty, labs, observations };
    };

    for (const dept of this.configs) {
      if (onlyFilter && !onlyFilter.has(dept.deptKey.toLowerCase())) continue;
      if (totalFaculty >= limit) break;

      if (dept.jsRenderedSkip && dept.dataUrl && dept.dataExtractor) {
        try {
          const payload = await fetchDeptData(dept, ctx.options.useCache, this.name);
          const entries = dept.dataExtractor(payload, { pageUrl: dept.dataUrl });
          if (entries.length > 0) {
            const processed = await processEntries(entries, dept, dept.dataUrl);
            totalObs += processed.observations;
            totalLabs += processed.labs;
            ctx.log(`[${dept.deptKey}] ${processed.faculty} faculty from data endpoint`);
            perDept.push({ deptKey: dept.deptKey, count: processed.faculty, status: 'ok' });
            continue;
          }
          ctx.log(`[${dept.deptKey}] data endpoint returned no faculty; trying rendered page`);
        } catch (err: any) {
          ctx.log(`[${dept.deptKey}] data endpoint failed: ${err?.message || err}`);
        }
      }

      if (dept.jsRenderedSkip && !this.renderedFetcher) {
        ctx.log(`[${dept.deptKey}] skipped — JS-rendered, needs headless browser`);
        perDept.push({ deptKey: dept.deptKey, count: 0, status: 'js-rendered-skip' });
        continue;
      }

      let deptCount = 0;
      const maxPages = dept.paginated ? MAX_PAGES_PER_DEPT : 1;
      let pagesFetched = 0;
      let lastPageHadEntries = true;

      if (dept.jsRenderedSkip && this.renderedFetcher) {
        if (totalFaculty >= limit) break;

        const rendered = await measureRenderedFetch(
          dept.url,
          'scrapling',
          () => fetchRenderedDeptPage(this.name, ctx.options.useCache, dept, this.renderedFetcher),
          { selectorName: dept.renderWaitSelector },
        );
        fetchAttempts.push(rendered.metric);
        pagesFetched++;

        if (!rendered.result || !rendered.result.html) {
          ctx.log(`[${dept.deptKey}] skipped — rendered page unavailable`);
          perDept.push({ deptKey: dept.deptKey, count: 0, status: 'rendered-unavailable' });
          continue;
        }

        let entries: FacultyEntry[];
        const pageUrl = rendered.result.url || dept.url;
        try {
          entries = (dept.renderedExtractor || dept.extractor)(rendered.result.html, { pageUrl });
        } catch (err: any) {
          ctx.log(`[${dept.deptKey}] rendered extractor error on ${pageUrl}: ${err?.message || err}`);
          perDept.push({ deptKey: dept.deptKey, count: 0, status: 'rendered-extractor-error' });
          continue;
        }

        const processed = await processEntries(entries, dept, pageUrl);
        totalObs += processed.observations;
        totalLabs += processed.labs;
        deptCount += processed.faculty;

        ctx.log(`[${dept.deptKey}] ${deptCount} faculty across ${pagesFetched} rendered page(s)`);
        perDept.push({ deptKey: dept.deptKey, count: deptCount, status: 'ok' });
        continue;
      }

      for (let pageIdx = 0; pageIdx < maxPages && lastPageHadEntries; pageIdx++) {
        if (totalFaculty >= limit) break;
        const pageUrl = pageUrlForIndex(dept.url, pageIdx);
        let html: string;
        try {
          html = await this.htmlFetcher(pageUrl, ctx.options.useCache, this.name);
        } catch (err: any) {
          ctx.log(`[${dept.deptKey}] fetch failed for ${pageUrl}: ${err?.message || err}`);
          break;
        }
        pagesFetched++;
        let entries: FacultyEntry[];
        try {
          entries = dept.extractor(html, { pageUrl });
        } catch (err: any) {
          ctx.log(`[${dept.deptKey}] extractor error on ${pageUrl}: ${err?.message || err}`);
          break;
        }
        if (entries.length === 0) {
          lastPageHadEntries = false;
          break;
        }

        const processed = await processEntries(entries, dept, pageUrl);
        totalObs += processed.observations;
        totalLabs += processed.labs;
        deptCount += processed.faculty;

        // Drupal pagination returns the same first page when `?page=N` is past
        // the end (some sites) — stop early when a page yields fewer entries
        // than the previous one and we've already crawled at least 2 pages.
        if (!dept.paginated) break;
      }

      ctx.log(`[${dept.deptKey}] ${deptCount} faculty across ${pagesFetched} page(s)`);
      perDept.push({ deptKey: dept.deptKey, count: deptCount, status: 'ok' });
    }

    const mergedUserObservations = mergeDepartmentRosterUserObservations(userObservations);
    if (mergedUserObservations.length > 0) {
      await ctx.emit(mergedUserObservations);
      totalObs += mergedUserObservations.length;
    }

    const summary = perDept
      .map((d) => `${d.deptKey}=${d.status === 'ok' ? d.count : d.status}`)
      .join(', ');
    ctx.log(
      `Emitted ${totalObs} observations across ${totalFaculty} faculty / ${totalLabs} labs (${summary})`,
    );

    return {
      observationCount: totalObs,
      entitiesObserved:
        new Set(mergedUserObservations.map((observation) => String(observation.entityKey))).size +
        totalLabs,
      notes: `Departments: ${summary}`,
      fetchMetrics: summarizeFetchMetrics(fetchAttempts),
    };
  }
}

async function fetchRenderedDeptPage(
  sourceName: string,
  useCache: boolean,
  dept: DeptConfig,
  renderedFetcher: RenderedFetcher | null,
): Promise<RenderedFetchResult | null> {
  if (!renderedFetcher) return null;
  const cacheKey = `rendered-page:v1:${dept.url}`;
  if (useCache) {
    const cached = await getCached<RenderedFetchResult>(sourceName, cacheKey);
    if (cached) return cached;
  }
  const result = await renderedFetcher({
    url: dept.url,
    waitSelector: dept.renderWaitSelector,
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  if (useCache && result?.html) await setCached(sourceName, cacheKey, result);
  return result;
}
