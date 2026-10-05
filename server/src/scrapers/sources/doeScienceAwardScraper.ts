import axios from 'axios';
import * as cheerio from 'cheerio';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { ssrfSafeAgents } from '../../utils/ssrfGuard';
import { getCached, setCached } from '../snapshotCache';
import {
  resolveCanonicalResearchHomeForResearcher,
  type CanonicalResearchHomeResolution,
} from '../canonicalResearchHomeResolver';
import { resolveResearcherIdForPersonName } from '../../services/researcherPersonNameResolver';
import { normalizeName } from '../utils/scraperHelpers';
import { resolveUserForPi, type FederalPiResolverDeps } from './nsfAwardScraper';
import {
  countGrantAttach,
  emptyGrantAttachTally,
  grantAttachSummary,
  resolveGrantEnrichmentTarget,
  type GrantPersonResolution,
} from '../utils/grantEnrichmentTarget';
import { grantAwardIdentity } from '../utils/grantAwardIdentity';
import { recentGrantPeriodsOf } from '../utils/recentGrantPeriods';
import { readFirstSheetRows } from '../utils/xlsxSheetRows';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import { retryOnRetryableStatus } from '../utils/httpFetch';

export const DOE_PAMS_AWARD_SEARCH_URL =
  'https://pamspublic.science.energy.gov/WebPAMSExternal/Interface/Awards/AwardSearchExternal.aspx';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 120_000;
const DEFAULT_LOOKBACK_YEARS = 6;
const MAX_GRANTS_PER_ROW = 10;
const INFERRED_PI_CONFIDENCE = 0.7;
const INSTITUTION_QUERY = 'Yale University';
const ALL_AWARD_STATUSES = '0';
const SEARCH_FIELD = 'ctl00$MainContent$pnlSearch';
const INSTITUTION_FIELD = 'ctl00$MainContent$pnlSearch$txtInstitutionName';
const AWARD_STATUS_FIELD = 'ctl00$MainContent$pnlSearch$ddAwardStatus';
const EXPORT_ACTION_FIELD = 'ctl00$Toolbar$toolBarActions$btnAction1';

const REQUIRED_EXPORT_HEADERS = [
  'awardnumber',
  'title',
  'institution',
  'state',
  'pi',
  'startdate',
  'enddate',
] as const;

export type DoeAwardRecord = Record<string, string>;

export type DoePamsAwardExport =
  | { kind: 'export'; reportedCount: number; rows: string[][] }
  | { kind: 'unrecognised'; reason: string };

export interface DoeScienceAward {
  awardNumber: string;
  title: string;
  abstract: string;
  programOffice: string;
  startDate?: Date;
  endDate?: Date;
  amount?: number;
  pi: { firstName: string; lastName: string };
}

export interface RecentGrantRecord {
  id: string;
  agency: 'DOE';
  title: string;
  abstract: string;
  startDate?: Date;
  endDate?: Date;
  dollarAmount?: number;
  url: string;
  role: 'pi';
}

export type DoeAwardRefusal = 'notYale' | 'noAwardNumber' | 'noPi' | 'undated' | 'outsideWindow';

export type DoeAwardExtraction =
  { kind: 'admitted'; award: DoeScienceAward } | { kind: 'refused'; reason: DoeAwardRefusal };

export function normalizedHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function collapseWhitespace(text: string | undefined): string {
  return String(text ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function exportRecords(rows: string[][]): { headers: string[]; records: DoeAwardRecord[] } {
  const [headerRow = [], ...dataRows] = rows;
  const headers = headerRow.map((header) => normalizedHeader(header));
  const records = dataRows
    .filter((row) => row.some((cell) => collapseWhitespace(cell) !== ''))
    .map((row) => {
      const record: DoeAwardRecord = {};
      headers.forEach((header, index) => {
        if (header) record[header] = collapseWhitespace(row[index]);
      });
      return record;
    });
  return { headers, records };
}

export function hasRequiredDoeHeaders(headers: string[]): boolean {
  const set = new Set(headers);
  return REQUIRED_EXPORT_HEADERS.every((header) => set.has(header));
}

export function parseReportedAwardCount(html: string): number | undefined {
  const $ = cheerio.load(html);
  const info = collapseWhitespace($('.rgInfoPart').first().text());
  const match = info.match(/(\d[\d,]*)\s+items?\b/i);
  return match ? Number(match[1].replace(/,/g, '')) : undefined;
}

export function parsePamsDate(value: string | undefined): Date | undefined {
  const match = collapseWhitespace(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return undefined;
  const [, month, day, year] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : undefined;
}

export function parsePamsAmount(value: string | undefined): number | undefined {
  const cleaned = collapseWhitespace(value).replace(/[$,]/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return undefined;
  const amount = Number(cleaned);
  return amount > 0 ? amount : undefined;
}

export function parsePiName(
  value: string | undefined,
): { firstName: string; lastName: string } | null {
  const text = collapseWhitespace(value);
  const comma = text.indexOf(',');
  if (comma <= 0) return null;
  const lastName = normalizeName(text.slice(0, comma));
  const firstName = normalizeName(text.slice(comma + 1));
  if (!lastName || !firstName) return null;
  return { firstName, lastName };
}

export function isYaleAwardee(record: DoeAwardRecord): boolean {
  return (
    /^yale university\b/i.test(record.institution || '') &&
    (record.state || '').trim().toUpperCase() === 'CT'
  );
}

export function extractDoeAward(record: DoeAwardRecord, cutoffYear: number): DoeAwardExtraction {
  if (!isYaleAwardee(record)) return { kind: 'refused', reason: 'notYale' };
  const awardNumber = (record.awardnumber || '').trim();
  const title = (record.title || '').trim();
  if (!awardNumber || !title) return { kind: 'refused', reason: 'noAwardNumber' };
  const pi = parsePiName(record.pi);
  if (!pi) return { kind: 'refused', reason: 'noPi' };
  const startDate = parsePamsDate(record.startdate);
  const endDate = parsePamsDate(record.enddate);
  const windowDate = endDate ?? startDate;
  if (!windowDate) return { kind: 'refused', reason: 'undated' };
  if (windowDate.getUTCFullYear() < cutoffYear) return { kind: 'refused', reason: 'outsideWindow' };
  return {
    kind: 'admitted',
    award: {
      awardNumber,
      title,
      abstract: record.abstract || '',
      programOffice: record.programoffice || '',
      startDate,
      endDate,
      amount: parsePamsAmount(record.amountawardedtodate),
      pi,
    },
  };
}

export function grantToRecord(award: DoeScienceAward): RecentGrantRecord {
  return {
    id: award.awardNumber,
    agency: 'DOE',
    title: award.title,
    abstract: award.abstract,
    startDate: award.startDate,
    endDate: award.endDate,
    dollarAmount: award.amount,
    url: DOE_PAMS_AWARD_SEARCH_URL,
    role: 'pi',
  };
}

export function sortGrantsByRecency(records: RecentGrantRecord[]): RecentGrantRecord[] {
  return [...records].sort((a, b) => {
    const ta = a.startDate ? a.startDate.getTime() : -Infinity;
    const tb = b.startDate ? b.startDate.getTime() : -Infinity;
    return tb - ta;
  });
}

export interface RowAwards {
  slug: string;
  researcherIds: Set<string>;
  awards: DoeScienceAward[];
}

export function buildResearchEntityObservations(row: RowAwards): ObservationInput[] {
  const byIdentity = new Map<string, RecentGrantRecord>();
  for (const award of row.awards) {
    const record = grantToRecord(award);
    const identity = grantAwardIdentity(record);
    if (identity && !byIdentity.has(identity)) byIdentity.set(identity, record);
  }
  const records = [...byIdentity.values()];
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: row.slug,
    sourceUrl: DOE_PAMS_AWARD_SEARCH_URL,
  };
  const periods = recentGrantPeriodsOf(records);
  const out: ObservationInput[] = [
    {
      ...base,
      field: 'recentGrants',
      value: sortGrantsByRecency(records).slice(0, MAX_GRANTS_PER_ROW),
    },
    { ...base, field: 'recentGrantPeriods', value: periods },
    { ...base, field: 'recentGrantCount', value: periods.length },
    { ...base, field: 'fundingAgencies', value: ['DOE'] },
  ];
  const lastObserved = records
    .map((record) => record.startDate)
    .filter((date): date is Date => date instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  if (lastObserved) out.push({ ...base, field: 'lastObservedAt', value: lastObserved });
  if (row.researcherIds.size === 1) {
    out.push({
      ...base,
      field: 'inferredPiUserId',
      value: [...row.researcherIds][0],
      confidenceOverride: INFERRED_PI_CONFIDENCE,
    });
  }
  return out;
}

export function aspNetFormFields(html: string): Record<string, string> {
  const $ = cheerio.load(html);
  const fields: Record<string, string> = {};
  $('input[name]').each((_, element) => {
    const type = ($(element).attr('type') || 'text').toLowerCase();
    if (['submit', 'button', 'checkbox', 'radio', 'image', 'file'].includes(type)) return;
    fields[$(element).attr('name') as string] = $(element).attr('value') ?? '';
  });
  $('select[name]').each((_, element) => {
    const selected = $(element).find('option[selected]').first();
    const option = selected.length > 0 ? selected : $(element).find('option').first();
    fields[$(element).attr('name') as string] = option.attr('value') ?? '';
  });
  return fields;
}

export function yaleSearchForm(searchPageHtml: string): Record<string, string> {
  return {
    ...aspNetFormFields(searchPageHtml),
    [INSTITUTION_FIELD]: INSTITUTION_QUERY,
    [AWARD_STATUS_FIELD]: ALL_AWARD_STATUSES,
    __EVENTTARGET: SEARCH_FIELD,
    __EVENTARGUMENT: 'CustomSortSelected=false SearchPanelExpanded=true Search',
  };
}

export function exportForm(resultsPageHtml: string): Record<string, string> {
  return {
    ...aspNetFormFields(resultsPageHtml),
    __EVENTTARGET: EXPORT_ACTION_FIELD,
    __EVENTARGUMENT: 'Export to Excel',
  };
}

function cookieHeaderFrom(setCookie: string[] | string | undefined, jar: Map<string, string>) {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const value of values) {
    const pair = value.split(';')[0];
    const equals = pair.indexOf('=');
    if (equals > 0) jar.set(pair.slice(0, equals).trim(), pair.slice(equals + 1).trim());
  }
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function pamsRequest(
  method: 'get' | 'post',
  jar: Map<string, string>,
  responseType: 'text' | 'arraybuffer',
  form?: Record<string, string>,
) {
  const agents = ssrfSafeAgents();
  const res = await retryOnRetryableStatus(() =>
    axios.request({
      method,
      url: DOE_PAMS_AWARD_SEARCH_URL,
      timeout: FETCH_TIMEOUT_MS,
      httpAgent: agents.httpAgent,
      httpsAgent: agents.httpsAgent,
      responseType,
      transformResponse: [(data) => data],
      maxRedirects: 0,
      data: form ? new URLSearchParams(form).toString() : undefined,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: responseType === 'text' ? 'text/html,*/*' : '*/*',
        ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(jar.size > 0 ? { Cookie: cookieHeaderFrom(undefined, jar) } : {}),
      },
    }),
  );
  cookieHeaderFrom(res.headers['set-cookie'], jar);
  return res;
}

export function isZipWorkbook(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer.readUInt32LE(0) === 0x04034b50;
}

async function fetchYaleAwardExport(
  useCache: boolean,
  sourceName: string,
): Promise<DoePamsAwardExport> {
  const cacheKey = `award-export:institution=${INSTITUTION_QUERY}:status=all`;
  if (useCache) {
    const cached = await getCached<DoePamsAwardExport>(sourceName, cacheKey);
    if (cached) return cached;
  }
  const jar = new Map<string, string>();
  const searchPage = await pamsRequest('get', jar, 'text');
  const results = await pamsRequest('post', jar, 'text', yaleSearchForm(String(searchPage.data)));
  const resultsHtml = String(results.data);
  const reportedCount = parseReportedAwardCount(resultsHtml);
  if (reportedCount === undefined) {
    return { kind: 'unrecognised', reason: 'results page carries no award count' };
  }
  const workbook = await pamsRequest('post', jar, 'arraybuffer', exportForm(resultsHtml));
  const buffer = Buffer.from(workbook.data as ArrayBuffer);
  if (!isZipWorkbook(buffer)) {
    return { kind: 'unrecognised', reason: 'export did not return a workbook' };
  }
  const result: DoePamsAwardExport = {
    kind: 'export',
    reportedCount,
    rows: readFirstSheetRows(buffer),
  };
  if (useCache) await setCached(sourceName, cacheKey, result);
  return result;
}

export interface DoeScienceAwardScraperDeps {
  fetchAwardExport?: typeof fetchYaleAwardExport;
  resolveResearcherId?: typeof resolveResearcherIdForPersonName;
  researchHomeResolver?: (researcherId: string) => Promise<CanonicalResearchHomeResolution>;
  lookbackYears?: number;
  currentYear?: number;
}

function summarizeRefusals(refusals: Record<DoeAwardRefusal, number>): string {
  return (
    `${refusals.notYale} not a Yale awardee, ${refusals.noAwardNumber} without an award number or title, ` +
    `${refusals.noPi} without a readable PI, ${refusals.undated} undated, ` +
    `${refusals.outsideWindow} ended before the window`
  );
}

function failClosed(ctx: ScraperContext, notes: string): ScraperResult {
  ctx.log(notes);
  return { observationCount: 0, entitiesObserved: 0, notes, failedClosed: true };
}

export class DoeScienceAwardScraper implements IScraper {
  readonly name = 'doe-science-awards';
  readonly displayName = 'DOE Office of Science awards (Yale PIs)';

  constructor(private readonly deps: DoeScienceAwardScraperDeps = {}) {}

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const resolverDeps: FederalPiResolverDeps = {
      resolveResearcherId: this.deps.resolveResearcherId,
    };
    const fetchAwardExport = this.deps.fetchAwardExport ?? fetchYaleAwardExport;
    const researchHomeResolver =
      this.deps.researchHomeResolver ?? resolveCanonicalResearchHomeForResearcher;
    const lookbackYears = this.deps.lookbackYears ?? DEFAULT_LOOKBACK_YEARS;
    const currentYear =
      this.deps.currentYear ?? (ctx.options.referenceDate ?? new Date()).getFullYear();
    const cutoffYear = currentYear - lookbackYears;

    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }
    const piLimit = limitOption ?? Infinity;

    ctx.log(`Exporting DOE Office of Science awards to ${INSTITUTION_QUERY} (all statuses)`);
    let awardExport: DoePamsAwardExport;
    try {
      awardExport = await fetchAwardExport(ctx.options.useCache, this.name);
    } catch (err: unknown) {
      return failClosed(
        ctx,
        `DOE Office of Science award search unreachable (${sanitizeLogValue(err)}); failed closed with no writes`,
      );
    }
    if (awardExport.kind === 'unrecognised') {
      return failClosed(
        ctx,
        `DOE Office of Science award search unrecognised (${awardExport.reason}); failed closed with no writes`,
      );
    }
    const { headers, records } = exportRecords(awardExport.rows);
    if (!hasRequiredDoeHeaders(headers)) {
      return failClosed(
        ctx,
        'DOE Office of Science award export is missing a required column; failed closed with no writes',
      );
    }
    if (records.length < awardExport.reportedCount) {
      return failClosed(
        ctx,
        `DOE Office of Science award export served ${records.length} of the ${awardExport.reportedCount} awards the search reports; failed closed with no writes rather than undercount grants`,
      );
    }

    const refusals: Record<DoeAwardRefusal, number> = {
      notYale: 0,
      noAwardNumber: 0,
      noPi: 0,
      undated: 0,
      outsideWindow: 0,
    };
    const awardsByPi = new Map<string, DoeScienceAward[]>();
    const seenAwards = new Set<string>();
    for (const record of records) {
      const extraction = extractDoeAward(record, cutoffYear);
      if (extraction.kind === 'refused') {
        refusals[extraction.reason]++;
        continue;
      }
      const { award } = extraction;
      const identity = grantAwardIdentity({ id: award.awardNumber, agency: 'DOE' });
      if (!identity || seenAwards.has(identity)) continue;
      seenAwards.add(identity);
      const piKey = `${award.pi.firstName} ${award.pi.lastName}`.toLowerCase();
      awardsByPi.set(piKey, [...(awardsByPi.get(piKey) ?? []), award]);
    }
    ctx.log(
      `Admitted ${seenAwards.size} of ${records.length} Yale DOE award(s) active since ${cutoffYear} across ${awardsByPi.size} PI(s)`,
    );

    const attach = emptyGrantAttachTally();
    const rows = new Map<string, RowAwards>();
    let processed = 0;
    for (const awards of awardsByPi.values()) {
      if (processed >= piLimit) break;
      processed++;
      const person: GrantPersonResolution = await resolveUserForPi(awards[0].pi, resolverDeps);
      const target = await resolveGrantEnrichmentTarget(person, researchHomeResolver);
      countGrantAttach(attach, target);
      if (target.status !== 'enrich') continue;
      const row = rows.get(target.slug) ?? {
        slug: target.slug,
        researcherIds: new Set<string>(),
        awards: [],
      };
      row.researcherIds.add(target.researcherId);
      row.awards.push(...awards);
      rows.set(target.slug, row);
    }

    let totalObs = 0;
    for (const row of rows.values()) {
      const observations = buildResearchEntityObservations(row);
      await ctx.emit(observations);
      totalObs += observations.length;
    }

    const notes =
      `DOE Office of Science award export: ${records.length} of ${awardExport.reportedCount} reported award(s) read; ` +
      `admitted ${seenAwards.size} active since ${cutoffYear}; refused ${summarizeRefusals(refusals)}; ` +
      `PIs: ${awardsByPi.size} (${processed} processed); ${rows.size} distinct row(s) enriched; ` +
      grantAttachSummary(attach);
    ctx.log(`Emitted ${totalObs} observations. ${notes}`);
    return { observationCount: totalObs, entitiesObserved: rows.size, notes };
  }
}
