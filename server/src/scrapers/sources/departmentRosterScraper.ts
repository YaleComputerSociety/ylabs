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
 *   - For each lab/personal website discovered: a ResearchGroup observation
 *     keyed by `dept-<deptKey>-<slug>`.
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
import { netidFromEmail, normalizeName, slugify, splitName } from '../utils/scraperHelpers';

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
  /** ORCID extracted from an official Yale profile page. */
  orcid?: string;
  /** Short bio or research summary extracted from an official Yale profile page. */
  bio?: string;
  /** Research interests extracted from official profile or roster topic fields. */
  researchInterests?: string[];
  /** Search/topic labels extracted from official profile or roster topic fields. */
  topics?: string[];
  /** Review-only Google Scholar profile URLs; never materialized as accepted Scholar IDs. */
  scholarCandidateProfileUrls?: string[];
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
      const absolute = safeHttpUrl(href, ctx.pageUrl);
      if (!absolute) return;
      if (profileHref && href === profileHref) return;
      if (profileUrl && normalizeUrlForDedupe(absolute) === normalizeUrlForDedupe(profileUrl)) {
        return;
      }
      const text = link.text().replace(/\s+/g, ' ').trim();
      const signal = `${text} ${link.attr('aria-label') || ''} ${link.attr('title') || ''} ${href}`;
      if (!/\b(website|lab|laboratory|homepage|research group)\b/i.test(signal) && !/^https?:\/\//i.test(href)) {
        return;
      }
      labUrl = absolute;
    });

    const topicCells = row.find(
      '.views-field-field-field-of-study, [class*="field-of-study"], .views-field-field-term-reference',
    );
    const topics = splitTopicText(
      topicCells
        .toArray()
        .map((cell) => topicTextFromRosterCell($(cell)))
        .join('; '),
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

export const csFacultyDataExtractor: FacultyDataExtractor = (payload, ctx) => {
  if (!isRecord(payload) || !isRecord(payload.pages)) return [];

  const out: FacultyEntry[] = [];
  const seen = new Set<string>();
  for (const page of Object.values(payload.pages)) {
    if (!isRecord(page) || !Array.isArray(page.facultyMembers)) continue;
    for (const member of page.facultyMembers) {
      if (!isRecord(member)) continue;
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

function safeHttpUrl(href: string | undefined, base: string): string | undefined {
  const raw = String(href || '').trim();
  if (!raw || /^mailto:|^tel:|^#|^javascript:/i.test(raw)) return undefined;
  if (/[<>]/.test(raw)) return undefined;

  try {
    const url = new URL(raw, base);
    if (!/^https?:$/i.test(url.protocol)) return undefined;
    const decoded = decodeURIComponent(url.toString());
    if (/[<>]/.test(decoded)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function cleanText(value: string | undefined | null): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanTopicValue(value: string): string {
  return cleanText(value)
    .replace(/^(research\s+(areas?|interests?)|fields?\s+of\s+study|topics?)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitTopicText(value: string | undefined | null): string[] {
  const cleaned = String(value || '').trim();
  if (!cleaned) return [];
  const parts = cleaned
    .split(/[,;|•\n\r]+/)
    .map((part) => cleanTopicValue(part))
    .filter((part) => {
      if (part.length <= 1 || /^[-–—]+$/.test(part)) return false;
      if (/^(research\s+(areas?|interests?)|fields?\s+of\s+study|topics?)$/i.test(part)) return false;
      if (/[a-z][A-Z]/.test(part) && !/\s/.test(part)) return false;
      return true;
    });
  return uniqueStrings(parts);
}

function topicTextFromRosterCell(cell: cheerio.Cheerio<any>): string {
  const clone = cell.clone();
  clone.find('em, small, script, style').remove();
  return clone.text();
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
  return canonicalHref ? absolutize(canonicalHref, fallbackUrl) : fallbackUrl;
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
  const bodyText = $('body').text();
  const matches = bodyText.match(/\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{3}[\dX]\b/gi) || [];
  candidates.push(...matches);

  for (const candidate of candidates) {
    const normalized = normalizeOrcid(candidate);
    if (normalized) return normalized;
  }
  return undefined;
}

function extractBioFromHtml($: cheerio.CheerioAPI): string | undefined {
  const selectors = [
    '[class*="profile-body"]',
    '[class*="profile"][class*="body"]',
    '[class*="profile"] [class*="body"]',
    '[class*="person"] [class*="bio"]',
    '[class*="biography"]',
    '[class*="research"] [class*="summary"]',
    '[class*="field--name-body"]',
    'article [class*="body"]',
    'main p',
  ];

  for (const selector of selectors) {
    const text = cleanText($(selector).first().text());
    if (text.length >= 40) return text.slice(0, 2000);
  }
  return undefined;
}

function extractResearchInterestsFromHtml($: cheerio.CheerioAPI): string[] {
  const values: string[] = [];
  $(
    [
      '.field-name-field-field-of-study .field-items .field-item',
      '.field--name-field-research .field__item',
      '.field--name-field-interests .field__item',
    ].join(', '),
  ).each((_i, el) => {
    values.push(...splitTopicText($(el).text()));
  });

  const selectors = [
    '[class*="research-interest"]',
    '[class*="field-of-study"]',
    '[class*="field--name-field-research"]',
    '[class*="field--name-field-interests"]',
    '[class*="interests"]',
  ];

  for (const selector of selectors) {
    $(selector).each((_i, el) => {
      if ($(el).find('.field-item, .field__item').length > 0) return;
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

function profileEnrichmentFromHtml(
  html: string,
  profileUrl: string,
): Partial<Pick<
  FacultyEntry,
  | 'profileUrl'
  | 'email'
  | 'labUrl'
  | 'title'
  | 'orcid'
  | 'bio'
  | 'researchInterests'
  | 'topics'
  | 'scholarCandidateProfileUrls'
  | 'profileSourceUrl'
>> {
  const $ = cheerio.load(html);
  const canonicalUrl = canonicalProfileUrlFromHtml($, profileUrl);

  const emailHref = $('a[href^="mailto:"]').first().attr('href') || '';
  const email = emailHref ? emailHref.replace(/^mailto:/i, '').trim() : undefined;

  const title =
    $('[class*="professional-title"], [class*="person-title"], [class*="job-title"], [class*="position"]')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim() || undefined;

  let labUrl: string | undefined;
  const scholarCandidateProfileUrls: string[] = [];
  const profileHost = (() => {
    try {
      return new URL(profileUrl).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();

  $('a[href]').each((_i, el) => {
    const link = $(el);
    const href = link.attr('href') || '';
    if (!href || /^mailto:|^tel:|^#|^javascript:/i.test(href)) return;

    const absolute = safeHttpUrl(href, profileUrl);
    if (!absolute) return;
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
    if (labUrl) return;
    if (normalizeUrlForDedupe(absolute) === normalizeUrlForDedupe(canonicalUrl)) return;

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

    labUrl = absolute;
  });

  const researchInterests = extractResearchInterestsFromHtml($);
  const bio = extractBioFromHtml($);

  return {
    profileUrl: canonicalUrl,
    profileSourceUrl: canonicalUrl,
    email,
    title,
    labUrl,
    orcid: extractOrcidFromHtml($),
    bio,
    researchInterests: researchInterests.length > 0 ? researchInterests : undefined,
    topics: researchInterests.length > 0 ? researchInterests : undefined,
    scholarCandidateProfileUrls:
      scholarCandidateProfileUrls.length > 0
        ? uniqueStrings(scholarCandidateProfileUrls)
        : undefined,
  };
}

function mergeProfileEnrichment(
  entry: FacultyEntry,
  enrichment: Partial<Pick<
    FacultyEntry,
    | 'profileUrl'
    | 'email'
    | 'labUrl'
    | 'title'
    | 'orcid'
    | 'bio'
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
    orcid: entry.orcid || enrichment.orcid,
    bio: entry.bio || enrichment.bio,
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
    return mergeProfileEnrichment(entry, enrichment);
  } catch (err: any) {
    log(`[profile] fetch failed for ${entry.profileUrl}: ${err?.message || err}`);
    return entry;
  }
}

function entryToUserObservations(
  entry: FacultyEntry,
  dept: DeptConfig,
  sourceUrl: string,
): { observations: ObservationInput[]; entityKey: string } {
  const cleaned = normalizeName(entry.name);
  const { first, last } = splitName(cleaned);
  const netid = netidFromEmail(entry.email);
  const slug = slugify(cleaned);
  const entityKey = netid ? `netid:${netid}` : `dept:${dept.deptKey}:${slug || 'unknown'}`;

  const rosterBase = { entityType: 'user' as const, entityKey, sourceUrl };
  const profileBase = {
    entityType: 'user' as const,
    entityKey,
    sourceUrl: entry.profileSourceUrl || entry.profileUrl || sourceUrl,
  };
  const obs: ObservationInput[] = [];

  if (netid) obs.push({ ...rosterBase, field: 'netid', value: netid });
  if (first) obs.push({ ...rosterBase, field: 'fname', value: first });
  if (last) obs.push({ ...rosterBase, field: 'lname', value: last });
  obs.push({ ...rosterBase, field: 'userType', value: 'faculty' });
  obs.push({ ...rosterBase, field: 'primaryDepartment', value: dept.deptName });
  obs.push({ ...rosterBase, field: 'departments', value: [dept.deptName] });
  if (entry.email) obs.push({ ...profileBase, field: 'email', value: entry.email });
  if (entry.title) obs.push({ ...profileBase, field: 'title', value: entry.title });
  if (entry.profileUrl) {
    obs.push({ ...profileBase, field: 'profileUrls', value: { departmental: entry.profileUrl } });
  }
  const safeLabUrl = safeHttpUrl(entry.labUrl, sourceUrl);
  if (safeLabUrl) obs.push({ ...profileBase, field: 'website', value: safeLabUrl });
  if (entry.orcid) obs.push({ ...profileBase, field: 'orcid', value: entry.orcid });
  if (entry.bio) obs.push({ ...profileBase, field: 'bio', value: entry.bio });
  if (entry.researchInterests && entry.researchInterests.length > 0) {
    obs.push({ ...profileBase, field: 'researchInterests', value: entry.researchInterests });
  }
  if (entry.topics && entry.topics.length > 0) {
    obs.push({ ...profileBase, field: 'topics', value: entry.topics });
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
  const labUrl = safeHttpUrl(entry.labUrl, sourceUrl);
  if (!labUrl) return [];
  const cleanedName = normalizeName(entry.name);
  const nameSlug = slugify(cleanedName) || slugify(labUrl);
  const slug = `dept-${dept.deptKey}-${nameSlug}`.slice(0, 100);
  const labName = cleanedName ? `${cleanedName} Lab` : labUrl;
  const base = { entityType: 'researchEntity' as const, entityKey: slug, sourceUrl };
  return [
    { ...base, field: 'slug', value: slug },
    { ...base, field: 'name', value: labName },
    { ...base, field: 'kind', value: 'lab' },
    { ...base, field: 'school', value: dept.schoolName },
    { ...base, field: 'departments', value: [dept.deptName] },
    { ...base, field: 'websiteUrl', value: labUrl },
    { ...base, field: 'sourceUrls', value: [sourceUrl, labUrl] },
    {
      ...base,
      field: 'inferredPiUserKey',
      value: ownerEntityKey,
      confidenceOverride: 0.7,
    },
  ];
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

    let totalObs = 0;
    let totalFaculty = 0;
    let totalLabs = 0;
    const perDept: Array<{ deptKey: string; count: number; status: string }> = [];
    const fetchAttempts: ScraperFetchMetric[] = [];
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

      for (const rawEntry of entries) {
        if (totalFaculty >= limit) break;
        const entry = await enrichEntryFromOfficialProfile(
          rawEntry,
          this.name,
          ctx.options.useCache,
          this.htmlFetcher,
          ctx.log,
        );
        const { observations: userObs, entityKey } = entryToUserObservations(
          entry,
          dept,
          sourceUrl,
        );
        const userDedupeKey = `${dept.deptKey}:${entityKey}`;
        if (seenUserKeys.has(userDedupeKey)) continue;
        seenUserKeys.add(userDedupeKey);
        await ctx.emit(userObs);
        observations += userObs.length;

        const labObs = entryToLabObservations(entry, dept, sourceUrl, entityKey);
        const labKey = labObs[0]?.entityKey;
        if (labObs.length > 0 && labKey && !seenLabKeys.has(labKey)) {
          seenLabKeys.add(labKey);
          await ctx.emit(labObs);
          observations += labObs.length;
          labs++;
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

    const summary = perDept
      .map((d) => `${d.deptKey}=${d.status === 'ok' ? d.count : d.status}`)
      .join(', ');
    ctx.log(
      `Emitted ${totalObs} observations across ${totalFaculty} faculty / ${totalLabs} labs (${summary})`,
    );

    return {
      observationCount: totalObs,
      entitiesObserved: totalFaculty + totalLabs,
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
