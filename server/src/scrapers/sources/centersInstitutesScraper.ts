/**
 * CentersInstitutesScraper
 *
 * One scraper class that pulls multi-PI rosters from Yale's cross-cutting
 * research centers and institutes — entities that don't fit any single
 * department (Wu Tsai Institute, Yale Cancer Center, Cowles Foundation, etc.).
 *
 * For each center config we fetch the people-listing page, run a per-center
 * extractor (HTML in → { name, profileUrl?, title? }[]), and emit:
 *   - one ResearchGroup observation set keyed by `center-<centerKey>`
 *     (kind, websiteUrl, school, sourceUrls, plus an `affiliatedNames` list of
 *     the raw member names so downstream tooling can join against User by name)
 *   - one ResearchGroupMember observation per member, keyed
 *     `center-<centerKey>:<member-slug>` with role 'core-faculty' (default) or
 *     'director' when the title clearly indicates leadership. The materializer
 *     can resolve the User by name (lname + fname) at write time.
 *
 * Centers DO NOT have a single PI — they are intentionally many-to-many.
 *
 * Honors `ctx.options.useCache`, `ctx.options.limit` (caps centers processed,
 * not members), and `ctx.options.only` (filter by centerKey, e.g.
 * `--only wu-tsai,cowles`).
 *
 * Per-center extractors are pure functions over HTML — adding a new center is a
 * one-row config change.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { getCached, setCached } from '../snapshotCache';
import {
  createScraplingRenderedFetcher,
  measureRenderedFetch,
  summarizeFetchMetrics,
  type RenderedFetcher,
  type RenderedFetchResult,
} from '../renderedFetch';
import type {
  IScraper,
  ScraperContext,
  ScraperResult,
  ObservationInput,
  ScraperFetchMetric,
} from '../types';
import { normalizeName, slugify, splitName } from '../utils/scraperHelpers';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';

const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;
const MAX_PAGES_PER_CENTER = 30;

export type CenterKind = 'center' | 'institute' | 'program' | 'initiative';
export type MemberRole = 'director' | 'co-director' | 'core-faculty' | 'affiliated';

/** A single person extracted from a center's people page. */
export interface CenterMember {
  name: string;
  profileUrl?: string;
  title?: string;
  role?: MemberRole;
}

/** A child research entity discovered on a parent index page (Jackson School). */
export interface ChildCenter {
  name: string;
  url: string;
  kind: CenterKind;
  description?: string;
}

/** Output shape returned by every per-center extractor. */
export interface ExtractorResult {
  members: CenterMember[];
  /** When the page is itself a meta-index (Jackson School), child centers
   *  emit additional ResearchGroup observations alongside the parent. */
  childCenters?: ChildCenter[];
}

/** Context handed to each extractor — used to absolutize relative URLs. */
export interface ExtractorCtx {
  pageUrl: string;
}

/** Pure HTML → structured rows. No I/O. */
export type CenterExtractor = (html: string, ctx: ExtractorCtx) => ExtractorResult;

/** Injectable static-page fetcher; defaults to the module `fetchHtml`. */
export type HtmlFetcher = (url: string, useCache: boolean, sourceName: string) => Promise<string>;

export interface CenterConfig {
  centerKey: string;
  centerName: string;
  /** Empty string when the entity is cross-school (most centers). */
  schoolName: string;
  kind: CenterKind;
  /** Optional list of departments the center spans, used as a static seed. */
  departments?: string[];
  url: string;
  /** When true the scraper crawls `?page=0`, `?page=1`, … until empty. */
  paginated?: boolean;
  extractor: CenterExtractor;
  /**
   * Parser to run after a rendered fetch. Keeps headless fetching separate from
   * domain parsing; falls back to `extractor` when unset.
   */
  renderedExtractor?: CenterExtractor;
  /** Selector that should exist after hydration; used for the rendered-fetch wait. */
  renderWaitSelector?: string;
  /**
   * Overrides the default `center-<centerKey>` entity key so the roster enriches
   * an entity another source already minted, instead of creating a duplicate.
   * Set this when the center already exists in the corpus under a different slug
   * (e.g. a YSE center discovered by `yse-centers-index` as `yse-<slug>`); the
   * group + member + relationship observations then all attach to that entity.
   */
  entityKey?: string;
  /**
   * Identity/home URL emitted as the entity `websiteUrl` when the crawl `url` is
   * a member-roster subpage distinct from the entity's own landing page (e.g. a
   * West Campus institute whose members live under `/institutes/<slug>/<slug>-labs`
   * while its identity page is `/institutes/<slug>`). Also added to `sourceUrls`.
   * Defaults to `url` when unset. Ignored in `entityKey` enrichment mode, where the
   * owning source keeps the identity website.
   */
  homeUrl?: string;
  /**
   * Set when the page is JS-rendered or behind auth. When a rendered fetcher is
   * available the runner fetches the hydrated HTML and parses it with
   * `renderedExtractor` (falling back to `extractor`); with no fetcher available
   * it logs and skips, mirroring `departmentRosterScraper`.
   */
  jsRenderedSkip?: boolean;
  /** Reason string used in the log line when jsRenderedSkip is true and skipped. */
  skipReason?: string;
}

export function centerEntityKey(config: CenterConfig): string {
  return config.entityKey || `center-${config.centerKey}`;
}

// ---------------------------------------------------------------------------
// Helpers reused by extractors
// ---------------------------------------------------------------------------

function absolutize(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/**
 * Many medicine.yale.edu / Drupal directories list names "Last, First" —
 * flip them so downstream `splitName` does the right thing.
 */
function flipLastFirst(name: string): string {
  const m = name.match(/^([^,]+?)\s*,\s*([^,]+?)$/);
  if (!m) return name;
  return `${m[2].trim()} ${m[1].trim()}`;
}

/** Heuristic: classify member role from their title string. */
function inferRole(title: string | undefined): MemberRole {
  if (!title) return 'core-faculty';
  const t = title.toLowerCase();
  if (/\b(co[- ]?director|associate director|deputy director|interim director)\b/.test(t)) {
    return 'co-director';
  }
  if (/\bdirector\b/.test(t)) return 'director';
  if (/\baffiliated|affiliate\b/.test(t)) return 'affiliated';
  return 'core-faculty';
}

// ---------------------------------------------------------------------------
// Per-center extractors
// ---------------------------------------------------------------------------

/**
 * Generic Drupal "node-teaser--person" extractor — used by the Yale Economics
 * theme, which Tobin, Cowles/EGC, and MacMillan all share.
 *   <article class="node-teaser node-teaser--person ...">
 *     <div class="node-teaser__heading"><a href="/people/<slug>"><span>Name</span></a></div>
 *     <div class="node-teaser__professional-title">Title…</div>
 *   </article>
 */
export const nodeTeaserPersonExtractor: CenterExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const members: CenterMember[] = [];
  $('article.node-teaser--person').each((_i, el) => {
    const card = $(el);
    const link = card.find('.node-teaser__heading a').first();
    const name = link.text().trim();
    if (!name) return;
    const href = link.attr('href') || '';
    const profileUrl = href ? absolutize(href, ctx.pageUrl) : undefined;
    const title = card.find('.node-teaser__professional-title').first().text().trim() || undefined;
    members.push({ name, profileUrl, title, role: inferRole(title) });
  });
  return { members };
};

/**
 * Wu Tsai Institute (`wti.yale.edu/humans/faculty`).
 *   <h2 class="teaser__heading">Name</h2>
 *   <p  class="teaser__text">Faculty Member, Department</p>
 * No profile URL is exposed in the listing.
 */
export const wuTsaiExtractor: CenterExtractor = (html) => {
  const $ = cheerio.load(html);
  const members: CenterMember[] = [];
  $('.teaser__heading').each((_i, el) => {
    const heading = $(el);
    const name = heading.text().trim();
    if (!name) return;
    // teaser__text lives in the same teaser__content sibling block
    const titleEl = heading.parent().find('.teaser__text').first();
    const title = titleEl.text().replace(/\s+/g, ' ').trim() || undefined;
    members.push({ name, title, role: inferRole(title) });
  });
  return { members };
};

/**
 * Factory for the shared medicine.yale.edu / YSM directory theme where a center's
 * A-Z roster is a flat list of profile links under its own `/<unit>/profile/`
 * namespace:
 *   <a href="/<unit>/profile/<slug>/" class="hyperlink">Last, First</a>
 * Names are "Last, First" — flipped for downstream split; no title in the listing.
 * Scoping to the unit's own profile prefix keeps sibling nav/contact `.hyperlink`
 * links out, and deduping by href drops the photo+name double links. This is the
 * one place the Cancer Center, Global Health, and Child Study Center rosters (and
 * any future YSM center on the same theme) share, so a new such center is a
 * one-row config change rather than a copied extractor.
 */
export function profileHyperlinkDirectoryExtractor(
  profilePathPrefix: string,
  role: MemberRole = 'core-faculty',
): CenterExtractor {
  const selector = `a[href^="${profilePathPrefix}"].hyperlink`;
  return (html, ctx) => {
    const $ = cheerio.load(html);
    const members: CenterMember[] = [];
    const seen = new Set<string>();
    $(selector).each((_i, el) => {
      const link = $(el);
      const raw = link.text().trim();
      if (!raw) return;
      const href = link.attr('href') || '';
      if (!href || seen.has(href)) return;
      seen.add(href);
      members.push({
        name: flipLastFirst(raw),
        profileUrl: absolutize(href, ctx.pageUrl),
        role,
      });
    });
    return { members };
  };
}

/**
 * Yale Cancer Center member directory (`/cancer/research/membership/directory`).
 * 470+ members on a single page, alphabetized.
 */
export const yaleCancerCenterExtractor: CenterExtractor =
  profileHyperlinkDirectoryExtractor('/cancer/profile/');

/**
 * Yale Institute for Global Health affiliated-faculty directory
 * (`/yigh/faculty-support-initiative/affiliated-faculty/`), grouped into
 * Medicine/Nursing/Public Health/University sections, each rendering the same
 * flat `/yigh/profile/<slug>/` list.
 */
export const yighAffiliatedFacultyExtractor: CenterExtractor =
  profileHyperlinkDirectoryExtractor('/yigh/profile/', 'affiliated');

/**
 * Yale Child Study Center faculty A-Z (`/childstudy/faculty/`). A broad
 * developmental-neuroscience / child-psychiatry roster of 500+ faculty on a
 * single page under the `/childstudy/profile/<slug>/` namespace.
 */
export const childStudyCenterExtractor: CenterExtractor =
  profileHyperlinkDirectoryExtractor('/childstudy/profile/');

/**
 * Drupal "views-field" people-table layout used by both Yale Quantum Institute
 * and Whitney Humanities Center:
 *   <div class="views-field views-field-name">
 *     <a href="/people/<slug>" class="username">Name</a>
 *   </div>
 *   <div class="views-field views-field-field-title">
 *     <div class="field-content">Title</div>
 *   </div>
 *
 * The `name` and `title` fields are siblings within a parent row container —
 * we walk back up to the nearest table row or views-row to pair them.
 */
export const viewsFieldNameExtractor: CenterExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const members: CenterMember[] = [];
  $('.views-field-name a.username').each((_i, el) => {
    const link = $(el);
    const name = link.text().trim();
    if (!name) return;
    const href = link.attr('href') || '';
    // skip non-person links (e.g. "Advisory Board", "Executive Board")
    if (/^\/(people|team)\/(advisory|executive|administration)/i.test(href)) return;
    const profileUrl = href ? absolutize(href, ctx.pageUrl) : undefined;
    // Find the enclosing row to scope the title lookup
    const row =
      link.closest('.views-row').length > 0
        ? link.closest('.views-row')
        : link.closest('td').length > 0
          ? link.closest('td')
          : link.closest('tr');
    const title =
      row.find('.views-field-field-title .field-content').first().text().trim() || undefined;
    members.push({ name, profileUrl, title, role: inferRole(title) });
  });
  return { members };
};

/**
 * ISPS team directory (`/team/directory/...`):
 *   <div class="views-row …">
 *     <div class="field field-name-team-list-member-name">
 *       <strong><a href="/team/<slug>">Name</a></strong>
 *     </div>
 *     <div class="field field-name-field-team-member-creds">Title</div>
 *   </div>
 */
export const ispsExtractor: CenterExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const members: CenterMember[] = [];
  $('.views-row').each((_i, el) => {
    const row = $(el);
    const link = row.find('.field-name-team-list-member-name a').first();
    const name = link.text().trim();
    if (!name) return;
    const href = link.attr('href') || '';
    const profileUrl = href ? absolutize(href, ctx.pageUrl) : undefined;
    const title =
      row.find('.field-name-field-team-member-creds').first().text().trim() || undefined;
    members.push({ name, profileUrl, title, role: inferRole(title) });
  });
  return { members };
};

/**
 * YCGA people page on YSM (`/genetics/research/ycga/people/`).
 *   <a href="/genetics/profile/<slug>/" class="profile-grid-item__link-details" …>
 *     <span class="profile-grid-item__name …">Name, PhD</span>
 *   </a>
 */
export const ycgaExtractor: CenterExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const members: CenterMember[] = [];
  const seen = new Set<string>();
  $('a.profile-grid-item__link-details').each((_i, el) => {
    const link = $(el);
    const href = link.attr('href') || '';
    if (!href || seen.has(href)) return;
    seen.add(href);
    const name = link.find('.profile-grid-item__name').first().text().trim();
    if (!name) return;
    members.push({
      name,
      profileUrl: absolutize(href, ctx.pageUrl),
      role: 'core-faculty',
    });
  });
  return { members };
};

interface PeopleCardSelectors {
  card: string;
  headingLink: string;
  subheading?: string;
  snippet?: string;
}

/**
 * Restricts card extraction to the sections whose heading passes `keepHeading`,
 * so a mixed roster page (faculty + admin/trainee sections) yields only the
 * faculty cards. `heading` selects each section's heading element and `root` is
 * the ancestor container that scopes the cards belonging to that heading.
 */
interface CardSectionScope {
  heading: string;
  root: string;
  keepHeading: (headingText: string) => boolean;
}

function collectPeopleCards(
  $: cheerio.CheerioAPI,
  root: cheerio.Cheerio<any>,
  ctx: ExtractorCtx,
  selectors: PeopleCardSelectors,
  seen: Set<string>,
  members: CenterMember[],
): void {
  root.find(selectors.card).each((_i, el) => {
    const card = $(el);
    const link = card.find(selectors.headingLink).first();
    const name = link.text().replace(/\s+/g, ' ').trim();
    if (!name) return;
    const href = link.attr('href') || '';
    const dedupeKey = href || slugify(name);
    if (!dedupeKey || seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    const profileUrl = href ? absolutize(href, ctx.pageUrl) : undefined;
    const subheading = selectors.subheading
      ? card.find(selectors.subheading).first().text().replace(/\s+/g, ' ').trim()
      : '';
    const snippet = selectors.snippet
      ? card.find(selectors.snippet).first().text().replace(/\s+/g, ' ').trim()
      : '';
    const roleText = [subheading, snippet].filter(Boolean).join(' ') || undefined;
    members.push({
      name,
      profileUrl,
      title: subheading || undefined,
      role: inferRole(roleText),
    });
  });
}

function extractPeopleCards(
  html: string,
  ctx: ExtractorCtx,
  selectors: PeopleCardSelectors,
): ExtractorResult {
  const $ = cheerio.load(html);
  const members: CenterMember[] = [];
  const seen = new Set<string>();
  collectPeopleCards($, $.root(), ctx, selectors, seen, members);
  return { members };
}

function extractPeopleCardsInSections(
  html: string,
  ctx: ExtractorCtx,
  selectors: PeopleCardSelectors,
  scope: CardSectionScope,
): ExtractorResult {
  const $ = cheerio.load(html);
  const members: CenterMember[] = [];
  const seen = new Set<string>();
  $(scope.heading).each((_i, headingEl) => {
    const headingText = $(headingEl).text().replace(/\s+/g, ' ').trim();
    if (!headingText || !scope.keepHeading(headingText)) return;
    const sectionRoot = $(headingEl).closest(scope.root);
    const root = sectionRoot.length > 0 ? sectionRoot : $(headingEl).parent();
    collectPeopleCards($, root, ctx, selectors, seen, members);
  });
  return { members };
}

const DIRECTORY_LISTING_CARD_SELECTORS: PeopleCardSelectors = {
  card: '.directory-listing-card',
  headingLink: '.directory-listing-card__heading-link',
  subheading: '.directory-listing-card__subheading',
  snippet: '.directory-listing-card__snippet',
};

const REFERENCE_CARD_SELECTORS: PeopleCardSelectors = {
  card: '.reference-card',
  headingLink: '.reference-card__heading-link',
  subheading: '.reference-card__subheading',
  snippet: '.reference-card__snippet',
};

/**
 * YaleSites "directory-listing-card" people block (Quantitative Biology
 * Institute `qbio.yale.edu/members`, and the sibling YaleSites institute
 * rosters). Each card links to the member's own official profile/lab page:
 *   <li class="directory-listing-card">
 *     <h3 class="directory-listing-card__heading">
 *       <a class="directory-listing-card__heading-link" href="<member site>">Name</a>
 *     </h3>
 *     <div class="directory-listing-card__subheading"><div>Title</div></div>
 *     <div class="directory-listing-card__snippet"><div>Director, …</div></div>
 *   </li>
 * Leadership is often carried in the snippet rather than the subheading, so both
 * feed the role heuristic.
 */
export const directoryListingCardExtractor: CenterExtractor = (html, ctx) =>
  extractPeopleCards(html, ctx, DIRECTORY_LISTING_CARD_SELECTORS);

/**
 * YaleSites "reference-card" people block (Data-Intensive Social Science Center
 * `dissc.yale.edu`, and the sibling YaleSites institute rosters). Same shape as
 * the directory-listing-card block under a different class prefix; each card
 * carries both a heading link and an aria-hidden image link to the same href, so
 * only the heading link is read to avoid double-counting.
 */
export const referenceCardPeopleExtractor: CenterExtractor = (html, ctx) =>
  extractPeopleCards(html, ctx, REFERENCE_CARD_SELECTORS);

/**
 * The Yale Center for Natural Carbon Capture people page
 * (`naturalcarboncapture.yale.edu/people`) is a YaleSites reference-card roster,
 * but it groups faculty sections (Directors, Scientific Leadership Team, Faculty
 * Affiliates) alongside non-faculty sections (Managing Director, Research
 * Scientists, Postdoctoral Associates, administrative staff). Each section is a
 * `component-wrapper` with its own `component-wrapper__heading`, so the extractor
 * keeps only the cards under a faculty/leadership heading and drops the
 * staff/trainee sections a student would not reach out to for a lab.
 */
const FACULTY_ROSTER_SECTION_HEADING = /\b(faculty|directors|leadership)\b/i;

export const naturalCarbonCaptureExtractor: CenterExtractor = (html, ctx) =>
  extractPeopleCardsInSections(html, ctx, REFERENCE_CARD_SELECTORS, {
    heading: '.component-wrapper__heading',
    root: '.component-wrapper',
    keepHeading: (headingText) => FACULTY_ROSTER_SECTION_HEADING.test(headingText),
  });

const CUSTOM_CARD_SELECTORS: PeopleCardSelectors = {
  card: '.custom-card',
  headingLink: '.custom-card__heading-link',
  snippet: '.custom-card__snippet',
};

const LABS_COLLECTION_HEADING = /\blabs?\b/i;

/**
 * YaleSites "custom-card" collection used by the Yale Cancer Biology Institute
 * landing page (`westcampus.yale.edu/institutes/yale-cancer-biology-institute`),
 * whose "Meet the labs of the Yale Cancer Biology Institute" block is the member
 * roster. Unlike the other West Campus institutes, membership is listed by lab
 * name rather than PI name, and each card links to the lab's own home:
 *   <div class="custom-card-collection">
 *     <h2 class="custom-card-collection__heading">Meet the labs …</h2>
 *     <li class="custom-card">
 *       <a class="custom-card__heading-link" href="/alarcon-lab">Alarcón Lab</a>
 *     </li>
 *   </div>
 * The heading gate scopes extraction to the labs collection so sibling
 * custom-card collections (news, events) are dropped.
 */
export const customCardLabsExtractor: CenterExtractor = (html, ctx) =>
  extractPeopleCardsInSections(html, ctx, CUSTOM_CARD_SELECTORS, {
    heading: '.custom-card-collection__heading',
    root: '.custom-card-collection',
    keepHeading: (headingText) => LABS_COLLECTION_HEADING.test(headingText),
  });

const CONTENT_SPOTLIGHT_SELECTORS: PeopleCardSelectors = {
  card: '.content-spotlight-portrait',
  headingLink: '.content-spotlight-portrait__ctas a',
};

/**
 * YaleSites "content-spotlight-portrait" block used by the Yale Microbial
 * Sciences Institute faculty-research page (`microbialsciences.yale.edu/faculty-research`).
 * Each faculty is one block whose CTA list carries the PI profile link first and
 * the lab link second, alongside a research blurb:
 *   <div class="content-spotlight-portrait">
 *     <div class="content-spotlight-portrait__text">…blurb…</div>
 *     <div class="content-spotlight-portrait__ctas">
 *       <a href="…/profile/andrew-goodman">Andrew Goodman</a>
 *       <a href="…/lab/goodman">Goodman Lab</a>
 *     </div>
 *   </div>
 * Only the first CTA (the PI profile) is read so the member resolves to a Yale
 * researcher; blocks without a CTA link are skipped.
 */
export const contentSpotlightFacultyExtractor: CenterExtractor = (html, ctx) =>
  extractPeopleCards(html, ctx, CONTENT_SPOTLIGHT_SELECTORS);

/**
 * Yale FDS (Institute for Foundations of Data Science) people page
 * (`fds.yale.edu/people/`). A WordPress ACF "ordered users grid" theme; the
 * roster is server-rendered in the static HTML (two grids: a leadership/admin
 * block and the cross-department member block), so no headless render is
 * needed. Each card links to the member's own `fds.yale.edu/people/<netid>/`
 * profile page:
 *   <div class="grid__user">
 *     <a class="grid__user__link" href="https://fds.yale.edu/people/<netid>/">
 *       <h3 class="grid__user__title">Name</h3>
 *       <p  class="grid__user__job-title">Title</p>
 *     </a>
 *   </div>
 */
export const fdsUsersGridExtractor: CenterExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const members: CenterMember[] = [];
  const seen = new Set<string>();
  $('.grid__user').each((_i, el) => {
    const card = $(el);
    const link = card.find('a.grid__user__link').first();
    const name = card.find('.grid__user__title').first().text().replace(/\s+/g, ' ').trim();
    if (!name) return;
    const href = link.attr('href') || '';
    const dedupeKey = href || slugify(name);
    if (!dedupeKey || seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    const profileUrl = href ? absolutize(href, ctx.pageUrl) : undefined;
    const title =
      card.find('.grid__user__job-title').first().text().replace(/\s+/g, ' ').trim() || undefined;
    members.push({ name, profileUrl, title, role: inferRole(title) });
  });
  return { members };
};

/**
 * Jackson School centers/initiatives index page is a META index — it lists
 * child centers, not people. Each child center becomes its own ResearchGroup.
 *   <div class="jordan_item">
 *     <div class="cta_box">
 *       <a href="https://jackson.yale.edu/<slug>/">…</a>
 *       <h3 class="cta_title">Center Name</h3>
 *       <div class="content">Description</div>
 *     </div>
 *   </div>
 */
export const jacksonCentersExtractor: CenterExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const childCenters: ChildCenter[] = [];
  $('.jordan_item .cta_box').each((_i, el) => {
    const box = $(el);
    const title = box.find('.cta_title').first().text().trim();
    const link = box.find('a').first().attr('href') || '';
    if (!title || !link) return;
    const url = absolutize(link, ctx.pageUrl);
    const description = box.find('.content').first().text().trim() || undefined;
    // Classify from the title only — Jackson's URLs all live under
    // `/centers-initiatives/`, which would otherwise force every entry to
    // 'initiative'.
    const lower = title.toLowerCase();
    let kind: CenterKind = 'center';
    if (/\binitiatives?\b/.test(lower)) kind = 'initiative';
    else if (/\bprograms?\b/.test(lower)) kind = 'program';
    else if (/\binstitute\b/.test(lower)) kind = 'institute';
    childCenters.push({ name: title, url, kind, description });
  });
  return { members: [], childCenters };
};

/**
 * Stub extractor used for known-broken / gated / SPA pages so the runner
 * logs a clear error rather than silently emitting zero members.
 */
export const jsRenderedStub: CenterExtractor = () => {
  throw new Error('Page is JS-rendered or gated; needs headless browser or auth');
};

// ---------------------------------------------------------------------------
// Default config — the wired center set (see centersInstitutesRegistry.ts for
// the full coverage map, including evaluated-but-unwired gaps).
// ---------------------------------------------------------------------------

export const DEFAULT_CENTER_CONFIGS: CenterConfig[] = [
  {
    centerKey: 'wu-tsai',
    centerName: 'Wu Tsai Institute',
    schoolName: '',
    kind: 'institute',
    departments: ['Neuroscience', 'Psychology', 'Molecular, Cellular and Developmental Biology'],
    url: 'https://wti.yale.edu/humans/faculty',
    paginated: true,
    extractor: wuTsaiExtractor,
  },
  {
    centerKey: 'yale-cancer-center',
    centerName: 'Yale Cancer Center',
    schoolName: 'Yale School of Medicine',
    kind: 'center',
    url: 'https://medicine.yale.edu/cancer/research/membership/directory',
    paginated: false,
    extractor: yaleCancerCenterExtractor,
  },
  {
    centerKey: 'yale-quantum-institute',
    centerName: 'Yale Quantum Institute',
    schoolName: '',
    kind: 'institute',
    departments: ['Physics', 'Applied Physics', 'Computer Science', 'Electrical Engineering'],
    url: 'https://quantuminstitute.yale.edu/people/members',
    paginated: false,
    extractor: viewsFieldNameExtractor,
  },
  {
    centerKey: 'cowles',
    centerName: 'Cowles Foundation for Research in Economics',
    schoolName: 'Yale Faculty of Arts and Sciences',
    kind: 'center',
    departments: ['Economics'],
    url: 'https://egc.yale.edu/people/faculty',
    paginated: true,
    extractor: nodeTeaserPersonExtractor,
  },
  {
    centerKey: 'tobin',
    centerName: 'Tobin Center for Economic Policy',
    schoolName: 'Yale Faculty of Arts and Sciences',
    kind: 'center',
    departments: ['Economics'],
    url: 'https://tobin.yale.edu/people',
    paginated: true,
    extractor: nodeTeaserPersonExtractor,
  },
  {
    centerKey: 'isps',
    centerName: 'Institution for Social and Policy Studies',
    schoolName: '',
    kind: 'institute',
    departments: ['Political Science', 'Economics', 'Sociology'],
    url: 'https://isps.yale.edu/team/directory/faculty-fellows',
    paginated: true,
    extractor: ispsExtractor,
  },
  {
    centerKey: 'macmillan',
    centerName: 'MacMillan Center for International and Area Studies',
    schoolName: '',
    kind: 'center',
    url: 'https://macmillan.yale.edu/people',
    paginated: true,
    extractor: nodeTeaserPersonExtractor,
  },
  {
    centerKey: 'whitney-humanities',
    centerName: 'Whitney Humanities Center',
    schoolName: 'Yale Faculty of Arts and Sciences',
    kind: 'center',
    url: 'https://whc.yale.edu/people/our-people',
    paginated: false,
    extractor: viewsFieldNameExtractor,
  },
  {
    centerKey: 'ycga',
    centerName: 'Yale Center for Genome Analysis',
    schoolName: 'Yale School of Medicine',
    kind: 'center',
    departments: ['Genetics'],
    url: 'https://medicine.yale.edu/genetics/research/ycga/people/',
    paginated: false,
    extractor: ycgaExtractor,
  },
  {
    centerKey: 'qbio',
    centerName: 'Quantitative Biology Institute',
    schoolName: '',
    kind: 'institute',
    url: 'https://qbio.yale.edu/members',
    paginated: false,
    extractor: directoryListingCardExtractor,
  },
  {
    centerKey: 'dissc',
    centerName: 'Data-Intensive Social Science Center',
    schoolName: '',
    kind: 'center',
    url: 'https://dissc.yale.edu/about/dissc-faculty-and-staff',
    paginated: false,
    extractor: referenceCardPeopleExtractor,
  },
  {
    centerKey: 'fds',
    centerName: 'Yale Institute for Foundations of Data Science',
    schoolName: '',
    kind: 'institute',
    url: 'https://fds.yale.edu/people/',
    paginated: false,
    extractor: fdsUsersGridExtractor,
    entityKey: 'research-yale-yale-institute-for-foundations-of-data-science',
  },
  {
    centerKey: 'natural-carbon-capture',
    centerName: 'Yale Center for Natural Carbon Capture',
    schoolName: '',
    kind: 'center',
    url: 'https://naturalcarboncapture.yale.edu/people',
    paginated: false,
    extractor: naturalCarbonCaptureExtractor,
    entityKey: 'yse-natural-carbon-capture',
  },
  {
    centerKey: 'wc-nanobiology',
    centerName: 'Yale Nanobiology Institute',
    schoolName: '',
    kind: 'institute',
    url: 'https://westcampus.yale.edu/institutes/yale-nanobiology-institute/yale-nanobiology-institute-research-labs',
    homeUrl: 'https://westcampus.yale.edu/institutes/yale-nanobiology-institute',
    paginated: false,
    extractor: directoryListingCardExtractor,
  },
  {
    centerKey: 'wc-biomolecular-design',
    centerName: 'Yale Institute of Biomolecular Design & Discovery',
    schoolName: '',
    kind: 'institute',
    url: 'https://westcampus.yale.edu/institutes/yale-institute-of-biomolecular-design-and-discovery/yale-institute-of-biomolecular',
    homeUrl: 'https://westcampus.yale.edu/institutes/yale-institute-of-biomolecular-design-and-discovery',
    paginated: false,
    extractor: directoryListingCardExtractor,
  },
  {
    centerKey: 'wc-energy-sciences',
    centerName: 'Yale Energy Sciences Institute',
    schoolName: '',
    kind: 'institute',
    url: 'https://westcampus.yale.edu/institutes/yale-energy-sciences-institute/yale-energy-sciences-institute-labs',
    homeUrl: 'https://westcampus.yale.edu/institutes/yale-energy-sciences-institute',
    paginated: false,
    extractor: directoryListingCardExtractor,
  },
  {
    centerKey: 'wc-systems-biology',
    centerName: 'Yale Systems Biology Institute',
    schoolName: '',
    kind: 'institute',
    url: 'https://westcampus.yale.edu/institutes/yale-systems-biology-institute/yale-systems-biology-institute-labs',
    homeUrl: 'https://westcampus.yale.edu/institutes/yale-systems-biology-institute',
    paginated: false,
    extractor: directoryListingCardExtractor,
  },
  {
    centerKey: 'wc-microbial-sciences',
    centerName: 'Yale Microbial Sciences Institute',
    schoolName: '',
    kind: 'institute',
    url: 'https://microbialsciences.yale.edu/faculty-research',
    homeUrl: 'https://microbialsciences.yale.edu/',
    paginated: false,
    extractor: contentSpotlightFacultyExtractor,
  },
  {
    centerKey: 'wc-cancer-biology',
    centerName: 'Yale Cancer Biology Institute',
    schoolName: '',
    kind: 'institute',
    url: 'https://westcampus.yale.edu/institutes/yale-cancer-biology-institute',
    paginated: false,
    extractor: customCardLabsExtractor,
  },
  {
    centerKey: 'jackson-centers',
    centerName: 'Jackson School of Global Affairs (centers index)',
    schoolName: 'Jackson School of Global Affairs',
    kind: 'center',
    url: 'https://jackson.yale.edu/centers-initiatives/',
    paginated: false,
    extractor: jacksonCentersExtractor,
  },
  {
    centerKey: 'yigh',
    centerName: 'Yale Institute for Global Health',
    schoolName: '',
    kind: 'institute',
    departments: ['Medicine', 'Nursing', 'Public Health'],
    url: 'https://medicine.yale.edu/yigh/faculty-support-initiative/affiliated-faculty/',
    paginated: false,
    extractor: yighAffiliatedFacultyExtractor,
  },
  {
    centerKey: 'child-study-center',
    centerName: 'Yale Child Study Center',
    schoolName: 'Yale School of Medicine',
    kind: 'center',
    url: 'https://medicine.yale.edu/childstudy/faculty/',
    homeUrl: 'https://medicine.yale.edu/childstudy/',
    paginated: false,
    extractor: childStudyCenterExtractor,
  },
];

// ---------------------------------------------------------------------------
// Internal: network + observation shaping
// ---------------------------------------------------------------------------

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

/**
 * Build the ResearchGroup observation set for a parent center.
 *
 * `affiliatedNames` carries the raw names of every member found on the page,
 * letting downstream tooling resolve them to User records by name (lname +
 * fname) without needing a separate observation per unmatched person.
 */
export function centerToGroupObservations(
  config: CenterConfig,
  members: CenterMember[],
  sourceUrl: string,
): { observations: ObservationInput[]; entityKey: string } {
  const entityKey = centerEntityKey(config);
  const base = { entityType: 'researchEntity' as const, entityKey, sourceUrl };

  // Aggregate departments from member titles when none were declared in config.
  const declaredDepts =
    config.departments && config.departments.length > 0 ? config.departments : [];

  const homeUrl = config.homeUrl ?? config.url;
  const sourceUrls =
    config.homeUrl && config.homeUrl !== sourceUrl ? [sourceUrl, config.homeUrl] : [sourceUrl];
  const obs: ObservationInput[] = [
    { ...base, field: 'slug', value: entityKey },
    { ...base, field: 'name', value: config.centerName },
    { ...base, field: 'kind', value: config.kind },
    { ...base, field: 'sourceUrls', value: sourceUrls },
  ];
  // In enrichment mode (`entityKey` overrides to an entity another source
  // already minted) the crawl entry point is a `/people` roster page, not a
  // research home. Emitting it as `websiteUrl` would compete with and clear the
  // target's canonical website, so the roster only adds members and provenance
  // and leaves the identity website to the owning source.
  if (!config.entityKey) {
    obs.push({ ...base, field: 'websiteUrl', value: homeUrl });
  }
  if (config.schoolName) {
    obs.push({ ...base, field: 'school', value: config.schoolName });
  }
  if (declaredDepts.length > 0) {
    obs.push({ ...base, field: 'departments', value: declaredDepts });
  }
  return { observations: obs, entityKey };
}

/**
 * Build the ResearchGroupMember observation set for one member.
 *
 * The materializer resolves the `inferredUserName` (lname + fname) into a
 * userId at write time. We deliberately keep the join logic out of the scraper
 * — extractors stay pure and the Yale-name → User mapping lives in one place.
 */
export function memberToObservations(
  member: CenterMember,
  config: CenterConfig,
  sourceUrl: string,
): ObservationInput[] {
  return memberObservationsForEntityKey(centerEntityKey(config), member, sourceUrl);
}

/**
 * ResearchGroupMember observations for a member of an arbitrary center entity,
 * keyed by the center's own entity slug (e.g. `center-cowles`, `yse-industrial-ecology`,
 * `center-jackson-centers-blue-center-...`). Shared by the HTML roster scrapers and
 * the LLM affiliation extractor so both feed the same materializer path.
 */
export function memberObservationsForEntityKey(
  centerEntityKey: string,
  member: CenterMember,
  sourceUrl: string,
): ObservationInput[] {
  const cleaned = normalizeName(member.name);
  const { first, last } = splitName(cleaned);
  const memberSlug = slugify(cleaned);
  if (!centerEntityKey || !memberSlug) return [];
  const entityKey = `${centerEntityKey}:${memberSlug}`;
  const base = { entityType: 'researchGroupMember' as const, entityKey, sourceUrl };
  const obs: ObservationInput[] = [
    { ...base, field: 'researchGroupKey', value: centerEntityKey },
    { ...base, field: 'role', value: member.role || 'core-faculty' },
    { ...base, field: 'inferredUserName', value: { fname: first, lname: last } },
  ];
  if (member.profileUrl) {
    obs.push({ ...base, field: 'profileUrl', value: member.profileUrl });
  }
  if (member.title) {
    obs.push({ ...base, field: 'title', value: member.title });
  }
  return obs;
}

function facultyResearchAreaKey(memberName: string): string {
  return `faculty-research-area-${slugify(memberName)}`.slice(0, 100);
}

/**
 * Conservative institute-to-research-home relationship observations.
 *
 * A center member page proves affiliation with the umbrella entity, but not a
 * lab opening or standalone research home. Emit only the relationship; the
 * materializer resolves the `faculty-research-area-*` target key to the member's
 * existing PI-led lab (preferred, as `AFFILIATED_LAB`) or a faculty-research-area
 * entity (`MEMBER_RESEARCH_AREA`), and skips when nothing resolves — it never
 * mints a weak duplicate shell. Emitted for every roster center; the
 * resolve-or-skip gate in the materializer keeps it safe without an allowlist.
 */
export function centerMemberRelationshipObservations(
  member: CenterMember,
  config: CenterConfig,
  sourceUrl: string,
): ObservationInput[] {
  return centerMemberRelationshipObservationsForEntityKey(
    centerEntityKey(config),
    member,
    sourceUrl,
  );
}

/**
 * Umbrella → faculty relationship observations for an arbitrary center entity,
 * keyed by the center's own entity slug. Shared by the HTML roster scrapers and
 * the LLM affiliation extractor. The materializer prefers the member's existing
 * lab (AFFILIATED_LAB) and skips unresolved members.
 */
export function centerMemberRelationshipObservationsForEntityKey(
  centerEntityKey: string,
  member: CenterMember,
  sourceUrl: string,
): ObservationInput[] {
  const cleaned = normalizeName(member.name);
  const targetEntityKey = facultyResearchAreaKey(cleaned);
  if (!centerEntityKey || !cleaned || !targetEntityKey) return [];

  const relationshipType = 'MEMBER_RESEARCH_AREA';
  const relationshipKey = `${centerEntityKey}:${targetEntityKey}:${relationshipType}`;
  const relationshipBase = {
    entityType: 'researchEntityRelationship' as const,
    entityKey: relationshipKey,
    sourceUrl,
  };

  return [
    { ...relationshipBase, field: 'sourceEntityKey', value: centerEntityKey },
    { ...relationshipBase, field: 'targetEntityKey', value: targetEntityKey },
    { ...relationshipBase, field: 'relationshipType', value: relationshipType },
    { ...relationshipBase, field: 'evidenceStrength', value: 'MODERATE' },
    { ...relationshipBase, field: 'confidence', value: 0.72 },
  ];
}

/**
 * Emit a child ResearchGroup discovered on a meta-index page (Jackson School).
 * Each child becomes its own `center-jackson-<slug>` ResearchGroup.
 */
export function childCenterToObservations(
  child: ChildCenter,
  parentConfig: CenterConfig,
  sourceUrl: string,
): ObservationInput[] {
  const childSlug = slugify(child.name);
  if (!childSlug) return [];
  const entityKey = `center-${parentConfig.centerKey}-${childSlug}`.slice(0, 100);
  const base = { entityType: 'researchEntity' as const, entityKey, sourceUrl };
  const obs: ObservationInput[] = [
    { ...base, field: 'slug', value: entityKey },
    { ...base, field: 'name', value: child.name },
    { ...base, field: 'kind', value: child.kind },
    { ...base, field: 'websiteUrl', value: child.url },
    { ...base, field: 'sourceUrls', value: [sourceUrl, child.url] },
  ];
  if (parentConfig.schoolName) {
    obs.push({ ...base, field: 'school', value: parentConfig.schoolName });
  }
  if (child.description) {
    obs.push({ ...base, field: 'fullDescription', value: child.description });
  }
  return obs;
}

// ---------------------------------------------------------------------------
// Scraper
// ---------------------------------------------------------------------------

export class CentersInstitutesScraper implements IScraper {
  readonly name = 'centers-institutes-index';
  readonly displayName = 'Yale centers & institutes index';

  /**
   * Configs, the rendered (headless) fetcher, and the static fetcher are all
   * injectable for testing; they default to the bundled center set, the
   * Scrapling renderer, and the module `fetchHtml`.
   */
  constructor(
    private readonly configs: CenterConfig[] = DEFAULT_CENTER_CONFIGS,
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
    let totalMembers = 0;
    let totalChildCenters = 0;
    let centersProcessed = 0;
    const perCenter: Array<{ key: string; status: string; count: number }> = [];
    const fetchAttempts: ScraperFetchMetric[] = [];

    const emitCenterResults = async (
      config: CenterConfig,
      allMembers: CenterMember[],
      allChildCenters: ChildCenter[],
      sourceUrl: string,
      pagesFetched: number,
    ): Promise<void> => {
      const { observations: groupObs } = centerToGroupObservations(config, allMembers, sourceUrl);
      await ctx.emit(groupObs);
      totalObs += groupObs.length;

      const seenMemberSlugs = new Set<string>();
      for (const member of allMembers) {
        const cleaned = normalizeName(member.name);
        const slug = slugify(cleaned);
        if (!slug || seenMemberSlugs.has(slug)) continue;
        seenMemberSlugs.add(slug);
        const memberObs = memberToObservations(member, config, sourceUrl);
        if (memberObs.length > 0) {
          await ctx.emit(memberObs);
          totalObs += memberObs.length;
          totalMembers++;
        }

        const relationshipObs = centerMemberRelationshipObservations(member, config, sourceUrl);
        if (relationshipObs.length > 0) {
          await ctx.emit(relationshipObs);
          totalObs += relationshipObs.length;
        }
      }

      for (const child of allChildCenters) {
        const childObs = childCenterToObservations(child, config, sourceUrl);
        if (childObs.length > 0) {
          await ctx.emit(childObs);
          totalObs += childObs.length;
          totalChildCenters++;
        }
      }

      ctx.log(
        `[${config.centerKey}] ${seenMemberSlugs.size} members, ${allChildCenters.length} child centers (${pagesFetched} page(s))`,
      );
      perCenter.push({
        key: config.centerKey,
        status: 'ok',
        count: seenMemberSlugs.size + allChildCenters.length,
      });
    };

    for (const config of this.configs) {
      if (onlyFilter && !onlyFilter.has(config.centerKey.toLowerCase())) continue;
      if (centersProcessed >= limit) break;

      if (config.jsRenderedSkip) {
        if (!this.renderedFetcher) {
          ctx.log(
            `[${config.centerKey}] skipped — ${config.skipReason || 'JS-rendered, needs headless browser'}`,
          );
          perCenter.push({ key: config.centerKey, status: 'js-rendered-skip', count: 0 });
          centersProcessed++;
          continue;
        }

        const rendered = await measureRenderedFetch(
          config.url,
          'scrapling',
          () => fetchRenderedCenterPage(this.name, ctx.options.useCache, config, this.renderedFetcher),
          { selectorName: config.renderWaitSelector },
        );
        fetchAttempts.push(rendered.metric);

        if (!rendered.result || !rendered.result.html) {
          ctx.log(`[${config.centerKey}] skipped — rendered page unavailable`);
          perCenter.push({ key: config.centerKey, status: 'rendered-unavailable', count: 0 });
          centersProcessed++;
          continue;
        }

        const pageUrl = rendered.result.url || config.url;
        let result: ExtractorResult;
        try {
          result = (config.renderedExtractor || config.extractor)(rendered.result.html, { pageUrl });
        } catch (err: any) {
          ctx.log(`[${config.centerKey}] rendered extractor error: ${sanitizeLogValue(err)}`);
          perCenter.push({ key: config.centerKey, status: 'rendered-extractor-error', count: 0 });
          centersProcessed++;
          continue;
        }

        await emitCenterResults(
          config,
          result.members || [],
          result.childCenters || [],
          pageUrl,
          1,
        );
        centersProcessed++;
        continue;
      }

      const allMembers: CenterMember[] = [];
      const allChildCenters: ChildCenter[] = [];
      let firstPageUrl: string | null = null;
      let pagesFetched = 0;
      const maxPages = config.paginated ? MAX_PAGES_PER_CENTER : 1;
      let lastPageHadEntries = true;
      let fetchFailed = false;

      for (let pageIdx = 0; pageIdx < maxPages && lastPageHadEntries; pageIdx++) {
        const pageUrl = pageUrlForIndex(config.url, pageIdx);
        if (!firstPageUrl) firstPageUrl = pageUrl;
        let html: string;
        try {
          html = await this.htmlFetcher(pageUrl, ctx.options.useCache, this.name);
        } catch (err: any) {
          ctx.log(
            `[${config.centerKey}] fetch failed for configured page: ${sanitizeLogValue(err)}`,
          );
          fetchFailed = true;
          break;
        }
        pagesFetched++;
        let result: ExtractorResult;
        try {
          result = config.extractor(html, { pageUrl });
        } catch (err: any) {
          ctx.log(
            `[${config.centerKey}] extractor error on configured page: ${sanitizeLogValue(err)}`,
          );
          break;
        }
        if (
          (!result.members || result.members.length === 0) &&
          (!result.childCenters || result.childCenters.length === 0)
        ) {
          lastPageHadEntries = false;
          break;
        }
        if (result.members) allMembers.push(...result.members);
        if (result.childCenters) allChildCenters.push(...result.childCenters);
        if (!config.paginated) break;
      }

      if (fetchFailed && allMembers.length === 0 && allChildCenters.length === 0) {
        perCenter.push({ key: config.centerKey, status: 'fetch-failed', count: 0 });
        centersProcessed++;
        continue;
      }

      const sourceUrl = firstPageUrl || config.url;

      await emitCenterResults(config, allMembers, allChildCenters, sourceUrl, pagesFetched);
      centersProcessed++;
    }

    const summary = perCenter
      .map((c) => `${c.key}=${c.status === 'ok' ? c.count : c.status}`)
      .join(', ');
    ctx.log(
      `Emitted ${totalObs} observations across ${centersProcessed} centers, ${totalMembers} members, ${totalChildCenters} child centers (${summary})`,
    );

    return {
      observationCount: totalObs,
      entitiesObserved: centersProcessed + totalMembers + totalChildCenters,
      notes: `Centers: ${summary}`,
      fetchMetrics: summarizeFetchMetrics(fetchAttempts),
    };
  }
}

async function fetchRenderedCenterPage(
  sourceName: string,
  useCache: boolean,
  config: CenterConfig,
  renderedFetcher: RenderedFetcher | null,
): Promise<RenderedFetchResult | null> {
  if (!renderedFetcher) return null;
  const cacheKey = `rendered-page:v1:${config.url}`;
  if (useCache) {
    const cached = await getCached<RenderedFetchResult>(sourceName, cacheKey);
    if (cached) return cached;
  }
  const result = await renderedFetcher({
    url: config.url,
    waitSelector: config.renderWaitSelector,
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  if (useCache && result?.html) await setCached(sourceName, cacheKey, result);
  return result;
}
