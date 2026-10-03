/**
 * DoeOstiGrantScraper
 *
 * Physical-sciences funding lane (issue #1534): the DOE analogue of the NIH
 * RePORTER (`nihReporterScraper`) and NSF Award Search (`nsfAwardScraper`)
 * producers. It adds `FUNDING_ACTIVITY` + `TOPICS` evidence and active-award
 * recency to research homes we already know about, for Department of Energy
 * (Office of Science) funded Yale PIs that the NSF-only funding lane misses.
 *
 * Data-source evaluation (documented in the #1534 PR):
 *   - USASpending.gov DOE awards to Yale carry the university as recipient with
 *     no structured PI field; PI names appear in free-text descriptions on only
 *     ~2% of awards, well below the NIH/NSF clean-PI bar - rejected.
 *   - OSTI journal-article records for Yale are dominated by large multi-
 *     institution collaborations (~54% list >50 authors); a Yale coauthor is not
 *     the DOE grant PI, so attributing one reintroduces the retired
 *     bibliographic-graft class - rejected.
 *   - OSTI *technical reports* are the awardee's own report to DOE, authored by
 *     the grant PI and tied to a DOE contract number. This is the one DOE source
 *     that meets the NIH/NSF PI-resolution bar, so this producer wires it and
 *     fails closed on everything else. NASA is deferred (no public source clears
 *     the same bar; see #1534).
 *
 * Strategy:
 *   1. Page through OSTI technical-report records where a research org is
 *      "Yale University", newest first, within a recency window.
 *   2. For each report, select the Yale-attributable author(s): prefer authors
 *      explicitly tagged with a Yale affiliation, and only when none are tagged
 *      fall back to affiliation-less authors; authors tagged with a non-Yale
 *      institution are always excluded.
 *   3. Resolve those candidates against the Yale faculty directory with the same
 *      unambiguous single-match resolver the NIH/NSF lanes use. A report counts
 *      only when it resolves to exactly one Yale faculty User; 0 or 2+ matches
 *      fail closed.
 *   4. Group reports by resolved PI and attach to the one existing research row
 *      the canonical resolver names for them. A grant proves that a person is
 *      funded, never that a row should exist, so every other outcome is counted
 *      by reason and mints nothing (#3145, #3565).
 *   5. Emit grant evidence without replacing identity fields on the existing row
 *      (`recentGrants`, `recentGrantCount`, `fundingAgencies: ['DOE']`,
 *      `lastObservedAt`). Abstract prose is embedded only inside `recentGrants`
 *      and never written to `fullDescription`, so award-summary boilerplate can
 *      never leak into a description (#1418 / #1499).
 *
 * Honors `--use-cache` (page payloads cached via snapshotCache) and `--limit`
 * (caps the number of PIs processed).
 */
import axios from 'axios';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { getCached, setCached } from '../snapshotCache';
import {
  resolveCanonicalResearchHomeForResearcher,
  type CanonicalResearchHomeResolution,
} from '../canonicalResearchHomeResolver';
import { canonicalPiName, resolveUserForPi } from './nihReporterScraper';
import {
  countGrantAttach,
  emptyGrantAttachTally,
  grantAttachSummary,
  resolveGrantEnrichmentTarget,
  type GrantEnrichmentTarget,
  type GrantPersonResolution,
} from '../utils/grantEnrichmentTarget';
import { fetchGrantWindowPage } from '../utils/grantWindowPageFetch';
import { recentGrantPeriodsOf } from '../utils/recentGrantPeriods';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';

const OSTI_ENDPOINT = 'https://www.osti.gov/api/v1/records';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 60_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const DEFAULT_LOOKBACK_YEARS = 6;
const MAX_GRANTS_PER_PI = 10;
const RESEARCH_ORG_QUERY = '"Yale University"';
const TECHNICAL_REPORT_PRODUCT_TYPE = 'Technical Report';
// OSTI author -> DOE PI is a weaker signal than NIH/NSF's structured contact PI,
// so the inferred-PI link sits below the NIH (0.9) confidence.
const INFERRED_PI_CONFIDENCE = 0.7;

export interface OstiRecord {
  osti_id?: string | number;
  title?: string;
  description?: string;
  authors?: string[];
  research_orgs?: string[];
  sponsor_orgs?: string[];
  subjects?: string[];
  doe_contract_number?: string;
  publication_date?: string;
}

export interface RecentGrantRecord {
  id: string;
  agency: 'DOE';
  title: string;
  abstract: string;
  startDate?: Date;
  url: string;
  role: 'pi';
}

export interface ParsedOstiAuthor {
  name: string;
  affiliation: string;
}

/**
 * Parse one OSTI author string of the form
 * "Last, First M [affiliation...] (ORCID:...)" into its name and affiliation.
 * The name keeps OSTI's "Last, First" ordering so `canonicalPiName` can flip it.
 */
export function parseOstiAuthor(raw: string): ParsedOstiAuthor {
  const trimmed = (raw || '').trim();
  if (!trimmed) return { name: '', affiliation: '' };
  const withoutOrcid = trimmed.replace(/\(ORCID:[^)]*\)/gi, '').trim();
  const bracket = withoutOrcid.match(/\[([^\]]*)\]/);
  const affiliation = bracket ? bracket[1].trim() : '';
  const name = withoutOrcid
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { name, affiliation };
}

function affiliationIsYale(affiliation: string): boolean {
  return /\byale\b/i.test(affiliation);
}

function affiliationIsExplicitlyNonYale(affiliation: string): boolean {
  return affiliation.length > 0 && !affiliationIsYale(affiliation);
}

/**
 * Choose the Yale-attributable authors on a report. Prefer authors explicitly
 * tagged with a Yale affiliation; only when no author carries a Yale tag do we
 * fall back to affiliation-less authors. Authors tagged with a non-Yale
 * institution are always dropped, so a collaborator at another university can
 * never be attributed to Yale.
 */
export function selectYalePiCandidates(authors: string[]): ParsedOstiAuthor[] {
  const parsed = (Array.isArray(authors) ? authors : []).map(parseOstiAuthor).filter((a) => a.name);
  const yaleTagged = parsed.filter((a) => affiliationIsYale(a.affiliation));
  if (yaleTagged.length > 0) return yaleTagged;
  return parsed.filter((a) => !affiliationIsExplicitlyNonYale(a.affiliation));
}

/**
 * Normalize an OSTI `doe_contract_number` into the canonical DOE award id. OSTI
 * returns bare, semicolon-joined numbers ("SC0023672; ", "FG02-98ER20311"); we
 * take the first, strip trailing punctuation, and add the "DE-" prefix DOE award
 * ids canonically carry. Returns null when no contract number is present.
 */
export function normalizeDoeContractId(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const first = String(raw).split(';')[0].trim().toUpperCase();
  if (!first) return null;
  return /^DE-/.test(first) ? first : `DE-${first}`;
}

function parseOstiDate(s: string | undefined | null): Date | undefined {
  if (!s) return undefined;
  const d = new Date(String(s));
  return Number.isFinite(d.getTime()) ? d : undefined;
}

function ostiRecordUrl(record: OstiRecord): string {
  const id = record.osti_id !== undefined && record.osti_id !== null ? String(record.osti_id) : '';
  return id ? `https://www.osti.gov/biblio/${id}` : OSTI_ENDPOINT;
}

/** Convert a single OSTI technical-report record into a `recentGrants` entry. */
export function recordToGrant(record: OstiRecord): RecentGrantRecord {
  const id = normalizeDoeContractId(record.doe_contract_number) || `osti-${record.osti_id ?? ''}`;
  return {
    id,
    agency: 'DOE',
    title: (record.title || '').trim(),
    abstract: (record.description || '').trim(),
    startDate: parseOstiDate(record.publication_date),
    url: ostiRecordUrl(record),
    role: 'pi',
  };
}

export interface DoePiGroup {
  userId: string;
  piName: string;
  records: OstiRecord[];
}

interface ResolvedReport {
  userId: string;
  piName: string;
  record: OstiRecord;
}

export type PiResolver = (
  canonicalName: string,
) => Promise<
  { status: 'matched'; userId: string } | { status: 'absent' } | { status: 'ambiguous' }
>;

export type ReportPiResolution =
  | { status: 'matched'; userId: string; piName: string }
  | { status: 'absent' }
  | { status: 'ambiguous' };

/**
 * Resolve a report to exactly one Yale faculty User across its candidate
 * authors. A report with no match is `absent`; one whose candidates match more
 * than one distinct User, or match none while one is itself ambiguous, is
 * `ambiguous`. Neither is attributed (fail closed).
 */
export async function resolveReportPi(
  record: OstiRecord,
  resolvePi: PiResolver,
): Promise<ReportPiResolution> {
  const candidates = selectYalePiCandidates(record.authors || []);
  const matched = new Map<string, string>();
  let sawAmbiguous = false;
  for (const candidate of candidates) {
    const canonical = canonicalPiName(candidate.name);
    if (!canonical) continue;
    const resolution = await resolvePi(canonical);
    if (resolution.status === 'matched') matched.set(resolution.userId, canonical);
    else if (resolution.status === 'ambiguous') sawAmbiguous = true;
  }
  if (matched.size > 1) return { status: 'ambiguous' };
  if (matched.size === 0) return { status: sawAmbiguous ? 'ambiguous' : 'absent' };
  const [userId, piName] = [...matched.entries()][0];
  return { status: 'matched', userId, piName };
}

export function groupReportsByPi(resolved: ResolvedReport[]): DoePiGroup[] {
  const map = new Map<string, DoePiGroup>();
  for (const item of resolved) {
    let group = map.get(item.userId);
    if (!group) {
      group = { userId: item.userId, piName: item.piName, records: [] };
      map.set(item.userId, group);
    }
    group.records.push(item.record);
  }
  return [...map.values()];
}

export function buildResearchEntityObservations(
  group: DoePiGroup,
  existingRowSlug: string,
): ObservationInput[] {
  const grants = group.records
    .map(recordToGrant)
    .sort((left, right) => (right.startDate?.getTime() ?? 0) - (left.startDate?.getTime() ?? 0));
  const top = grants.slice(0, MAX_GRANTS_PER_PI);
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: existingRowSlug,
    sourceUrl: OSTI_ENDPOINT,
  };
  const periods = recentGrantPeriodsOf(grants);
  const out: ObservationInput[] = [
    { ...base, field: 'recentGrants', value: top },
    { ...base, field: 'recentGrantPeriods', value: periods },
    { ...base, field: 'recentGrantCount', value: periods.length },
    { ...base, field: 'fundingAgencies', value: ['DOE'] },
    {
      ...base,
      field: 'inferredPiUserId',
      value: group.userId,
      confidenceOverride: INFERRED_PI_CONFIDENCE,
    },
  ];
  const lastObserved = top[0]?.startDate;
  if (lastObserved) out.push({ ...base, field: 'lastObservedAt', value: lastObserved });
  return out;
}

async function fetchPage(
  page: number,
  useCache: boolean,
  sourceName: string,
): Promise<OstiRecord[]> {
  const cacheKey = `osti:techreport:page=${page}:rows=${PAGE_SIZE}`;
  if (useCache) {
    const cached = await getCached<OstiRecord[]>(sourceName, cacheKey);
    if (cached) return cached;
  }
  const res = await axios.get(OSTI_ENDPOINT, {
    params: {
      research_org: RESEARCH_ORG_QUERY,
      product_type: TECHNICAL_REPORT_PRODUCT_TYPE,
      rows: String(PAGE_SIZE),
      page: String(page),
      sort: 'publication_date desc',
    },
    timeout: FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  const records: OstiRecord[] = Array.isArray(res.data) ? res.data : res.data?.records || [];
  if (useCache) await setCached(sourceName, cacheKey, records);
  return records;
}

export interface DoeOstiGrantScraperDeps {
  fetchPage?: typeof fetchPage;
  piResolver?: PiResolver;
  researchHomeResolver?: (userId: string) => Promise<CanonicalResearchHomeResolution>;
  lookbackYears?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

function defaultPiResolver(canonicalName: string): ReturnType<PiResolver> {
  return resolveUserForPi(canonicalName).then((resolution) =>
    resolution.status === 'matched'
      ? { status: 'matched' as const, userId: resolution.user._id }
      : { status: resolution.status },
  );
}

export class DoeOstiGrantScraper implements IScraper {
  readonly name = 'doe-osti';
  readonly displayName = 'DOE OSTI (Yale technical reports)';

  constructor(private readonly deps: DoeOstiGrantScraperDeps = {}) {}

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const fetcher = this.deps.fetchPage ?? fetchPage;
    const resolvePi = this.deps.piResolver ?? defaultPiResolver;
    const researchHomeResolver =
      this.deps.researchHomeResolver ?? resolveCanonicalResearchHomeForResearcher;
    const now = this.deps.now ? this.deps.now() : new Date();
    const cutoff = new Date(now);
    cutoff.setFullYear(cutoff.getFullYear() - (this.deps.lookbackYears ?? DEFAULT_LOOKBACK_YEARS));

    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }

    ctx.log(
      `Fetching DOE OSTI technical reports for Yale University since ${cutoff.toISOString()}`,
    );

    const records: OstiRecord[] = [];
    let reachedCutoff = false;
    let windowEnded = false;
    let pagesRead = 0;
    let failedPage: { page: number; error: string } | undefined;
    for (let page = 1; page <= MAX_PAGES && !reachedCutoff; page++) {
      const outcome = await fetchGrantWindowPage(
        () => fetcher(page, ctx.options.useCache, this.name),
        { label: `DOE OSTI page ${page}`, sleep: this.deps.sleep, log: ctx.log },
      );
      if (outcome.status === 'failed') {
        failedPage = { page, error: outcome.error };
        break;
      }
      const pageRecords = outcome.value;
      pagesRead++;
      if (pageRecords.length === 0) {
        windowEnded = true;
        break;
      }
      for (const record of pageRecords) {
        const published = parseOstiDate(record.publication_date);
        if (published && published.getTime() < cutoff.getTime()) {
          reachedCutoff = true;
          continue;
        }
        records.push(record);
      }
      if (pageRecords.length < PAGE_SIZE) {
        windowEnded = true;
        break;
      }
    }

    const windowCounts = `${records.length} in-window record(s) across ${pagesRead} page(s)`;
    const incompleteReason = failedPage
      ? `page ${failedPage.page} unreadable after retries (${failedPage.error})`
      : !reachedCutoff && !windowEnded
        ? `page cap of ${MAX_PAGES} reached before the window ended`
        : undefined;
    if (incompleteReason) {
      const notes = `DOE OSTI window incomplete: ${incompleteReason}; read ${windowCounts}; failed closed, no observations emitted`;
      ctx.log(notes);
      return {
        observationCount: 0,
        entitiesObserved: 0,
        notes,
        partialFailures: [notes],
        failedClosed: true,
      };
    }

    ctx.log(`Collected ${records.length} in-window technical-report record(s)`);

    const attach = emptyGrantAttachTally();
    const resolved: ResolvedReport[] = [];
    for (const record of records) {
      const pi = await resolveReportPi(record, resolvePi);
      if (pi.status !== 'matched') {
        countGrantAttach(attach, await resolveGrantEnrichmentTarget(pi, researchHomeResolver));
        continue;
      }
      resolved.push({ userId: pi.userId, piName: pi.piName, record });
    }
    const unattributedReports = records.length - resolved.length;

    const allGroups = groupReportsByPi(resolved);
    const groups = limitOption ? allGroups.slice(0, limitOption) : allGroups;
    ctx.log(
      `Resolved ${resolved.length} report(s) to ${allGroups.length} Yale PI(s); ` +
        `${unattributedReports} report(s) failed closed on attribution`,
    );

    let totalObs = 0;
    let resolveErrors = 0;
    for (const group of groups) {
      const person: GrantPersonResolution = { status: 'matched', userId: group.userId };
      let target: GrantEnrichmentTarget;
      try {
        target = await resolveGrantEnrichmentTarget(person, researchHomeResolver);
      } catch (err: unknown) {
        ctx.log(`research-row resolve error: ${sanitizeLogValue(err)} - skipping PI`);
        resolveErrors++;
        continue;
      }
      countGrantAttach(attach, target);
      if (target.status !== 'enrich') continue;
      const observations = buildResearchEntityObservations(group, target.slug);
      await ctx.emit(observations);
      totalObs += observations.length;
    }

    return {
      observationCount: totalObs,
      entitiesObserved: groups.length,
      notes:
        `DOE OSTI technical reports: ${windowCounts}, ` +
        `${resolved.length} attributed to ${allGroups.length} PI(s); ` +
        `researcher refusals count reports, row outcomes count PIs; ` +
        grantAttachSummary(attach) +
        (resolveErrors > 0 ? `; ${resolveErrors} PI(s) skipped on a resolve error` : ''),
    };
  }
}
