/**
 * NsfAwardScraper
 *
 * Pulls active NSF grants where Yale University is the awardee from the public
 * NSF Award Search API (https://api.nsf.gov/services/v1/awards.json). Free,
 * unauthenticated, JSON, max 25 records per page.
 *
 * Why this scraper exists:
 *   Yale's School of Engineering & Applied Science (and other engineering
 *   departments) publishes faculty rosters and lab pages as JS-rendered SPAs we
 *   can't scrape with plain HTTP. NSF awards are the structured fallback —
 *   funding flows are public, indexed by PI, and give us the engineering-side
 *   PIs and lab-existence signals we'd otherwise miss.
 *
 * Strategy (mirrors the parallel NIH scraper):
 *   1. Page through "Yale University" awards from `dateStart` (default 5 years
 *      ago) using `awardeeName="Yale University"` (quoted = exact phrase) and
 *      offset/rpp pagination. Stop on an empty page.
 *   2. Group awards by PI (`piFirstName` + `piLastName`).
 *   3. For each PI: try to match an existing User by exact lname+fname, then by
 *      lname + first initial. If matched, enrich that faculty member's existing
 *      ResearchEntity when available. Only a high-signal faculty match may mint
 *      a funding-derived profile; NSF records alone are not enough to create a
 *      student-facing research entity.
 *   4. Emit a ResearchGroup observation per PI:
 *        - `recentGrants`: full embedded array of up to MAX_GRANTS_PER_PI
 *          (latest by start date).
 *        - `recentGrantCount`: count of active awards for this PI.
 *        - `fundingAgencies`: ['NSF']  (NIH scraper emits ['NIH']; the resolver
 *          merges array-typed fields with an agreement bonus across sources.)
 *        - `lastObservedAt`: max(startDate) across this PI's awards.
 *   5. Co-PIs (`coPDPI`) → emit ResearchGroupMember observations with role
 *      'co-pi' but ONLY when we can resolve the co-PI to an existing Yale User
 *      (avoids creating noise from non-Yale collaborators).
 *
 * Honors `--use-cache` (page responses cached via snapshotCache) and `--limit`
 * (caps total awards processed across all pages).
 */
import axios from 'axios';
import { User } from '../../models/user';
import { ResearchEntity } from '../../models/researchEntity';
import { ResearchGroupMember } from '../../models/researchGroupMember';
import { getCached, setCached } from '../snapshotCache';
import { normalizeName, slugify, splitName } from '../utils/scraperHelpers';
import type {
  IScraper,
  ObservationInput,
  ScraperContext,
  ScraperResult,
} from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NSF_API_URL = 'https://api.nsf.gov/services/v1/awards.json';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 25; // NSF API max
const MAX_PAGES = 200; // safety cap (5000 awards) — well above current ~400
const DEFAULT_LOOKBACK_YEARS = 5;
const MAX_GRANTS_PER_PI = 10;
const SYNTHETIC_FUNDING_NETID_RE = /^(?:nsf|nih)-pi:/i;
const FUNDING_ENTITY_SLUG_RE = /^(?:nsf|nih)-pi-/i;
const LEAD_MEMBER_ROLES = ['pi', 'co-pi', 'director', 'co-director'];

// Quote-wrapped exact-phrase match. Without quotes the API does a fuzzy
// keyword search across all awardees and returns ~every university.
const AWARDEE_QUERY = '"Yale University"';

const PRINT_FIELDS = [
  'id',
  'title',
  'abstractText',
  'awardeeName',
  'piFirstName',
  'piLastName',
  'piMiddeInitial', // (sic) NSF API uses this misspelled field name
  'piEmail',
  'piPhone',
  'pdPIName',
  'coPDPI',
  'pi',
  'startDate',
  'expDate',
  'fundsObligatedAmt',
  'estimatedTotalAmt',
  'fundProgramName',
  'agency',
  'publicAccessMandate',
  'activeAwd',
].join(',');

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
// Types
// ---------------------------------------------------------------------------

/** Raw NSF award shape — only the fields we read are typed; extras are tolerated. */
export interface NsfAward {
  id?: string;
  title?: string;
  abstractText?: string;
  awardeeName?: string;
  piFirstName?: string;
  piLastName?: string;
  piMiddeInitial?: string;
  piEmail?: string;
  piPhone?: string;
  pdPIName?: string;
  coPDPI?: string[];
  pi?: string[];
  startDate?: string; // mm/dd/yyyy
  expDate?: string; // mm/dd/yyyy
  fundsObligatedAmt?: string;
  estimatedTotalAmt?: string;
  fundProgramName?: string;
  agency?: string;
  activeAwd?: string;
}

/** Per-PI aggregation of awards. */
export interface PiAwardsGroup {
  piFirstName: string;
  piLastName: string;
  awards: NsfAward[];
}

/** Normalized record we embed in ResearchGroup.recentGrants. */
export interface RecentGrantRecord {
  id: string;
  agency: 'NSF';
  title: string;
  abstract: string;
  startDate?: Date;
  endDate?: Date;
  dollarAmount?: number;
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
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Parse an NSF mm/dd/yyyy date string. Returns undefined for blank / malformed
 * input rather than `Invalid Date`, so callers don't accidentally write garbage
 * into Mongo.
 */
export function parseNsfDate(s: string | undefined | null): Date | undefined {
  if (!s) return undefined;
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return undefined;
  const [_all, mm, dd, yyyy] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return Number.isFinite(d.getTime()) ? d : undefined;
}

/**
 * Parse the dollar-amount string fields (always returned as strings by NSF).
 * Strips any non-numeric characters defensively. Returns undefined if no digits.
 */
export function parseDollarAmount(s: string | undefined | null): number | undefined {
  if (s === undefined || s === null || s === '') return undefined;
  const cleaned = String(s).replace(/[^0-9.]/g, '');
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

/** Compose a full PI display name from the awarded `piFirstName` + `piLastName`. */
export function piDisplayName(award: NsfAward): string {
  const first = (award.piFirstName || '').trim();
  const last = (award.piLastName || '').trim();
  const composed = [first, last].filter(Boolean).join(' ').trim();
  if (composed) return composed;
  // fallback to pdPIName if PI name fields are missing
  return normalizeName(award.pdPIName || '');
}

/**
 * Stable, lowercase, dash-joined key for a (firstName, lastName) pair. Used as
 * the deduplication key when grouping awards by PI and as the entityKey suffix
 * for unmatched-PI User observations.
 */
export function piGroupKey(firstName: string, lastName: string): string {
  const f = slugify(firstName || '');
  const l = slugify(lastName || '');
  if (!f && !l) return 'unknown';
  return [f, l].filter(Boolean).join(' ');
}

/**
 * Group an array of awards by (piFirstName, piLastName) → PiAwardsGroup.
 * Awards missing a PI name are dropped (we can't attribute them).
 *
 * Pure / no I/O — testable in isolation.
 */
export function groupAwardsByPi(awards: NsfAward[]): PiAwardsGroup[] {
  const map = new Map<string, PiAwardsGroup>();
  for (const a of awards) {
    const first = (a.piFirstName || '').trim();
    const last = (a.piLastName || '').trim();
    if (!first && !last) continue;
    const key = piGroupKey(first, last);
    let group = map.get(key);
    if (!group) {
      group = { piFirstName: first, piLastName: last, awards: [] };
      map.set(key, group);
    }
    group.awards.push(a);
  }
  return Array.from(map.values());
}

/**
 * Convert a single NSF award into the embedded RecentGrantRecord shape that
 * matches the `recentGrants` subdocument schema on ResearchGroup. Returns null
 * when the award has no `id` (we need it to make the public URL).
 */
export function awardToRecord(
  award: NsfAward,
  role: 'pi' | 'copi' = 'pi',
): RecentGrantRecord | null {
  if (!award.id) return null;
  const url = `https://www.nsf.gov/awardsearch/showAward?AWD_ID=${award.id}`;
  return {
    id: award.id,
    agency: 'NSF',
    title: (award.title || '').trim(),
    abstract: (award.abstractText || '').trim(),
    startDate: parseNsfDate(award.startDate),
    endDate: parseNsfDate(award.expDate),
    dollarAmount:
      parseDollarAmount(award.fundsObligatedAmt) ??
      parseDollarAmount(award.estimatedTotalAmt),
    url,
    role,
  };
}

/**
 * Sort RecentGrantRecords most-recent-first by startDate (records without a
 * start date sink to the end). Returns a new array; does not mutate.
 */
export function sortGrantsByRecency(records: RecentGrantRecord[]): RecentGrantRecord[] {
  return [...records].sort((a, b) => {
    const ta = a.startDate ? a.startDate.getTime() : -Infinity;
    const tb = b.startDate ? b.startDate.getTime() : -Infinity;
    return tb - ta;
  });
}

/**
 * Resolve the latest startDate across a set of awards (used to populate
 * lastObservedAt on the ResearchGroup). Returns undefined if no award has a
 * parseable start date.
 */
export function maxStartDate(awards: NsfAward[]): Date | undefined {
  let max: Date | undefined;
  for (const a of awards) {
    const d = parseNsfDate(a.startDate);
    if (d && (!max || d.getTime() > max.getTime())) max = d;
  }
  return max;
}

/**
 * Parse a co-PI line of the form "FullName email@host" into its parts.
 * NSF's API returns coPDPI as an array of these joined strings. Returns null
 * if we can't extract at least a name.
 */
export function parseCoPdpiLine(line: string): {
  fullName: string;
  email?: string;
} | null {
  if (!line) return null;
  const trimmed = String(line).trim();
  if (!trimmed) return null;
  // Email tends to be the last whitespace-separated token containing '@'.
  const tokens = trimmed.split(/\s+/);
  let email: string | undefined;
  let nameTokens = tokens;
  if (tokens.length > 1 && tokens[tokens.length - 1].includes('@')) {
    email = tokens[tokens.length - 1];
    nameTokens = tokens.slice(0, -1);
  }
  const fullName = nameTokens.join(' ').trim();
  if (!fullName) return null;
  return { fullName, email };
}

/**
 * Legacy slug helper retained for tests and migration compatibility.
 * Runtime target selection goes through defaultResearchEntityTargetFinder.
 */
export function piSlug(piUserId: string | null, firstName: string, lastName: string): string {
  if (piUserId) return `nsf-pi-${piUserId}`;
  const key = piGroupKey(firstName, lastName);
  return `nsf-pi-${key.replace(/\s+/g, '-')}`.slice(0, 100);
}

/**
 * Find an existing Yale User for a given (first, last) name. Two-pass:
 *   1. exact lname + fname (case-insensitive)
 *   2. exact lname + first initial of fname (case-insensitive)
 * Both passes only consider professor/faculty/admin user types and return a
 * match only when a single candidate is found (avoids ambiguous attribution).
 *
 * Returns the matched faculty user record, or null when no unambiguous match exists.
 *
 * Default depends on the live `User` model; tests can inject a custom finder
 * via the second argument.
 */
export async function findUserForPi(
  name: { firstName: string; lastName: string },
  finder: (q: Record<string, unknown>) => Promise<Array<MatchedFacultyForFunding & { _id: unknown }>> = defaultUserFinder,
): Promise<MatchedFacultyForFunding | null> {
  const first = (name.firstName || '').trim();
  const last = (name.lastName || '').trim();
  if (!last) return null;

  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lnameRe = new RegExp(`^${escapeRe(last)}$`, 'i');
  const userTypeFilter = { $in: ['professor', 'faculty', 'admin'] };
  const canonicalUserFilter = { $not: SYNTHETIC_FUNDING_NETID_RE };
  const canonicalMatches = (matches: Array<{ _id: unknown; netid?: unknown }>) =>
    matches
      .filter((match) => !SYNTHETIC_FUNDING_NETID_RE.test(String(match.netid || '')))
      .map((match) => ({ ...match, _id: String(match._id) }));

  // pass 1: exact lname + fname
  if (first) {
    const fnameRe = new RegExp(`^${escapeRe(first)}$`, 'i');
    const matches = canonicalMatches(await finder({
      lname: lnameRe,
      fname: fnameRe,
      userType: userTypeFilter,
      netid: canonicalUserFilter,
    }));
    if (matches.length === 1) return matches[0] as MatchedFacultyForFunding;
    // multiple exact matches → ambiguous, give up (don't fall through to initial)
    if (matches.length > 1) return null;
  }

  // pass 2: lname + safe first-name compatibility. Avoid bare first-initial
  // matches for full names; "Maria Martinez" must not match "Michael Martinez".
  if (first) {
    const initial = first.charAt(0);
    const initRe = new RegExp(`^${escapeRe(initial)}`, 'i');
    const matches = canonicalMatches(await finder({
      lname: lnameRe,
      fname: initRe,
      userType: userTypeFilter,
      netid: canonicalUserFilter,
    }));
    const compatibleMatches = matches.filter((match: any) =>
      firstNameCompatible(first, match.fname),
    );
    if (compatibleMatches.length === 1) return compatibleMatches[0] as MatchedFacultyForFunding;
  }
  return null;
}

async function defaultUserFinder(
  q: Record<string, unknown>,
): Promise<Array<MatchedFacultyForFunding & { _id: unknown }>> {
  const rows = await User.find(q, {
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
  })
    .limit(5)
    .lean();
  return rows.map((row: any) => ({ ...row, _id: String(row._id) }));
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
    ? { slug: `nsf-pi-${user._id}`, createIfMissing: true }
    : null;
}

// ---------------------------------------------------------------------------
// HTTP fetch with cache
// ---------------------------------------------------------------------------

async function fetchPage(
  offset: number,
  dateStart: string,
  useCache: boolean,
  sourceName: string,
): Promise<{ awards: NsfAward[]; totalCount?: number }> {
  const cacheKey = `awards:dateStart=${dateStart}:offset=${offset}:rpp=${PAGE_SIZE}`;
  if (useCache) {
    const cached = await getCached<{ awards: NsfAward[]; totalCount?: number }>(
      sourceName,
      cacheKey,
    );
    if (cached) return cached;
  }
  const params: Record<string, string> = {
    awardeeName: AWARDEE_QUERY,
    dateStart,
    offset: String(offset),
    rpp: String(PAGE_SIZE),
    printFields: PRINT_FIELDS,
  };
  const res = await axios.get(NSF_API_URL, {
    params,
    timeout: FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  const r = (res.data?.response ?? {}) as {
    award?: NsfAward[];
    metadata?: { totalCount?: number };
  };
  const payload = {
    awards: Array.isArray(r.award) ? r.award : [],
    totalCount: r.metadata?.totalCount,
  };
  if (useCache) await setCached(sourceName, cacheKey, payload);
  return payload;
}

// ---------------------------------------------------------------------------
// Observation builders
// ---------------------------------------------------------------------------

function buildResearchGroupObservations(
  group: PiAwardsGroup,
  matchedUser: MatchedFacultyForFunding,
  target: FundingResearchEntityTarget,
  sourceUrl: string,
): ObservationInput[] {
  const slug = target.slug;
  const piName = piDisplayName(group.awards[0] || ({} as NsfAward));
  const labName = piName ? `${piName} Lab` : `NSF PI ${slug}`;

  const records = group.awards
    .map((a) => awardToRecord(a, 'pi'))
    .filter((r): r is RecentGrantRecord => r !== null);
  const sorted = sortGrantsByRecency(records);
  const top = sorted.slice(0, MAX_GRANTS_PER_PI);
  const sourceUrls = top.map((record) => record.url).filter(Boolean);

  const base = { entityType: 'researchEntity' as const, entityKey: slug, sourceUrl };
  const out: ObservationInput[] = [
    { ...base, field: 'recentGrants', value: top },
    { ...base, field: 'recentGrantCount', value: records.length },
    { ...base, field: 'fundingAgencies', value: ['NSF'] },
  ];
  if (target.createIfMissing) {
    out.unshift(
      { ...base, field: 'slug', value: slug },
      { ...base, field: 'name', value: labName },
      { ...base, field: 'kind', value: 'lab' },
    );
  }
  if (sourceUrls.length > 0) out.push({ ...base, field: 'sourceUrls', value: sourceUrls });

  const lastObserved = maxStartDate(group.awards);
  if (lastObserved) out.push({ ...base, field: 'lastObservedAt', value: lastObserved });

  out.push({
    ...base,
    field: 'inferredPiUserId',
    value: matchedUser._id,
    confidenceOverride: 0.7,
  });
  return out;
}

async function buildCoPiObservations(
  group: PiAwardsGroup,
  researchGroupSlug: string,
  sourceUrl: string,
  finder: (q: Record<string, unknown>) => Promise<Array<MatchedFacultyForFunding & { _id: unknown }>>,
): Promise<ObservationInput[]> {
  const out: ObservationInput[] = [];
  const seenUserIds = new Set<string>();
  for (const award of group.awards) {
    const lines = Array.isArray(award.coPDPI) ? award.coPDPI : [];
    for (const line of lines) {
      const parsed = parseCoPdpiLine(line);
      if (!parsed) continue;
      const { first, last } = splitName(normalizeName(parsed.fullName));
      // Only match co-PIs that exist as Yale Users — avoids creating noise from
      // non-Yale collaborators we don't have rich metadata for.
      const matchedUser = await findUserForPi({ firstName: first, lastName: last }, finder);
      if (!matchedUser) continue;
      const userId = matchedUser._id;
      if (seenUserIds.has(userId)) continue;
      seenUserIds.add(userId);

      const memberKey = `${researchGroupSlug}::copi::${userId}`;
      const base = {
        entityType: 'researchGroupMember' as const,
        entityKey: memberKey,
        sourceUrl,
      };
      out.push({ ...base, field: 'researchGroupSlug', value: researchGroupSlug });
      out.push({ ...base, field: 'userId', value: userId });
      out.push({ ...base, field: 'role', value: 'co-pi' });
      out.push({ ...base, field: 'fullName', value: parsed.fullName });
      if (parsed.email) out.push({ ...base, field: 'email', value: parsed.email });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scraper class
// ---------------------------------------------------------------------------

export interface NsfAwardScraperDeps {
  /** Override the User-finder (used in tests to avoid hitting Mongo). */
  userFinder?: (q: Record<string, unknown>) => Promise<Array<MatchedFacultyForFunding & { _id: unknown }>>;
  /** Override ResearchEntity target lookup (used in tests to avoid hitting Mongo). */
  researchEntityTargetFinder?: (
    user: MatchedFacultyForFunding,
  ) => Promise<FundingResearchEntityTarget | null>;
  /** Override the page fetcher (used in tests to avoid hitting NSF). */
  fetchPage?: typeof fetchPage;
  /** Override the lookback start date (default: today minus 5 years). */
  dateStart?: string;
}

function defaultDateStart(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - DEFAULT_LOOKBACK_YEARS);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

export class NsfAwardScraper implements IScraper {
  readonly name = 'nsf-award-search';
  readonly displayName = 'NSF Award Search (Yale grants)';

  constructor(private readonly deps: NsfAwardScraperDeps = {}) {}

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const dateStart = this.deps.dateStart ?? defaultDateStart();
    const finder = this.deps.userFinder ?? defaultUserFinder;
    const targetFinder = this.deps.researchEntityTargetFinder ?? defaultResearchEntityTargetFinder;
    const fetcher = this.deps.fetchPage ?? fetchPage;
    const limit = ctx.options.limit && ctx.options.limit > 0 ? ctx.options.limit : Infinity;

    ctx.log(`Fetching NSF awards for "Yale University" since ${dateStart}`);

    // 1. Page through all Yale awards.
    const awards: NsfAward[] = [];
    let offset = 0;
    let totalCount: number | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      let payload: { awards: NsfAward[]; totalCount?: number };
      try {
        payload = await fetcher(offset, dateStart, ctx.options.useCache, this.name);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.log(`fetch failed at offset ${offset}: ${msg} — aborting pagination`);
        break;
      }
      if (totalCount === undefined && payload.totalCount !== undefined) {
        totalCount = payload.totalCount;
        ctx.log(`NSF reports totalCount=${totalCount} for Yale University`);
      }
      if (payload.awards.length === 0) break;
      for (const a of payload.awards) {
        if (awards.length >= limit) break;
        awards.push(a);
      }
      if (awards.length >= limit) break;
      if (payload.awards.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    ctx.log(`Fetched ${awards.length} awards across ${Math.ceil(awards.length / PAGE_SIZE)} page(s)`);

    // 2. Group by PI.
    const groups = groupAwardsByPi(awards);
    ctx.log(`Grouped into ${groups.length} distinct PIs`);

    // 3. For each PI: emit ResearchGroup + co-PI member observations.
    const sourceUrl = NSF_API_URL;
    let totalObs = 0;
    let piMatched = 0;

    for (const group of groups) {
      // 3a. Match PI to existing User (best-effort).
      const matchedUser = await findUserForPi(
        { firstName: group.piFirstName, lastName: group.piLastName },
        finder,
      );
      if (matchedUser) piMatched++;

      if (!matchedUser) continue;
      const target = await targetFinder(matchedUser);
      if (!target) continue;

      const rgObs = buildResearchGroupObservations(group, matchedUser, target, sourceUrl);
      await ctx.emit(rgObs);
      totalObs += rgObs.length;

      // 3c. Co-PI member observations — only when co-PI is a known Yale User.
      const slug = target.slug;
      const coPiObs = await buildCoPiObservations(group, slug, sourceUrl, finder);
      if (coPiObs.length > 0) {
        await ctx.emit(coPiObs);
        totalObs += coPiObs.length;
      }
    }

    ctx.log(
      `Emitted ${totalObs} observations across ${groups.length} PIs (${piMatched} matched to Yale Users)`,
    );

    return {
      observationCount: totalObs,
      entitiesObserved: groups.length,
      notes:
        `Yale NSF awards: ${awards.length}` +
        (totalCount !== undefined ? ` (NSF totalCount=${totalCount})` : '') +
        `, PIs: ${groups.length}, matched to Users: ${piMatched}`,
    };
  }
}
