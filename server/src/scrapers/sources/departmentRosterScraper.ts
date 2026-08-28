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
 *     stub Researchers from synthetic keys.
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
import { extractElementTextWithBlockSeparators } from '../utils/htmlText';
import { isPersonProfileOrDirectoryUrl } from '../../utils/researchHomeWebsiteUrl';
import { extractOfficialResearchDescription } from '../../utils/officialResearchDescription';
import {
  clampDescriptionLength,
  sanitizeResearchEntityDescription,
} from '../../utils/descriptionHygiene';
import {
  isFullProseParagraph,
  isPageSectionHeadingPhrase,
  isProseNotTopicPhrase,
  isResearchSectionLabel,
  stripResearchSectionLabelPrefix,
} from '../researchAreaLabels';
import {
  fullDescriptionQuality,
  shortDescriptionQuality,
} from '../../utils/researchEntityDescriptionQuality';
import { unwrapMicrosoftSafeLinksUrl } from '../../utils/safeLinksUrl';
import { DEPARTMENT_ROSTER_HEALTH_FIELD } from '../facultyRosterDepartureReconciler';

const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;
const MAX_PAGES_PER_DEPT = 20; // safety cap on pagination crawl
// Roster descriptions are keyword-synthesized directory one-liners, so they must
// rank below any genuinely extracted research-home description (lab-microsite full
// page 0.82, profile-page 0.55) during field resolution and only win as a fallback.
const ROSTER_SYNTHESIZED_DESCRIPTION_CONFIDENCE = 0.5;
// Grounded prose deterministically extracted from the PI's own official profile
// page (the #481 lever) is real source text, so it must outrank the synthesized
// one-liner while matching the shared profile-page tier used by the lab-microsite
// extractor so a later microsite full-page description still wins.
const ROSTER_PROFILE_DESCRIPTION_CONFIDENCE = 0.55;

/** Minimal structured row produced by every per-department extractor. */
export interface FacultyEntry {
  name: string;
  /**
   * True when `name` is a slug-derived placeholder (the listing exposed only a
   * profile-URL slug, no readable name). Profile enrichment replaces it with the
   * real name read from the profile page. Used by thumbnail-only rosters.
   */
  namePlaceholder?: boolean;
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
  /** Grounded research-home description deterministically extracted from the PI's official profile page (#481 lever). */
  researchHomeDescription?: string;
  /** Grounded one-sentence summary paired with `researchHomeDescription`. */
  researchHomeShortDescription?: string;
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
  /**
   * When true, emit only official-profile person observations and never derive a
   * research entity from a discovered lab link. Used for research-center rosters
   * (e.g. Wright Laboratory) whose faculty already own lab entities elsewhere, so
   * this source contributes official-profile coverage without minting duplicates.
   */
  officialProfileOnly?: boolean;
  /**
   * When true, this "department" is actually a cross-cutting institute/center
   * affiliates roster (e.g. YIBS faculty-affiliates) rather than a listing of
   * people whose home department is `deptName`. A person appears on the page
   * because they are affiliated, not because the institute is their department -
   * every affiliate would otherwise get the identical `deptName` stamped as a
   * fabricated home department (#1427). Suppresses `primaryDepartment` and
   * `departments` emission for both the person and any derived research entity;
   * the person's real department is left to resolve from a better source.
   */
  affiliatesOnly?: boolean;
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
        card.find('.node-teaser__professional-title, .node-teaser__title').first().text(),
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
    const title =
      card.find('.directory-listing-card__subheading').first().text().trim() || undefined;
    const imageUrl = imageUrlFromElement(card, ctx.pageUrl);
    let email: string | undefined;
    let labUrl: string | undefined;
    card.find('.directory-listing-card__link').each((_j, a) => {
      const rawHref = $(a).attr('href') || '';
      if (/^mailto:/i.test(rawHref)) {
        email = rawHref.replace(/^mailto:/i, '').trim() || email;
        return;
      }
      const href = unwrapMicrosoftSafeLinksUrl(rawHref);
      if (/^https?:\/\//i.test(href) && !labUrl && !isGenericLabDirectoryUrl(href)) {
        labUrl = href;
      }
    });
    const bio =
      cleanText(card.find('.directory-listing-card__snippet').first().text()) || undefined;
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
    const profileLink =
      nameLink.length > 0
        ? nameLink
        : row
            .find('.views-field-picture a[href*="/people/"], a.username, a[href*="/people/"]')
            .first();
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
    const email = /^mailto:/i.test(emailHref)
      ? emailHref.replace(/^mailto:/i, '').trim()
      : undefined;

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
      if (
        profileUrl &&
        normalizeUrlForDedupe(absolutize(href, ctx.pageUrl)) === normalizeUrlForDedupe(profileUrl)
      ) {
        return;
      }
      const text = link.text().replace(/\s+/g, ' ').trim();
      const signal = `${text} ${link.attr('aria-label') || ''} ${link.attr('title') || ''} ${href}`;
      if (
        !/\b(website|lab|laboratory|homepage|research group)\b/i.test(signal) &&
        !/^https?:\/\//i.test(href)
      ) {
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

function yaleEmailFromElement(
  $: cheerio.CheerioAPI,
  node: cheerio.Cheerio<any>,
): string | undefined {
  const href = node.find('a[href^="mailto:"]').first().attr('href') || '';
  if (/^mailto:/i.test(href))
    return href
      .replace(/^mailto:/i, '')
      .trim()
      .toLowerCase();

  const decoded = decodeHtmlEntities(node.html() || node.text() || '');
  const mailtoMatch = decoded.match(/mailto:([a-z0-9._%+-]+@yale\.edu)/i);
  if (mailtoMatch) return mailtoMatch[1].toLowerCase();

  return decoded.match(/\b[a-z0-9._%+-]+@yale\.edu\b/i)?.[0]?.toLowerCase();
}

/**
 * Legacy Drupal Views rows used by interdisciplinary programs such as ER&M
 * and WGSS, and by department people-grids such as MBB whose degree-suffixed
 * name links point at medicine.yale.edu profiles. The email field is sometimes
 * written by an inline script with numeric HTML entities (decode the local
 * markup rather than executing it) and sometimes exposed as a plain
 * `.views-field-mail` mailto; read whichever the row provides.
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
    const email =
      yaleEmailFromElement($, row.find('.views-field-field-email').first()) ||
      yaleEmailFromElement($, row.find('.views-field-mail').first());
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
    const email = /^mailto:/i.test(emailHref)
      ? emailHref.replace(/^mailto:/i, '').trim()
      : undefined;
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
 * "Last, First" directory entries (Yale School of Public Health school-wide
 * A-Z index) list the surname before the given name, unlike every other
 * roster on this page which is already "First Last".
 */
function nameFromLastCommaFirst(raw: string): string {
  const [last, first] = raw.split(',').map((part) => cleanText(part));
  if (!first || !last) return cleanText(raw);
  return `${first} ${last}`;
}

/**
 * Yale School of Public Health — school-wide "Faculty Directory by Name"
 * A-Z index. All letters render server-side on one page (no pagination).
 *   <li class="link-items-list__item">
 *     <div><a href="/profile/<slug>/" class="hyperlink">Last, First</a></div>
 *   </li>
 * The listing carries no title/department/email; those are enriched from
 * each faculty member's own official profile page.
 */
export const ysphDirectoryExtractor: FacultyExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const out: FacultyEntry[] = [];
  $('section.generic-anchored-list .link-items-list__item a.hyperlink').each((_i, el) => {
    const link = $(el);
    const href = link.attr('href') || '';
    if (!/\/profile\//.test(href)) return;
    const raw = cleanText(link.text());
    if (!raw) return;
    const name = nameFromLastCommaFirst(raw);
    if (!name) return;
    const profileUrl = absolutize(href, ctx.pageUrl);
    out.push({ name, profileUrl });
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

/**
 * Yale SEAS Chemical & Environmental Engineering — unlike its sibling SEAS
 * department pages, this one renders its roster as static server-side HTML
 * instead of hydrating a client-side `load_faculty` widget:
 *   <a class="stories-item" href="/research-and-faculty/faculty-directory/<slug>">
 *     <h3>Name <em class="fa fa-arrow-right"></em></h3>
 *     <span class="font-bold">Title</span>
 *   </a>
 */
export const chemEnvFacultyExtractor: FacultyExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const out: FacultyEntry[] = [];

  $('a.stories-item').each((_i, el) => {
    const card = $(el);
    const heading = card.find('h3').first();
    const name = normalizeName(
      cleanText(
        heading
          .contents()
          .filter((_j, node) => node.type === 'text')
          .text(),
      ),
    );
    if (!name) return;

    const profileHref = card.attr('href') || '';
    const profileUrl = profileHref ? absolutize(profileHref, ctx.pageUrl) : undefined;
    const title = cleanText(card.find('span.font-bold').first().text()) || undefined;
    const imageUrl = imageUrlFromElement(card, ctx.pageUrl);

    out.push({
      name,
      profileUrl,
      title,
      ...(imageUrl ? { imageUrl } : {}),
    });
  });

  return out;
};

/**
 * Newer Yale Drupal directory theme shared across many FAS humanities and
 * professional-school people pages.
 *   <li class="directory-listing-card">
 *     <a class="directory-listing-card__heading-link" href="/profile/<slug>">Name</a>
 *     <div class="directory-listing-card__subheading"><div>Title…</div></div>
 *     <a class="directory-listing-card__link" href="mailto:…">Email</a>
 *     <div class="directory-listing-card__image"><img srcset="…"></div>
 * One extractor covers every directory rendered with this theme.
 */
export const directoryListingCardExtractor: FacultyExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const out: FacultyEntry[] = [];

  $('.directory-listing-card').each((_i, el) => {
    const card = $(el);
    const nameLink = card.find('.directory-listing-card__heading-link').first();
    const name = normalizeName(cleanText(nameLink.text()));
    if (!name) return;

    const profileHref = nameLink.attr('href') || '';
    const profileUrl = profileHref ? absolutize(profileHref, ctx.pageUrl) : undefined;
    const title =
      cleanText(card.find('.directory-listing-card__subheading').first().text()) || undefined;
    const email = yaleEmailFromElement($, card);
    const imageUrl = imageUrlFromElement(
      card.find('.directory-listing-card__image').first(),
      ctx.pageUrl,
    );

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
 * Yale West Campus "reference-card" component (westcampus.yale.edu). Each card's
 * heading link is the faculty member's own destination — an on-site
 * `/profile/<slug>` page or an off-directory lab/home — which is what gets cited,
 * never the directory root.
 *   <li class="reference-card">
 *     <h3 class="reference-card__heading">
 *       <a class="reference-card__heading-link" href="https://alexlab.yale.edu/">Alex Fixture, PhD</a>
 *     </h3>
 *     <div class="reference-card__subheading"><div>Director, …; Professor of …</div></div>
 *     <div class="reference-card__image"><img src="…" srcset="…"></div>
 */
export const referenceCardExtractor: FacultyExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const out: FacultyEntry[] = [];

  $('.reference-card').each((_i, el) => {
    const card = $(el);
    const nameLink = card.find('.reference-card__heading-link').first();
    const name = normalizeName(cleanText(nameLink.text()));
    const href = nameLink.attr('href') || '';
    if (!name || !href) return;

    const destinationUrl = absolutize(href, ctx.pageUrl);
    const title = cleanText(card.find('.reference-card__subheading').first().text()) || undefined;
    const imageUrl = imageUrlFromElement(card.find('.reference-card__image').first(), ctx.pageUrl);
    // Mint a research home only when the destination is a lab/home site; a profile
    // page is cited as an official-profile source and left for enrichment/dedup.
    const labUrl = isPersonProfileOrDirectoryUrl(destinationUrl) ? undefined : destinationUrl;

    out.push({
      name,
      profileUrl: destinationUrl,
      title,
      labUrl,
      ...(imageUrl ? { imageUrl } : {}),
    });
  });

  return out;
};

/**
 * Yale School of Art "faculty & staff" page (art.yale.edu) - a Yale-CMS
 * "scrolling-list-module" component: several `<ul>` sections (Academic
 * Leadership, program areas, interdepartmental, Undergraduate, faculty
 * emeriti, Yale Norfolk School of Art, Administration and Staff, ...), each
 * `<li>` an `<a href="/<Slug>">Name</a>, Title` entry (#1334 Tier C - the
 * per-person links this issue originally reported missing are present on the
 * current page). The same person appears in several sections (e.g. a dean is
 * also on the Faculty Governing Board), so entries are deduped by destination
 * URL, keeping the longest title seen. "Administration and Staff" lists
 * non-research staff, not faculty, and is skipped.
 *   <div class="scrolling-list-module">
 *     <h4 class="scrolling-list-module__title">Academic Leadership</h4>
 *     <ul class="scrolling-list-module__list">
 *       <li class="scrolling-list-module__list-item">
 *         <a href="/KymberlyPinder">Kymberly Pinder</a>, Stavros Niarchos Foundation Dean
 *       </li>
 */
export const scrollingListModuleExtractor: FacultyExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const byUrl = new Map<string, FacultyEntry>();
  const pageHost = hostnameOf(ctx.pageUrl);

  $('.scrolling-list-module').each((_i, section) => {
    const heading = cleanText($(section).find('.scrolling-list-module__title').first().text());
    if (/administration and staff/i.test(heading)) return;

    $(section)
      .find('.scrolling-list-module__list-item')
      .each((_j, el) => {
        const item = $(el);
        const link = item.find('a').first();
        const name = normalizeName(cleanText(link.text()));
        const href = link.attr('href') || '';
        if (!name || !href) return;

        const destinationUrl = absolutize(href, ctx.pageUrl);
        const fullText = cleanText(item.text());
        const title =
          (fullText.startsWith(name)
            ? cleanText(fullText.slice(name.length).replace(/^[,;]\s*/, ''))
            : '') || undefined;
        // Mint a research home only when the destination is off-directory (a
        // personal or lab site); the faculty member's own art.yale.edu bio page
        // is cited as an official-profile source and left for enrichment/dedup.
        const isOwnProfile =
          hostnameOf(destinationUrl) === pageHost || isPersonProfileOrDirectoryUrl(destinationUrl);
        const labUrl = isOwnProfile ? undefined : destinationUrl;

        const existing = byUrl.get(destinationUrl);
        if (existing) {
          if (title && (!existing.title || title.length > existing.title.length)) {
            existing.title = title;
          }
          return;
        }
        byUrl.set(destinationUrl, { name, profileUrl: destinationUrl, title, labUrl });
      });
  });

  return Array.from(byUrl.values());
};

/**
 * Drupal Views rendered as an HTML table (as opposed to the `.views-row` div
 * grid handled by `viewsRowPersonExtractor`). Used by several FAS humanities
 * departments.
 *   <tr>
 *     <td class="views-field views-field-picture"><img></td>
 *     <td class="views-field views-field-name"><a class="username" href="/people/…">Name</a></td>
 *     <td class="views-field views-field-field-title">Title…</td>
 */
export const viewsTableRowExtractor: FacultyExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const out: FacultyEntry[] = [];

  $('tr').each((_i, el) => {
    const row = $(el);
    const nameCell = row.find('td.views-field-name').first();
    if (!nameCell.length) return;

    const nameLink = nameCell.find('a.username, a').first();
    const name = normalizeName(cleanText(nameLink.text() || nameCell.text()));
    if (!name) return;

    const profileHref = nameLink.attr('href') || '';
    const profileUrl = profileHref ? absolutize(profileHref, ctx.pageUrl) : undefined;
    const title =
      cleanText(row.find('[class*="views-field-field-title"]').first().text()) || undefined;
    const email = yaleEmailFromElement($, row);
    const imageUrl = imageUrlFromElement(row.find('.views-field-picture').first(), ctx.pageUrl);

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
 * YSM Drupal "profile-grid-item" cards, used by several medicine.yale.edu
 * research-center rosters (Stem Cell Center, Physician Associate Program).
 *   <div class="profile-grid-item">
 *     <span class="profile-grid-item__name--link">Name, PhD</span>
 *     <p class="profile-grid-item__title">Role</p>
 *     <a href="/stemcell/profile/<slug>/">View Full Profile</a>
 *     <div class="profile-grid-item__thumbnail-container"><img></div>
 */
export const profileGridItemExtractor: FacultyExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const out: FacultyEntry[] = [];

  $('.profile-grid-item').each((_i, el) => {
    const card = $(el);
    const name = normalizeName(
      cleanText(card.find('.profile-grid-item__name--link').first().text()),
    );
    if (!name) return;

    const profileHref =
      card.find('a[href*="/profile/"]').first().attr('href') ||
      card.find('.profile-grid-item__link-details-container a').first().attr('href') ||
      '';
    const profileUrl = profileHref ? absolutize(profileHref, ctx.pageUrl) : undefined;
    const titles = card
      .find('.profile-grid-item__title')
      .map((_j, t) => cleanText($(t).text()))
      .get()
      .filter(Boolean);
    const title = titles.sort((a, b) => b.length - a.length)[0] || undefined;
    const imageUrl = imageUrlFromElement(
      card.find('.profile-grid-item__thumbnail-container').first(),
      ctx.pageUrl,
    );

    out.push({ name, profileUrl, title, ...(imageUrl ? { imageUrl } : {}) });
  });

  return out;
};

/**
 * Yale SOM Drupal `node-teaser--faculty` rows.
 *   <article class="node-teaser node-teaser--faculty">
 *     <h3 class="node-teaser__heading"><a href="/faculty-research/faculty-directory/<slug>">Name</a></h3>
 *     <div class="node-teaser__job-title">Title</div>
 *     <div class="node-teaser__image"><img></div>
 */
export const nodeTeaserFacultyExtractor: FacultyExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const out: FacultyEntry[] = [];

  $('article.node-teaser--faculty').each((_i, el) => {
    const card = $(el);
    const nameLink = card.find('.node-teaser__heading a').first();
    const name = normalizeName(
      cleanText(nameLink.text() || card.find('.node-teaser__heading').first().text()),
    );
    if (!name) return;

    const profileHref = nameLink.attr('href') || '';
    const profileUrl = profileHref ? absolutize(profileHref, ctx.pageUrl) : undefined;
    const title = cleanText(card.find('.node-teaser__job-title').first().text()) || undefined;
    const imageUrl = imageUrlFromElement(card.find('.node-teaser__image').first(), ctx.pageUrl);

    out.push({ name, profileUrl, title, ...(imageUrl ? { imageUrl } : {}) });
  });

  return out;
};

/**
 * Jackson School Drupal `profile--component` cards (the newer
 * professors-global-affairs directory, distinct from the WordPress
 * `page-item-person` layout handled by `jacksonPersonCardExtractor`).
 *   <article class="profile profile--component">
 *     <div class="profile__content"><h3><a href="/directory/<slug>">Name</a></h3>
 *       <ul class="profile-positions">Title</ul></div>
 *     <div class="profile__media"><img></div>
 */
export const jacksonProfileComponentExtractor: FacultyExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const out: FacultyEntry[] = [];

  $('article.profile--component').each((_i, el) => {
    const card = $(el);
    const nameLink = card.find('.profile__content h3 a, .profile__content h3').first();
    const name = normalizeName(cleanText(nameLink.text()));
    if (!name) return;

    const profileHref = card.find('.profile__content h3 a').first().attr('href') || '';
    const profileUrl = profileHref ? absolutize(profileHref, ctx.pageUrl) : undefined;
    const title = cleanText(card.find('.profile-positions').first().text()) || undefined;
    const imageUrl = imageUrlFromElement(card.find('.profile__media').first(), ctx.pageUrl);

    out.push({ name, profileUrl, title, ...(imageUrl ? { imageUrl } : {}) });
  });

  return out;
};

/**
 * Yale Law School Drupal `node--type-person` filtered-listing cards.
 *   <article class="node--type-person">
 *     <h3><a href="/<slug>"><span class="field--name-title">Name</span></a></h3>
 *     <div class="field--name-field-title">Title</div>
 */
export const lawPersonListingExtractor: FacultyExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const out: FacultyEntry[] = [];

  $('article.node--type-person').each((_i, el) => {
    const card = $(el);
    const name = normalizeName(
      cleanText(card.find('.field--name-title').first().text() || card.find('h3 a').first().text()),
    );
    if (!name) return;

    const profileHref = card.find('h3 a').first().attr('href') || '';
    const profileUrl = profileHref ? absolutize(profileHref, ctx.pageUrl) : undefined;
    const title = cleanText(card.find('.field--name-field-title').first().text()) || undefined;
    const imageUrl = imageUrlFromElement(card, ctx.pageUrl);

    out.push({ name, profileUrl, title, ...(imageUrl ? { imageUrl } : {}) });
  });

  return out;
};

/**
 * Yale School of Nursing Drupal faculty-directory nodes.
 *   <div class="node-faculty-directory">
 *     <a class="group-faculty-link-wrapper" href="/faculty-research/faculty-directory/<slug>">
 *     <div class="field-name-faculty-firstname-lastname"><h2><span>Name</span></h2></div>
 */
export const nursingFacultyExtractor: FacultyExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const out: FacultyEntry[] = [];

  $('.node-faculty-directory').each((_i, el) => {
    const card = $(el);
    const name = normalizeName(
      cleanText(card.find('.field-name-faculty-firstname-lastname').first().text()),
    );
    if (!name) return;

    const profileHref =
      card.find('a.group-faculty-link-wrapper').first().attr('href') ||
      card.find('a[href*="/faculty-directory/"]').first().attr('href') ||
      '';
    const profileUrl = profileHref ? absolutize(profileHref, ctx.pageUrl) : undefined;
    const title =
      cleanText(
        card
          .find('.field-name-faculty-title, .field-name-position, .field-name-title')
          .first()
          .text(),
      ) || undefined;
    const imageUrl = imageUrlFromElement(card.find('.field-name-field-photo').first(), ctx.pageUrl);

    out.push({ name, profileUrl, title, ...(imageUrl ? { imageUrl } : {}) });
  });

  return out;
};

/**
 * Yale School of Music Drupal `node--type-person` cards. The listing hydrates
 * client-side, so this runs against rendered HTML (renderedExtractor). Each
 * card carries the person on the article's `about` attribute and the name on
 * the profile image's alt text.
 *   <article about="/people/<slug>" class="node node--type-person node--view-mode-card">
 *     <img alt="Name" src="...">
 */
const nameFromPeopleSlug = (about: string): string => {
  const match = about.match(/\/people\/([^/?#]+)/);
  if (!match) return '';
  const titleCased = decodeURIComponent(match[1])
    .split('-')
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
  return normalizeName(titleCased);
};

export const nodePersonCardExtractor: FacultyExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const out: FacultyEntry[] = [];

  $('article.node--type-person').each((_i, el) => {
    const card = $(el);
    const about = card.attr('about') || card.find('a[href*="/people/"]').first().attr('href') || '';
    const name =
      normalizeName(cleanText(card.find('img[alt]').first().attr('alt') || '')) ||
      nameFromPeopleSlug(about);
    if (!name) return;

    const profileUrl = about ? absolutize(about, ctx.pageUrl) : undefined;
    const title =
      cleanText(
        card
          .find(
            '.paragraph--type--title-affiliation, [class*="title-affiliation"], .field--name-field-title',
          )
          .first()
          .text(),
      ) || undefined;
    const imageUrl = imageUrlFromElement(card, ctx.pageUrl);

    out.push({ name, profileUrl, title, ...(imageUrl ? { imageUrl } : {}) });
  });

  return out;
};

/**
 * Legacy Drupal field-collection person rows, used by the YIBS faculty-affiliates
 * roster. Each affiliate is a `field-collection-item-field-person-info` block
 * whose `.field-name-field-person-description` holds an `<h3>` name (often linked
 * to the affiliate's home-department profile or lab site) and a photo field.
 * Affiliates are cross-listed, so this is paired with `officialProfileOnly` to
 * enrich existing entities rather than mint duplicates.
 */
export const fieldCollectionPersonExtractor: FacultyExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const out: FacultyEntry[] = [];

  $('[class*="field-collection-item-field-person-info"]').each((_i, el) => {
    const card = $(el);
    const desc = card.find('.field-name-field-person-description').first();
    const nameLink = desc.find('h3 a').first();
    const name = normalizeName(cleanText(nameLink.text() || desc.find('h3').first().text()));
    if (!name) return;

    const href = nameLink.attr('href') || '';
    const profileUrl = /^https?:\/\//i.test(href) ? href : undefined;
    const title = cleanText(desc.find('p em').first().text()).replace(/[,;]\s*$/, '') || undefined;
    const imageUrl = imageUrlFromElement(
      card.find('.field-name-field-person-photo').first(),
      ctx.pageUrl,
    );

    out.push({ name, profileUrl, title, ...(imageUrl ? { imageUrl } : {}) });
  });

  return out;
};

/**
 * Derive a display-name placeholder from a faculty profile slug such as
 * `/faculty/318-emily-abruzzo` (strip a leading numeric id, title-case tokens).
 * Placeholder only: profile enrichment replaces it with the real profile name.
 */
function nameFromFacultySlug(href: string): string {
  const segment = href.split(/[?#]/)[0].split('/').filter(Boolean).pop() || '';
  const nameSlug = segment.replace(/^\d+-/, '');
  return nameSlug
    .split('-')
    .map((token) => (token ? `${token.charAt(0).toUpperCase()}${token.slice(1)}` : token))
    .join(' ')
    .trim();
}

const GENERIC_DIRECTORY_NAME_TOKENS = new Set([
  'faculty',
  'staff',
  'people',
  'directory',
  'home',
  'profile',
  'members',
  'affiliates',
  'overview',
  'index',
  'and',
]);

function isPersonNameShaped(name: string): boolean {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return false;
  return tokens.every(
    (token) => /^\p{Lu}/u.test(token) && !GENERIC_DIRECTORY_NAME_TOKENS.has(token.toLowerCase()),
  );
}

/**
 * Read a person's name from their official profile page's og:title / <title>,
 * dropping the trailing site-name segment (e.g. "Emily Abruzzo - Yale Architecture").
 * Returns undefined when the leading segment does not look like a personal name so a
 * generic listing/section title cannot overwrite a reliable slug-derived placeholder.
 */
function personNameFromProfileHtml($: cheerio.CheerioAPI): string | undefined {
  const raw =
    $('meta[property="og:title"]').attr('content') || cleanText($('title').first().text());
  const leading = cleanText(raw).split(/\s+[|–—-]\s+/)[0];
  if (!leading || !isPersonNameShaped(leading)) return undefined;
  return leading;
}

/**
 * Yale School of Architecture faculty grid. Cards expose only a headshot linking
 * `/faculty/<id>-<name-slug>`; the readable name is on the profile page, so this
 * emits a slug placeholder plus `namePlaceholder` and lets enrichment fill the
 * real name. The JS "infinite load" grid degrades to server-rendered `?page=N`
 * pages, so the paginated config walks the whole roster statically.
 */
export const facultyThumbnailExtractor: FacultyExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const out: FacultyEntry[] = [];

  $('.faculty-member-thumbnail').each((_i, el) => {
    const card = $(el);
    const href = card.find('a.blank-link, a[href*="/faculty/"]').first().attr('href') || '';
    if (!/\/faculty\/\d+-/.test(href)) return;

    const name = normalizeName(nameFromFacultySlug(href));
    if (!name) return;

    const profileUrl = absolutize(href, ctx.pageUrl);
    const imageUrl = imageUrlFromElement(card, ctx.pageUrl);

    out.push({ name, namePlaceholder: true, profileUrl, ...(imageUrl ? { imageUrl } : {}) });
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
    deptKey: 'applied-physics',
    deptName: 'Applied Physics',
    schoolName: 'Yale School of Engineering & Applied Science',
    url: 'https://engineering.yale.edu/academic-study/departments/applied-physics/people',
    paginated: false,
    extractor: csJsRenderedStub,
    dataUrl:
      'https://engineering.yale.edu/academic-study/departments/applied-physics/people/load_faculty/4867',
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
    deptKey: 'biomedical-engineering',
    deptName: 'Biomedical Engineering',
    schoolName: 'Yale School of Engineering & Applied Science',
    url: 'https://engineering.yale.edu/academic-study/departments/biomedical-engineering/faculty',
    paginated: false,
    extractor: csJsRenderedStub,
    dataUrl:
      'https://engineering.yale.edu/academic-study/departments/biomedical-engineering/faculty/load_faculty/4868',
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
    deptKey: 'chemical-environmental-engineering',
    deptName: 'Chemical & Environmental Engineering',
    schoolName: 'Yale School of Engineering & Applied Science',
    url: 'https://engineering.yale.edu/academic-study/departments/chemical-and-environmental-engineering/faculty',
    paginated: false,
    extractor: chemEnvFacultyExtractor,
  },
  {
    deptKey: 'electrical-computer-engineering',
    deptName: 'Electrical & Computer Engineering',
    schoolName: 'Yale School of Engineering & Applied Science',
    url: 'https://engineering.yale.edu/academic-study/departments/electrical-and-computer-engineering/faculty',
    paginated: false,
    extractor: csJsRenderedStub,
    dataUrl:
      'https://engineering.yale.edu/academic-study/departments/electrical-and-computer-engineering/faculty/load_faculty/266',
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
    deptKey: 'mechanical-engineering',
    deptName: 'Mechanical Engineering & Materials Science',
    schoolName: 'Yale School of Engineering & Applied Science',
    url: 'https://engineering.yale.edu/academic-study/departments/mechanical-engineering/faculty',
    paginated: false,
    extractor: csJsRenderedStub,
    dataUrl:
      'https://engineering.yale.edu/academic-study/departments/mechanical-engineering/faculty/load_faculty/4870',
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
    deptKey: 'materials-science',
    deptName: 'Mechanical Engineering & Materials Science',
    schoolName: 'Yale School of Engineering & Applied Science',
    url: 'https://engineering.yale.edu/academic-study/departments/materials-science/faculty',
    paginated: false,
    extractor: csJsRenderedStub,
    dataUrl:
      'https://engineering.yale.edu/academic-study/departments/materials-science/faculty/load_faculty/4869',
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
    extractor: mcdbExtractor,
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
    schoolName: 'Jackson School of Global Affairs',
    url: 'https://jackson.yale.edu/faculty-research/lecturers-visiting-faculty',
    paginated: false,
    extractor: jacksonProfileComponentExtractor,
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
  {
    deptKey: 'wright-lab',
    deptName: 'Physics',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://wlab.yale.edu/people/faculty/primary-faculty',
    paginated: false,
    extractor: mcdbExtractor,
    emitPersonalResearchEntities: false,
    officialProfileOnly: true,
  },
  {
    deptKey: 'mbb',
    deptName: 'Molecular Biophysics & Biochemistry',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://mbb.yale.edu/people/faculty',
    paginated: false,
    extractor: viewsRowPersonExtractor,
  },
  {
    deptKey: 'black-studies',
    deptName: 'Black Studies',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://blackstudies.yale.edu/people',
    paginated: false,
    extractor: viewsRowPersonExtractor,
  },
  {
    deptKey: 'classics',
    deptName: 'Classics',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://classics.yale.edu/people/faculty',
    paginated: false,
    extractor: viewsRowPersonExtractor,
  },
  {
    deptKey: 'nelc',
    deptName: 'Near Eastern Languages & Civilizations',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://nelc.yale.edu/people/faculty',
    paginated: false,
    extractor: viewsRowPersonExtractor,
  },
  {
    deptKey: 'german',
    deptName: 'Germanic Languages & Literatures',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://german.yale.edu/people/faculty',
    paginated: false,
    extractor: viewsRowPersonExtractor,
  },
  {
    deptKey: 'ysph',
    deptName: 'Yale School of Public Health',
    schoolName: 'Yale School of Public Health',
    url: 'https://ysph.yale.edu/school-of-public-health-faculty/directory-name/',
    paginated: false,
    extractor: ysphDirectoryExtractor,
  },
  {
    deptKey: 'english',
    deptName: 'English',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://english.yale.edu/people/ladder-faculty',
    paginated: false,
    extractor: viewsTableRowExtractor,
  },
  {
    deptKey: 'eeb',
    deptName: 'Ecology and Evolutionary Biology',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://eeb.yale.edu/people/faculty',
    paginated: false,
    extractor: viewsTableRowExtractor,
  },
  {
    deptKey: 'film-media-studies',
    deptName: 'Film and Media Studies',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://filmstudies.yale.edu/people/faculty',
    paginated: false,
    extractor: viewsTableRowExtractor,
  },
  {
    deptKey: 'spanish-portuguese',
    deptName: 'Spanish and Portuguese',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://span-port.yale.edu/people/faculty',
    paginated: false,
    extractor: viewsTableRowExtractor,
  },
  {
    deptKey: 'sociology',
    deptName: 'Sociology',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://sociology.yale.edu/faculty',
    paginated: false,
    extractor: directoryListingCardExtractor,
  },
  {
    deptKey: 'philosophy',
    deptName: 'Philosophy',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://philosophy.yale.edu/faculty',
    paginated: false,
    extractor: directoryListingCardExtractor,
  },
  {
    deptKey: 'religious-studies',
    deptName: 'Religious Studies',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://religiousstudies.yale.edu/people/core-faculty',
    paginated: false,
    extractor: directoryListingCardExtractor,
  },
  {
    deptKey: 'linguistics',
    deptName: 'Linguistics',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://ling.yale.edu/people/linguistics-faculty',
    paginated: false,
    extractor: directoryListingCardExtractor,
  },
  {
    deptKey: 'comparative-literature',
    deptName: 'Comparative Literature',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://complit.yale.edu/people/faculty',
    paginated: false,
    extractor: directoryListingCardExtractor,
  },
  {
    deptKey: 'french',
    deptName: 'French',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://french.yale.edu/people/professors',
    paginated: false,
    extractor: directoryListingCardExtractor,
  },
  {
    deptKey: 'slavic',
    deptName: 'Slavic Languages and Literatures',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://slavic.yale.edu/directory/faculty',
    paginated: false,
    extractor: directoryListingCardExtractor,
  },
  {
    deptKey: 'italian',
    deptName: 'Italian Language and Literature',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://italian.yale.edu/people/faculty',
    paginated: false,
    extractor: directoryListingCardExtractor,
  },
  {
    deptKey: 'divinity',
    deptName: 'Divinity',
    schoolName: 'Yale Divinity School',
    url: 'https://divinity.yale.edu/about/faculty-directory',
    paginated: false,
    extractor: directoryListingCardExtractor,
  },
  {
    deptKey: 'chemistry',
    deptName: 'Chemistry',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://chem.yale.edu/people/faculty',
    paginated: false,
    extractor: directoryListingCardExtractor,
  },
  {
    deptKey: 'stem-cell-center',
    deptName: 'Stem Cell Center',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/stemcell/people/listing/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'physician-associate-program',
    deptName: 'Physician Associate Program',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/pa/profession/meet-the-team/',
    paginated: false,
    extractor: profileGridItemExtractor,
  },
  {
    deptKey: 'som',
    deptName: 'Accounting',
    schoolName: 'Yale School of Management',
    url: 'https://som.yale.edu/faculty-research/faculty-directory/accounting',
    paginated: false,
    extractor: nodeTeaserFacultyExtractor,
  },
  {
    deptKey: 'som',
    deptName: 'Economics',
    schoolName: 'Yale School of Management',
    url: 'https://som.yale.edu/faculty-research/faculty-directory/economics',
    paginated: false,
    extractor: nodeTeaserFacultyExtractor,
  },
  {
    deptKey: 'som',
    deptName: 'Finance',
    schoolName: 'Yale School of Management',
    url: 'https://som.yale.edu/faculty-research/faculty-directory/finance',
    paginated: false,
    extractor: nodeTeaserFacultyExtractor,
  },
  {
    deptKey: 'som',
    deptName: 'Marketing',
    schoolName: 'Yale School of Management',
    url: 'https://som.yale.edu/faculty-research/faculty-directory/marketing',
    paginated: false,
    extractor: nodeTeaserFacultyExtractor,
  },
  {
    deptKey: 'som',
    deptName: 'Operations',
    schoolName: 'Yale School of Management',
    url: 'https://som.yale.edu/faculty-research/faculty-directory/operations',
    paginated: false,
    extractor: nodeTeaserFacultyExtractor,
  },
  {
    deptKey: 'som',
    deptName: 'Organizational Behavior',
    schoolName: 'Yale School of Management',
    url: 'https://som.yale.edu/faculty-research/faculty-directory/organizational-behavior',
    paginated: false,
    extractor: nodeTeaserFacultyExtractor,
  },
  {
    deptKey: 'jackson-global-affairs',
    deptName: 'Global Affairs',
    schoolName: 'Jackson School of Global Affairs',
    url: 'https://jackson.yale.edu/faculty-research/professors-global-affairs',
    paginated: false,
    extractor: jacksonProfileComponentExtractor,
  },
  {
    deptKey: 'nursing',
    deptName: 'Nursing',
    schoolName: 'Yale School of Nursing',
    url: 'https://nursing.yale.edu/faculty-research/faculty-directory',
    paginated: false,
    extractor: nursingFacultyExtractor,
  },
  {
    deptKey: 'law',
    deptName: 'Law',
    schoolName: 'Yale Law School',
    url: 'https://law.yale.edu/faculty?type=faculty',
    // Load More is client-side, but the same Drupal view honors server-side
    // ?page=N pagination, so the static path walks the whole roster (#1348).
    paginated: true,
    extractor: lawPersonListingExtractor,
  },
  {
    deptKey: 'west-campus',
    deptName: 'West Campus Institutes',
    schoolName: 'Yale West Campus',
    url: 'https://westcampus.yale.edu/about-us/faculty',
    paginated: false,
    extractor: referenceCardExtractor,
  },
  {
    deptKey: 'art',
    deptName: 'Art',
    schoolName: 'Yale School of Art',
    url: 'https://www.art.yale.edu/about/people/faculty-and-staff',
    paginated: false,
    extractor: scrollingListModuleExtractor,
  },
  {
    deptKey: 'school-of-music',
    deptName: 'Music',
    schoolName: 'Yale School of Music',
    url: 'https://music.yale.edu/meet-our-faculty',
    paginated: false,
    extractor: nodePersonCardExtractor,
    renderedExtractor: nodePersonCardExtractor,
    renderWaitSelector: 'article.node--type-person',
    jsRenderedSkip: true,
  },
  {
    deptKey: 'yibs',
    deptName: 'Biospheric Studies',
    schoolName: 'Yale Institute for Biospheric Studies',
    url: 'https://yibs.yale.edu/people/faculty-affiliates',
    paginated: false,
    extractor: fieldCollectionPersonExtractor,
    officialProfileOnly: true,
    affiliatesOnly: true,
  },
  {
    deptKey: 'architecture',
    deptName: 'Architecture',
    schoolName: 'Yale School of Architecture',
    url: 'https://www.architecture.yale.edu/faculty',
    paginated: true,
    extractor: facultyThumbnailExtractor,
  },
  {
    deptKey: 'ysm-cell-biology',
    deptName: 'Cell Biology',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/cellbio/people/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-immunobiology',
    deptName: 'Immunobiology',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/immuno/people/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-pharmacology',
    deptName: 'Pharmacology',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/pharm/people/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-genetics',
    deptName: 'Genetics',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/genetics/people/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-cellular-molecular-physiology',
    deptName: 'Cellular & Molecular Physiology',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/physiology/faculty/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-microbial-pathogenesis',
    deptName: 'Microbial Pathogenesis',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/micropath/people/primary-faculty/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-microbial-pathogenesis-research',
    deptName: 'Microbial Pathogenesis',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/micropath/people/research-faculty/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-comparative-medicine',
    deptName: 'Comparative Medicine',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/compmed/people/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-pathology',
    deptName: 'Pathology',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/pathology/people/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-neuroscience',
    deptName: 'Neuroscience',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/neuroscience/people/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-biomedical-informatics-data-science',
    deptName: 'Biomedical Informatics & Data Science',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/biomedical-informatics-data-science/people/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-history-of-medicine',
    deptName: 'History of Medicine',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/histmed/people/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-neurosurgery',
    deptName: 'Neurosurgery',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/neurosurgery/people/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-dermatology',
    deptName: 'Dermatology',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/dermatology/people/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-emergency-medicine',
    deptName: 'Emergency Medicine',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/emergencymed/people/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-orthopaedics',
    deptName: 'Orthopaedics & Rehabilitation',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/ortho/people/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-therapeutic-radiology',
    deptName: 'Therapeutic Radiology',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/therapeuticradiology/people/faculty/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-urology',
    deptName: 'Urology',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/urology/faculty/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-laboratory-medicine',
    deptName: 'Laboratory Medicine',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/labmed/faculty/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-ophthalmology',
    deptName: 'Ophthalmology & Visual Science',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/eyes/people/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-radiology-biomedical-imaging',
    deptName: 'Radiology & Biomedical Imaging',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/radiology-biomedical-imaging/faculty-and-staff/clinical-faculty-by-section/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-pediatrics',
    deptName: 'Pediatrics',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/pediatrics/people/',
    paginated: false,
    extractor: ysphDirectoryExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-psychiatry',
    deptName: 'Psychiatry',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/psychiatry/people/',
    paginated: false,
    extractor: ysphDirectoryExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-neurology',
    deptName: 'Neurology',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/neurology/people/',
    paginated: false,
    extractor: ysphDirectoryExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-obgyn',
    deptName: 'Obstetrics, Gynecology & Reproductive Sciences',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/obgyn/people/',
    paginated: false,
    extractor: ysphDirectoryExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-anesthesiology',
    deptName: 'Anesthesiology',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/anesthesiology/people/',
    paginated: false,
    extractor: ysphDirectoryExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-internal-medicine',
    deptName: 'Internal Medicine',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/internal-medicine/people/faculty/',
    paginated: false,
    extractor: ysphDirectoryExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-child-study-center',
    deptName: 'Child Study Center',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/childstudy/faculty/',
    paginated: false,
    extractor: ysphDirectoryExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysm-surgery',
    deptName: 'Surgery',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/surgery/directory/',
    paginated: false,
    extractor: ysphDirectoryExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysph-biostatistics',
    deptName: 'Biostatistics',
    schoolName: 'Yale School of Public Health',
    url: 'https://ysph.yale.edu/school-of-public-health-faculty/biostatistics/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysph-chronic-disease-epidemiology',
    deptName: 'Chronic Disease Epidemiology',
    schoolName: 'Yale School of Public Health',
    url: 'https://ysph.yale.edu/school-of-public-health-faculty/chronic-disease-epidemiology/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysph-environmental-health-sciences',
    deptName: 'Environmental Health Sciences',
    schoolName: 'Yale School of Public Health',
    url: 'https://ysph.yale.edu/school-of-public-health-faculty/environmental-health-sciences/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysph-epidemiology-microbial-diseases',
    deptName: 'Epidemiology of Microbial Diseases',
    schoolName: 'Yale School of Public Health',
    url: 'https://ysph.yale.edu/school-of-public-health-faculty/epidemiology-of-microbial-diseases/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysph-global-health',
    deptName: 'Global Health',
    schoolName: 'Yale School of Public Health',
    url: 'https://ysph.yale.edu/school-of-public-health-faculty/global-health/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysph-health-policy-management',
    deptName: 'Health Policy & Management',
    schoolName: 'Yale School of Public Health',
    url: 'https://ysph.yale.edu/school-of-public-health-faculty/health-policy-and-management/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'ysph-social-behavioral-sciences',
    deptName: 'Social & Behavioral Sciences',
    schoolName: 'Yale School of Public Health',
    url: 'https://ysph.yale.edu/school-of-public-health-faculty/social-behavioral-sciences/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
  },
  {
    deptKey: 'applied-mathematics',
    deptName: 'Applied Mathematics',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://applied.math.yale.edu/people/faculty',
    paginated: false,
    extractor: viewsTableRowExtractor,
  },
  {
    deptKey: 'history-science-medicine-public-health',
    deptName: 'History of Science, Medicine & Public Health',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://hshm.yale.edu/people/faculty',
    paginated: false,
    extractor: viewsTableRowExtractor,
  },
  {
    deptKey: 'judaic-studies',
    deptName: 'Judaic Studies',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://judaicstudies.yale.edu/people',
    paginated: false,
    extractor: mcdbExtractor,
  },
  {
    deptKey: 'council-east-asian-studies',
    deptName: 'Council on East Asian Studies',
    schoolName: 'MacMillan Center for International and Area Studies at Yale',
    url: 'https://macmillan.yale.edu/eastasia/people',
    paginated: false,
    extractor: econExtractor,
    officialProfileOnly: true,
    affiliatesOnly: true,
  },
  {
    deptKey: 'south-asian-studies-council',
    deptName: 'South Asian Studies Council',
    schoolName: 'MacMillan Center for International and Area Studies at Yale',
    url: 'https://macmillan.yale.edu/southasia/people?person_type=80&departments_target_id=All&academic_year_id=All',
    paginated: false,
    extractor: econExtractor,
    officialProfileOnly: true,
    affiliatesOnly: true,
  },
  {
    deptKey: 'ysph-climate-change-and-health',
    deptName: 'Climate Change and Health',
    schoolName: 'Yale School of Public Health',
    url: 'https://ysph.yale.edu/school-of-public-health-faculty/climate-change-and-health-concentration/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
    affiliatesOnly: true,
  },
  {
    deptKey: 'ysph-implementation-science',
    deptName: 'Implementation Science',
    schoolName: 'Yale School of Public Health',
    url: 'https://ysph.yale.edu/school-of-public-health-faculty/implementation-science-concentration/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
    affiliatesOnly: true,
  },
  {
    deptKey: 'ysph-maternal-child-health-promotion',
    deptName: 'Maternal and Child Health Promotion',
    schoolName: 'Yale School of Public Health',
    url: 'https://ysph.yale.edu/school-of-public-health-faculty/maternal-child-health-promotion-track/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
    affiliatesOnly: true,
  },
  {
    deptKey: 'ysph-public-health-modeling',
    deptName: 'Public Health Modeling',
    schoolName: 'Yale School of Public Health',
    url: 'https://ysph.yale.edu/school-of-public-health-faculty/public-health-modeling/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
    affiliatesOnly: true,
  },
  {
    deptKey: 'ysph-us-health-justice',
    deptName: 'U.S. Health Justice',
    schoolName: 'Yale School of Public Health',
    url: 'https://ysph.yale.edu/school-of-public-health-faculty/us-health-justice-concentration/',
    paginated: false,
    extractor: profileGridItemExtractor,
    officialProfileOnly: true,
    affiliatesOnly: true,
  },
];

// ---------------------------------------------------------------------------
// Internal helpers (network + emission shape)
// ---------------------------------------------------------------------------

function absolutize(href: string, base: string): string {
  try {
    return unwrapMicrosoftSafeLinksUrl(new URL(href, base).toString());
  } catch {
    return href;
  }
}

function cleanText(value: string | undefined | null): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
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

function elementTextWithChildSeparators($: cheerio.CheerioAPI, el: AnyNode): string {
  const rawParts = $(el)
    .contents()
    .map((_i, node) => cleanText($(node).text()))
    .get()
    .filter(Boolean);
  if (rawParts.length > 0) {
    return rawParts.filter((part) => !isFullProseParagraph(part)).join('; ');
  }
  const whole = cleanText($(el).text());
  return isFullProseParagraph(whole) ? '' : whole;
}

function stripTopicLabelPrefix(value: string): string {
  return stripResearchSectionLabelPrefix(value);
}

function isTopicLabelChrome(value: string): boolean {
  const cleaned = cleanText(value);
  if (!cleaned) return true;
  if (/:$/.test(cleaned)) return true;
  return (
    isResearchSectionLabel(cleaned) ||
    isProseNotTopicPhrase(cleaned) ||
    isPageSectionHeadingPhrase(cleaned)
  );
}

function splitTopicText(value: string | undefined | null): string[] {
  const cleaned = String(value || '').trim();
  if (!cleaned) return [];
  const parts = cleaned
    .split(/[,;|•\n\r]+/)
    .map((part) => stripTopicLabelPrefix(part))
    .filter((part) => part.length > 1 && !/^[-–—]+$/.test(part) && !isTopicLabelChrome(part));
  return uniqueStrings(parts);
}

const nonResearchTopicLabels = new Set([
  'experimentalist',
  'theorist',
  'observational',
  'observer',
  'emeritus',
]);

function shouldPreserveTopicWordCasing(word: string): boolean {
  return (
    /^[A-Z0-9&-]{2,}$/.test(word) ||
    /[A-Z]/.test(word.slice(1)) ||
    /[/+.]/.test(word) ||
    /-[A-Z]/.test(word)
  );
}

function lowerTopicPhrase(value: string): string {
  return cleanText(value)
    .split(/\s+/)
    .map((word) =>
      shouldPreserveTopicWordCasing(word)
        ? word
        : `${word.charAt(0).toLowerCase()}${word.slice(1)}`,
    )
    .join(' ');
}

function rosterTopicDescription(topics: string[] = []): string {
  const usefulTopics = uniqueStrings(topics)
    .filter(
      (topic) => !nonResearchTopicLabels.has(topic.toLowerCase()) && !isTopicLabelChrome(topic),
    )
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
    link.closest(
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
    ).length > 0
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
    .replace(/\bDownload CV\b/gi, ' ')
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
      const text = cleanProfileSectionText(extractElementTextWithBlockSeparators(cursor[0]));
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
  if (biography) return clampDescriptionLength(biography, 2000);

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
    const text = cleanProfileSectionText(
      extractElementTextWithBlockSeparators($(selector).first()[0]),
    )
      .replace(/^CV\s+/i, '')
      .replace(/\s+Office hours?:.*$/i, '');
    if (text.length >= 40 && !isLikelyProfileChromeBio(text))
      return clampDescriptionLength(text, 2000);
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
): Partial<
  Pick<
    FacultyEntry,
    | 'profileUrl'
    | 'name'
    | 'email'
    | 'labUrl'
    | 'title'
    | 'orcid'
    | 'bio'
    | 'researchInterests'
    | 'topics'
    | 'scholarCandidateProfileUrls'
    | 'profileSourceUrl'
    | 'researchHomeDescription'
    | 'researchHomeShortDescription'
  >
> {
  const $ = cheerio.load(html);
  const canonicalUrl = canonicalProfileUrlFromHtml($, profileUrl);

  const emailHref = $('a[href^="mailto:"]').first().attr('href') || '';
  const email = emailHref ? emailHref.replace(/^mailto:/i, '').trim() : undefined;

  const title =
    $(
      '[class*="professional-title"], [class*="person-title"], [class*="job-title"], [class*="position"], [class*="header-info__title"], [class*="workday-title"]',
    )
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
  const officialProse = extractGroundedProfileDescription(html);

  return {
    profileUrl: canonicalUrl,
    profileSourceUrl: canonicalUrl,
    name: personNameFromProfileHtml($),
    email,
    title,
    labUrl,
    orcid: extractOrcidFromHtml($),
    bio,
    researchHomeDescription: officialProse?.fullDescription,
    researchHomeShortDescription: officialProse?.shortDescription || undefined,
    researchInterests: researchInterests.length > 0 ? researchInterests : undefined,
    topics: researchInterests.length > 0 ? researchInterests : undefined,
    scholarCandidateProfileUrls:
      scholarCandidateProfileUrls.length > 0
        ? uniqueStrings(scholarCandidateProfileUrls)
        : undefined,
  };
}

/**
 * Deterministically recover a research-home's own grounded prose from the PI's
 * official profile page (the #481 lever), then fail closed through the shared
 * catalog-description hygiene so a roster/nav/FAQ/form/curation dump can never
 * become a student-facing description. A profile page is person-authored, so it
 * is scored with the `person` kind.
 */
function extractGroundedProfileDescription(
  html: string,
): { fullDescription: string; shortDescription: string } | undefined {
  const extracted = extractOfficialResearchDescription(html, { kind: 'person' });
  if (!extracted) return undefined;
  const fullDescription = sanitizeResearchEntityDescription(extracted.fullDescription);
  if (!fullDescription) return undefined;
  const shortDescription = sanitizeResearchEntityDescription(extracted.shortDescription);
  return { fullDescription, shortDescription };
}

function mergeProfileEnrichment(
  entry: FacultyEntry,
  enrichment: Partial<
    Pick<
      FacultyEntry,
      | 'profileUrl'
      | 'name'
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
      | 'researchHomeDescription'
      | 'researchHomeShortDescription'
    >
  >,
): FacultyEntry {
  const resolvedName =
    entry.namePlaceholder && enrichment.name ? normalizeName(enrichment.name) : entry.name;
  return {
    ...entry,
    name: resolvedName || entry.name,
    namePlaceholder: entry.namePlaceholder && resolvedName === entry.name ? true : undefined,
    profileUrl: enrichment.profileUrl || entry.profileUrl,
    profileSourceUrl: enrichment.profileSourceUrl || entry.profileSourceUrl,
    title: entry.title || enrichment.title,
    email: entry.email || enrichment.email,
    labUrl: entry.labUrl || enrichment.labUrl,
    orcid: entry.orcid || enrichment.orcid,
    bio: entry.bio || enrichment.bio,
    researchHomeDescription: entry.researchHomeDescription || enrichment.researchHomeDescription,
    researchHomeShortDescription:
      entry.researchHomeShortDescription || enrichment.researchHomeShortDescription,
    researchInterests:
      uniqueStrings([...(entry.researchInterests || []), ...(enrichment.researchInterests || [])])
        .length > 0
        ? uniqueStrings([
            ...(entry.researchInterests || []),
            ...(enrichment.researchInterests || []),
          ])
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
    log(`[profile] fetch failed: ${sanitizeLogValue(err)}`);
    return entry;
  }
}

const SHARED_SYNTHETIC_ENTITY_KEY_NAMESPACE: Record<string, string> = {
  'mechanical-engineering': 'meng-matsci',
  'materials-science': 'meng-matsci',
};

function namespacedDeptKey(deptKey: string): string {
  return SHARED_SYNTHETIC_ENTITY_KEY_NAMESPACE[deptKey] || deptKey;
}

function entryToUserObservations(
  entry: FacultyEntry,
  dept: DeptConfig,
  sourceUrl: string,
): { observations: ObservationInput[]; entityKey: string } {
  const cleaned = normalizeName(entry.name);
  const { first, last } = splitName(cleaned);
  const personEmail = isLikelyPersonSpecificYaleEmail(entry.email, cleaned)
    ? entry.email
    : undefined;
  const netid = netidFromEmail(personEmail);
  const slug = slugify(cleaned);
  const entityKeyNamespace = namespacedDeptKey(dept.deptKey);
  const entityKey = netid ? `netid:${netid}` : `dept:${entityKeyNamespace}:${slug || 'unknown'}`;

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
  if (!dept.affiliatesOnly) {
    obs.push({ ...rosterBase, field: 'primaryDepartment', value: dept.deptName });
    obs.push({ ...rosterBase, field: 'departments', value: [dept.deptName] });
  }
  if (personEmail) obs.push({ ...profileBase, field: 'email', value: personEmail });
  if (entry.title) obs.push({ ...profileBase, field: 'title', value: entry.title });
  if (entry.profileUrl) {
    obs.push({ ...profileBase, field: 'profileUrls', value: { departmental: entry.profileUrl } });
  }
  if (entry.imageUrl) obs.push({ ...profileBase, field: 'imageUrl', value: entry.imageUrl });
  if (entry.labUrl) obs.push({ ...profileBase, field: 'website', value: entry.labUrl });
  if (entry.orcid) obs.push({ ...profileBase, field: 'orcid', value: entry.orcid });
  if (entry.bio) obs.push({ ...profileBase, field: 'bio', value: entry.bio });
  const researchInterests = (entry.researchInterests || []).filter(
    (topic) => !isTopicLabelChrome(topic),
  );
  if (researchInterests.length > 0) {
    obs.push({ ...profileBase, field: 'researchInterests', value: researchInterests });
  }
  const topics = (entry.topics || []).filter((topic) => !isTopicLabelChrome(topic));
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

function isLikelyExplicitLabWebsite(entry: FacultyEntry): boolean {
  const name = normalizeName(entry.name);
  const url = entry.labUrl || '';
  const searchable = `${name} ${url}`.toLowerCase();
  return (
    /\b(lab|laboratory|research[-\s]?group|group)\b/.test(searchable) || /lab[./-]/.test(searchable)
  );
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
  const slug = `dept-${namespacedDeptKey(dept.deptKey)}-${nameSlug}`.slice(0, 100);
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
    ...(dept.affiliatesOnly
      ? []
      : [{ ...base, field: 'departments' as const, value: [dept.deptName] }]),
    { ...base, field: 'websiteUrl', value: entry.labUrl },
    { ...base, field: 'sourceUrls', value: [sourceUrl, entry.labUrl] },
    {
      ...base,
      field: 'inferredPiUserKey',
      value: ownerEntityKey,
      confidenceOverride: 0.7,
    },
  ];

  const topics = uniqueStrings([
    ...(entry.researchInterests || []),
    ...(entry.topics || []),
  ]).filter((topic) => !isTopicLabelChrome(topic));
  if (topics.length > 0) {
    observations.push({ ...base, field: 'researchAreas', value: topics });
  }

  const groundedDescriptionCandidate = cleanText(entry.researchHomeDescription);
  const groundedDescription =
    groundedDescriptionCandidate && fullDescriptionQuality(groundedDescriptionCandidate).isUseful
      ? groundedDescriptionCandidate
      : '';
  if (groundedDescription) {
    observations.push({
      ...base,
      field: 'fullDescription',
      value: groundedDescription,
      confidenceOverride: ROSTER_PROFILE_DESCRIPTION_CONFIDENCE,
    });
    const groundedShortCandidate = cleanText(entry.researchHomeShortDescription);
    const groundedShort =
      groundedShortCandidate &&
      shortDescriptionQuality(groundedShortCandidate, groundedDescription).isUseful
        ? groundedShortCandidate
        : '';
    if (groundedShort) {
      observations.push({
        ...base,
        field: 'shortDescription',
        value: groundedShort,
        confidenceOverride: ROSTER_PROFILE_DESCRIPTION_CONFIDENCE,
      });
    }
  } else if (topics.length > 0) {
    const description = rosterTopicDescription(topics);
    if (description) {
      observations.push({
        ...base,
        field: 'fullDescription',
        value: description,
        confidenceOverride: ROSTER_SYNTHESIZED_DESCRIPTION_CONFIDENCE,
      });
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
    const onlyFilter =
      ctx.options.only && ctx.options.only.length > 0
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
    const discoveredEntityKeysByDept = new Map<string, Set<string>>();
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

        const labObs = dept.officialProfileOnly
          ? []
          : entryToResearchEntityObservations(entry, dept, sourceUrl, entityKey);
        const labKey = labObs[0]?.entityKey;
        if (labObs.length > 0 && labKey && !seenLabKeys.has(labKey)) {
          seenLabKeys.add(labKey);
          await ctx.emit(labObs);
          observations += labObs.length;
          labs++;
        }
        if (labObs.length > 0 && typeof labKey === 'string' && labKey) {
          const deptDiscovered =
            discoveredEntityKeysByDept.get(dept.deptKey) ?? new Set<string>();
          deptDiscovered.add(labKey);
          discoveredEntityKeysByDept.set(dept.deptKey, deptDiscovered);
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
        perDept.push({
          deptKey: dept.deptKey,
          count: deptCount,
          status: deptCount === 0 ? 'empty' : 'ok',
        });
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
      perDept.push({
        deptKey: dept.deptKey,
        count: deptCount,
        status: deptCount === 0 ? 'empty' : 'ok',
      });
    }

    const deptConfigByKey = new Map(this.configs.map((dept) => [dept.deptKey, dept]));
    const rosterHealthObservations: ObservationInput[] = perDept.map((deptResult) => {
      const dept = deptConfigByKey.get(deptResult.deptKey);
      const discoveredEntityKeys = Array.from(
        discoveredEntityKeysByDept.get(deptResult.deptKey) ?? new Set<string>(),
      );
      const entityAuthoritative = deptResult.status === 'ok' && !dept?.officialProfileOnly;
      return {
        entityType: 'departmentRosterHealth' as const,
        entityKey: deptResult.deptKey,
        field: DEPARTMENT_ROSTER_HEALTH_FIELD,
        value: {
          deptKey: deptResult.deptKey,
          deptName: dept?.deptName ?? '',
          schoolName: dept?.schoolName ?? '',
          status: deptResult.status,
          complete: entityAuthoritative,
          discoveredCount: discoveredEntityKeys.length,
          discoveredEntityKeys,
        },
        sourceUrl: dept?.url ?? this.name,
        observedAt: new Date(),
      };
    });
    if (rosterHealthObservations.length > 0) {
      await ctx.emit(rosterHealthObservations);
      totalObs += rosterHealthObservations.length;
    }

    const summary = perDept
      .map((d) => `${d.deptKey}=${d.status === 'ok' ? d.count : d.status}`)
      .join(', ');
    ctx.log(
      `Emitted ${totalObs} observations across ${totalFaculty} faculty / ${totalLabs} labs (${summary})`,
    );

    const breakageStatuses = new Set(['empty', 'rendered-extractor-error']);
    const brokenSources = perDept.filter((d) => breakageStatuses.has(d.status));
    if (brokenSources.length > 0) {
      ctx.log(
        `WARNING: ${brokenSources.length} configured roster source(s) fetched but yielded no faculty - likely a site migration or renamed layout; re-verify the URL and extractor: ${brokenSources
          .map((d) => `${d.deptKey}(${d.status})`)
          .join(', ')}`,
      );
    }

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
