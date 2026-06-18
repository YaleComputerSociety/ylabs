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
 *      lname + given-name prefix (or first initial when NSF only gives an initial). If matched, use a slug derived from that user; if
 *      not, emit a User observation under entityKey `nsf-pi:<normalized-name>`
 *      so the materializer at least records the person's existence.
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
import { sanitizeLogValue } from '../../utils/logSanitizer';
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
 * Slug to use when emitting ResearchGroup observations for a matched-Yale-PI.
 * Mirrors the dept-faculty-roster scraper's slug shape so multiple sources
 * landing on the same Yale faculty PI converge on one ResearchGroup row.
 */
export function piSlug(piUserId: string | null, firstName: string, lastName: string): string {
  if (piUserId) return `nsf-pi-${piUserId}`;
  const key = piGroupKey(firstName, lastName);
  return `nsf-pi-${key.replace(/\s+/g, '-')}`.slice(0, 100);
}

/**
 * Find an existing Yale User for a given (first, last) name. Two-pass:
 *   1. exact lname + fname (case-insensitive)
 *   2. exact lname + given-name prefix, or first initial when the source only gives an initial
 * Both passes only consider professor/faculty/admin user types and return a
 * match only when a single candidate is found (avoids ambiguous attribution).
 *
 * Returns the User _id as a string, or null when no unambiguous match exists.
 *
 * Default depends on the live `User` model; tests can inject a custom finder
 * via the second argument.
 */
export async function findUserForPi(
  name: { firstName: string; lastName: string },
  finder: (q: Record<string, unknown>) => Promise<Array<{ _id: unknown }>> = defaultUserFinder,
): Promise<string | null> {
  const first = (name.firstName || '').trim();
  const last = (name.lastName || '').trim();
  if (!last) return null;

  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lnameRe = new RegExp(`^${escapeRe(last)}$`, 'i');
  const userTypeFilter = { $in: ['professor', 'faculty', 'admin'] };

  // pass 1: exact lname + fname
  if (first) {
    const fnameRe = new RegExp(`^${escapeRe(first)}$`, 'i');
    const matches = await finder({
      lname: lnameRe,
      fname: fnameRe,
      userType: userTypeFilter,
    });
    if (matches.length === 1) return String(matches[0]._id);
    // multiple exact matches → ambiguous, give up (don't fall through to initial)
    if (matches.length > 1) return null;
  }

  // pass 2: exact lname + given-name prefix. Only fall back to a bare initial
  // when the source itself only provided an initial; otherwise same-initial
  // matches are too broad (for example Leying Guan vs Lawrence Guan).
  if (first) {
    const firstToken = first.split(/\s+/)[0]?.replace(/\./g, '') || first;
    const isInitialOnly = firstToken.length === 1;
    const initRe = new RegExp(`^${escapeRe(isInitialOnly ? firstToken : first)}`, 'i');
    const matches = await finder({
      lname: lnameRe,
      fname: initRe,
      userType: userTypeFilter,
    });
    if (matches.length === 1) return String(matches[0]._id);
  }
  return null;
}

async function defaultUserFinder(
  q: Record<string, unknown>,
): Promise<Array<{ _id: unknown }>> {
  return User.find(q, { _id: 1, fname: 1, lname: 1 }).limit(5).lean();
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

function buildPiUserObservations(
  group: PiAwardsGroup,
  sourceUrl: string,
): { observations: ObservationInput[]; entityKey: string } {
  const fullName = piDisplayName(group.awards[0] || ({} as NsfAward));
  const cleaned = normalizeName(fullName);
  const { first, last } = splitName(cleaned);
  const entityKey = `nsf-pi:${piGroupKey(group.piFirstName, group.piLastName)}`;
  const base = { entityType: 'user' as const, entityKey, sourceUrl };
  const obs: ObservationInput[] = [];
  if (first || group.piFirstName) {
    obs.push({ ...base, field: 'fname', value: first || group.piFirstName });
  }
  if (last || group.piLastName) {
    obs.push({ ...base, field: 'lname', value: last || group.piLastName });
  }
  obs.push({ ...base, field: 'userType', value: 'faculty' });
  // capture an email if one came back on a PI line
  const piLine = (group.awards[0]?.pi || [])[0];
  if (piLine) {
    const parts = parseCoPdpiLine(piLine);
    if (parts?.email && /@yale\.edu$/i.test(parts.email)) {
      obs.push({ ...base, field: 'email', value: parts.email });
    }
  }
  obs.push({ ...base, field: 'dataSources', value: ['nsf-award-search'] });
  return { observations: obs, entityKey };
}

function buildResearchGroupObservations(
  group: PiAwardsGroup,
  piUserId: string | null,
  sourceUrl: string,
): ObservationInput[] {
  const slug = piSlug(piUserId, group.piFirstName, group.piLastName);
  const piName = piDisplayName(group.awards[0] || ({} as NsfAward));
  const labName = piName ? `${piName} Lab` : `NSF PI ${slug}`;

  const records = group.awards
    .map((a) => awardToRecord(a, 'pi'))
    .filter((r): r is RecentGrantRecord => r !== null);
  const sorted = sortGrantsByRecency(records);
  const top = sorted.slice(0, MAX_GRANTS_PER_PI);

  const base = { entityType: 'researchEntity' as const, entityKey: slug, sourceUrl };
  const out: ObservationInput[] = [
    { ...base, field: 'slug', value: slug },
    { ...base, field: 'name', value: labName },
    { ...base, field: 'kind', value: 'lab' },
    { ...base, field: 'recentGrants', value: top },
    { ...base, field: 'recentGrantCount', value: records.length },
    { ...base, field: 'fundingAgencies', value: ['NSF'] },
  ];

  const lastObserved = maxStartDate(group.awards);
  if (lastObserved) out.push({ ...base, field: 'lastObservedAt', value: lastObserved });

  if (piUserId) {
    out.push({
      ...base,
      field: 'inferredPiUserId',
      value: piUserId,
      confidenceOverride: 0.7,
    });
  }
  return out;
}

async function buildCoPiObservations(
  group: PiAwardsGroup,
  researchGroupSlug: string,
  sourceUrl: string,
  finder: (q: Record<string, unknown>) => Promise<Array<{ _id: unknown }>>,
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
      const userId = await findUserForPi({ firstName: first, lastName: last }, finder);
      if (!userId) continue;
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
  userFinder?: (q: Record<string, unknown>) => Promise<Array<{ _id: unknown }>>;
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
    const fetcher = this.deps.fetchPage ?? fetchPage;
    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }
    const limit = limitOption ?? Infinity;

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
        const msg = sanitizeLogValue(err);
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

    // 3. For each PI: emit User + ResearchGroup + co-PI member observations.
    const sourceUrl = NSF_API_URL;
    let totalObs = 0;
    let piMatched = 0;

    for (const group of groups) {
      // 3a. Match PI to existing User (best-effort).
      const piUserId = await findUserForPi(
        { firstName: group.piFirstName, lastName: group.piLastName },
        finder,
      );
      if (piUserId) piMatched++;

      // 3b. User observations — under nsf-pi:<key> entityKey if no match.
      // (Matched PIs already have a real User row; we don't re-emit User obs
      // for them, since we don't want to overwrite authoritative directory data
      // with weak NSF-name signals.)
      if (!piUserId) {
        const { observations: userObs } = buildPiUserObservations(group, sourceUrl);
        await ctx.emit(userObs);
        totalObs += userObs.length;
      }

      // 3c. ResearchGroup observations — always emitted.
      const rgObs = buildResearchGroupObservations(group, piUserId, sourceUrl);
      await ctx.emit(rgObs);
      totalObs += rgObs.length;

      // 3d. Co-PI member observations — only when co-PI is a known Yale User.
      const slug = piSlug(piUserId, group.piFirstName, group.piLastName);
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
