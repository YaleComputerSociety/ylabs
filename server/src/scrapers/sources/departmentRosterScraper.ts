/**
 * DepartmentRosterScraper
 *
 * One scraper class that pulls faculty rosters from multiple Yale department
 * websites. Each department's HTML differs, so we use a per-department config
 * row that pairs a URL with a pure extractor function. Adding a new department
 * is a single config-row change — the orchestrator class itself is closed for
 * modification.
 *
 * For v1 we target Economics, MCDB, Computer Science, and Psychology. CS uses
 * a Next.js client-side render so its extractor is a no-op stub until we wire
 * up a headless browser. The other three are server-rendered Drupal sites and
 * scrape cleanly with plain HTTP + cheerio.
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
}

/** Context passed to each per-department extractor for URL resolution and logging. */
export interface ExtractorCtx {
  /** Absolute URL the HTML was fetched from — used to resolve relative hrefs. */
  pageUrl: string;
}

/** Pure extractor: HTML in, structured rows out. No I/O. */
export type FacultyExtractor = (html: string, ctx: ExtractorCtx) => FacultyEntry[];

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
    out.push({ name, profileUrl, title, email, labUrl });
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
  $('table.views-table tbody tr').each((_i, tr) => {
    const row = $(tr);
    const nameLink = row.find('td.views-field-name a').first();
    const name = nameLink.text().trim();
    if (!name) return;
    const profileHref = nameLink.attr('href') || '';
    const profileUrl = profileHref ? absolutize(profileHref, ctx.pageUrl) : undefined;
    const emailHref = row.find('td.views-field-mail a').first().attr('href') || '';
    const email = /^mailto:/i.test(emailHref) ? emailHref.replace(/^mailto:/i, '').trim() : undefined;
    out.push({ name, profileUrl, email });
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
    renderedExtractor: csRenderedExtractor,
    renderWaitSelector: 'a[href*="faculty"], a[href*="profile"], main',
    jsRenderedSkip: true,
  },
  {
    deptKey: 'psych',
    deptName: 'Psychology',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://psychology.yale.edu/people/faculty',
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

  const base = { entityType: 'user' as const, entityKey, sourceUrl };
  const obs: ObservationInput[] = [];

  if (netid) obs.push({ ...base, field: 'netid', value: netid });
  if (entry.email) obs.push({ ...base, field: 'email', value: entry.email });
  if (first) obs.push({ ...base, field: 'fname', value: first });
  if (last) obs.push({ ...base, field: 'lname', value: last });
  obs.push({ ...base, field: 'userType', value: 'faculty' });
  obs.push({ ...base, field: 'primaryDepartment', value: dept.deptName });
  obs.push({ ...base, field: 'departments', value: [dept.deptName] });
  if (entry.title) obs.push({ ...base, field: 'title', value: entry.title });
  if (entry.profileUrl) {
    obs.push({ ...base, field: 'profileUrls', value: { departmental: entry.profileUrl } });
  }
  if (entry.labUrl) obs.push({ ...base, field: 'website', value: entry.labUrl });
  obs.push({ ...base, field: 'dataSources', value: ['dept-faculty-roster'] });

  return { observations: obs, entityKey };
}

function entryToLabObservations(
  entry: FacultyEntry,
  dept: DeptConfig,
  sourceUrl: string,
  ownerEntityKey: string,
): ObservationInput[] {
  if (!entry.labUrl) return [];
  const cleanedName = normalizeName(entry.name);
  const nameSlug = slugify(cleanedName) || slugify(entry.labUrl);
  const slug = `dept-${dept.deptKey}-${nameSlug}`.slice(0, 100);
  const labName = cleanedName ? `${cleanedName} Lab` : entry.labUrl;
  const base = { entityType: 'researchGroup' as const, entityKey: slug, sourceUrl };
  return [
    { ...base, field: 'slug', value: slug },
    { ...base, field: 'name', value: labName },
    { ...base, field: 'kind', value: 'lab' },
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
}

// ---------------------------------------------------------------------------
// Scraper
// ---------------------------------------------------------------------------

export class DepartmentRosterScraper implements IScraper {
  readonly name = 'dept-faculty-roster';
  readonly displayName = 'Department faculty rosters (Econ, MCDB, CS, Psych)';

  /** Configs are injectable for testing; default to the v1 four-department set. */
  constructor(
    private readonly configs: DeptConfig[] = DEFAULT_DEPT_CONFIGS,
    private readonly renderedFetcher: RenderedFetcher | null = createScraplingRenderedFetcher(),
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

    for (const dept of this.configs) {
      if (onlyFilter && !onlyFilter.has(dept.deptKey.toLowerCase())) continue;
      if (totalFaculty >= limit) break;

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

        for (const entry of entries) {
          if (totalFaculty >= limit) break;
          const { observations: userObs, entityKey } = entryToUserObservations(
            entry,
            dept,
            pageUrl,
          );
          await ctx.emit(userObs);
          totalObs += userObs.length;

          const labObs = entryToLabObservations(entry, dept, pageUrl, entityKey);
          if (labObs.length > 0) {
            await ctx.emit(labObs);
            totalObs += labObs.length;
            totalLabs++;
          }
          deptCount++;
          totalFaculty++;
        }

        ctx.log(`[${dept.deptKey}] ${deptCount} faculty across ${pagesFetched} rendered page(s)`);
        perDept.push({ deptKey: dept.deptKey, count: deptCount, status: 'ok' });
        continue;
      }

      for (let pageIdx = 0; pageIdx < maxPages && lastPageHadEntries; pageIdx++) {
        if (totalFaculty >= limit) break;
        const pageUrl = pageUrlForIndex(dept.url, pageIdx);
        let html: string;
        try {
          html = await fetchHtml(pageUrl, ctx.options.useCache, this.name);
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

        for (const entry of entries) {
          if (totalFaculty >= limit) break;
          const { observations: userObs, entityKey } = entryToUserObservations(
            entry,
            dept,
            pageUrl,
          );
          await ctx.emit(userObs);
          totalObs += userObs.length;

          const labObs = entryToLabObservations(entry, dept, pageUrl, entityKey);
          if (labObs.length > 0) {
            await ctx.emit(labObs);
            totalObs += labObs.length;
            totalLabs++;
          }
          deptCount++;
          totalFaculty++;
        }

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
