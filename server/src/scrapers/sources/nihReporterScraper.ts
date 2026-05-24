/**
 * NihReporterScraper
 *
 * Pulls active NIH-funded research projects whose lead organization is Yale from
 * the public NIH RePORTER API (https://api.reporter.nih.gov/v2/projects/search).
 * The endpoint is free, requires no auth, and accepts a `User-Agent` header.
 *
 * The single canonical org_names value "YALE UNIVERSITY" captures all Yale
 * grants (we verified that "YALE SCHOOL OF MEDICINE", "YALE NEW HAVEN HOSPITAL",
 * etc. all resolve to 0 — RePORTER normalizes to a single org_name per IPF
 * code). YSM, YSPH and other school-affiliated grants surface under the same
 * "YALE UNIVERSITY" umbrella with `organization.dept_type` distinguishing them.
 *
 * Strategy:
 *   - Paginate through Yale grants (offset/limit, max 500 per request).
 *   - Group grants by contact PI name.
 *   - For each PI:
 *       - Try to resolve to a User by (lname exact + fname exact), then
 *         (lname exact + first initial). If unmatched, keep the funding evidence
 *         on the ResearchEntity only; NIH records alone are not enough to mint
 *         a canonical Yale User identity.
 *       - Compute a deterministic ResearchGroup slug `nih-pi-<normalized>`.
 *       - Emit ResearchGroup observations: name, kind, school (for YSM only),
 *         recentGrants (full array of up to 10 most-recent grants), recentGrantCount,
 *         fundingAgencies=['NIH'], lastObservedAt = max(start_date), sourceUrls.
 *
 * Honors:
 *   - ctx.options.useCache — caches each (offset/limit/fiscal_year) page payload.
 *   - ctx.options.limit — caps the *number of PIs processed*, not raw grants.
 */
import axios from 'axios';
import { User } from '../../models/user';
import { ResearchEntity } from '../../models/researchEntity';
import { ResearchGroupMember } from '../../models/researchGroupMember';
import { getCached, setCached } from '../snapshotCache';
import { normalizeName, slugify, splitName } from '../utils/scraperHelpers';
import type { IScraper, ScraperContext, ScraperResult, ObservationInput } from '../types';

const REPORTER_ENDPOINT = 'https://api.reporter.nih.gov/v2/projects/search';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const PAGE_SIZE = 500;
const FETCH_TIMEOUT_MS = 60_000;
const RECENT_GRANTS_PER_PI = 10;
const SYNTHETIC_FUNDING_NETID_RE = /^(?:nsf|nih)-pi:/i;
const FUNDING_ENTITY_SLUG_RE = /^(?:nsf|nih)-pi-/i;
const LEAD_MEMBER_ROLES = ['pi', 'co-pi', 'director', 'co-director'];
const DEFAULT_FISCAL_YEARS = [
  new Date().getFullYear() - 2,
  new Date().getFullYear() - 1,
  new Date().getFullYear(),
];
const YALE_ORG_NAMES = ['YALE UNIVERSITY'];
// Cap how many pages we'll ever request defensively. 30 pages * 500 = 15k records,
// well above Yale's typical ~3.5k for a 3-year window.
const MAX_PAGES = 30;

function firstNameCompatible(sourceFirstName: string, candidateFirstName: unknown): boolean {
  const sourceToken = slugify(sourceFirstName).split('-')[0] || '';
  const candidateToken = slugify(String(candidateFirstName || '')).split('-')[0] || '';
  if (!sourceToken || !candidateToken) return false;
  if (sourceToken === candidateToken) return true;
  if (sourceToken.length === 1) return candidateToken.startsWith(sourceToken);
  if (sourceToken.length < 3) return false;
  return candidateToken.startsWith(sourceToken) || sourceToken.startsWith(candidateToken);
}

// ---------------------------------------------------------------------------
// API response shapes (only the fields we use)
// ---------------------------------------------------------------------------

export interface NihPrincipalInvestigator {
  profile_id?: number;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  full_name?: string;
  is_contact_pi?: boolean;
  title?: string;
}

export interface NihAgencyAdmin {
  code?: string;
  abbreviation?: string;
  name?: string;
}

export interface NihOrganization {
  org_name?: string;
  dept_type?: string;
  org_city?: string;
  org_state?: string;
}

export interface NihGrant {
  project_num?: string;
  appl_id?: number;
  core_project_num?: string;
  project_title?: string;
  abstract_text?: string;
  contact_pi_name?: string;
  principal_investigators?: NihPrincipalInvestigator[];
  organization?: NihOrganization;
  fiscal_year?: number;
  award_amount?: number;
  project_start_date?: string;
  project_end_date?: string;
  agency_ic_admin?: NihAgencyAdmin;
  activity_code?: string;
  project_detail_url?: string;
  is_active?: boolean;
}

interface NihPage {
  meta: {
    total: number;
    offset: number;
    limit: number;
  };
  results: NihGrant[];
}

// ---------------------------------------------------------------------------
// Normalized record shape we emit into ResearchGroup.recentGrants
// ---------------------------------------------------------------------------

export interface RecentGrantRecord {
  id: string;
  agency: string;
  title: string;
  abstract: string;
  startDate?: Date;
  endDate?: Date;
  dollarAmount: number;
  url: string;
  role: 'pi' | 'copi';
}

export interface MatchedFacultyForFunding {
  _id: string;
  netid?: string;
  userType?: string;
  primaryDepartment?: string;
  departments?: string[];
  secondaryDepartments?: string[];
  profileUrls?: Record<string, unknown>;
  website?: string;
}

export interface FundingResearchEntityTarget {
  slug: string;
  createIfMissing: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers (testable in isolation)
// ---------------------------------------------------------------------------

/**
 * Convert "TABACHNIKOVA, ALEXANDRA " (RePORTER's contact_pi_name format) into
 * a canonical "First Last" representation. Falls back to the raw string when
 * no comma is present.
 */
export function canonicalPiName(raw: string | undefined | null): string {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';
  if (trimmed.includes(',')) {
    const [last, rest] = trimmed.split(',', 2).map((s) => s.trim());
    const firstChunk = (rest || '').split(/\s+/)[0] || '';
    const last_t = titleCaseToken(last);
    const first_t = titleCaseToken(firstChunk);
    return [first_t, last_t].filter(Boolean).join(' ');
  }
  return trimmed
    .split(/\s+/)
    .filter(Boolean)
    .map(titleCaseToken)
    .join(' ');
}

function titleCaseToken(token: string): string {
  if (!token) return '';
  if (/^[A-Z]+$/.test(token)) {
    // ALL-CAPS token like "TABACHNIKOVA" -> "Tabachnikova"
    return token.charAt(0) + token.slice(1).toLowerCase();
  }
  return token;
}

/**
 * Stable, deterministic PI key helper retained for compatibility with tests
 * and legacy references. Funding scrapers do not use this key to mint User
 * observations unless a separate Yale-confirming identity source exists.
 */
export function piEntityKey(canonicalName: string): string {
  const slug = slugify(canonicalName);
  return slug ? `nih-pi:${slug}` : '';
}

export function piSlugForResearchGroup(canonicalName: string): string {
  const slug = slugify(canonicalName);
  return slug ? `nih-pi-${slug}` : '';
}

/**
 * Group grants by their contact PI's canonical name.
 *
 * The RePORTER record sometimes lists multiple PIs in `principal_investigators`
 * — we attribute the grant to whichever entry has `is_contact_pi: true`,
 * falling back to `contact_pi_name`. Grants with no resolvable PI are
 * dropped.
 */
export function groupGrantsByPi(grants: NihGrant[]): Map<string, NihGrant[]> {
  const groups = new Map<string, NihGrant[]>();
  for (const grant of grants) {
    const piName = pickContactPiName(grant);
    if (!piName) continue;
    const list = groups.get(piName) || [];
    list.push(grant);
    groups.set(piName, list);
  }
  return groups;
}

/** Prefer the structured `is_contact_pi: true` entry over the unstructured string. */
export function pickContactPiName(grant: NihGrant): string {
  const contactStruct = (grant.principal_investigators || []).find((p) => p.is_contact_pi);
  if (contactStruct) {
    const first = (contactStruct.first_name || '').trim();
    const last = (contactStruct.last_name || '').trim();
    if (first || last) {
      return canonicalPiName(`${last}, ${first}`.trim());
    }
    if (contactStruct.full_name) return canonicalPiName(contactStruct.full_name);
  }
  if (grant.contact_pi_name) return canonicalPiName(grant.contact_pi_name);
  return '';
}

/** Map a single API record into the schema-shaped record stored in `recentGrants`. */
export function grantToRecord(grant: NihGrant): RecentGrantRecord {
  const id =
    grant.project_num ||
    grant.core_project_num ||
    (grant.appl_id ? `appl-${grant.appl_id}` : 'unknown');
  const agency =
    grant.agency_ic_admin?.abbreviation ||
    grant.agency_ic_admin?.name ||
    grant.agency_ic_admin?.code ||
    'NIH';
  const title = (grant.project_title || '').trim();
  const abstract = (grant.abstract_text || '').trim();
  const dollarAmount = typeof grant.award_amount === 'number' ? grant.award_amount : 0;
  const url =
    grant.project_detail_url ||
    (grant.appl_id ? `https://reporter.nih.gov/project-details/${grant.appl_id}` : REPORTER_ENDPOINT);
  return {
    id,
    agency,
    title,
    abstract,
    startDate: parseDate(grant.project_start_date),
    endDate: parseDate(grant.project_end_date),
    dollarAmount,
    url,
    role: 'pi',
  };
}

function parseDate(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

/**
 * Try to resolve a NIH PI name to an existing Yale faculty User.
 *
 * Strategy: split into first/last, look for an exact (case-insensitive) lname
 * match restricted to faculty/professor/admin userType, then narrow further
 * by either an exact fname match or a first-initial match. Returns the lone
 * matching user or null when ambiguous / not found. The DB query is exposed
 * via the `userModel` parameter so tests can inject a mock without touching
 * mongoose.
 */
export async function findUserForPi(
  canonicalName: string,
  userModel: { find: typeof User.find } = User,
): Promise<MatchedFacultyForFunding | null> {
  if (!canonicalName) return null;
  const { first, last } = splitName(canonicalName);
  if (!last) return null;
  const lnameRe = new RegExp(`^${escapeRegex(last)}$`, 'i');
  const candidates: any[] = await userModel
    .find(
      {
        lname: lnameRe,
        userType: { $in: ['professor', 'faculty', 'admin'] },
        netid: { $not: SYNTHETIC_FUNDING_NETID_RE },
      },
      {
        _id: 1,
        fname: 1,
        lname: 1,
        netid: 1,
        userType: 1,
        primaryDepartment: 1,
        departments: 1,
        secondaryDepartments: 1,
        profileUrls: 1,
        website: 1,
      },
    )
    .limit(10)
    .lean();
  const canonicalCandidates = candidates.filter(
    (candidate) => !SYNTHETIC_FUNDING_NETID_RE.test(String(candidate.netid || '')),
  );
  if (canonicalCandidates.length === 0) return null;
  if (canonicalCandidates.length === 1) {
    if (first && !firstNameCompatible(first, canonicalCandidates[0].fname)) return null;
    return { ...canonicalCandidates[0], _id: String(canonicalCandidates[0]._id) };
  }
  if (!first) return null;
  // Exact first name match wins.
  const exact = canonicalCandidates.filter(
    (c) => (c.fname || '').toLowerCase() === first.toLowerCase(),
  );
  if (exact.length === 1) {
    return { ...exact[0], _id: String(exact[0]._id) };
  }
  // Fall back to safe first-name compatibility. Avoid bare first-initial
  // matches for full names; "Maria Martinez" must not match "Michael Martinez".
  const initial = first.charAt(0).toLowerCase();
  const byInitial = canonicalCandidates.filter(
    (c) => (c.fname || '').toLowerCase().charAt(0) === initial,
  );
  const compatibleMatches = byInitial.filter((candidate) =>
    firstNameCompatible(first, candidate.fname),
  );
  if (compatibleMatches.length === 1) {
    return { ...compatibleMatches[0], _id: String(compatibleMatches[0]._id) };
  }
  // Ambiguous — refuse to guess.
  return null;
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function arrayHasText(values: unknown): boolean {
  return Array.isArray(values) && values.some((value) => !!textValue(value));
}

function hasOfficialYaleProfileUrl(user: MatchedFacultyForFunding): boolean {
  const urls = [
    user.website,
    ...(user.profileUrls && typeof user.profileUrls === 'object'
      ? Object.values(user.profileUrls)
      : []),
  ];
  return urls.some((value) => {
    const url = textValue(value);
    if (!url) return false;
    try {
      const parsed = new URL(url);
      return parsed.hostname === 'yale.edu' || parsed.hostname.endsWith('.yale.edu');
    } catch {
      return /(^|[/.])yale\.edu\//i.test(url);
    }
  });
}

export function isHighSignalFundingFacultyMatch(user: MatchedFacultyForFunding): boolean {
  return (
    !SYNTHETIC_FUNDING_NETID_RE.test(textValue(user.netid)) &&
    hasOfficialYaleProfileUrl(user) &&
    Boolean(textValue(user.primaryDepartment) ||
      arrayHasText(user.departments) ||
      arrayHasText(user.secondaryDepartments))
  );
}

async function defaultResearchEntityTargetFinder(
  user: MatchedFacultyForFunding,
): Promise<FundingResearchEntityTarget | null> {
  const memberships = await ResearchGroupMember.find({
    userId: user._id,
    isCurrentMember: { $ne: false },
    role: { $in: LEAD_MEMBER_ROLES },
  })
    .select('researchEntityId')
    .lean();
  const ids = memberships.map((membership: any) => membership.researchEntityId).filter(Boolean);
  if (ids.length > 0) {
    const existing = (await ResearchEntity.findOne({
      _id: { $in: ids },
      archived: { $ne: true },
      slug: { $not: FUNDING_ENTITY_SLUG_RE },
    })
      .select('slug')
      .sort({ updatedAt: -1, _id: 1 })
      .lean()) as { slug?: string } | null;
    if (existing?.slug) {
      return { slug: existing.slug, createIfMissing: false };
    }
  }

  return isHighSignalFundingFacultyMatch(user)
    ? { slug: piSlugForResearchGroup(`${user._id}`), createIfMissing: true }
    : null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the observation list for one PI's grants.
 *
 * Emits:
 *   - ResearchEntity observations keyed by the PI slug.
 *   - A matched Yale User link only when identity resolution found an existing
 *     Yale User. Unmatched funding PIs remain name-scoped grant evidence.
 *   - All recentGrants observations are emitted as a single full array — the
 *     resolver picks the highest-confidence value per field rather than trying
 *     to merge multiple partial arrays.
 */
export function piGrantsToObservations(
  canonicalName: string,
  grants: NihGrant[],
  matchedUser: MatchedFacultyForFunding | null,
  target?: FundingResearchEntityTarget | null,
): ObservationInput[] {
  const out: ObservationInput[] = [];
  if (!canonicalName || grants.length === 0 || !matchedUser || !target) return out;

  const slug = target.slug;
  if (!slug) return out;

  // Sort grants by start date (desc), keep top N for the recentGrants array.
  const sorted = [...grants].sort((a, b) => {
    const ad = parseDate(a.project_start_date)?.getTime() ?? 0;
    const bd = parseDate(b.project_start_date)?.getTime() ?? 0;
    return bd - ad;
  });
  const recentRecords = sorted.slice(0, RECENT_GRANTS_PER_PI).map(grantToRecord);
  const lastObservedAt = recentRecords
    .map((g) => g.startDate?.getTime())
    .filter((t): t is number => typeof t === 'number')
    .reduce((max, t) => (t > max ? t : max), 0);

  const sourceUrls = sorted
    .map((g) => g.project_detail_url)
    .filter((u): u is string => !!u);

  // ResearchEntity observations.
  const groupBase = {
    entityType: 'researchEntity' as const,
    entityKey: slug,
    sourceUrl: sorted[0]?.project_detail_url || REPORTER_ENDPOINT,
  };
  const piDisplayName = canonicalName;
  if (target.createIfMissing) {
    out.push({ ...groupBase, field: 'slug', value: slug });
    out.push({ ...groupBase, field: 'name', value: `${piDisplayName} Lab` });
    out.push({ ...groupBase, field: 'kind', value: 'lab' });
  }
  out.push({ ...groupBase, field: 'recentGrants', value: recentRecords });
  out.push({ ...groupBase, field: 'recentGrantCount', value: recentRecords.length });
  out.push({ ...groupBase, field: 'fundingAgencies', value: ['NIH'] });
  if (lastObservedAt > 0) {
    out.push({ ...groupBase, field: 'lastObservedAt', value: new Date(lastObservedAt) });
  }
  if (sourceUrls.length > 0) {
    out.push({ ...groupBase, field: 'sourceUrls', value: sourceUrls.slice(0, RECENT_GRANTS_PER_PI) });
  }
  out.push({
    ...groupBase,
    field: 'inferredPiUserId',
    value: matchedUser._id,
    confidenceOverride: 0.9, // RePORTER + name match is high-confidence
  });
  return out;
}

// ---------------------------------------------------------------------------
// Network layer
// ---------------------------------------------------------------------------

interface FetchPageOpts {
  offset: number;
  limit: number;
  fiscalYears: number[];
  useCache: boolean;
  ctx: ScraperContext;
}

async function fetchPage({
  offset,
  limit,
  fiscalYears,
  useCache,
  ctx,
}: FetchPageOpts): Promise<NihPage> {
  const cacheKey = `page:offset=${offset}:limit=${limit}:fy=${fiscalYears.join(',')}`;
  if (useCache) {
    const cached = await getCached<NihPage>('nih-reporter', cacheKey);
    if (cached) return cached;
  }
  const body = {
    criteria: {
      org_names: YALE_ORG_NAMES,
      exclude_subprojects: true,
      fiscal_years: fiscalYears,
    },
    offset,
    limit,
    sort_field: 'project_start_date',
    sort_order: 'desc',
  };
  const res = await axios.post(REPORTER_ENDPOINT, body, {
    timeout: FETCH_TIMEOUT_MS,
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
  const payload: NihPage = {
    meta: res.data?.meta || { total: 0, offset, limit },
    results: (res.data?.results as NihGrant[]) || [],
  };
  if (useCache) await setCached('nih-reporter', cacheKey, payload);
  ctx.log(
    `fetched offset=${offset} got=${payload.results.length} total=${payload.meta.total}`,
  );
  return payload;
}

// ---------------------------------------------------------------------------
// Scraper class
// ---------------------------------------------------------------------------

export interface NihReporterScraperOptions {
  /** Override fiscal years (defaults to current FY plus the two prior FYs). */
  fiscalYears?: number[];
  /** Inject a custom User model (used by tests to mock the DB). */
  userModel?: { find: typeof User.find };
  /** Inject target lookup (used by tests to mock ResearchEntity lookup). */
  researchEntityTargetFinder?: (
    user: MatchedFacultyForFunding,
  ) => Promise<FundingResearchEntityTarget | null>;
}

export class NihReporterScraper implements IScraper {
  readonly name = 'nih-reporter';
  readonly displayName = 'NIH RePORTER (Yale grants)';

  constructor(private readonly opts: NihReporterScraperOptions = {}) {}

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const fiscalYears = this.opts.fiscalYears || DEFAULT_FISCAL_YEARS;
    const userModel = this.opts.userModel || User;
    const targetFinder =
      this.opts.researchEntityTargetFinder || defaultResearchEntityTargetFinder;
    ctx.log(`Querying NIH RePORTER for Yale grants in FY ${fiscalYears.join(', ')}`);

    // 1. Paginate through all matching grants.
    const allGrants: NihGrant[] = [];
    let offset = 0;
    let total = Infinity;
    let pages = 0;
    while (offset < total && pages < MAX_PAGES) {
      let page: NihPage;
      try {
        page = await fetchPage({
          offset,
          limit: PAGE_SIZE,
          fiscalYears,
          useCache: ctx.options.useCache,
          ctx,
        });
      } catch (err: any) {
        ctx.log(`fetch error at offset=${offset}: ${err?.message || err}`);
        break;
      }
      pages++;
      total = page.meta.total ?? page.results.length;
      allGrants.push(...page.results);
      if (page.results.length === 0) break;
      offset += page.results.length;
    }
    ctx.log(`fetched ${allGrants.length}/${total} grants across ${pages} page(s)`);

    // 2. Group by PI.
    const groups = groupGrantsByPi(allGrants);
    ctx.log(`grouped into ${groups.size} unique contact PIs`);

    // 3. Honor --limit (caps PIs processed, NOT raw grants).
    const piLimit = ctx.options.limit && ctx.options.limit > 0 ? ctx.options.limit : Infinity;
    const piEntries = Array.from(groups.entries()).slice(0, piLimit);

    // 4. Resolve each PI to a User (or stub) and emit observations.
    let totalObs = 0;
    let matched = 0;
    let unmatched = 0;
    let processed = 0;
    for (const [piName, grants] of piEntries) {
      let matchedUser: MatchedFacultyForFunding | null = null;
      try {
        matchedUser = await findUserForPi(piName, userModel);
      } catch (err: any) {
        ctx.log(`user-lookup error for "${piName}": ${err?.message || err}`);
      }
      if (matchedUser) matched++;
      else unmatched++;

      const target = matchedUser ? await targetFinder(matchedUser) : null;
      const observations = piGrantsToObservations(piName, grants, matchedUser, target);
      if (observations.length > 0) {
        await ctx.emit(observations);
        totalObs += observations.length;
      }
      processed++;
      if (processed % 100 === 0 || processed === piEntries.length) {
        ctx.log(
          `progress: ${processed}/${piEntries.length} PIs (${matched} matched, ${unmatched} unmatched), ${totalObs} obs`,
        );
      }
    }

    return {
      observationCount: totalObs,
      entitiesObserved: piEntries.length,
      notes: `Yale NIH grants FY ${fiscalYears.join('-')}: ${allGrants.length} grants → ${groups.size} PIs (matched ${matched}, unmatched ${unmatched})`,
    };
  }
}
