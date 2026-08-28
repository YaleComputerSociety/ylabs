/**
 * NehGrantScraper
 *
 * Pulls Yale-awardee National Endowment for the Humanities (NEH) funded
 * projects from NEH's public open-data bulk files
 * (https://apps.neh.gov/open/data/, per-decade `NEH_Grants<decade>s.csv`).
 * The files are free, unauthenticated, and published in a stable CSV schema.
 *
 * This is the humanities/social-science analogue of the STEM-only NIH RePORTER
 * and NSF Award Search grant lanes (#1529): a Yale historian, classicist, or
 * area-studies scholar is more likely to lack a scrapable lab microsite, so a
 * funding-side lane matters more there, not less. It mirrors the NSF/NIH
 * producers: group awards by PI, self-attach a resolved PI to an existing
 * research home, or mint a conservative synthetic shell only when no membership
 * exists. Funding is FUNDING_ACTIVITY enrichment only and is never
 * undergraduate-access evidence on its own; the run creates no access/route/
 * opportunity evidence.
 *
 * Fail-closed: if no decade file is reachable, or a fetched file's schema has
 * drifted (required columns absent), the run emits no observations and logs a
 * coverage note, exactly as the NIH/NSF scrapers do on API errors.
 */
import axios from 'axios';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { getCached, setCached } from '../snapshotCache';
import {
  resolveCanonicalResearchHomeForResearcher,
  type CanonicalResearchHomeResolution,
} from '../canonicalResearchHomeResolver';
import { resolveResearcherIdForPersonName } from '../../services/researcherPersonNameResolver';
import { normalizeName, slugify, splitName } from '../utils/scraperHelpers';
import { resolveUserForPi, findUserForPi, type FederalPiResolverDeps } from './nsfAwardScraper';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';

const NEH_OPEN_DATA_BASE = 'https://apps.neh.gov/open/data';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 60_000;
const DEFAULT_LOOKBACK_YEARS = 6;
const MAX_GRANTS_PER_PI = 10;
// "<PI> Research" is a placeholder minted only when no real name is known; keep
// it well below any real-name source (microsite, official profile) so those win.
const PI_DERIVED_HOME_NAME_CONFIDENCE = 0.3;
// A funded humanities scholar's project, deliberately not a STEM `LAB` shape.
const HUMANITIES_SHELL_ENTITY_TYPE = 'FACULTY_PROJECT';
const HUMANITIES_SHELL_KIND = 'individual';
const LEAD_ROLE = 'project director';
const CO_LEAD_ROLE = 'co project director';

// Any missing column fails the schema check closed rather than writing garbage.
const REQUIRED_CSV_HEADERS = [
  'appnumber',
  'institution',
  'inststate',
  'projecttitle',
  'participants',
  'yearawarded',
] as const;

export interface NehParticipant {
  fullName: string;
  role: string;
  isLead: boolean;
  isCoLead: boolean;
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
  toSupport: string;
  primaryDiscipline: string;
  disciplines: string[];
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

export function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

export function normalizedHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export type NehCsvRecord = Record<string, string>;

export function parseNehCsv(input: string): { records: NehCsvRecord[]; headers: string[] } {
  const rows = parseCsvRows(input);
  if (rows.length < 1) return { records: [], headers: [] };
  const headers = rows[0].map((cell) => normalizedHeader(cell.trim()));
  const records = rows.slice(1).flatMap((cells) => {
    if (!cells.some((cell) => cell.trim().length > 0)) return [];
    const record: NehCsvRecord = {};
    headers.forEach((header, index) => {
      record[header] = (cells[index] ?? '').trim();
    });
    return [record];
  });
  return { records, headers };
}

export function hasRequiredNehHeaders(headers: string[]): boolean {
  const set = new Set(headers);
  return REQUIRED_CSV_HEADERS.every((header) => set.has(header));
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

export function parseNehAmount(s: string | undefined | null): number | undefined {
  if (s === undefined || s === null || s === '') return undefined;
  const cleaned = String(s).replace(/[^0-9.]/g, '');
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function parseYear(s: string | undefined | null): number | undefined {
  if (!s) return undefined;
  const m = String(s).trim().match(/(\d{4})/);
  if (!m) return undefined;
  const year = Number(m[1]);
  return Number.isFinite(year) ? year : undefined;
}

export function parseParticipants(raw: string | undefined | null): NehParticipant[] {
  if (!raw) return [];
  return String(raw)
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const m = chunk.match(/^(.*?)\s*\[([^\]]*)\]\s*$/);
      const fullName = normalizeName((m ? m[1] : chunk).trim());
      const role = (m ? m[2] : '').trim();
      const roleKey = role.toLowerCase();
      return {
        fullName,
        role,
        isLead: roleKey === LEAD_ROLE,
        isCoLead: roleKey === CO_LEAD_ROLE,
      };
    })
    .filter((p) => p.fullName.length > 0);
}

export function leadParticipant(participants: NehParticipant[]): NehParticipant | null {
  return participants.find((p) => p.isLead) || participants[0] || null;
}

export function isYaleAwardee(record: NehCsvRecord): boolean {
  const institution = (record.institution || '').toLowerCase();
  const state = (record.inststate || '').trim().toUpperCase();
  return /\byale\b/.test(institution) && state === 'CT';
}

export function recordToNehGrant(record: NehCsvRecord): NehGrant | null {
  const appNumber = (record.appnumber || '').trim();
  const projectTitle = (record.projecttitle || '').trim();
  if (!appNumber || !projectTitle) return null;
  const participants = parseParticipants(record.participants);
  if (participants.length === 0) return null;
  const disciplines = (record.disciplines || '')
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean);
  return {
    appNumber,
    institution: (record.institution || '').trim(),
    instState: (record.inststate || '').trim(),
    projectTitle,
    program: (record.program || '').trim(),
    division: (record.division || '').trim(),
    yearAwarded: parseYear(record.yearawarded),
    beginGrant: parseNehDate(record.begingrant),
    endGrant: parseNehDate(record.endgrant),
    projectDesc: (record.projectdesc || '').trim(),
    toSupport: (record.tosupport || '').trim(),
    primaryDiscipline: (record.primarydiscipline || '').trim(),
    disciplines,
    awardOutright: parseNehAmount(record.awardoutright),
    originalAmount: parseNehAmount(record.originalamount),
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
    const { first, last } = splitName(lead.fullName);
    if (!first && !last) continue;
    const key = piGroupKey(first, last);
    let group = map.get(key);
    if (!group) {
      group = { piFirstName: first, piLastName: last, fullName: lead.fullName, awards: [] };
      map.set(key, group);
    }
    group.awards.push(grant);
  }
  return Array.from(map.values());
}

export function nehGrantUrl(appNumber: string): string {
  return `https://securegrants.neh.gov/publicquery/main.aspx?f=1&gn=${encodeURIComponent(
    appNumber,
  )}`;
}

export function grantToRecord(grant: NehGrant, role: 'pi' | 'copi' = 'pi'): RecentGrantRecord {
  return {
    id: grant.appNumber,
    agency: 'NEH',
    title: grant.projectTitle,
    abstract: grant.projectDesc || grant.toSupport || '',
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

export function piSlug(piUserId: string | null, firstName: string, lastName: string): string {
  if (piUserId) return `neh-pi-${piUserId}`;
  const key = piGroupKey(firstName, lastName);
  return `neh-pi-${key.replace(/\s+/g, '-')}`.slice(0, 100);
}

// A window that straddles a decade boundary needs both decade files, since each
// NEH file spans exactly one decade (NEH_Grants2020s.csv covers 2020-2029).
export function decadeFilesForLookback(currentYear: number, lookbackYears: number): string[] {
  const startYear = currentYear - lookbackYears;
  const files = new Set<string>();
  for (let decade = Math.floor(startYear / 10) * 10; decade <= currentYear; decade += 10) {
    files.add(`NEH_Grants${decade}s.csv`);
  }
  return Array.from(files);
}

async function fetchDecadeCsv(
  fileName: string,
  useCache: boolean,
  sourceName: string,
): Promise<string> {
  const cacheKey = `file:${fileName}`;
  if (useCache) {
    const cached = await getCached<{ csv: string }>(sourceName, cacheKey);
    if (cached) return cached.csv;
  }
  const res = await axios.get(`${NEH_OPEN_DATA_BASE}/${fileName}`, {
    timeout: FETCH_TIMEOUT_MS,
    responseType: 'text',
    transformResponse: [(data) => data],
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/csv,*/*' },
  });
  const csv = typeof res.data === 'string' ? res.data : String(res.data ?? '');
  if (useCache) await setCached(sourceName, cacheKey, { csv });
  return csv;
}

export function buildResearchEntityObservations(
  group: PiGrantsGroup,
  piUserId: string | null,
  sourceUrl: string,
  canonicalResearchHomeSlug?: string | null,
): ObservationInput[] {
  const slug = canonicalResearchHomeSlug || piSlug(piUserId, group.piFirstName, group.piLastName);
  const homeName = group.fullName ? `${group.fullName} Research` : `NEH PI ${slug}`;

  const records = group.awards.map((a) => grantToRecord(a, 'pi'));
  const top = sortGrantsByRecency(records).slice(0, MAX_GRANTS_PER_PI);

  const base = { entityType: 'researchEntity' as const, entityKey: slug, sourceUrl };
  const out: ObservationInput[] = [
    ...(!canonicalResearchHomeSlug
      ? [
          { ...base, field: 'slug', value: slug },
          {
            ...base,
            field: 'name',
            value: homeName,
            confidenceOverride: PI_DERIVED_HOME_NAME_CONFIDENCE,
          },
          { ...base, field: 'kind', value: HUMANITIES_SHELL_KIND },
          { ...base, field: 'entityType', value: HUMANITIES_SHELL_ENTITY_TYPE },
        ]
      : []),
    { ...base, field: 'recentGrants', value: top },
    { ...base, field: 'recentGrantCount', value: records.length },
    { ...base, field: 'fundingAgencies', value: ['NEH'] },
  ];

  const lastObserved = maxStartDate(group.awards);
  if (lastObserved) out.push({ ...base, field: 'lastObservedAt', value: lastObserved });

  if (piUserId) {
    out.push({ ...base, field: 'inferredPiUserId', value: piUserId, confidenceOverride: 0.7 });
  }
  return out;
}

async function buildCoPiObservations(
  group: PiGrantsGroup,
  researchEntitySlug: string,
  leadFullName: string,
  sourceUrl: string,
  deps: FederalPiResolverDeps,
): Promise<ObservationInput[]> {
  const out: ObservationInput[] = [];
  const seenUserIds = new Set<string>();
  const leadKey = leadFullName.toLowerCase();
  for (const award of group.awards) {
    for (const participant of award.participants) {
      if (participant.isLead && participant.fullName.toLowerCase() === leadKey) continue;
      const { first, last } = splitName(participant.fullName);
      if (!first && !last) continue;
      const userId = await findUserForPi({ firstName: first, lastName: last }, deps);
      if (!userId) continue;
      if (seenUserIds.has(userId)) continue;
      seenUserIds.add(userId);

      const memberKey = `${researchEntitySlug}::copi::${userId}`;
      const base = {
        entityType: 'researchGroupMember' as const,
        entityKey: memberKey,
        sourceUrl,
      };
      out.push({ ...base, field: 'researchGroupSlug', value: researchEntitySlug });
      out.push({ ...base, field: 'userId', value: userId });
      out.push({ ...base, field: 'role', value: 'co-pi' });
      out.push({ ...base, field: 'fullName', value: participant.fullName });
    }
  }
  return out;
}

export interface NehGrantScraperDeps {
  resolveResearcherId?: typeof resolveResearcherIdForPersonName;
  fetchDecadeCsv?: typeof fetchDecadeCsv;
  lookbackYears?: number;
  currentYear?: number;
  researchHomeResolver?: (researcherId: string) => Promise<CanonicalResearchHomeResolution>;
}

export class NehGrantScraper implements IScraper {
  readonly name = 'neh-funded-projects';
  readonly displayName = 'NEH funded projects (Yale humanities/social-science grants)';

  constructor(private readonly deps: NehGrantScraperDeps = {}) {}

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const resolverDeps: FederalPiResolverDeps = {
      resolveResearcherId: this.deps.resolveResearcherId,
    };
    const fetcher = this.deps.fetchDecadeCsv ?? fetchDecadeCsv;
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

    const files = decadeFilesForLookback(currentYear, lookbackYears);
    ctx.log(`Fetching NEH open-data files ${files.join(', ')} (awards since ${cutoffYear})`);

    const yaleGrants: NehGrant[] = [];
    let anyFileFetched = false;
    let anySchemaIntact = false;
    for (const fileName of files) {
      let csv: string;
      try {
        csv = await fetcher(fileName, ctx.options.useCache, this.name);
      } catch (err: unknown) {
        ctx.log(`fetch failed for ${fileName}: ${sanitizeLogValue(err)}`);
        continue;
      }
      anyFileFetched = true;
      const { records, headers } = parseNehCsv(csv);
      if (!hasRequiredNehHeaders(headers)) {
        ctx.log(`schema drift in ${fileName}: required column(s) absent; skipping (fail closed)`);
        continue;
      }
      anySchemaIntact = true;
      for (const record of records) {
        if (!isYaleAwardee(record)) continue;
        const grant = recordToNehGrant(record);
        if (!grant) continue;
        if (grant.yearAwarded !== undefined && grant.yearAwarded < cutoffYear) continue;
        yaleGrants.push(grant);
      }
    }

    if (!anyFileFetched) {
      ctx.log('no NEH open-data file was reachable; emitting nothing (fail closed)');
      return {
        observationCount: 0,
        entitiesObserved: 0,
        notes: 'NEH open data unreachable; failed closed with no writes',
      };
    }
    if (!anySchemaIntact) {
      ctx.log('every reachable NEH file failed the schema check; emitting nothing (fail closed)');
      return {
        observationCount: 0,
        entitiesObserved: 0,
        notes: 'NEH open-data schema drift; failed closed with no writes',
      };
    }

    ctx.log(`Retained ${yaleGrants.length} Yale NEH award(s) within the lookback window`);

    const groups = groupGrantsByLeadPi(yaleGrants);
    ctx.log(`Grouped into ${groups.length} distinct PIs`);

    const sourceUrl = NEH_OPEN_DATA_BASE;
    let totalObs = 0;
    let piMatched = 0;
    let processed = 0;
    for (const group of groups) {
      if (processed >= piLimit) break;
      processed++;

      const userResolution = await resolveUserForPi(
        { firstName: group.piFirstName, lastName: group.piLastName },
        resolverDeps,
      );
      if (userResolution.status === 'ambiguous') continue;
      const piUserId = userResolution.status === 'matched' ? userResolution.userId : null;
      if (piUserId) piMatched++;

      const researchHomeResolution = piUserId
        ? await researchHomeResolver(piUserId)
        : { status: 'safe-shell' as const };
      if (
        researchHomeResolution.status === 'ambiguous' ||
        researchHomeResolution.status === 'ineligible'
      ) {
        continue;
      }
      const canonicalResearchHomeSlug =
        researchHomeResolution.status === 'canonical' ? researchHomeResolution.slug : null;

      const entityObs = buildResearchEntityObservations(
        group,
        piUserId,
        sourceUrl,
        canonicalResearchHomeSlug,
      );
      await ctx.emit(entityObs);
      totalObs += entityObs.length;

      const slug =
        canonicalResearchHomeSlug || piSlug(piUserId, group.piFirstName, group.piLastName);
      const coPiObs = await buildCoPiObservations(group, slug, group.fullName, sourceUrl, resolverDeps);
      if (coPiObs.length > 0) {
        await ctx.emit(coPiObs);
        totalObs += coPiObs.length;
      }
    }

    ctx.log(
      `Emitted ${totalObs} observations across ${processed} PIs (${piMatched} matched to Yale Users)`,
    );

    return {
      observationCount: totalObs,
      entitiesObserved: processed,
      notes: `Yale NEH awards: ${yaleGrants.length}, PIs: ${groups.length}, matched to Users: ${piMatched}`,
    };
  }
}
