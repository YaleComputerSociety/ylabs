/**
 * NehGrantScraper
 *
 * Pulls Yale-awardee National Endowment for the Humanities (NEH) funded
 * projects from NEH Award Search (https://awardsearch.neh.gov/, query-string
 * API documented in https://awardsearch.neh.gov/api.pdf). The per-decade
 * open-data CSVs this lane used to read were retired with the apps.neh.gov
 * file host, which now redirects every path to the NEH application-status
 * tool (#3541).
 *
 * This is the humanities/social-science analogue of the STEM-only NIH RePORTER
 * and NSF Award Search grant lanes (#1529). A grant proves that a person is
 * funded, never that a research row should exist, so this lane only enriches
 * an existing research row the canonical resolver names for a Project Director
 * who resolves to exactly one researcher, and never mints one (#3145). Funding
 * is FUNDING_ACTIVITY enrichment only and is never undergraduate-access
 * evidence on its own.
 *
 * Fail-closed: an unreachable year shard, an unrecognised page, a results grid
 * missing a required column, or a grid serving fewer awards than it reports
 * leaves the lookback window incomplete, so the run writes nothing rather than
 * an undercount, and the run notes say which of those happened on every run.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { getCached, setCached } from '../snapshotCache';
import {
  resolveCanonicalResearchHomeForResearcher,
  type CanonicalResearchHomeResolution,
} from '../canonicalResearchHomeResolver';
import { resolveResearcherIdForPersonName } from '../../services/researcherPersonNameResolver';
import { normalizeName, slugify } from '../utils/scraperHelpers';
import { resolveUserForPi, type FederalPiResolverDeps } from './nsfAwardScraper';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';

export const NEH_AWARD_SEARCH_BASE = 'https://awardsearch.neh.gov';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 60_000;
const DEFAULT_LOOKBACK_YEARS = 6;
const MAX_GRANTS_PER_PI = 10;
const ORGANIZATION_QUERY = 'Yale';
const STATE_QUERY = 'CT';

const REQUIRED_GRID_HEADERS = [
  'awardnumber',
  'projecttitle',
  'projectdirectorfirstname',
  'projectdirectorlastname',
  'organization',
  'organizationstate',
  'yearawarded',
] as const;

export interface NehParticipant {
  fullName: string;
  firstName: string;
  lastName: string;
  isLead: boolean;
}

export interface NehGrant {
  appNumber: string;
  institution: string;
  instState: string;
  projectTitle: string;
  program: string;
  division: string;
  yearAwarded?: number;
  beginGrant?: Date;
  endGrant?: Date;
  projectDesc: string;
  primaryDiscipline: string;
  awardOutright?: number;
  originalAmount?: number;
  participants: NehParticipant[];
}

export interface PiGrantsGroup {
  piFirstName: string;
  piLastName: string;
  fullName: string;
  awards: NehGrant[];
}

export interface RecentGrantRecord {
  id: string;
  agency: 'NEH';
  title: string;
  abstract: string;
  startDate?: Date;
  endDate?: Date;
  dollarAmount?: number;
  url: string;
  role: 'pi' | 'copi';
}

export type NehGridRecord = Record<string, string>;

export type NehAwardSearchPage =
  | { kind: 'grid'; headers: string[]; records: NehGridRecord[]; reportedCount?: number }
  | { kind: 'empty' }
  | { kind: 'unrecognised' };

export function normalizedHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function collapseWhitespace(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseNehAwardSearchPage(html: string): NehAwardSearchPage {
  const $ = cheerio.load(html);
  const grid = $('table.rgMasterTable').first();
  if (grid.length === 0) {
    const resultsGrid = $('#cphMainContent_pnlResults #ctl00_cphMainContent_rgResults');
    const queryError = collapseWhitespace($('#cphMainContent_lblQueryError').text());
    const emptyResultsGrid = resultsGrid.length > 0 && resultsGrid.find('table').length === 0;
    return emptyResultsGrid && !queryError ? { kind: 'empty' } : { kind: 'unrecognised' };
  }
  const headers = grid
    .find('thead th')
    .toArray()
    .map((th) => {
      const clone = $(th).clone();
      clone.find('button, input').remove();
      return normalizedHeader(collapseWhitespace(clone.text()));
    });
  const records = grid
    .find('tbody tr')
    .toArray()
    .filter((tr) => /\brg(?:Alt)?Row\b/.test($(tr).attr('class') || ''))
    .map((tr) => {
      const cells = $(tr).children('td').toArray();
      const record: NehGridRecord = {};
      headers.forEach((header, index) => {
        record[header] = cells[index] ? collapseWhitespace($(cells[index]).text()) : '';
      });
      return record;
    });
  const countMatch = grid
    .find('.rgInfoPart')
    .first()
    .text()
    .match(/(\d[\d,]*)\s+items?\b/i);
  const reportedCount = countMatch ? Number(countMatch[1].replace(/,/g, '')) : undefined;
  return { kind: 'grid', headers, records, reportedCount };
}

export function hasRequiredNehHeaders(headers: string[]): boolean {
  const set = new Set(headers);
  return REQUIRED_GRID_HEADERS.every((header) => set.has(header));
}

export function parseNehDate(s: string | undefined | null): Date | undefined {
  if (!s) return undefined;
  const m = String(s)
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return undefined;
  const [, mm, dd, yyyy] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return Number.isFinite(d.getTime()) ? d : undefined;
}

export function parseAwardPeriod(s: string | undefined | null): { begin?: Date; end?: Date } {
  const [begin, end] = String(s || '')
    .split(/\s+-\s+/)
    .map((part) => parseNehDate(part));
  return { begin, end };
}

export function parseNehAmount(s: string | undefined | null): number | undefined {
  if (s === undefined || s === null || s === '') return undefined;
  const cleaned = String(s).replace(/[^0-9.]/g, '');
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function parseYear(s: string | undefined | null): number | undefined {
  if (!s) return undefined;
  const m = String(s)
    .trim()
    .match(/(\d{4})/);
  if (!m) return undefined;
  const year = Number(m[1]);
  return Number.isFinite(year) ? year : undefined;
}

function participantFrom(first: string, last: string, isLead: boolean): NehParticipant | null {
  const firstName = normalizeName(first);
  const lastName = normalizeName(last);
  if (!lastName) return null;
  const fullName = [firstName, lastName].filter(Boolean).join(' ');
  return { fullName, firstName, lastName, isLead };
}

export function participantsFromRecord(record: NehGridRecord): NehParticipant[] {
  return [
    participantFrom(record.projectdirectorfirstname, record.projectdirectorlastname, true),
    participantFrom(record.coprojectdirectorfirstname, record.coprojectdirectorlastname, false),
  ].filter((p): p is NehParticipant => p !== null);
}

export function leadParticipant(participants: NehParticipant[]): NehParticipant | null {
  return participants.find((p) => p.isLead) || null;
}

export function isYaleAwardee(record: NehGridRecord): boolean {
  const institution = (record.organization || '').toLowerCase();
  const state = (record.organizationstate || '').trim().toUpperCase();
  return /\byale\b/.test(institution) && state === 'CT';
}

function awardedTotal(record: NehGridRecord): number | undefined {
  const outright = parseNehAmount(record.awardedoutrightfunds) ?? 0;
  const matching = parseNehAmount(record.awardedmatchingfunds) ?? 0;
  const total = outright + matching;
  return total > 0 ? total : undefined;
}

function approvedTotal(record: NehGridRecord): number | undefined {
  return parseNehAmount(record.approvedawardtotal) ?? parseNehAmount(record.approvedoutrightfunds);
}

export function recordToNehGrant(record: NehGridRecord): NehGrant | null {
  const appNumber = (record.awardnumber || '').trim();
  const projectTitle = (record.projecttitle || '').trim();
  if (!appNumber || !projectTitle) return null;
  const participants = participantsFromRecord(record);
  if (participants.length === 0) return null;
  const { begin, end } = parseAwardPeriod(record.awardperiod);
  return {
    appNumber,
    institution: (record.organization || '').trim(),
    instState: (record.organizationstate || '').trim(),
    projectTitle,
    program: (record.grantprogramname || record.grantprogram || '').trim(),
    division: (record.divisionoroffice || '').trim(),
    yearAwarded: parseYear(record.yearawarded),
    beginGrant: begin,
    endGrant: end,
    projectDesc: (record.description || '').trim(),
    primaryDiscipline: (record.primaryhumanitiesdiscipline || '').trim(),
    awardOutright: awardedTotal(record),
    originalAmount: approvedTotal(record),
    participants,
  };
}

export function piGroupKey(firstName: string, lastName: string): string {
  const f = slugify(firstName || '');
  const l = slugify(lastName || '');
  if (!f && !l) return 'unknown';
  return [f, l].filter(Boolean).join(' ');
}

export function groupGrantsByLeadPi(grants: NehGrant[]): PiGrantsGroup[] {
  const map = new Map<string, PiGrantsGroup>();
  for (const grant of grants) {
    const lead = leadParticipant(grant.participants);
    if (!lead) continue;
    const key = piGroupKey(lead.firstName, lead.lastName);
    let group = map.get(key);
    if (!group) {
      group = {
        piFirstName: lead.firstName,
        piLastName: lead.lastName,
        fullName: lead.fullName,
        awards: [],
      };
      map.set(key, group);
    }
    group.awards.push(grant);
  }
  return Array.from(map.values());
}

export function nehGrantUrl(appNumber: string): string {
  return `${NEH_AWARD_SEARCH_BASE}/AwardDetail.aspx?gn=${encodeURIComponent(appNumber)}`;
}

export function grantToRecord(grant: NehGrant, role: 'pi' | 'copi' = 'pi'): RecentGrantRecord {
  return {
    id: grant.appNumber,
    agency: 'NEH',
    title: grant.projectTitle,
    abstract: grant.projectDesc,
    startDate: grant.beginGrant,
    endDate: grant.endGrant,
    dollarAmount: grant.awardOutright ?? grant.originalAmount,
    url: nehGrantUrl(grant.appNumber),
    role,
  };
}

export function sortGrantsByRecency(records: RecentGrantRecord[]): RecentGrantRecord[] {
  return [...records].sort((a, b) => {
    const ta = a.startDate ? a.startDate.getTime() : -Infinity;
    const tb = b.startDate ? b.startDate.getTime() : -Infinity;
    return tb - ta;
  });
}

export function maxStartDate(grants: NehGrant[]): Date | undefined {
  let max: Date | undefined;
  for (const g of grants) {
    const d = g.beginGrant;
    if (d && (!max || d.getTime() > max.getTime())) max = d;
  }
  return max;
}

export function yearShardsForLookback(currentYear: number, lookbackYears: number): number[] {
  const years: number[] = [];
  for (let year = currentYear - lookbackYears; year <= currentYear; year++) years.push(year);
  return years;
}

export function awardSearchQueryUrl(year: number): string {
  const params = new URLSearchParams({
    q: '1',
    a: '0',
    n: '0',
    o: '1',
    ov: ORGANIZATION_QUERY,
    ot: '0',
    k: '0',
    f: '0',
    s: '1',
    sv: STATE_QUERY,
    cd: '0',
    p: '0',
    d: '0',
    at: '0',
    y: '1',
    yf: String(year),
    yt: String(year),
    prd: '0',
    cov: '0',
    prz: '0',
    wp: '0',
    sp: '0',
    ca: '0',
    arp: '0',
    ob: 'year',
    or: 'DESC',
  });
  return `${NEH_AWARD_SEARCH_BASE}/Default.aspx?${params.toString()}`;
}

async function fetchAwardSearchYear(
  year: number,
  useCache: boolean,
  sourceName: string,
): Promise<string> {
  const url = awardSearchQueryUrl(year);
  const cacheKey = `award-search:org=${ORGANIZATION_QUERY}:state=${STATE_QUERY}:year=${year}`;
  if (useCache) {
    const cached = await getCached<{ html: string }>(sourceName, cacheKey);
    if (cached) return cached.html;
  }
  const res = await axios.get(url, {
    timeout: FETCH_TIMEOUT_MS,
    responseType: 'text',
    transformResponse: [(data) => data],
    maxRedirects: 0,
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
  });
  const html = typeof res.data === 'string' ? res.data : String(res.data ?? '');
  if (useCache) await setCached(sourceName, cacheKey, { html });
  return html;
}

export function buildResearchEntityObservations(
  group: PiGrantsGroup,
  piUserId: string,
  canonicalResearchHomeSlug: string,
): ObservationInput[] {
  const records = group.awards.map((a) => grantToRecord(a, 'pi'));
  const top = sortGrantsByRecency(records).slice(0, MAX_GRANTS_PER_PI);

  const base = {
    entityType: 'researchEntity' as const,
    entityKey: canonicalResearchHomeSlug,
    sourceUrl: `${NEH_AWARD_SEARCH_BASE}/`,
  };
  const out: ObservationInput[] = [
    { ...base, field: 'recentGrants', value: top },
    { ...base, field: 'recentGrantCount', value: records.length },
    { ...base, field: 'fundingAgencies', value: ['NEH'] },
  ];

  const lastObserved = maxStartDate(group.awards);
  if (lastObserved) out.push({ ...base, field: 'lastObservedAt', value: lastObserved });

  out.push({ ...base, field: 'inferredPiUserId', value: piUserId, confidenceOverride: 0.7 });
  return out;
}

/**
 * This lane no longer emits roster membership. See the note in `nsfAwardScraper.ts`:
 * a grant establishes funding, not membership of a lab's roster, and the co-PI block
 * addressed the entity under a field the materializer does not read, so its output was
 * discarded in full (#3274, #3145).
 */

export interface NehGrantScraperDeps {
  resolveResearcherId?: typeof resolveResearcherIdForPersonName;
  fetchAwardSearchYear?: typeof fetchAwardSearchYear;
  lookbackYears?: number;
  currentYear?: number;
  researchHomeResolver?: (researcherId: string) => Promise<CanonicalResearchHomeResolution>;
}

interface ShardTally {
  fetched: number;
  failed: number;
  empty: number;
  unrecognised: number;
  schemaDrift: number;
  truncated: number;
}

interface AttachTally {
  enriched: number;
  unresolved: number;
  ambiguousPerson: number;
  noExistingRow: number;
  ineligibleRow: number;
  ambiguousRow: number;
}

function shardSummary(years: number[], shards: ShardTally): string {
  return (
    `year shards ${years[0]}-${years[years.length - 1]}: ${years.length} queried, ` +
    `${shards.fetched} fetched, ${shards.failed} failed, ${shards.empty} empty, ` +
    `${shards.unrecognised} unrecognised page, ${shards.schemaDrift} schema drift, ` +
    `${shards.truncated} truncated`
  );
}

function attachSummary(attach: AttachTally): string {
  return (
    `rows enriched: ${attach.enriched}; not attached: ${attach.unresolved} resolved to no researcher, ` +
    `${attach.ambiguousPerson} resolved to several researchers, ` +
    `${attach.noExistingRow} have no existing research row (grants never mint one, #3145), ` +
    `${attach.ineligibleRow} ineligible row, ${attach.ambiguousRow} ambiguous row`
  );
}

export class NehGrantScraper implements IScraper {
  readonly name = 'neh-funded-projects';
  readonly displayName = 'NEH funded projects (Yale humanities/social-science grants)';

  constructor(private readonly deps: NehGrantScraperDeps = {}) {}

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const resolverDeps: FederalPiResolverDeps = {
      resolveResearcherId: this.deps.resolveResearcherId,
    };
    const fetcher = this.deps.fetchAwardSearchYear ?? fetchAwardSearchYear;
    const researchHomeResolver =
      this.deps.researchHomeResolver ?? resolveCanonicalResearchHomeForResearcher;
    const lookbackYears = this.deps.lookbackYears ?? DEFAULT_LOOKBACK_YEARS;
    const currentYear = this.deps.currentYear ?? new Date().getFullYear();
    const cutoffYear = currentYear - lookbackYears;

    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }
    const piLimit = limitOption ?? Infinity;

    const years = yearShardsForLookback(currentYear, lookbackYears);
    ctx.log(
      `Querying NEH Award Search for ${ORGANIZATION_QUERY} (${STATE_QUERY}) awards, one request per year ${years[0]}-${years[years.length - 1]}`,
    );

    const shards: ShardTally = {
      fetched: 0,
      failed: 0,
      empty: 0,
      unrecognised: 0,
      schemaDrift: 0,
      truncated: 0,
    };
    const grantsByNumber = new Map<string, NehGrant>();
    for (const year of years) {
      let html: string;
      try {
        html = await fetcher(year, ctx.options.useCache, this.name);
      } catch (err: unknown) {
        shards.failed++;
        ctx.log(`fetch failed for NEH Award Search year ${year}: ${sanitizeLogValue(err)}`);
        continue;
      }
      shards.fetched++;
      const page = parseNehAwardSearchPage(html);
      if (page.kind === 'empty') {
        shards.empty++;
        continue;
      }
      if (page.kind === 'unrecognised') {
        shards.unrecognised++;
        ctx.log(`NEH Award Search year ${year} returned no results grid; skipping (fail closed)`);
        continue;
      }
      if (!hasRequiredNehHeaders(page.headers)) {
        shards.schemaDrift++;
        ctx.log(
          `schema drift in NEH Award Search year ${year}: required column(s) absent; skipping (fail closed)`,
        );
        continue;
      }
      if (page.reportedCount !== undefined && page.reportedCount > page.records.length) {
        shards.truncated++;
        ctx.log(
          `NEH Award Search year ${year} reported ${page.reportedCount} awards but served ${page.records.length} on one page; skipping (fail closed)`,
        );
        continue;
      }
      for (const record of page.records) {
        if (!isYaleAwardee(record)) continue;
        const grant = recordToNehGrant(record);
        if (!grant) continue;
        if (grant.yearAwarded !== undefined && grant.yearAwarded < cutoffYear) continue;
        grantsByNumber.set(grant.appNumber, grant);
      }
    }

    if (shards.fetched === 0) {
      const notes = `NEH Award Search unreachable; failed closed with no writes (${shardSummary(years, shards)})`;
      ctx.log(notes);
      return { observationCount: 0, entitiesObserved: 0, notes };
    }
    const shardsWithUsableGrid = shards.fetched - shards.unrecognised - shards.schemaDrift;
    if (shardsWithUsableGrid === 0) {
      const notes = `NEH Award Search page shape drifted; failed closed with no writes (${shardSummary(years, shards)})`;
      ctx.log(notes);
      return { observationCount: 0, entitiesObserved: 0, notes };
    }
    const incompleteShards =
      shards.failed + shards.unrecognised + shards.schemaDrift + shards.truncated;
    if (incompleteShards > 0) {
      const notes = `NEH Award Search window incomplete (${incompleteShards} of ${years.length} year shards unread); failed closed with no writes rather than undercount grants (${shardSummary(years, shards)})`;
      ctx.log(notes);
      return { observationCount: 0, entitiesObserved: 0, notes };
    }

    const yaleGrants = Array.from(grantsByNumber.values());
    ctx.log(`Retained ${yaleGrants.length} Yale NEH award(s) awarded since ${cutoffYear}`);

    const groups = groupGrantsByLeadPi(yaleGrants);
    ctx.log(`Grouped into ${groups.length} distinct Project Directors`);

    const attach: AttachTally = {
      enriched: 0,
      unresolved: 0,
      ambiguousPerson: 0,
      noExistingRow: 0,
      ineligibleRow: 0,
      ambiguousRow: 0,
    };
    let totalObs = 0;
    let processed = 0;
    for (const group of groups) {
      if (processed >= piLimit) break;
      processed++;

      const userResolution = await resolveUserForPi(
        { firstName: group.piFirstName, lastName: group.piLastName },
        resolverDeps,
      );
      if (userResolution.status === 'ambiguous') {
        attach.ambiguousPerson++;
        continue;
      }
      if (userResolution.status !== 'matched') {
        attach.unresolved++;
        continue;
      }

      const home = await researchHomeResolver(userResolution.userId);
      if (home.status === 'safe-shell') {
        attach.noExistingRow++;
        continue;
      }
      if (home.status === 'ineligible') {
        attach.ineligibleRow++;
        continue;
      }
      if (home.status === 'ambiguous') {
        attach.ambiguousRow++;
        continue;
      }

      const entityObs = buildResearchEntityObservations(group, userResolution.userId, home.slug);
      await ctx.emit(entityObs);
      totalObs += entityObs.length;
      attach.enriched++;
    }

    const notes =
      `${shardSummary(years, shards)}; Yale NEH awards since ${cutoffYear}: ${yaleGrants.length}; ` +
      `Project Directors: ${groups.length} (${processed} processed); ${attachSummary(attach)}`;
    ctx.log(`Emitted ${totalObs} observations. ${notes}`);

    return {
      observationCount: totalObs,
      entitiesObserved: attach.enriched,
      notes,
    };
  }
}
