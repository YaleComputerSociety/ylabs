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
import type { IScraper, ScraperContext, ScraperResult, ObservationInput } from '../types';
import { normalizeName, slugify, splitName } from '../utils/scraperHelpers';

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
  /** Set when the page is JS-rendered or behind auth — runner logs and skips. */
  jsRenderedSkip?: boolean;
  /** Reason string used in the log line when jsRenderedSkip is true. */
  skipReason?: string;
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
 * Yale Cancer Center member directory (`/cancer/research/membership/directory`).
 * 470+ members on a single page, alphabetized:
 *   <a href="/cancer/profile/<slug>/" class="hyperlink">Last, First</a>
 * Names are "Last, First" — flipped for downstream split. No title in listing.
 */
export const yaleCancerCenterExtractor: CenterExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const members: CenterMember[] = [];
  const seen = new Set<string>();
  $('a[href^="/cancer/profile/"].hyperlink').each((_i, el) => {
    const link = $(el);
    const raw = link.text().trim();
    if (!raw) return;
    const href = link.attr('href') || '';
    if (!href || seen.has(href)) return;
    seen.add(href);
    const flipped = flipLastFirst(raw);
    members.push({
      name: flipped,
      profileUrl: absolutize(href, ctx.pageUrl),
      role: 'core-faculty',
    });
  });
  return { members };
};

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
    const title = row.find('.field-name-field-team-member-creds').first().text().trim() || undefined;
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
// Default config — the v1 ten-center set
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
    centerKey: 'jackson-centers',
    centerName: 'Jackson School of Global Affairs (centers index)',
    schoolName: 'Jackson School of Global Affairs',
    kind: 'center',
    url: 'https://jackson.yale.edu/centers-initiatives/',
    paginated: false,
    extractor: jacksonCentersExtractor,
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
  const entityKey = `center-${config.centerKey}`;
  const base = { entityType: 'researchEntity' as const, entityKey, sourceUrl };

  // Aggregate departments from member titles when none were declared in config.
  const declaredDepts = config.departments && config.departments.length > 0
    ? config.departments
    : [];

  const obs: ObservationInput[] = [
    { ...base, field: 'slug', value: entityKey },
    { ...base, field: 'name', value: config.centerName },
    { ...base, field: 'kind', value: config.kind },
    { ...base, field: 'websiteUrl', value: config.url },
    { ...base, field: 'sourceUrls', value: [sourceUrl] },
    { ...base, field: 'openness', value: 'open' },
  ];
  if (config.schoolName) {
    obs.push({ ...base, field: 'school', value: config.schoolName });
  }
  if (declaredDepts.length > 0) {
    obs.push({ ...base, field: 'departments', value: declaredDepts });
  }
  if (members.length > 0) {
    const names = members.map((m) => normalizeName(m.name)).filter(Boolean);
    obs.push({ ...base, field: 'affiliatedNames', value: names });
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
  const cleaned = normalizeName(member.name);
  const { first, last } = splitName(cleaned);
  const memberSlug = slugify(cleaned);
  if (!memberSlug) return [];
  const entityKey = `center-${config.centerKey}:${memberSlug}`;
  const base = { entityType: 'researchGroupMember' as const, entityKey, sourceUrl };
  const obs: ObservationInput[] = [
    { ...base, field: 'researchGroupKey', value: `center-${config.centerKey}` },
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
    { ...base, field: 'openness', value: 'open' },
  ];
  if (parentConfig.schoolName) {
    obs.push({ ...base, field: 'school', value: parentConfig.schoolName });
  }
  if (child.description) {
    obs.push({ ...base, field: 'description', value: child.description });
  }
  return obs;
}

// ---------------------------------------------------------------------------
// Scraper
// ---------------------------------------------------------------------------

export class CentersInstitutesScraper implements IScraper {
  readonly name = 'centers-institutes-index';
  readonly displayName = 'Yale centers & institutes index';

  /** Configs are injectable for testing; default to the bundled ten-center set. */
  constructor(private readonly configs: CenterConfig[] = DEFAULT_CENTER_CONFIGS) {}

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

    for (const config of this.configs) {
      if (onlyFilter && !onlyFilter.has(config.centerKey.toLowerCase())) continue;
      if (centersProcessed >= limit) break;

      if (config.jsRenderedSkip) {
        ctx.log(
          `[${config.centerKey}] skipped — ${config.skipReason || 'JS-rendered, needs headless browser'}`,
        );
        perCenter.push({ key: config.centerKey, status: 'js-rendered-skip', count: 0 });
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
          html = await fetchHtml(pageUrl, ctx.options.useCache, this.name);
        } catch (err: any) {
          ctx.log(`[${config.centerKey}] fetch failed for ${pageUrl}: ${err?.message || err}`);
          fetchFailed = true;
          break;
        }
        pagesFetched++;
        let result: ExtractorResult;
        try {
          result = config.extractor(html, { pageUrl });
        } catch (err: any) {
          ctx.log(`[${config.centerKey}] extractor error on ${pageUrl}: ${err?.message || err}`);
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

      // Parent ResearchGroup observation
      const { observations: groupObs } = centerToGroupObservations(
        config,
        allMembers,
        sourceUrl,
      );
      await ctx.emit(groupObs);
      totalObs += groupObs.length;

      // Per-member ResearchGroupMember observations
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
      }

      // Child ResearchGroup observations (Jackson School style)
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
    };
  }
}
