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
 *   3. For each PI, resolve an unambiguous canonical Researcher by exact or conservative
 *      prefix matching, then the one existing research row the canonical resolver
 *      names for them. A grant proves that a person is funded, never that a row
 *      should exist, so every other outcome is counted by reason and mints nothing
 *      (#3145, #3561).
 *   4. Emit grant evidence without replacing identity fields on the existing row:
 *        - `recentGrants`: full embedded array of up to MAX_GRANTS_PER_PI
 *          (latest by start date).
 *        - `recentGrantCount`: count of active awards for this PI.
 *        - `fundingAgencies`: ['NSF'] (materialization unions latest source snapshots).
 *        - `lastObservedAt`: max(startDate) across this PI's awards.
 *
 * Honors `--use-cache` (page responses cached via snapshotCache) and `--limit`
 * (caps total awards processed across all pages).
 */
import axios from 'axios';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { getCached, setCached } from '../snapshotCache';
import {
  resolveCanonicalResearchHomeForResearcher,
  type CanonicalResearchHomeResolution,
} from '../canonicalResearchHomeResolver';
import { resolveResearcherIdForPersonName } from '../../services/researcherPersonNameResolver';
import { slugify } from '../utils/scraperHelpers';
import {
  countGrantAttach,
  emptyGrantAttachTally,
  grantAttachSummary,
  resolveGrantEnrichmentTarget,
} from '../utils/grantEnrichmentTarget';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';

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
  const m = String(s)
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
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

/**
 * Stable, lowercase, dash-joined key for a (firstName, lastName) pair. Used as
 * the deduplication key when grouping awards by PI.
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
      parseDollarAmount(award.fundsObligatedAmt) ?? parseDollarAmount(award.estimatedTotalAmt),
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
 * Resolve a (first, last) name to a canonical Researcher via the shared
 * `resolveResearcherIdForPersonName` keystone, which does the exact and
 * conservative-prefix matching and returns a match only when a single candidate
 * is found (avoids ambiguous attribution).
 *
 * Returns the Researcher _id as a string, or null when no unambiguous match
 * exists. Tests can inject a custom resolver via the second argument.
 */
export interface FederalPiResolverDeps {
  resolveResearcherId?: typeof resolveResearcherIdForPersonName;
}

export async function findUserForPi(
  name: { firstName: string; lastName: string },
  deps: FederalPiResolverDeps = {},
): Promise<string | null> {
  const result = await resolveUserForPi(name, deps);
  return result.status === 'matched' ? result.userId : null;
}

export type NsfPiUserResolution =
  | { status: 'matched'; userId: string }
  | { status: 'absent' }
  | { status: 'ambiguous' };

export async function resolveUserForPi(
  pi: { firstName?: string; lastName?: string },
  deps: FederalPiResolverDeps = {},
): Promise<NsfPiUserResolution> {
  const first = (pi.firstName || '').trim();
  const last = (pi.lastName || '').trim();
  if (!last) return { status: 'absent' };
  const resolveResearcherId = deps.resolveResearcherId ?? resolveResearcherIdForPersonName;
  const resolution = await resolveResearcherId([first, last].filter(Boolean).join(' '));
  if (resolution.status === 'ambiguous') return { status: 'ambiguous' };
  if (resolution.status !== 'matched' || !resolution.researcherId) return { status: 'absent' };
  return { status: 'matched', userId: resolution.researcherId.toString() };
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

export function buildResearchEntityObservations(
  group: PiAwardsGroup,
  piUserId: string,
  existingRowSlug: string,
): ObservationInput[] {
  const records = group.awards
    .map((a) => awardToRecord(a, 'pi'))
    .filter((r): r is RecentGrantRecord => r !== null);
  const top = sortGrantsByRecency(records).slice(0, MAX_GRANTS_PER_PI);

  const base = {
    entityType: 'researchEntity' as const,
    entityKey: existingRowSlug,
    sourceUrl: NSF_API_URL,
  };
  const out: ObservationInput[] = [
    { ...base, field: 'recentGrants', value: top },
    { ...base, field: 'recentGrantCount', value: records.length },
    { ...base, field: 'fundingAgencies', value: ['NSF'] },
  ];

  const lastObserved = maxStartDate(group.awards);
  if (lastObserved) out.push({ ...base, field: 'lastObservedAt', value: lastObserved });

  out.push({ ...base, field: 'inferredPiUserId', value: piUserId, confidenceOverride: 0.7 });
  return out;
}

/**
 * These lanes no longer emit roster membership.
 *
 * A grant establishes that someone received funding. It does not establish that they
 * are a member of a lab's roster, which is the same assertion #3145 refused one step
 * further: grants enrich a research row and never mint one. The co-PI block here
 * emitted `researchGroupMember` observations addressing the entity under
 * `researchGroupSlug`, a name the materializer does not read, so all 465 of them were
 * discarded and 93 member edges lay dormant (#3274).
 *
 * Aligning the field name would have activated those 93 rather than tidied a
 * vocabulary, so the emission is removed instead. The award's funding evidence is
 * unaffected: it reaches the row through the grant fields, never through a roster edge.
 */

// ---------------------------------------------------------------------------
// Scraper class
// ---------------------------------------------------------------------------

export interface NsfAwardScraperDeps {
  /** Override the researcher resolver (used in tests to avoid hitting Mongo). */
  resolveResearcherId?: typeof resolveResearcherIdForPersonName;
  /** Override the page fetcher (used in tests to avoid hitting NSF). */
  fetchPage?: typeof fetchPage;
  /** Override the lookback start date (default: today minus 5 years). */
  dateStart?: string;
  researchHomeResolver?: (researcherId: string) => Promise<CanonicalResearchHomeResolution>;
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
    const resolverDeps: FederalPiResolverDeps = {
      resolveResearcherId: this.deps.resolveResearcherId,
    };
    const fetcher = this.deps.fetchPage ?? fetchPage;
    const researchHomeResolver =
      this.deps.researchHomeResolver ?? resolveCanonicalResearchHomeForResearcher;
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
    ctx.log(
      `Fetched ${awards.length} awards across ${Math.ceil(awards.length / PAGE_SIZE)} page(s)`,
    );

    // 2. Group by PI.
    const groups = groupAwardsByPi(awards);
    ctx.log(`Grouped into ${groups.length} distinct PIs`);

    const attach = emptyGrantAttachTally();
    let totalObs = 0;
    for (const group of groups) {
      const person = await resolveUserForPi(
        { firstName: group.piFirstName, lastName: group.piLastName },
        resolverDeps,
      );
      const target = await resolveGrantEnrichmentTarget(person, researchHomeResolver);
      countGrantAttach(attach, target);
      if (target.status !== 'enrich') continue;
      const observations = buildResearchEntityObservations(group, target.researcherId, target.slug);
      await ctx.emit(observations);
      totalObs += observations.length;
    }

    const notes =
      `Yale NSF awards: ${awards.length}` +
      (totalCount !== undefined ? ` (NSF totalCount=${totalCount})` : '') +
      `; PIs: ${groups.length}; ${grantAttachSummary(attach)}`;
    ctx.log(`Emitted ${totalObs} observations. ${notes}`);

    return {
      observationCount: totalObs,
      entitiesObserved: attach.enriched,
      notes,
    };
  }
}
