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
import type { AnyNode } from 'domhandler';
import {
  createScraplingRenderedFetcher,
  measureRenderedFetch,
  summarizeFetchMetrics,
  type RenderedFetcher,
  type RenderedFetchResult,
} from '../renderedFetch';
import { getCached, setCached } from '../snapshotCache';
import { normalizeOrcid } from '../../utils/orcid';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';
import type {
  IScraper,
  ScraperContext,
  ScraperResult,
  ObservationInput,
  ScraperFetchMetric,
} from '../types';
import {
  isLikelyPersonSpecificYaleEmail,
  netidFromEmail,
  normalizeName,
  slugify,
  splitName,
} from '../utils/scraperHelpers';

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
  /** Official roster/profile image URL. */
  imageUrl?: string;
  /** Publications listed directly on an official Yale profile page. */
  officialProfilePublications?: OfficialProfilePublication[];
  /** Publication-list pages linked from an official Yale profile. */
  publicationListUrls?: string[];
}

export interface OfficialProfilePublication {
  title: string;
  year?: number;
  venue?: string;
  url?: string;
  sourceUrl: string;
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
  /** Defaults to true. Set false for broad people rosters where personal/staff URLs are not research homes. */
  emitPersonalResearchEntities?: boolean;
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
    const title =
      cleanText(
        card
          .find('.node-teaser__professional-title, .node-teaser__title')
          .first()
          .text(),
      ) || undefined;
    const imageUrl = imageUrlFromElement(card, ctx.pageUrl);
    out.push({ name, profileUrl, title, ...(imageUrl ? { imageUrl } : {}) });
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
    const imageUrl = imageUrlFromElement(card, ctx.pageUrl);
    let email: string | undefined;
    let labUrl: string | undefined;
    card.find('.directory-listing-card__link').each((_j, a) => {
      const href = $(a).attr('href') || '';
      if (/^mailto:/i.test(href)) {
        email = href.replace(/^mailto:/i, '').trim() || email;
      } else if (/^https?:\/\//i.test(href) && !labUrl && !isGenericLabDirectoryUrl(href)) {
        labUrl = href;
      }
    });
    const bio = cleanText(card.find('.directory-listing-card__snippet').first().text()) || undefined;
    out.push({ name, profileUrl, title, email, labUrl, bio, ...(imageUrl ? { imageUrl } : {}) });
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
    const imageHref = row.find('.views-field-picture img').first().attr('src') || '';
    const imageUrl = imageHref ? absolutize(imageHref, ctx.pageUrl) : undefined;
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
      const absolute = absolutize(href, ctx.pageUrl);
      if (isGenericLabDirectoryUrl(absolute)) return;
      labUrl = absolute;
    });

    const topics: string[] = [];
    row
      .find(
        '.views-field-field-field-of-study, [class*="field-of-study"], .views-field-field-term-reference',
      )
      .each((_j, el) => {
        topics.push(...splitTopicText(elementTextWithChildSeparators($, el)));
      });

    out.push({
      name,
      profileUrl,
      title,
      email,
      ...(imageUrl ? { imageUrl } : {}),
      labUrl,
      topics: topics.length > 0 ? topics : undefined,
      researchInterests: topics.length > 0 ? topics : undefined,
    });
  });
  return out;
};

function decodeHtmlEntities(value: string): string {
  return cheerio.load(`<textarea>${value}</textarea>`)('textarea').text();
}

function yaleEmailFromElement($: cheerio.CheerioAPI, node: cheerio.Cheerio<any>): string | undefined {
  const href = node.find('a[href^="mailto:"]').first().attr('href') || '';
  if (/^mailto:/i.test(href)) return href.replace(/^mailto:/i, '').trim().toLowerCase();

  const decoded = decodeHtmlEntities(node.html() || node.text() || '');
  const mailtoMatch = decoded.match(/mailto:([a-z0-9._%+-]+@yale\.edu)/i);
  if (mailtoMatch) return mailtoMatch[1].toLowerCase();

  return decoded.match(/\b[a-z0-9._%+-]+@yale\.edu\b/i)?.[0]?.toLowerCase();
}

/**
 * Legacy Drupal Views rows used by interdisciplinary programs such as ER&M
 * and WGSS. The email field is sometimes written by an inline script with
 * numeric HTML entities; decode the local markup rather than executing it.
 */
export const viewsRowPersonExtractor: FacultyExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const out: FacultyEntry[] = [];

  $('.views-row').each((_i, el) => {
    const row = $(el);
    const nameLink = row.find('.views-field-name a.username, .views-field-name a').first();
    const name = cleanText(nameLink.text() || row.find('.views-field-name').first().text());
    if (!name) return;

    const profileHref = nameLink.attr('href') || '';
    const profileUrl = profileHref ? absolutize(profileHref, ctx.pageUrl) : undefined;
    const title =
      cleanText(
        row
          .find(
            '.views-field-field-title .field-content, .views-field-field-title, [class*="position"]',
          )
          .first()
          .text(),
      ) || undefined;
    const email = yaleEmailFromElement($, row.find('.views-field-field-email').first());
    const imageHref = row.find('.views-field-picture img').first().attr('src') || '';
    const imageUrl = imageHref ? absolutize(imageHref, ctx.pageUrl) : undefined;

    out.push({
      name,
      profileUrl,
      title,
      email,
      ...(imageUrl ? { imageUrl } : {}),
    });
  });

  return out;
};

/**
 * Yale Jackson School — WordPress person cards used on faculty/lecturer pages.
 *   <div class="page-item page-item-person">
 *     <div class="page-item-person-name-inner">Name</div>
 *     <div class="page-item-person-bio-title">Lecturer</div>
 *     <a href="mailto:...">Email</a>
 *     <a href="https://jackson.yale.edu/person/<slug>/">View Bio</a>
 *   </div>
 */
export const jacksonPersonCardExtractor: FacultyExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const out: FacultyEntry[] = [];

  $('.page-item-person').each((_i, el) => {
    const card = $(el);
    const name =
      cleanText(card.find('.page-item-person-name-inner').first().text()) ||
      cleanText(card.find('.page-item-person-name').first().text());
    if (!name) return;

    const profileHref = card.find('a[href*="/person/"]').first().attr('href') || '';
    const emailHref = card.find('a[href^="mailto:"]').first().attr('href') || '';
    const email = /^mailto:/i.test(emailHref) ? emailHref.replace(/^mailto:/i, '').trim() : undefined;
    const title = cleanText(card.find('.page-item-person-bio-title').first().text()) || undefined;
    const imageUrl = imageUrlFromElement(card, ctx.pageUrl);

    out.push({
      name,
      profileUrl: profileHref ? absolutize(profileHref, ctx.pageUrl) : undefined,
      title,
      email,
      ...(imageUrl ? { imageUrl } : {}),
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
        profileUrl && !isOfficialYaleUrl(profileUrl) && !isGenericLabDirectoryUrl(profileUrl)
          ? profileUrl
          : undefined;
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
  {
    deptKey: 'eall',
    deptName: 'East Asian Languages & Literatures',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://eall.yale.edu/people/professors',
    paginated: false,
    extractor: psychExtractor,
  },
  {
    deptKey: 'american-studies',
    deptName: 'American Studies',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://americanstudies.yale.edu/people/faculty',
    paginated: false,
    extractor: psychExtractor,
  },
  {
    deptKey: 'african-studies',
    deptName: 'African Studies',
    schoolName: 'MacMillan Center for International and Area Studies at Yale',
    url: 'https://macmillan.yale.edu/africa/people',
    paginated: false,
    extractor: econExtractor,
    emitPersonalResearchEntities: false,
  },
  {
    deptKey: 'music',
    deptName: 'Music',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://yalemusic.yale.edu/people/faculty',
    paginated: false,
    extractor: psychExtractor,
  },
  {
    deptKey: 'political-science',
    deptName: 'Political Science',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://politicalscience.yale.edu/people/faculty',
    paginated: true,
    extractor: psychExtractor,
  },
  {
    deptKey: 'history',
    deptName: 'History',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://history.yale.edu/people/faculty',
    paginated: true,
    extractor: psychExtractor,
  },
  {
    deptKey: 'history-art',
    deptName: 'History of Art',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://arthistory.yale.edu/people/faculty',
    paginated: false,
    extractor: viewsRowPersonExtractor,
  },
  {
    deptKey: 'anthropology',
    deptName: 'Anthropology',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://anthropology.yale.edu/people/faculty',
    paginated: false,
    extractor: mcdbExtractor,
  },
  {
    deptKey: 'earth-planetary-sciences',
    deptName: 'Earth and Planetary Sciences',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://earth.yale.edu/faculty',
    paginated: false,
    extractor: mcdbExtractor,
  },
  {
    deptKey: 'erm',
    deptName: 'Ethnicity, Race, and Migration',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://erm.yale.edu/people/faculty',
    paginated: false,
    extractor: viewsRowPersonExtractor,
  },
  {
    deptKey: 'wgss',
    deptName: "Women's, Gender, and Sexuality Studies",
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://wgss.yale.edu/people/faculty',
    paginated: false,
    extractor: viewsRowPersonExtractor,
  },
  {
    deptKey: 'global-affairs',
    deptName: 'Global Affairs',
    schoolName: 'Yale Jackson School of Global Affairs',
    url: 'https://jackson.yale.edu/about/meet-us/faculty/lecturers/',
    paginated: false,
    extractor: jacksonPersonCardExtractor,
    emitPersonalResearchEntities: false,
  },
  {
    deptKey: 'tdps',
    deptName: 'Theater, Dance, and Performance Studies',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://tdps.yale.edu/people',
    paginated: false,
    extractor: mcdbExtractor,
    emitPersonalResearchEntities: false,
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

function firstImageUrlFromSrcset(value: string | undefined | null): string | undefined {
  const first = String(value || '')
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0])
    .find(Boolean);
  return first || undefined;
}

function imageUrlFromElement(node: cheerio.Cheerio<any>, baseUrl: string): string | undefined {
  const img = node.find('img').first();
  if (!img.length) return undefined;
  const src =
    img.attr('src') ||
    img.attr('data-src') ||
    firstImageUrlFromSrcset(img.attr('srcset')) ||
    firstImageUrlFromSrcset(img.attr('data-srcset')) ||
    '';
  return src ? absolutize(src, baseUrl) : undefined;
}

function isGenericLabDirectoryUrl(value: string | undefined | null): boolean {
  try {
    const url = new URL(String(value || ''));
    const path = url.pathname.replace(/\/+$/, '').toLowerCase();
    return (
      url.hostname.toLowerCase() === 'medicine.yale.edu' &&
      path === '/about/a-to-z-index/atoz/lab-websites'
    );
  } catch {
    return false;
  }
}

function elementTextWithChildSeparators(
  $: cheerio.CheerioAPI,
  el: AnyNode,
): string {
  const parts = $(el)
    .contents()
    .map((_i, node) => cleanText($(node).text()))
    .get()
    .filter(Boolean);
  return parts.length > 0 ? parts.join('; ') : cleanText($(el).text());
}

function splitTopicText(value: string | undefined | null): string[] {
  const cleaned = String(value || '').trim();
  if (!cleaned) return [];
  const parts = cleaned
    .split(/[,;|•\n\r]+/)
    .map((part) => cleanText(part))
    .filter((part) => part.length > 1 && !/^[-–—]+$/.test(part));
  return uniqueStrings(parts);
}

const nonResearchTopicLabels = new Set([
  'experimentalist',
  'theorist',
  'observational',
  'observer',
  'emeritus',
]);

function lowerTopicPhrase(value: string): string {
  return cleanText(value)
    .split(/\s+/)
    .map((word) => (/^[A-Z0-9&-]{2,}$/.test(word) ? word : `${word.charAt(0).toLowerCase()}${word.slice(1)}`))
    .join(' ');
}

function rosterTopicDescription(topics: string[] = []): string {
  const usefulTopics = uniqueStrings(topics)
    .filter((topic) => !nonResearchTopicLabels.has(topic.toLowerCase()))
    .slice(0, 5);
  if (usefulTopics.length === 0) return '';

  const [primary, ...rest] = usefulTopics;
  if (rest.length === 0) return `Studies ${lowerTopicPhrase(primary)}.`;
  const restText =
    rest.length === 1
      ? lowerTopicPhrase(rest[0])
      : `${rest.slice(0, -1).map(lowerTopicPhrase).join(', ')}, and ${lowerTopicPhrase(rest.at(-1) || '')}`;
  return `Studies ${lowerTopicPhrase(primary)}, including ${restText}.`;
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

function isSiteChromeLink(link: cheerio.Cheerio<any>): boolean {
  return (
    link
      .closest(
        [
          'footer',
          'nav',
          '[role="navigation"]',
          '.site-header',
          '.site-footer',
          '.site-navigation',
          '.menu',
          '.menu__item',
          '.menu__link',
          '.breadcrumb',
          '[id="site-header"]',
          '[id="site-footer"]',
          '[id="site-navigation"]',
          '[id="breadcrumb"]',
        ].join(', '),
      )
      .length > 0
  );
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

function isHeadingTag(node: cheerio.Cheerio<any>): boolean {
  return /^h[1-6]$/i.test(node.prop('tagName') || '');
}

function cleanProfileSectionText(value: string): string {
  return cleanText(value)
    .replace(/\bCopy Link\b/gi, ' ')
    .replace(/\bLast Updated on [^.]+\.?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSectionAfterHeading(
  $: cheerio.CheerioAPI,
  headingPattern: RegExp,
): string | undefined {
  let sectionText: string | undefined;

  $('h1,h2,h3,h4,h5,h6,strong').each((_i, heading) => {
    if (sectionText) return false;

    const label = cleanText($(heading).text());
    if (!headingPattern.test(label)) return;

    const parts: string[] = [];
    let cursor = $(heading).next();
    while (cursor.length > 0) {
      if (isHeadingTag(cursor)) break;
      const text = cleanProfileSectionText(cursor.text());
      if (text) parts.push(text);
      cursor = cursor.next();
    }

    const text = cleanProfileSectionText(parts.join(' '));
    if (text.length >= 40) sectionText = text;
  });

  return sectionText;
}

function isLikelyProfileChromeBio(value: string): boolean {
  return /view this doctor's clinical profile|are you a patient|download hi-res photo/i.test(value);
}

function extractBioFromHtml($: cheerio.CheerioAPI): string | undefined {
  const biography = extractSectionAfterHeading($, /^biography$/i);
  if (biography) return biography.slice(0, 2000);

  const selectors = [
    '[class*="profile-body"]',
    '[class*="profile"][class*="body"]',
    '[class*="profile"] [class*="body"]',
    '[class*="person"] [class*="bio"]',
    '[class*="biography"]',
    '[class*="field-name-field-bio"]',
    'main .text',
    'article .text',
    '[class*="research"] [class*="summary"]',
    '[class*="field--name-body"]',
    'article [class*="body"]',
    'main p',
  ];

  for (const selector of selectors) {
    const text = cleanText($(selector).first().text())
      .replace(/^CV\s+/i, '')
      .replace(/\s+Office hours?:.*$/i, '');
    if (text.length >= 40 && !isLikelyProfileChromeBio(text)) return text.slice(0, 2000);
  }
  return undefined;
}

function extractResearchInterestsFromHtml($: cheerio.CheerioAPI): string[] {
  const values: string[] = [];
  const selectors = [
    '[class*="research-interest"]',
    '[class*="field-of-study"]',
    '[class*="field--name-field-research"]',
    '[class*="field--name-field-interests"]',
    '[class*="interests"]',
  ];

  for (const selector of selectors) {
    $(selector).each((_i, el) => {
      const text = elementTextWithChildSeparators($, el);
      values.push(...splitTopicText(text));
    });
  }

  $('h2,h3,h4,strong').each((_i, heading) => {
    const label = cleanText($(heading).text()).toLowerCase();
    if (!/\b(research interests?|fields? of study|topics?)\b/.test(label)) return;
    const next = $(heading).next();
    if (next[0]) values.push(...splitTopicText(elementTextWithChildSeparators($, next[0])));
  });

  return uniqueStrings(values).slice(0, 20);
}

function normalizePublicationTitle(value: string | undefined | null): string {
  return cleanText(value)
    .replace(/^(?:pdf|link|download|abstract|paper)\s*[:\-–—]?\s*/i, '')
    .replace(/^["'“”‘’]+|["'“”‘’.,;:]+$/g, '')
    .replace(/^(book|article|chapter)\s*:\s*/i, '')
    .trim();
}

function isGenericPublicationPointer(value: string | undefined | null): boolean {
  const text = cleanText(value).toLowerCase();
  if (!text) return true;
  return (
    /\bfor a list of (?:selected |latest |recent )?publications\b/.test(text) ||
    /\b(?:visit|see|view)\s+(?:my|the|our|professor\s+\w+['’]s)\s+(?:website|webpage|site|publication list)\b/.test(text) ||
    /\bcomplete publication list\b/.test(text) ||
    /\bgoogle scholar\b/.test(text) ||
    /^(?:pdf|link|publication page|publications?|selected publications?|books?)$/i.test(text)
  );
}

function publicationTitleFromElement(
  $: cheerio.CheerioAPI,
  node: cheerio.Cheerio<any>,
  text: string,
): string {
  const quotedTitle = normalizePublicationTitle((text.match(/[“"]([^”"]{8,180})[”"]/) || [])[1]);
  if (quotedTitle) return quotedTitle;

  const emphasizedText = normalizePublicationTitle(node.find('em, i, cite').first().text());
  if (emphasizedText) return emphasizedText;

  const boldTitle = normalizePublicationTitle(node.find('.p-desc b, b').first().text());
  if (boldTitle && !isGenericPublicationPointer(boldTitle)) return boldTitle;

  const segmentedText = elementTextWithChildSeparators($, node[0])
    .split(/[;\n\r]+/)
    .map((part) => normalizePublicationTitle(part.replace(/\b(18|19|20)\d{2}\b/g, '')))
    .filter((part) => part.length >= 8 && !isGenericPublicationPointer(part));
  if (segmentedText.length > 0) return segmentedText[0];

  return normalizePublicationTitle(text.replace(/\b(18|19|20)\d{2}\b/g, ''));
}

function publicationFromElement(
  $: cheerio.CheerioAPI,
  el: any,
  profileUrl: string,
): OfficialProfilePublication | null {
  const node = $(el);
  const text = cleanText(node.text());
  if (text.length < 8) return null;
  if (isGenericPublicationPointer(text)) return null;

  const title = publicationTitleFromElement($, node, text);
  if (!title || title.length < 8 || title.length > 240 || isGenericPublicationPointer(title)) return null;

  const yearMatch = text.match(/\b(18|19|20)\d{2}\b/);
  const year = yearMatch ? Number(yearMatch[0]) : undefined;
  const href = node.find('a[href]').first().attr('href') || '';
  const quotedTitle = normalizePublicationTitle((text.match(/[“"]([^”"]{8,180})[”"]/) || [])[1]);
  const emphasizedText = normalizePublicationTitle(node.find('em, i, cite').first().text());
  const venue = quotedTitle && emphasizedText
    ? emphasizedText
    : emphasizedText && title === emphasizedText
    ? normalizePublicationTitle(text.replace(emphasizedText, '').replace(/\b(18|19|20)\d{2}\b/g, ''))
        .replace(/^[-–—,.:;()\s]+|[-–—,.:;()\s]+$/g, '')
        .slice(0, 180) || undefined
    : undefined;

  return {
    title,
    ...(year ? { year } : {}),
    ...(venue ? { venue } : {}),
    ...(href ? { url: absolutize(href, profileUrl) } : {}),
    sourceUrl: profileUrl,
  };
}

function extractOfficialProfilePublicationsFromHtml(
  $: cheerio.CheerioAPI,
  profileUrl: string,
): OfficialProfilePublication[] {
  const candidates: OfficialProfilePublication[] = [];

  const collectPublicationsFrom = (section: cheerio.Cheerio<any>) => {
    const items = section.is('ul,ol') ? section.find('li') : section.is('li,p') ? section : section.find('li,p');
    items.each((_j, el) => {
      const publication = publicationFromElement($, el, profileUrl);
      if (publication) candidates.push(publication);
    });
  };

  $('[class*="publication"], [id*="publication"]').each((_i, section) => {
    collectPublicationsFrom($(section));
  });

  $('h2,h3,h4,strong').each((_i, heading) => {
    const label = cleanText($(heading).text()).toLowerCase();
    if (!/\b(selected\s+)?publications?\b|\bbooks?\b/.test(label)) return;

    const scanStartNodes = [$(heading).next(), $(heading).parent().next()].filter((node) => node.length > 0);
    for (const startNode of scanStartNodes) {
      let cursor = startNode;
      while (cursor.length > 0) {
        if (/^h[2-4]$/i.test(cursor.prop('tagName') || '')) break;
        collectPublicationsFrom(cursor);
        cursor = cursor.next();
      }
    }
  });

  const seen = new Set<string>();
  return candidates.filter((publication) => {
    const key = `${publication.title.toLowerCase()}|${publication.year || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

function extractPublicationListUrlsFromHtml(
  $: cheerio.CheerioAPI,
  profileUrl: string,
): string[] {
  const urls: string[] = [];

  const collectLinksFrom = (section: cheerio.Cheerio<any>) => {
    section.find('a[href]').each((_i, el) => {
      const link = $(el);
      const text = cleanText(link.text());
      const href = link.attr('href') || '';
      if (!href || /^mailto:|^tel:|^#|^javascript:/i.test(href)) return;
      if (!isGenericPublicationPointer(`${text} ${href}`)) return;
      urls.push(absolutize(href, profileUrl));
    });
  };

  $('[class*="publication"], [id*="publication"]').each((_i, section) => {
    collectLinksFrom($(section));
  });

  $('h2,h3,h4,strong').each((_i, heading) => {
    const label = cleanText($(heading).text()).toLowerCase();
    if (!/\b(selected\s+)?publications?\b|\bbooks?\b/.test(label)) return;

    const scanStartNodes = [$(heading).next(), $(heading).parent().next()].filter((node) => node.length > 0);
    for (const startNode of scanStartNodes) {
      let cursor = startNode;
      while (cursor.length > 0) {
        if (/^h[2-4]$/i.test(cursor.prop('tagName') || '')) break;
        collectLinksFrom(cursor);
        cursor = cursor.next();
      }
    }
  });

  return uniqueStrings(urls).filter((url) => normalizeUrlForDedupe(url) !== normalizeUrlForDedupe(profileUrl));
}

function extractInlineMajorPublications(
  text: string | undefined,
  profileUrl: string,
): OfficialProfilePublication[] {
  if (!text) return [];
  const match = text.match(/\bmajor publications include\b([\s\S]+)/i);
  if (!match) return [];
  const section = match[1]
    .split(/\bPlease see\b|\bI have received\b|\bGrants?\b/i)[0]
    .trim();
  if (!section) return [];

  const publications: OfficialProfilePublication[] = [];
  const pattern = /([^.;]+?)\s*\(([^)]*\b(?:18|19|20)\d{2}\b[^)]*)\)/g;
  let current: RegExpExecArray | null;
  while ((current = pattern.exec(section)) && publications.length < 10) {
    const title = normalizePublicationTitle(
      current[1].replace(/^(?:,|\band\b|\ba\b|\ban\b|\bthe\b|\s)+/i, ''),
    );
    const detail = cleanText(current[2]);
    const yearMatch = detail.match(/\b(18|19|20)\d{2}\b/);
    const year = yearMatch ? Number(yearMatch[0]) : undefined;
    const venue = year
      ? normalizePublicationTitle(detail.replace(String(year), '').replace(/,\s*$/, ''))
      : undefined;

    if (!title || !year || title.length < 8 || title.length > 240) continue;
    publications.push({
      title,
      year,
      ...(venue ? { venue } : {}),
      sourceUrl: profileUrl,
    });
  }

  return publications;
}

async function fetchHtml(url: string, useCache: boolean, sourceName: string): Promise<string> {
  const safeUrl = await assertPublicHttpUrl(url);
  const safeUrlText = safeUrl.toString();
  const cacheKey = `page:${safeUrlText}`;
  if (useCache) {
    const cached = await getCached<string>(sourceName, cacheKey);
    if (cached) return cached;
  }
  const agents = ssrfSafeAgents();
  const res = await axios.get(safeUrlText, {
    timeout: FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT },
    maxRedirects: 5,
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
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
  const safeDataUrl = await assertPublicHttpUrl(dept.dataUrl);
  const safeDataUrlText = safeDataUrl.toString();
  const request = dept.dataRequest || {};
  const cacheKey = `data:${safeDataUrlText}:${JSON.stringify(request)}`;
  if (useCache) {
    const cached = await getCached<unknown>(sourceName, cacheKey);
    if (cached) return cached;
  }

  const body = new URLSearchParams(request);
  const agents = ssrfSafeAgents();
  const res = await axios.post(safeDataUrlText, body, {
    timeout: FETCH_TIMEOUT_MS,
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    maxRedirects: 5,
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
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
  | 'officialProfilePublications'
  | 'publicationListUrls'
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
    if (isSiteChromeLink(link)) return;

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

    if (isGenericLabDirectoryUrl(absolute)) return;
    labUrl = absolute;
  });

  const researchInterests = extractResearchInterestsFromHtml($);
  const bio = extractBioFromHtml($);
  const publicationCandidates = [
    ...extractOfficialProfilePublicationsFromHtml($, canonicalUrl),
    ...extractInlineMajorPublications(bio, canonicalUrl),
  ];
  const publicationKeys = new Set<string>();
  const officialProfilePublications = publicationCandidates.filter((publication) => {
    const key = `${publication.title.toLowerCase()}|${publication.year || ''}`;
    if (publicationKeys.has(key)) return false;
    publicationKeys.add(key);
    return true;
  });
  const publicationListUrls = extractPublicationListUrlsFromHtml($, canonicalUrl);

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
    officialProfilePublications:
      officialProfilePublications.length > 0 ? officialProfilePublications : undefined,
    publicationListUrls: publicationListUrls.length > 0 ? publicationListUrls : undefined,
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
    | 'imageUrl'
    | 'officialProfilePublications'
    | 'publicationListUrls'
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
    imageUrl: entry.imageUrl || enrichment.imageUrl,
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
    officialProfilePublications:
      [...(entry.officialProfilePublications || []), ...(enrichment.officialProfilePublications || [])]
        .length > 0
        ? [...(entry.officialProfilePublications || []), ...(enrichment.officialProfilePublications || [])]
        : undefined,
    publicationListUrls:
      uniqueStrings([...(entry.publicationListUrls || []), ...(enrichment.publicationListUrls || [])])
        .length > 0
        ? uniqueStrings([...(entry.publicationListUrls || []), ...(enrichment.publicationListUrls || [])])
        : undefined,
  };
}

async function enrichEntryFromPublicationLists(
  entry: FacultyEntry,
  sourceName: string,
  useCache: boolean,
  htmlFetcher: HtmlFetcher,
  log: ScraperContext['log'],
): Promise<FacultyEntry> {
  const urls = entry.publicationListUrls || [];
  if (urls.length === 0) return entry;

  const publications: OfficialProfilePublication[] = [];
  for (const url of urls.slice(0, 2)) {
    try {
      const html = await htmlFetcher(url, useCache, sourceName);
      const $ = cheerio.load(html);
      publications.push(
        ...extractOfficialProfilePublicationsFromHtml($, url).map((publication) => ({
          ...publication,
          sourceUrl: url,
        })),
      );
    } catch (err: any) {
      log(`[profile] publication-list fetch failed: ${sanitizeLogValue(err)}`);
    }
  }

  if (publications.length === 0) return entry;
  return mergeProfileEnrichment(entry, { officialProfilePublications: publications });
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
    return enrichEntryFromPublicationLists(merged, sourceName, useCache, htmlFetcher, log);
  } catch (err: any) {
    log(`[profile] fetch failed: ${sanitizeLogValue(err)}`);
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
  const personEmail = isLikelyPersonSpecificYaleEmail(entry.email, cleaned) ? entry.email : undefined;
  const netid = netidFromEmail(personEmail);
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
  if (personEmail) obs.push({ ...profileBase, field: 'email', value: personEmail });
  if (entry.title) obs.push({ ...profileBase, field: 'title', value: entry.title });
  if (entry.profileUrl) {
    obs.push({ ...profileBase, field: 'profileUrls', value: { departmental: entry.profileUrl } });
  }
  if (entry.imageUrl) obs.push({ ...profileBase, field: 'imageUrl', value: entry.imageUrl });
  if (entry.labUrl) obs.push({ ...profileBase, field: 'website', value: entry.labUrl });
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
  if (entry.officialProfilePublications && entry.officialProfilePublications.length > 0) {
    obs.push({
      ...profileBase,
      field: 'officialProfilePublications',
      value: entry.officialProfilePublications,
      confidenceOverride: 0.9,
    });
  }
  obs.push({ ...rosterBase, field: 'dataSources', value: ['dept-faculty-roster'] });

  return { observations: obs, entityKey };
}

function isLikelyExplicitLabWebsite(entry: FacultyEntry): boolean {
  const name = normalizeName(entry.name);
  const url = entry.labUrl || '';
  const searchable = `${name} ${url}`.toLowerCase();
  return /\b(lab|laboratory|research[-\s]?group|group)\b/.test(searchable) || /lab[./-]/.test(searchable);
}

function entryToResearchEntityObservations(
  entry: FacultyEntry,
  dept: DeptConfig,
  sourceUrl: string,
  ownerEntityKey: string,
): ObservationInput[] {
  if (!entry.labUrl) return [];
  const cleanedName = normalizeName(entry.name);
  const nameSlug = slugify(cleanedName) || slugify(entry.labUrl);
  const slug = `dept-${dept.deptKey}-${nameSlug}`.slice(0, 100);
  const isExplicitLab = isLikelyExplicitLabWebsite(entry);
  if (!isExplicitLab && dept.emitPersonalResearchEntities === false) return [];
  const entityName = cleanedName
    ? isExplicitLab
      ? `${cleanedName} Lab`
      : `${cleanedName} Faculty Research`
    : entry.labUrl;
  const base = { entityType: 'researchEntity' as const, entityKey: slug, sourceUrl };
  const observations: ObservationInput[] = [
    { ...base, field: 'slug', value: slug },
    { ...base, field: 'name', value: entityName },
    { ...base, field: 'kind', value: isExplicitLab ? 'lab' : 'individual' },
    { ...base, field: 'entityType', value: isExplicitLab ? 'LAB' : 'FACULTY_RESEARCH_AREA' },
    { ...base, field: 'school', value: dept.schoolName },
    { ...base, field: 'departments', value: [dept.deptName] },
    { ...base, field: 'websiteUrl', value: entry.labUrl },
    { ...base, field: 'sourceUrls', value: [sourceUrl, entry.labUrl] },
    {
      ...base,
      field: 'inferredPiUserKey',
      value: ownerEntityKey,
      confidenceOverride: 0.7,
    },
  ];

  const topics = uniqueStrings([...(entry.researchInterests || []), ...(entry.topics || [])]);
  if (topics.length > 0) {
    observations.push({ ...base, field: 'researchAreas', value: topics });
    const description = rosterTopicDescription(topics);
    if (description) {
      observations.push(
        { ...base, field: 'fullDescription', value: description, confidenceOverride: 0.76 },
        { ...base, field: 'shortDescription', value: description, confidenceOverride: 0.76 },
      );
    }
  }

  return observations;
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
    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }
    const limit = limitOption ?? Infinity;

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

        const labObs = entryToResearchEntityObservations(entry, dept, sourceUrl, entityKey);
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
          ctx.log(`[${dept.deptKey}] data endpoint failed: ${sanitizeLogValue(err)}`);
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
          ctx.log(`[${dept.deptKey}] rendered extractor error: ${sanitizeLogValue(err)}`);
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
          ctx.log(`[${dept.deptKey}] fetch failed for configured page: ${sanitizeLogValue(err)}`);
          break;
        }
        pagesFetched++;
        let entries: FacultyEntry[];
        try {
          entries = dept.extractor(html, { pageUrl });
        } catch (err: any) {
          ctx.log(`[${dept.deptKey}] extractor error on configured page: ${sanitizeLogValue(err)}`);
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
