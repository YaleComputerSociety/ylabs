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
 *     (kind, the canonical `entityType` derived from it, websiteUrl, school,
 *     sourceUrls, plus an `affiliatedNames` list of the raw member names so
 *     downstream tooling can join against User by name)
 *   - one ResearchGroupMember observation per member, keyed
 *     `center-<centerKey>:<member-slug>` with role 'core-faculty' (default) or
 *     'director' when the title clearly indicates leadership, plus the identity
 *     evidence the member's own Yale profile page states. The materializer joins a
 *     member to a researcher only through that evidence, never by name (#3802).
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
import { RESEARCH_ENTITY_SLUG_OBSERVATION_FIELD } from '../entityMaterializer';
import {
  buildCenterRosterHealthSnapshot,
  CENTER_ROSTER_HEALTH_ENTITY_TYPE,
  CENTER_ROSTER_HEALTH_FIELD,
  type CenterRosterReadMember,
  type CenterRosterStopReason,
} from '../centerRosterRetirement';
import { officialProfileIdentityKey, rosterMembershipKey } from '../utils/rosterMembershipKey';
import {
  extractRosterMemberIdentityEvidence,
  isYaleHostedUrl,
  ROSTER_MEMBER_IDENTITY_EVIDENCE_FIELD,
  type RosterMemberIdentityEvidence,
} from '../utils/rosterMemberIdentityEvidence';
import { mapWithConcurrency } from '../utils/mapWithConcurrency';
import { fetchPageWithPolicy } from '../utils/httpFetch';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { getCached, setCached } from '../snapshotCache';
import {
  createScraplingRenderedFetcher,
  fetchUsableRenderedPage,
  measureRenderedFetch,
  summarizeFetchMetrics,
  type RenderedFetcher,
} from '../renderedFetch';
import type {
  IScraper,
  ScraperContext,
  ScraperResult,
  ObservationInput,
  ScraperFetchMetric,
} from '../types';
import { normalizeName, slugify, splitName } from '../utils/scraperHelpers';
import { mapResearchGroupKindToEntityType } from '../../models/researchAccessTypes';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import {
  researchHomeWebsiteUrlWriteRefusal,
  type ResearchHomeWebsiteUrlRefusal,
} from '../../utils/researchHomeWebsiteUrl';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';

const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;
const MAX_PAGES_PER_CENTER = 30;
const CONSECUTIVE_REPEATED_PAGES_TO_STOP = 2;
const MEMBER_PROFILE_FETCH_CONCURRENCY = 4;
const MEMBER_IDENTITY_EVIDENCE_CACHE_PREFIX = 'member-identity-evidence:v1:';

export type CenterKind = 'center' | 'institute' | 'program' | 'initiative';
export type MemberRole = 'director' | 'co-director' | 'core-faculty' | 'affiliated';

/** A single person extracted from a center's people page. */
export interface CenterMember {
  name: string;
  profileUrl?: string;
  title?: string;
  role?: MemberRole;
  identityEvidence?: RosterMemberIdentityEvidence;
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
  /** The entity the roster is being read for, so a title-derived role can be scoped to it. */
  centerName?: string;
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
   * Required in practice: the roster `url` must sit on this site
   * (`centerRosterSiteRefusal`), and a config without one is refused. Ignored for
   * `websiteUrl` and `sourceUrls` in `entityKey` enrichment mode, where the owning
   * source keeps the identity website.
   */
  homeUrl?: string;
  /**
   * A partner site that publishes this center's roster on its behalf. The roster
   * guard accepts `url` on this site as well as on `homeUrl`, and only with a
   * non-empty `reason`, so a cross-site roster is a reviewed decision rather than a
   * copied URL.
   */
  sharedRosterSite?: { url: string; reason: string };
  /**
   * Further pages of the center's own site to cite as provenance, such as the
   * mission or about page. These reach the description lane through `sourceUrls`:
   * a center landing page is often dominated by a news or appeal banner, and a
   * banner extracted as the center's description is the same wrong prose the
   * person rows that borrowed the site were already serving (#2535).
   */
  extraSourceUrls?: string[];
  /**
   * Set when the page is JS-rendered or behind auth. When a rendered fetcher is
   * available the runner fetches the hydrated HTML and parses it with
   * `renderedExtractor` (falling back to `extractor`); with no fetcher available
   * it logs and skips, mirroring `departmentRosterScraper`.
   */
  jsRenderedSkip?: boolean;
  /** Reason string used in the log line when jsRenderedSkip is true and skipped. */
  skipReason?: string;
  /**
   * For meta-index configs (Jackson School): crawl each discovered child
   * center's own site to find its engagement subpage (people/get-involved/
   * programs...) and roster, so the child ResearchGroup carries a real
   * student-facing way-in URL rather than only its homepage. Without it,
   * organizational children are held out of student_ready as an
   * `organizationalDeadEnd` (#1359).
   */
  crawlChildCenters?: boolean;
}

export type CenterRosterSiteRefusal =
  | 'no-declared-home'
  | 'unparseable-url'
  | 'shared-roster-site-without-reason'
  | 'roster-off-center-host'
  | 'roster-outside-center-path';

function parseSiteUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function siteHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

function sitePathPrefix(url: URL): string {
  return url.pathname.toLowerCase().replace(/\/+$/, '');
}

function pageIsWithinSite(page: URL, site: URL): boolean {
  if (siteHost(page) !== siteHost(site)) return false;
  const prefix = sitePathPrefix(site);
  if (!prefix) return true;
  const path = sitePathPrefix(page);
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Every member a roster yields is attributed to this config's entity, so the
 * roster page has to be published by that entity: on the host of its declared
 * `homeUrl`, and under the home page's path when the host is shared by several
 * units (medicine.yale.edu, macmillan.yale.edu, westcampus.yale.edu). A roster
 * on any other site is another organization's membership (#3703), and a config
 * with no declared home has nothing to check against, so both fail closed.
 * `sharedRosterSite` is the explicit, reasoned exception for a roster genuinely
 * published by a partner site on the center's behalf.
 */
export function centerRosterPageSiteRefusal(
  config: CenterConfig,
  pageUrl: string,
): CenterRosterSiteRefusal | null {
  if (!config.homeUrl) return 'no-declared-home';
  const home = parseSiteUrl(config.homeUrl);
  const page = parseSiteUrl(pageUrl);
  if (!home || !page) return 'unparseable-url';
  const sites = [home];
  if (config.sharedRosterSite) {
    if (!config.sharedRosterSite.reason.trim()) return 'shared-roster-site-without-reason';
    const shared = parseSiteUrl(config.sharedRosterSite.url);
    if (!shared) return 'unparseable-url';
    sites.push(shared);
  }
  if (!sites.some((site) => siteHost(site) === siteHost(page))) return 'roster-off-center-host';
  if (!sites.some((site) => pageIsWithinSite(page, site))) return 'roster-outside-center-path';
  return null;
}

export function centerRosterSiteRefusal(config: CenterConfig): CenterRosterSiteRefusal | null {
  return centerRosterPageSiteRefusal(config, config.url);
}

export function centerEntityKey(config: CenterConfig): string {
  return config.entityKey || `center-${config.centerKey}`;
}

export function centerHomeUrlWriteRefusal(
  config: CenterConfig,
): ResearchHomeWebsiteUrlRefusal | null {
  return researchHomeWebsiteUrlWriteRefusal(config.homeUrl ?? config.url, {
    name: config.centerName,
    entityType: mapResearchGroupKindToEntityType(config.kind),
    kind: config.kind,
  });
}

// ---------------------------------------------------------------------------
// Helpers reused by extractors
// ---------------------------------------------------------------------------

function normalizedText(value: string | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

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

const ORGANIZATION_NAME_FILLER_WORDS = new Set([
  'a',
  'and',
  'at',
  'center',
  'centre',
  'committee',
  'council',
  'for',
  'foundation',
  'in',
  'initiative',
  'institute',
  'institution',
  'of',
  'on',
  'program',
  'research',
  'school',
  'studies',
  'the',
  'university',
  'yale',
]);

const INITIALISM_SKIPPED_WORDS = new Set(['a', 'and', 'at', 'for', 'in', 'of', 'on', 'the']);

function organizationNameWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function organizationNameInitialisms(words: string[]): string[] {
  const initials = words.filter((word) => !INITIALISM_SKIPPED_WORDS.has(word)).map((w) => w[0]);
  const withoutYale = words
    .filter((word) => word !== 'yale' && !INITIALISM_SKIPPED_WORDS.has(word))
    .map((w) => w[0]);
  return [initials.join(''), withoutYale.join('')].filter((initialism) => initialism.length >= 2);
}

function distinctiveWordRuns(words: string[]): string[] {
  const runs: string[][] = [[]];
  for (const word of words) {
    if (ORGANIZATION_NAME_FILLER_WORDS.has(word)) runs.push([]);
    else runs[runs.length - 1].push(word);
  }
  return runs.filter((run) => run.length > 0).map((run) => run.join(' '));
}

function organizationTextNamesUnit(organizationText: string, unitName: string): boolean {
  const unitWords = organizationNameWords(unitName);
  const unitProperName = distinctiveWordRuns(unitWords)[0];
  const initialisms = new Set(organizationNameInitialisms(unitWords));
  const textWords = organizationNameWords(organizationText);
  return (
    textWords.some((word) => initialisms.has(word)) ||
    (unitProperName !== undefined && distinctiveWordRuns(textWords).includes(unitProperName))
  );
}

const DIRECTORSHIP_OF_NAMED_UNIT =
  /\bdirector\s+(?:of|for|at)\s+(?:the\s+)?([^,;]+?)(?:\s+and\s+|,|$)/i;
const DIRECTORSHIP_COMMA_NAMED_UNIT = /\bdirector\s*,\s*([^,;]+)/i;
const ORGANIZATION_NOUN =
  /\b(?:center|centre|institute|program|programme|lab|laboratory|council|initiative|foundation|school|department|office|project|committee)\b/i;

function directorshipNamedUnit(clause: string): string | undefined {
  const ofUnit = clause.match(DIRECTORSHIP_OF_NAMED_UNIT)?.[1];
  if (ofUnit) return ofUnit;
  const commaUnit = clause.match(DIRECTORSHIP_COMMA_NAMED_UNIT)?.[1];
  return commaUnit && ORGANIZATION_NOUN.test(commaUnit) ? commaUnit : undefined;
}
const FORMER_DIRECTORSHIP =
  /\bformer(?:ly)?\s+(?:\S+\s+){0,4}\S*director\b|\bdirector\s+emerit(?:us|a)\b|\bemerit(?:us|a)\s+\S*director\b/i;
const CLOSED_YEAR_RANGE = /\b((?:19|20)\d{2})\s*[-\u2013\u2014]\s*((?:19|20)?\d{2})\b/g;

function closedRangeEndYear(startText: string, endText: string): number {
  const start = Number(startText);
  if (endText.length === 4) return Number(endText);
  const end = Math.floor(start / 100) * 100 + Number(endText);
  return end < start ? end + 100 : end;
}

function isHistoricalDirectorship(clause: string): boolean {
  if (FORMER_DIRECTORSHIP.test(clause)) return true;
  const endYears = [...clause.matchAll(CLOSED_YEAR_RANGE)].map(([, start, end]) =>
    closedRangeEndYear(start, end),
  );
  const currentYear = new Date().getFullYear();
  return endYears.length > 0 && endYears.every((endYear) => endYear < currentYear);
}

/**
 * A professional title lists every directorship the person holds or has held
 * anywhere, so only a clause that is current and does not name some other unit
 * can make the person a lead of the unit being read: on a shared economics theme
 * a past director's "(2011-14)" and another center's "Faculty Director of ..."
 * both read as this center's director otherwise.
 */
function directorClausesForUnit(title: string, unitName: string | undefined): string[] {
  const directorClauses = title
    .split(/[;|\n]/)
    .map((clause) => clause.trim())
    .filter((clause) => /\bdirector\b/i.test(clause));
  if (!unitName) return directorClauses;
  return directorClauses
    .filter((clause) => !isHistoricalDirectorship(clause))
    .filter((clause) => {
      const namedUnit = directorshipNamedUnit(clause);
      return !namedUnit || organizationTextNamesUnit(namedUnit, unitName);
    });
}

/** Heuristic: classify member role from their title string. */
function inferRole(title: string | undefined, unitName?: string): MemberRole {
  if (!title) return 'core-faculty';
  const t = directorClausesForUnit(title, unitName).join('; ').toLowerCase();
  if (/\b(co[- ]?director|associate director|deputy director|interim director)\b/.test(t)) {
    return 'co-director';
  }
  if (/\bdirector\b/.test(t)) return 'director';
  if (/\baffiliated|affiliate\b/.test(title.toLowerCase())) return 'affiliated';
  return 'core-faculty';
}

// ---------------------------------------------------------------------------
// Per-center extractors
// ---------------------------------------------------------------------------

/**
 * Generic Drupal "node-teaser--person" extractor — used by the Yale Economics
 * theme, which Tobin, Cowles, and MacMillan all share.
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
    members.push({ name, profileUrl, title, role: inferRole(title, ctx.centerName) });
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
export const yighAffiliatedFacultyExtractor: CenterExtractor = profileHyperlinkDirectoryExtractor(
  '/yigh/profile/',
  'affiliated',
);

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

const TOP_DIRECTOR_TITLE = /^(?:founding\s+)?directors?$/i;

const SECONDARY_DIRECTOR_TITLE =
  /^(?:co[-\s]?|associate\s+|assoc\.?\s+|deputy\s+|interim\s+|acting\s+|founding\s+|executive\s+|faculty\s+|senior\s+)+directors?$/i;

/**
 * The center-scoped role a unit role line grants.
 *
 * A SUFFIXED line names a functional directorate reporting into the center rather
 * than the thing that runs it, so "Director of Research" and "Director of Education
 * and Training" stay roster members: promoting them would put three co-equal
 * Directors on ERIC's page and let the primary-lead pick land on someone other than
 * the founding director, which is the outcome #2535 exists to prevent. This matches
 * `centerDirectorLLMExtractor`, which deliberately extracts the single top director
 * and leaves multi-leader rosters out of scope.
 *
 * A PREFIXED line is a real center-scoped lead but not the top one, so it resolves
 * to `co-director` rather than to `director` even where `inferRole` alone would say
 * `director`: an "Executive Director" or "Faculty Director" is a functional
 * directorate in exactly the sense "Director of Research" is, and reading it as
 * `director` would make it co-equal with the founding director through the same
 * primary-lead pick the suffix guard exists to protect.
 */
function centerLeadRoleFromUnitTitle(unitRoleTitle: string): MemberRole {
  if (TOP_DIRECTOR_TITLE.test(unitRoleTitle)) return 'director';
  if (SECONDARY_DIRECTOR_TITLE.test(unitRoleTitle)) return 'co-director';
  return 'core-faculty';
}

/**
 * YSM `profile-grid-item` people page where a leadership card carries TWO title
 * paragraphs: a unit-scoped role line ("Director", "Deputy Director") followed by
 * the person's full professional title, while an ordinary roster card carries only
 * the professional title.
 *
 * Only the unit-scoped line may set the role. A professional title is a career
 * summary that lists every directorship the person holds anywhere, so reading a
 * role out of it makes another organization's directorship this center's lead:
 * on ERIC's roster it would attach "Medical Director, Sickle Cell Program",
 * "Deputy Director, Diversity Enhancement Program in Oncology" and "Director, The
 * SASH Lab" as leads of ERIC. A card with a single title therefore stays
 * `core-faculty` however many times the word "director" appears in it.
 *
 * Cards are deduplicated by profile href preferring the ROLE-BEARING card, not the
 * first one in the DOM, because a person listed in the leadership block and again in
 * the A-Z roster must keep the role the leadership block gave them. Page order does
 * not decide it: the extractor is offered for any center on this shared theme, and on
 * a page whose roster precedes its leadership block, keeping the first occurrence
 * drops the director's role and the center materializes with no lead at all.
 */
export const profileGridLeadershipExtractor: CenterExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const members: CenterMember[] = [];
  const seenByHref = new Map<string, { index: number; hasUnitRole: boolean }>();
  $('.profile-grid-item').each((_i, el) => {
    const card = $(el);
    const name = normalizedText(card.find('.profile-grid-item__name').first().text());
    if (!name) return;
    const href = card.find('a.profile-grid-item__link-details').first().attr('href') || '';
    const titles = card
      .find('.profile-grid-item__title')
      .map((_titleIndex, titleElement) => normalizedText($(titleElement).text()))
      .get()
      .filter(Boolean);
    const unitRoleTitle = titles.length > 1 ? titles[0] : '';
    const professionalTitle = titles.length > 0 ? titles[titles.length - 1] : undefined;
    const member: CenterMember = {
      name,
      profileUrl: href ? absolutize(href, ctx.pageUrl) : undefined,
      title: professionalTitle,
      role: unitRoleTitle ? centerLeadRoleFromUnitTitle(unitRoleTitle) : 'core-faculty',
    };
    const seen = href ? seenByHref.get(href) : undefined;
    if (seen) {
      if (!unitRoleTitle || seen.hasUnitRole) return;
      members[seen.index] = member;
      seen.hasUnitRole = true;
      return;
    }
    if (href) seenByHref.set(href, { index: members.length, hasUnitRole: Boolean(unitRoleTitle) });
    members.push(member);
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

function classifyChildCenterKind(title: string): CenterKind {
  const lower = title.toLowerCase();
  if (/\binitiatives?\b/.test(lower)) return 'initiative';
  if (/\bprograms?\b/.test(lower)) return 'program';
  if (/\binstitute\b/.test(lower)) return 'institute';
  return 'center';
}

/**
 * Jackson School centers/initiatives index page is a META index — it lists
 * child centers, not people. Each child center becomes its own ResearchGroup.
 * The page's Drupal "child menu" block lists exactly the child centers, scoped
 * away from the site-wide navigation:
 *   <div class="child-menu__wrapper">
 *     <ul class="menu">
 *       <li class="menu-item"><a href="/blue-center">Blue Center …</a></li>
 *     </ul>
 *   </div>
 * Kind is classified from the title alone since every child lives under the
 * jackson.yale.edu root without a per-kind path segment.
 */
export const jacksonCentersExtractor: CenterExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const childCenters: ChildCenter[] = [];
  const seen = new Set<string>();
  $('.child-menu__wrapper a[href]').each((_i, el) => {
    const link = $(el);
    const title = link.text().replace(/\s+/g, ' ').trim();
    const href = link.attr('href') || '';
    if (!title || !href) return;
    const url = absolutize(href, ctx.pageUrl);
    if (seen.has(url)) return;
    seen.add(url);
    childCenters.push({ name: title, url, kind: classifyChildCenterKind(title) });
  });
  return { members: [], childCenters };
};

/**
 * Jackson School person-card theme, shared across every jackson.yale.edu center
 * homepage and its `/people` roster:
 *   <article class="profile profile--component profile__item …">
 *     <div class="profile__content">
 *       <h3><a href="/directory/<slug>">Name</a></h3>
 *       <ul class="profile-positions …"><li>Title</li></ul>
 *     </div>
 *   </article>
 * Only `.profile__item` cards are read, so shared site navigation and footer
 * `/directory/` links (which are not wrapped in a profile card) are never
 * mistaken for center members.
 */
export const jacksonProfileItemExtractor: CenterExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const members: CenterMember[] = [];
  const seen = new Set<string>();
  $('.profile__item').each((_i, el) => {
    const card = $(el);
    const link = card
      .find(
        '.profile__content h3 a, .profile__content a[href*="/directory/"], a[href*="/directory/"]',
      )
      .first();
    const name = link.text().replace(/\s+/g, ' ').trim();
    if (!name) return;
    const href = link.attr('href') || '';
    const dedupeKey = href || slugify(name);
    if (!dedupeKey || seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    const profileUrl = href ? absolutize(href, ctx.pageUrl) : undefined;
    const title =
      card.find('.profile-positions').first().text().replace(/\s+/g, ' ').trim() || undefined;
    members.push({ name, profileUrl, title, role: inferRole(title) });
  });
  return { members };
};

/**
 * Path tokens, highest-value first, that mark an organizational engagement
 * subpage. Mirrors the accepted path patterns in `studentVisibilityTier.ts`
 * (#1359): a child center URL carrying one of these clears the
 * `organizationalDeadEnd` gate.
 */
const CHILD_ENGAGEMENT_TOKEN_TIERS: readonly (readonly string[])[] = [
  [
    'people',
    'staff',
    'team',
    'members',
    'member',
    'membership',
    'our-people',
    'who-we-are',
    'leadership',
  ],
  [
    'get-involved',
    'getinvolved',
    'join',
    'join-us',
    'participate',
    'volunteer',
    'opportunities',
    'apply',
    'how-to-apply',
    'admissions',
  ],
  [
    'programs',
    'program',
    'education',
    'academics',
    'training',
    'courses',
    'course',
    'fellowships',
    'internships',
    'research-opportunities',
    'for-students',
    'students',
  ],
];

function pathSegmentCarriesToken(lastSegment: string, token: string): boolean {
  return `-${lastSegment}-`.includes(`-${token}-`);
}

/**
 * Given a child center's homepage HTML and URL, return ranked, deduplicated
 * engagement-subpage URLs to try. A link is a candidate when it is same-host,
 * lives under the child's own path prefix, and its last path segment carries an
 * engagement token. The emitted candidate is canonicalized to
 * `<origin>/<child-prefix>/<token>` so it satisfies the gate's path patterns
 * even when the linked slug embeds the token (e.g. `blue-center-people` ->
 * `/blue-center/people`). Candidates are HTTP-verified by the caller.
 */
export function deriveChildEngagementCandidates(html: string, childHomepageUrl: string): string[] {
  let home: URL;
  try {
    home = new URL(childHomepageUrl);
  } catch {
    return [];
  }
  const firstSegment = home.pathname.split('/').filter(Boolean)[0];
  if (!firstSegment) return [];
  const prefix = `/${firstSegment}`;
  const homePath = home.pathname.replace(/\/+$/g, '');
  const $ = cheerio.load(html);
  const bestTierByUrl = new Map<string, number>();
  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    let target: URL;
    try {
      target = new URL(href, home);
    } catch {
      return;
    }
    if (target.hostname !== home.hostname) return;
    const path = target.pathname.replace(/\/+$/g, '');
    if (path === prefix || path === homePath) return;
    if (!path.startsWith(`${prefix}/`)) return;
    const lastSegment = path.split('/').filter(Boolean).pop() || '';
    for (let tier = 0; tier < CHILD_ENGAGEMENT_TOKEN_TIERS.length; tier++) {
      const token = CHILD_ENGAGEMENT_TOKEN_TIERS[tier].find((t) =>
        pathSegmentCarriesToken(lastSegment, t),
      );
      if (!token) continue;
      const candidate = `${home.origin}${prefix}/${token}`;
      const existingTier = bestTierByUrl.get(candidate);
      if (existingTier === undefined || tier < existingTier) bestTierByUrl.set(candidate, tier);
      break;
    }
  });
  return [...bestTierByUrl.entries()].sort((a, b) => a[1] - b[1]).map(([url]) => url);
}

/**
 * Stub extractor used for known-broken / gated / SPA pages so the runner
 * logs a clear error rather than silently emitting zero members.
 */
export const jsRenderedStub: CenterExtractor = () => {
  throw new Error('Page is JS-rendered or gated; needs headless browser or auth');
};

// ---------------------------------------------------------------------------
// Default config — the wired center set (see issue #2040 for the full
// coverage map, including evaluated-but-unwired gaps).
// ---------------------------------------------------------------------------

export const DEFAULT_CENTER_CONFIGS: CenterConfig[] = [
  {
    centerKey: 'wu-tsai',
    centerName: 'Wu Tsai Institute',
    schoolName: '',
    kind: 'institute',
    departments: ['Neuroscience', 'Psychology', 'Molecular, Cellular and Developmental Biology'],
    url: 'https://wti.yale.edu/humans/faculty',
    homeUrl: 'https://wti.yale.edu/',
    paginated: true,
    extractor: wuTsaiExtractor,
  },
  {
    centerKey: 'yale-cancer-center',
    centerName: 'Yale Cancer Center',
    schoolName: 'Yale School of Medicine',
    kind: 'center',
    url: 'https://medicine.yale.edu/cancer/research/membership/directory',
    homeUrl: 'https://medicine.yale.edu/cancer/',
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
    homeUrl: 'https://quantuminstitute.yale.edu/',
    paginated: false,
    extractor: viewsFieldNameExtractor,
  },
  {
    centerKey: 'cowles',
    centerName: 'Cowles Foundation for Research in Economics',
    schoolName: 'Yale Faculty of Arts and Sciences',
    kind: 'center',
    departments: ['Economics'],
    url: 'https://cowles.yale.edu/cowles-researchers',
    homeUrl: 'https://cowles.yale.edu/',
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
    homeUrl: 'https://tobin.yale.edu/',
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
    homeUrl: 'https://isps.yale.edu/',
    paginated: true,
    extractor: ispsExtractor,
  },
  {
    centerKey: 'macmillan',
    centerName: 'MacMillan Center for International and Area Studies',
    schoolName: '',
    kind: 'center',
    url: 'https://macmillan.yale.edu/people',
    homeUrl: 'https://macmillan.yale.edu/',
    paginated: true,
    extractor: nodeTeaserPersonExtractor,
  },
  {
    centerKey: 'macmillan-middle-east',
    centerName: 'Council on Middle East Studies',
    schoolName: '',
    kind: 'center',
    url: 'https://macmillan.yale.edu/middleeast/people',
    homeUrl: 'https://macmillan.yale.edu/middleeast',
    paginated: true,
    extractor: nodeTeaserPersonExtractor,
  },
  {
    centerKey: 'macmillan-east-asian',
    centerName: 'Council on East Asian Studies',
    schoolName: '',
    kind: 'center',
    url: 'https://macmillan.yale.edu/eastasia/people',
    homeUrl: 'https://macmillan.yale.edu/eastasia',
    paginated: true,
    extractor: nodeTeaserPersonExtractor,
  },
  {
    centerKey: 'macmillan-latin-american',
    centerName: 'Council on Latin American & Iberian Studies',
    schoolName: '',
    kind: 'center',
    url: 'https://macmillan.yale.edu/latam/people',
    homeUrl: 'https://macmillan.yale.edu/latam',
    paginated: true,
    extractor: nodeTeaserPersonExtractor,
  },
  {
    centerKey: 'macmillan-african',
    centerName: 'Council on African Studies',
    schoolName: '',
    kind: 'center',
    url: 'https://macmillan.yale.edu/africa/people',
    homeUrl: 'https://macmillan.yale.edu/africa',
    paginated: true,
    extractor: nodeTeaserPersonExtractor,
  },
  {
    centerKey: 'macmillan-european',
    centerName: 'European Studies Council',
    schoolName: '',
    kind: 'center',
    url: 'https://macmillan.yale.edu/europe/people',
    homeUrl: 'https://macmillan.yale.edu/europe',
    paginated: true,
    extractor: nodeTeaserPersonExtractor,
  },
  {
    centerKey: 'macmillan-south-asian',
    centerName: 'South Asian Studies Council',
    schoolName: '',
    kind: 'center',
    url: 'https://macmillan.yale.edu/southasia/people',
    homeUrl: 'https://macmillan.yale.edu/southasia',
    paginated: true,
    extractor: nodeTeaserPersonExtractor,
  },
  {
    centerKey: 'macmillan-southeast-asia',
    centerName: 'Council on Southeast Asia Studies',
    schoolName: '',
    kind: 'center',
    url: 'https://macmillan.yale.edu/southeast-asia/seas-people',
    homeUrl: 'https://macmillan.yale.edu/southeast-asia',
    paginated: true,
    extractor: nodeTeaserPersonExtractor,
  },
  {
    centerKey: 'macmillan-reees',
    centerName: 'Council on Russian, East European, and Eurasian Studies',
    schoolName: '',
    kind: 'center',
    url: 'https://macmillan.yale.edu/reees/people',
    homeUrl: 'https://macmillan.yale.edu/reees',
    paginated: true,
    extractor: nodeTeaserPersonExtractor,
  },
  {
    centerKey: 'macmillan-genocide-studies',
    centerName: 'Genocide Studies Program',
    schoolName: '',
    kind: 'program',
    url: 'https://macmillan.yale.edu/gsp/steering-committee',
    homeUrl: 'https://macmillan.yale.edu/gsp',
    paginated: true,
    extractor: nodeTeaserPersonExtractor,
  },
  {
    centerKey: 'macmillan-iranian-studies',
    centerName: 'Program in Iranian Studies',
    schoolName: '',
    kind: 'program',
    url: 'https://macmillan.yale.edu/iranian-studies/people',
    homeUrl: 'https://macmillan.yale.edu/iranian-studies',
    paginated: true,
    extractor: nodeTeaserPersonExtractor,
  },
  {
    centerKey: 'macmillan-hellenic-studies',
    centerName: 'Hellenic Studies Program',
    schoolName: '',
    kind: 'program',
    url: 'https://macmillan.yale.edu/hellenic/people',
    homeUrl: 'https://macmillan.yale.edu/hellenic',
    paginated: true,
    extractor: nodeTeaserPersonExtractor,
  },
  {
    centerKey: 'macmillan-korean-studies',
    centerName: 'Korean Studies at Yale',
    schoolName: '',
    kind: 'program',
    url: 'https://macmillan.yale.edu/korean-studies/korean-studies-faculty-librarians',
    homeUrl: 'https://macmillan.yale.edu/korean-studies',
    paginated: true,
    extractor: nodeTeaserPersonExtractor,
  },
  {
    centerKey: 'macmillan-eu-studies',
    centerName: 'European Union Studies Program',
    schoolName: '',
    kind: 'program',
    url: 'https://macmillan.yale.edu/eustudies/european-union-studies-people',
    homeUrl: 'https://macmillan.yale.edu/eustudies',
    paginated: true,
    extractor: nodeTeaserPersonExtractor,
  },
  {
    centerKey: 'macmillan-baltic-studies',
    centerName: 'Baltic Studies Program',
    schoolName: '',
    kind: 'program',
    url: 'https://macmillan.yale.edu/baltic/people',
    homeUrl: 'https://macmillan.yale.edu/baltic',
    paginated: true,
    extractor: nodeTeaserPersonExtractor,
  },
  {
    centerKey: 'macmillan-canadian-studies',
    centerName: 'Committee on Canadian Studies',
    schoolName: '',
    kind: 'program',
    url: 'https://macmillan.yale.edu/canada/people',
    homeUrl: 'https://macmillan.yale.edu/canada',
    paginated: true,
    extractor: nodeTeaserPersonExtractor,
  },
  {
    centerKey: 'macmillan-central-asia',
    centerName: 'Central Asia Initiative',
    schoolName: '',
    kind: 'initiative',
    url: 'https://macmillan.yale.edu/central-asia/people',
    homeUrl: 'https://macmillan.yale.edu/central-asia',
    paginated: true,
    extractor: nodeTeaserPersonExtractor,
  },
  {
    centerKey: 'whitney-humanities',
    centerName: 'Whitney Humanities Center',
    schoolName: 'Yale Faculty of Arts and Sciences',
    kind: 'center',
    url: 'https://whc.yale.edu/people/our-people',
    homeUrl: 'https://whc.yale.edu/',
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
    homeUrl: 'https://medicine.yale.edu/genetics/research/ycga/',
    paginated: false,
    extractor: ycgaExtractor,
  },
  {
    centerKey: 'qbio',
    centerName: 'Quantitative Biology Institute',
    schoolName: '',
    kind: 'institute',
    url: 'https://qbio.yale.edu/members',
    homeUrl: 'https://qbio.yale.edu/',
    paginated: false,
    extractor: directoryListingCardExtractor,
  },
  {
    centerKey: 'dissc',
    centerName: 'Data-Intensive Social Science Center',
    schoolName: '',
    kind: 'center',
    url: 'https://dissc.yale.edu/about/dissc-faculty-and-staff',
    homeUrl: 'https://dissc.yale.edu/',
    paginated: false,
    extractor: referenceCardPeopleExtractor,
  },
  {
    centerKey: 'fds',
    centerName: 'Yale Institute for Foundations of Data Science',
    schoolName: '',
    kind: 'institute',
    url: 'https://fds.yale.edu/people/',
    homeUrl: 'https://fds.yale.edu/',
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
    homeUrl: 'https://naturalcarboncapture.yale.edu/',
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
    homeUrl:
      'https://westcampus.yale.edu/institutes/yale-institute-of-biomolecular-design-and-discovery',
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
    homeUrl: 'https://westcampus.yale.edu/institutes/yale-cancer-biology-institute',
    paginated: false,
    extractor: customCardLabsExtractor,
  },
  {
    centerKey: 'jackson-centers',
    centerName: 'Jackson School of Global Affairs (centers index)',
    schoolName: 'Jackson School of Global Affairs',
    kind: 'center',
    url: 'https://jackson.yale.edu/centers-initiatives/',
    homeUrl: 'https://jackson.yale.edu/centers-initiatives/',
    paginated: false,
    extractor: jacksonCentersExtractor,
    crawlChildCenters: true,
  },
  {
    centerKey: 'yigh',
    centerName: 'Yale Institute for Global Health',
    schoolName: '',
    kind: 'institute',
    departments: ['Medicine', 'Nursing', 'Public Health'],
    url: 'https://medicine.yale.edu/yigh/faculty-support-initiative/affiliated-faculty/',
    homeUrl: 'https://medicine.yale.edu/yigh/',
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
  {
    // `eric.yale.edu` is a vanity host that redirects here, so the resolved
    // canonical path is the identity URL. Using the vanity host would leave the
    // center and the person rows that borrowed its site holding two different
    // strings for one page.
    centerKey: 'eric',
    centerName: 'Equity Research and Innovation Center (ERIC)',
    schoolName: 'Yale School of Medicine',
    kind: 'center',
    departments: ['Internal Medicine'],
    url: 'https://medicine.yale.edu/internal-medicine/genmed/eric/people/',
    homeUrl: 'https://medicine.yale.edu/internal-medicine/genmed/eric/',
    extraSourceUrls: ['https://medicine.yale.edu/internal-medicine/genmed/eric/about/'],
    paginated: false,
    extractor: profileGridLeadershipExtractor,
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

export type MemberPageFetcher = (url: string) => Promise<string>;

// medicine.yale.edu answers a burst of member pages with 403, so these go through the shared
// per-host limiter and its 403/429/5xx backoff rather than the roster fetch.
async function fetchMemberProfilePage(url: string): Promise<string> {
  return (await fetchPageWithPolicy(url, { timeoutMs: FETCH_TIMEOUT_MS })).html;
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
 * letting downstream tooling resolve them to canonical Researchers by name (lname +
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
  const sourceUrls = [
    ...new Set(
      [
        sourceUrl,
        !config.entityKey && config.homeUrl && config.homeUrl !== sourceUrl ? config.homeUrl : '',
        ...(config.extraSourceUrls || []),
      ].filter(Boolean),
    ),
  ];
  const obs: ObservationInput[] = [
    { ...base, field: 'slug', value: entityKey },
    { ...base, field: 'name', value: config.centerName },
    { ...base, field: 'kind', value: config.kind },
    // `entityType` is the canonical taxonomy and `kind` is derived from it
    // (#2144), so the org classification has to be observed on the canonical
    // field or it can never correct an entity another source minted as a lab.
    { ...base, field: 'entityType', value: mapResearchGroupKindToEntityType(config.kind) },
    { ...base, field: 'sourceUrls', value: sourceUrls },
  ];
  // In enrichment mode (`entityKey` overrides to an entity another source
  // already minted) the crawl entry point is a `/people` roster page, not a
  // research home. Emitting it as `websiteUrl` would compete with and clear the
  // target's canonical website, so the roster only adds members and provenance
  // and leaves the identity website to the owning source.
  if (!config.entityKey && !centerHomeUrlWriteRefusal(config)) {
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
 * The materializer decides who the member is from the profile URL and the page's
 * identity evidence; the join logic stays out of the scraper so extractors stay pure.
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
    { ...base, field: RESEARCH_ENTITY_SLUG_OBSERVATION_FIELD, value: centerEntityKey },
    { ...base, field: 'role', value: member.role || 'core-faculty' },
    { ...base, field: 'inferredUserName', value: { fname: first, lname: last } },
  ];
  if (member.profileUrl) {
    obs.push({ ...base, field: 'profileUrl', value: member.profileUrl });
  }
  if (member.title) {
    obs.push({ ...base, field: 'title', value: member.title });
  }
  if (member.identityEvidence) {
    obs.push({
      ...base,
      field: ROSTER_MEMBER_IDENTITY_EVIDENCE_FIELD,
      value: member.identityEvidence,
    });
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

export interface CenterRosterReadOutcome {
  pagesRead: number;
  readMode: 'html' | 'rendered';
  stopReason: CenterRosterStopReason;
}

export function centerRosterReadMember(
  member: CenterMember,
  memberObs: readonly ObservationInput[],
  relationshipObs: readonly ObservationInput[],
): CenterRosterReadMember | null {
  const memberKey = memberObs[0]?.entityKey || '';
  if (!memberKey) return null;
  const role = member.role || 'core-faculty';
  return {
    memberKey,
    role,
    membershipKey: rosterMembershipKey(officialProfileIdentityKey(member.profileUrl || ''), role),
    relationshipKey: relationshipObs[0]?.entityKey || '',
  };
}

export function centerRosterHealthObservation(
  config: CenterConfig,
  members: readonly CenterRosterReadMember[],
  sourceUrl: string,
  read: CenterRosterReadOutcome,
  options: { cacheAllowed: boolean; readAt?: Date },
): ObservationInput {
  const readAt = options.readAt ?? new Date();
  const entityKey = centerEntityKey(config);
  return {
    entityType: CENTER_ROSTER_HEALTH_ENTITY_TYPE,
    entityKey,
    field: CENTER_ROSTER_HEALTH_FIELD,
    value: buildCenterRosterHealthSnapshot({
      centerKey: config.centerKey,
      entityKey,
      members,
      pagesRead: read.pagesRead,
      readMode: read.readMode,
      stopReason: read.stopReason,
      cacheAllowed: options.cacheAllowed,
      readAt,
    }),
    sourceUrl,
    observedAt: readAt,
  };
}

/**
 * Deterministic entity key for a child ResearchGroup discovered on a meta-index
 * page (Jackson School). Empty string when the child name does not slugify.
 */
export function childCenterEntityKey(parentConfig: CenterConfig, child: ChildCenter): string {
  const childSlug = slugify(child.name);
  if (!childSlug) return '';
  return `center-${parentConfig.centerKey}-${childSlug}`.slice(0, 100);
}

/**
 * Emit a child ResearchGroup discovered on a meta-index page (Jackson School).
 * Each child becomes its own `center-jackson-<slug>` ResearchGroup.
 *
 * `extraSourceUrls` carries engagement subpages discovered by crawling the
 * child's own site (see `crawlChildCenters`), giving the child a real
 * student-facing way-in URL beyond its homepage.
 */
export function childCenterToObservations(
  child: ChildCenter,
  parentConfig: CenterConfig,
  sourceUrl: string,
  extraSourceUrls: string[] = [],
): ObservationInput[] {
  const entityKey = childCenterEntityKey(parentConfig, child);
  if (!entityKey) return [];
  const base = { entityType: 'researchEntity' as const, entityKey, sourceUrl };
  const sourceUrls = [...new Set([sourceUrl, child.url, ...extraSourceUrls])];
  const obs: ObservationInput[] = [
    { ...base, field: 'slug', value: entityKey },
    { ...base, field: 'name', value: child.name },
    { ...base, field: 'kind', value: child.kind },
    { ...base, field: 'entityType', value: mapResearchGroupKindToEntityType(child.kind) },
    { ...base, field: 'websiteUrl', value: child.url },
    { ...base, field: 'sourceUrls', value: sourceUrls },
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
    private readonly memberPageFetcher: MemberPageFetcher = fetchMemberProfilePage,
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
    const rosterSiteRefusals: Array<{ key: string; reason: CenterRosterSiteRefusal }> = [];

    const refuseRosterSite = (
      config: CenterConfig,
      pageUrl: string,
      reason: CenterRosterSiteRefusal,
    ): void => {
      ctx.log(
        `[${config.centerKey}] refused - roster page ${sanitizeLogValue(pageUrl)} is not on the center's own site (${reason}); no members emitted`,
      );
      rosterSiteRefusals.push({ key: config.centerKey, reason });
      perCenter.push({ key: config.centerKey, status: `roster-site-refused:${reason}`, count: 0 });
    };

    const emitCenterResults = async (
      config: CenterConfig,
      allMembers: CenterMember[],
      allChildCenters: ChildCenter[],
      sourceUrl: string,
      read: CenterRosterReadOutcome,
    ): Promise<void> => {
      const { observations: groupObs } = centerToGroupObservations(config, allMembers, sourceUrl);
      await ctx.emit(groupObs);
      totalObs += groupObs.length;

      const seenMemberSlugs = new Set<string>();
      const uniqueMembers = allMembers.filter((member) => {
        const slug = slugify(normalizeName(member.name));
        if (!slug || seenMemberSlugs.has(slug)) return false;
        seenMemberSlugs.add(slug);
        return true;
      });
      const listedMembers = await this.withMemberIdentityEvidence(
        config.centerKey,
        uniqueMembers,
        ctx,
      );
      const readMembers: CenterRosterReadMember[] = [];
      for (const member of listedMembers) {
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
        const readMember = centerRosterReadMember(member, memberObs, relationshipObs);
        if (readMember) readMembers.push(readMember);
      }

      const snapshot = centerRosterHealthObservation(config, readMembers, sourceUrl, read, {
        cacheAllowed: Boolean(ctx.options.useCache),
      });
      await ctx.emit(snapshot);
      totalObs += 1;

      for (const child of allChildCenters) {
        let engagementUrl: string | undefined;
        const childMembers: CenterMember[] = [];
        if (config.crawlChildCenters) {
          const crawled = await this.crawlChildCenter(child, ctx);
          engagementUrl = crawled.engagementUrl;
          childMembers.push(...crawled.members);
        }

        const childObs = childCenterToObservations(
          child,
          config,
          sourceUrl,
          engagementUrl ? [engagementUrl] : [],
        );
        if (childObs.length > 0) {
          await ctx.emit(childObs);
          totalObs += childObs.length;
          totalChildCenters++;
        }

        if (childMembers.length > 0) {
          const childKey = childCenterEntityKey(config, child);
          const memberSourceUrl = engagementUrl || child.url;
          const seenChildMemberSlugs = new Set<string>();
          const uniqueChildMembers = childMembers.filter((member) => {
            const slug = slugify(normalizeName(member.name));
            if (!slug || seenChildMemberSlugs.has(slug)) return false;
            seenChildMemberSlugs.add(slug);
            return true;
          });
          const listedChildMembers = await this.withMemberIdentityEvidence(
            childKey,
            uniqueChildMembers,
            ctx,
          );
          for (const member of listedChildMembers) {
            const memberObs = memberObservationsForEntityKey(childKey, member, memberSourceUrl);
            if (memberObs.length > 0) {
              await ctx.emit(memberObs);
              totalObs += memberObs.length;
              totalMembers++;
            }
            const relationshipObs = centerMemberRelationshipObservationsForEntityKey(
              childKey,
              member,
              memberSourceUrl,
            );
            if (relationshipObs.length > 0) {
              await ctx.emit(relationshipObs);
              totalObs += relationshipObs.length;
            }
          }
        }
      }

      ctx.log(
        `[${config.centerKey}] ${seenMemberSlugs.size} members, ${allChildCenters.length} child centers (${read.pagesRead} page(s), ${read.stopReason})`,
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

      const rosterSiteRefusal = centerRosterSiteRefusal(config);
      if (rosterSiteRefusal) {
        refuseRosterSite(config, config.url, rosterSiteRefusal);
        centersProcessed++;
        continue;
      }

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
          () =>
            fetchUsableRenderedPage({
              sourceName: this.name,
              useCache: ctx.options.useCache,
              request: {
                url: config.url,
                waitSelector: config.renderWaitSelector,
                timeoutMs: FETCH_TIMEOUT_MS,
              },
              renderedFetcher: this.renderedFetcher,
            }),
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
        const renderedSiteRefusal = centerRosterPageSiteRefusal(config, pageUrl);
        if (renderedSiteRefusal) {
          refuseRosterSite(config, pageUrl, renderedSiteRefusal);
          centersProcessed++;
          continue;
        }
        let result: ExtractorResult;
        try {
          result = (config.renderedExtractor || config.extractor)(rendered.result.html, {
            pageUrl,
            centerName: config.centerName,
          });
        } catch (err: any) {
          ctx.log(`[${config.centerKey}] rendered extractor error: ${sanitizeLogValue(err)}`);
          perCenter.push({ key: config.centerKey, status: 'rendered-extractor-error', count: 0 });
          centersProcessed++;
          continue;
        }

        await emitCenterResults(config, result.members || [], result.childCenters || [], pageUrl, {
          pagesRead: 1,
          readMode: 'rendered',
          stopReason: 'rendered-page',
        });
        centersProcessed++;
        continue;
      }

      const allMembers: CenterMember[] = [];
      const allChildCenters: ChildCenter[] = [];
      const seenPaginationKeys = new Set<string>();
      let firstPageUrl: string | null = null;
      let pagesFetched = 0;
      const maxPages = config.paginated ? MAX_PAGES_PER_CENTER : 1;
      let consecutiveRepeatedPages = 0;
      let stopReason: CenterRosterStopReason = 'page-cap';

      for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
        const pageUrl = pageUrlForIndex(config.url, pageIdx);
        if (!firstPageUrl) firstPageUrl = pageUrl;
        let html: string;
        try {
          html = await this.htmlFetcher(pageUrl, ctx.options.useCache, this.name);
        } catch (err: any) {
          ctx.log(
            `[${config.centerKey}] fetch failed for configured page: ${sanitizeLogValue(err)}`,
          );
          stopReason = 'fetch-failed';
          break;
        }
        pagesFetched++;
        let result: ExtractorResult;
        try {
          result = config.extractor(html, { pageUrl, centerName: config.centerName });
        } catch (err: any) {
          ctx.log(
            `[${config.centerKey}] extractor error on configured page: ${sanitizeLogValue(err)}`,
          );
          stopReason = 'extractor-error';
          break;
        }
        const pageMembers = result.members ?? [];
        const pageChildCenters = result.childCenters ?? [];
        if (pageMembers.length === 0 && pageChildCenters.length === 0) {
          stopReason = 'empty-page';
          break;
        }
        const newMembers = pageMembers.filter((member) => {
          const key = `member:${slugify(normalizeName(member.name))}`;
          if (key === 'member:' || seenPaginationKeys.has(key)) return false;
          seenPaginationKeys.add(key);
          return true;
        });
        const newChildCenters = pageChildCenters.filter((child) => {
          const key = `child:${slugify(child.name)}`;
          if (key === 'child:' || seenPaginationKeys.has(key)) return false;
          seenPaginationKeys.add(key);
          return true;
        });
        if (newMembers.length === 0 && newChildCenters.length === 0) {
          consecutiveRepeatedPages++;
          if (!config.paginated || consecutiveRepeatedPages >= CONSECUTIVE_REPEATED_PAGES_TO_STOP) {
            stopReason = config.paginated ? 'repeated-page' : 'not-paginated';
            break;
          }
          continue;
        }
        consecutiveRepeatedPages = 0;
        allMembers.push(...newMembers);
        allChildCenters.push(...newChildCenters);
        if (!config.paginated) {
          stopReason = 'not-paginated';
          break;
        }
      }

      if (
        pagesFetched === 0 ||
        (stopReason === 'fetch-failed' && allMembers.length === 0 && allChildCenters.length === 0)
      ) {
        perCenter.push({ key: config.centerKey, status: 'fetch-failed', count: 0 });
        centersProcessed++;
        continue;
      }

      const sourceUrl = firstPageUrl || config.url;

      await emitCenterResults(config, allMembers, allChildCenters, sourceUrl, {
        pagesRead: pagesFetched,
        readMode: 'html',
        stopReason,
      });
      centersProcessed++;
    }

    const summary = perCenter
      .map((c) => `${c.key}=${c.status === 'ok' ? c.count : c.status}`)
      .join(', ');
    ctx.log(
      `Emitted ${totalObs} observations across ${centersProcessed} centers, ${totalMembers} members, ${totalChildCenters} child centers (${summary})`,
    );

    if (rosterSiteRefusals.length > 0) {
      ctx.log(
        `Refused ${rosterSiteRefusals.length} center roster(s) off the center's own site: ${rosterSiteRefusals
          .map((refusal) => `${refusal.key} (${refusal.reason})`)
          .join(', ')}`,
      );
    }

    return {
      observationCount: totalObs,
      entitiesObserved: centersProcessed + totalMembers + totalChildCenters,
      notes: `Centers: ${summary}`,
      fetchMetrics: summarizeFetchMetrics(fetchAttempts),
    };
  }

  private async withMemberIdentityEvidence(
    rosterKey: string,
    members: CenterMember[],
    ctx: ScraperContext,
  ): Promise<CenterMember[]> {
    const profiled = members
      .filter((member) => isYaleHostedUrl(member.profileUrl))
      .slice(0, ctx.options.limit ?? Infinity);
    const evidenceByMember = new Map<CenterMember, RosterMemberIdentityEvidence>();
    await mapWithConcurrency(profiled, MEMBER_PROFILE_FETCH_CONCURRENCY, async (member) => {
      const evidence = await this.readMemberIdentityEvidence(member, ctx);
      if (evidence) evidenceByMember.set(member, evidence);
    });
    if (profiled.length > 0) {
      ctx.log(
        `[${rosterKey}] member identity evidence: ${evidenceByMember.size} of ${profiled.length} profile page(s) read`,
      );
    }
    return members.map((member) => {
      const identityEvidence = evidenceByMember.get(member);
      return identityEvidence ? { ...member, identityEvidence } : member;
    });
  }

  // Only the extracted evidence is cached, never the page: a center's member pages run to
  // hundreds of megabytes, and caching them whole fills the Development quota.
  private async readMemberIdentityEvidence(
    member: CenterMember,
    ctx: ScraperContext,
  ): Promise<RosterMemberIdentityEvidence | undefined> {
    const profileUrl = member.profileUrl || '';
    const cacheKey = `${MEMBER_IDENTITY_EVIDENCE_CACHE_PREFIX}${profileUrl}`;
    if (ctx.options.useCache) {
      const cached = await getCached<RosterMemberIdentityEvidence>(this.name, cacheKey);
      if (cached) return cached;
    }
    let html: string;
    try {
      html = await this.memberPageFetcher(profileUrl);
    } catch {
      return undefined;
    }
    if (typeof html !== 'string' || !html) return undefined;
    const evidence = extractRosterMemberIdentityEvidence(html, profileUrl, member.name);
    if (ctx.options.useCache) await setCached(this.name, cacheKey, evidence);
    return evidence;
  }

  /**
   * Crawl a child center's own site to discover a student-facing engagement
   * subpage and roster. Fetches the child homepage, reads any Jackson
   * profile-card members on it, then tries the ranked engagement candidates
   * (HTTP-verified, fail closed on non-200) and reads the roster of the first
   * that resolves. Returns no engagement URL when the child is a genuine dead
   * end with no discoverable way-in.
   */
  private async crawlChildCenter(
    child: ChildCenter,
    ctx: ScraperContext,
  ): Promise<{ engagementUrl?: string; members: CenterMember[] }> {
    let homepageHtml: string;
    try {
      homepageHtml = await this.htmlFetcher(child.url, ctx.options.useCache, this.name);
    } catch (err: any) {
      ctx.log(`[child ${slugify(child.name)}] homepage fetch failed: ${sanitizeLogValue(err)}`);
      return { members: [] };
    }

    const members: CenterMember[] = [
      ...jacksonProfileItemExtractor(homepageHtml, { pageUrl: child.url }).members,
    ];

    let engagementUrl: string | undefined;
    for (const candidate of deriveChildEngagementCandidates(homepageHtml, child.url)) {
      let html: string;
      try {
        html = await this.htmlFetcher(candidate, ctx.options.useCache, this.name);
      } catch {
        continue;
      }
      engagementUrl = candidate;
      members.push(...jacksonProfileItemExtractor(html, { pageUrl: candidate }).members);
      break;
    }

    return { engagementUrl, members };
  }
}
