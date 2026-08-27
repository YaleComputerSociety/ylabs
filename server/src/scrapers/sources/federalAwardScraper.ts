/**
 * FederalAwardScraper
 *
 * Pulls DOE-, NASA-, and DoD-funded Yale research awards from the public
 * USAspending.gov award search API and enriches Yale research homes with the
 * same grant-evidence fields NSF/NIH populate (recentGrants, recentGrantCount,
 * fundingAgencies, lastObservedAt). It closes the physical-science / mission-
 * agency coverage gap: NIH RePORTER covers biomedical, NSF covers most other
 * STEM, but DOE Office of Science (Wright Lab, Physics, Chemistry), NASA
 * (Astronomy, Earth & Planetary), and DoD (ONR/AFOSR/ARO) dominate departments
 * whose rosters are JS-rendered SPAs we cannot scrape directly.
 *
 * Critical source constraint (why this producer is stricter than NSF/NIH):
 *   USAspending is prime-recipient-level federal spending data. Unlike the NSF
 *   award API (structured piFirstName/piLastName) and NIH RePORTER (structured
 *   principal_investigators), USAspending exposes NO principal-investigator
 *   field on assistance awards - not on the search endpoint and not on the award
 *   detail endpoint. A PI name is only recoverable when the award's free-text
 *   `Description` happens to embed one (e.g. "...; PI - JOHN HARRIS"), which is a
 *   small minority of records. We therefore FAIL CLOSED:
 *     - Awards with no extractable inline PI are skipped (never attributed).
 *     - An extracted PI is emitted only when it resolves to a single existing
 *       Yale User via the same conservative matcher NSF uses; ambiguous or
 *       absent identities are skipped. We never mint a person/lab shell from a
 *       free-text name alone.
 *   This keeps net-new coverage evidence-first and avoids fabricating research
 *   homes from mission-agency spending descriptions.
 */
import axios from 'axios';
import { canonicalPersonName } from '../utils/personNameCasing';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { getCached, setCached } from '../snapshotCache';
import {
  resolveCanonicalResearchHomeForResearcher,
  type CanonicalResearchHomeResolution,
} from '../canonicalResearchHomeResolver';
import { normalizeName, slugify, splitName } from '../utils/scraperHelpers';
import { resolveResearcherIdForPersonName } from '../../services/researcherPersonNameResolver';
import { resolveUserForPi, piGroupKey, type FederalPiResolverDeps } from './nsfAwardScraper';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';

const USASPENDING_SEARCH_URL =
  'https://api.usaspending.gov/api/v2/search/spending_by_award/';
const AWARD_PUBLIC_URL_PREFIX = 'https://www.usaspending.gov/award/';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const DEFAULT_LOOKBACK_YEARS = 5;
const MAX_GRANTS_PER_PI = 10;
const PI_DERIVED_LAB_NAME_CONFIDENCE = 0.3;
const RECIPIENT_SEARCH_TEXT = ['YALE UNIVERSITY'];
const GRANT_AWARD_TYPE_CODES = ['02', '03', '04', '05'];
const AWARD_SEARCH_FIELDS = [
  'Award ID',
  'Recipient Name',
  'Description',
  'Start Date',
  'End Date',
  'Award Amount',
  'Awarding Agency',
  'Awarding Sub Agency',
];

export interface FederalAgencyConfig {
  toptierName: string;
  abbreviation: string;
}

export const FEDERAL_AGENCIES: FederalAgencyConfig[] = [
  { toptierName: 'Department of Energy', abbreviation: 'DOE' },
  { toptierName: 'National Aeronautics and Space Administration', abbreviation: 'NASA' },
  { toptierName: 'Department of Defense', abbreviation: 'DOD' },
];

export interface UsaspendingAward {
  'Award ID'?: string;
  'Recipient Name'?: string;
  Description?: string;
  'Start Date'?: string;
  'End Date'?: string;
  'Award Amount'?: number | string;
  'Awarding Agency'?: string;
  'Awarding Sub Agency'?: string;
  generated_internal_id?: string;
  internal_id?: number;
}

export interface FederalAward {
  award: UsaspendingAward;
  agencyAbbreviation: string;
  piFirstName: string;
  piLastName: string;
}

export interface PiAwardsGroup {
  piFirstName: string;
  piLastName: string;
  awards: FederalAward[];
}

export interface RecentGrantRecord {
  id: string;
  agency: string;
  title: string;
  abstract: string;
  startDate?: Date;
  endDate?: Date;
  dollarAmount?: number;
  url: string;
  role: 'pi' | 'copi';
}

const PI_IN_DESCRIPTION = new RegExp(
  String.raw`\b(?:PRINCIPAL\s+INVESTIGATOR|P\.?\s*I\.?)\s*[-:]\s*([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2})`,
  'i',
);

const NAME_STOP_TOKENS = new Set(['and', 'et', 'al', 'the', 'of', 'for', 'with', 'yale']);

export function extractPiName(
  description: string | undefined | null,
): { firstName: string; lastName: string } | null {
  if (!description) return null;
  const match = PI_IN_DESCRIPTION.exec(String(description));
  if (!match) return null;
  const rawTokens = match[1].trim().split(/\s+/).filter(Boolean);
  const nameTokens: string[] = [];
  for (const token of rawTokens) {
    if (NAME_STOP_TOKENS.has(token.toLowerCase())) break;
    nameTokens.push(token);
  }
  if (nameTokens.length < 2) return null;
  const canonical = canonicalPersonName(normalizeName(nameTokens.join(' ')));
  const { first, last } = splitName(canonical);
  if (!first || !last) return null;
  return { firstName: first, lastName: last };
}

export function parseUsaspendingDate(s: string | undefined | null): Date | undefined {
  if (!s) return undefined;
  const m = String(s)
    .trim()
    .match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return undefined;
  const [_all, yyyy, mm, dd] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return Number.isFinite(d.getTime()) ? d : undefined;
}

export function parseAwardAmount(value: number | string | undefined | null): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const cleaned = String(value).replace(/[^0-9.]/g, '');
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

export function awardPublicUrl(award: UsaspendingAward): string | null {
  const id = (award.generated_internal_id || '').trim();
  if (id) return `${AWARD_PUBLIC_URL_PREFIX}${encodeURIComponent(id)}`;
  return null;
}

export function awardToRecord(entry: FederalAward, role: 'pi' | 'copi' = 'pi'): RecentGrantRecord | null {
  const url = awardPublicUrl(entry.award);
  const id = (entry.award.generated_internal_id || entry.award['Award ID'] || '').trim();
  if (!url || !id) return null;
  const description = (entry.award.Description || '').trim();
  return {
    id,
    agency: entry.agencyAbbreviation,
    title: description,
    abstract: '',
    startDate: parseUsaspendingDate(entry.award['Start Date']),
    endDate: parseUsaspendingDate(entry.award['End Date']),
    dollarAmount: parseAwardAmount(entry.award['Award Amount']),
    url,
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

export function maxStartDate(awards: FederalAward[]): Date | undefined {
  let max: Date | undefined;
  for (const a of awards) {
    const d = parseUsaspendingDate(a.award['Start Date']);
    if (d && (!max || d.getTime() > max.getTime())) max = d;
  }
  return max;
}

export function fundingAgenciesForGroup(group: PiAwardsGroup): string[] {
  return Array.from(new Set(group.awards.map((a) => a.agencyAbbreviation))).sort();
}

export function groupAwardsByPi(awards: FederalAward[]): PiAwardsGroup[] {
  const map = new Map<string, PiAwardsGroup>();
  for (const a of awards) {
    const key = piGroupKey(a.piFirstName, a.piLastName);
    let group = map.get(key);
    if (!group) {
      group = { piFirstName: a.piFirstName, piLastName: a.piLastName, awards: [] };
      map.set(key, group);
    }
    group.awards.push(a);
  }
  return Array.from(map.values());
}

export function federalPiSlug(piUserId: string): string {
  return `federal-pi-${piUserId}`.slice(0, 100);
}

export function buildResearchHomeObservations(
  group: PiAwardsGroup,
  piUserId: string,
  sourceUrl: string,
  canonicalResearchHomeSlug: string | null,
): ObservationInput[] {
  const slug = canonicalResearchHomeSlug || federalPiSlug(piUserId);
  const piName = canonicalPersonName(
    normalizeName([group.piFirstName, group.piLastName].filter(Boolean).join(' ')),
  );
  const labName = piName ? `${piName} Lab` : `Federal award PI ${slug}`;

  const records = group.awards
    .map((a) => awardToRecord(a, 'pi'))
    .filter((r): r is RecentGrantRecord => r !== null);
  const sorted = sortGrantsByRecency(records);
  const top = sorted.slice(0, MAX_GRANTS_PER_PI);

  const base = { entityType: 'researchEntity' as const, entityKey: slug, sourceUrl };
  const out: ObservationInput[] = [
    ...(!canonicalResearchHomeSlug
      ? [
          { ...base, field: 'slug', value: slug },
          {
            ...base,
            field: 'name',
            value: labName,
            confidenceOverride: PI_DERIVED_LAB_NAME_CONFIDENCE,
          },
          { ...base, field: 'kind', value: 'lab' },
        ]
      : []),
    { ...base, field: 'recentGrants', value: top },
    { ...base, field: 'recentGrantCount', value: records.length },
    { ...base, field: 'fundingAgencies', value: fundingAgenciesForGroup(group) },
  ];

  const lastObserved = maxStartDate(group.awards);
  if (lastObserved) out.push({ ...base, field: 'lastObservedAt', value: lastObserved });

  out.push({ ...base, field: 'inferredPiUserId', value: piUserId, confidenceOverride: 0.7 });
  return out;
}

interface FetchAgencyPageResult {
  awards: UsaspendingAward[];
  hasNext: boolean;
}

async function fetchAgencyPage(
  agency: FederalAgencyConfig,
  page: number,
  timePeriod: { start_date: string; end_date: string },
  useCache: boolean,
  sourceName: string,
): Promise<FetchAgencyPageResult> {
  const cacheKey = `awards:agency=${slugify(agency.abbreviation)}:start=${timePeriod.start_date}:end=${timePeriod.end_date}:page=${page}:limit=${PAGE_SIZE}`;
  if (useCache) {
    const cached = await getCached<FetchAgencyPageResult>(sourceName, cacheKey);
    if (cached) return cached;
  }
  const body = {
    filters: {
      recipient_search_text: RECIPIENT_SEARCH_TEXT,
      award_type_codes: GRANT_AWARD_TYPE_CODES,
      time_period: [timePeriod],
      agencies: [{ type: 'awarding', tier: 'toptier', name: agency.toptierName }],
    },
    fields: AWARD_SEARCH_FIELDS,
    page,
    limit: PAGE_SIZE,
    sort: 'Award Amount',
    order: 'desc',
  };
  const res = await axios.post(USASPENDING_SEARCH_URL, body, {
    timeout: FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  const data = (res.data ?? {}) as {
    results?: UsaspendingAward[];
    page_metadata?: { hasNext?: boolean };
  };
  const payload: FetchAgencyPageResult = {
    awards: Array.isArray(data.results) ? data.results : [],
    hasNext: Boolean(data.page_metadata?.hasNext),
  };
  if (useCache) await setCached(sourceName, cacheKey, payload);
  return payload;
}

export interface FederalAwardScraperDeps {
  resolveResearcherId?: typeof resolveResearcherIdForPersonName;
  fetchAgencyPage?: typeof fetchAgencyPage;
  timePeriod?: { start_date: string; end_date: string };
  agencies?: FederalAgencyConfig[];
  researchHomeResolver?: (researcherId: string) => Promise<CanonicalResearchHomeResolution>;
}

function defaultTimePeriod(): { start_date: string; end_date: string } {
  const end = new Date();
  const start = new Date();
  start.setFullYear(start.getFullYear() - DEFAULT_LOOKBACK_YEARS);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  return { start_date: iso(start), end_date: iso(end) };
}

export class FederalAwardScraper implements IScraper {
  readonly name = 'federal-award-usaspending';
  readonly displayName = 'USAspending federal awards (DOE/NASA/DoD Yale grants)';

  constructor(private readonly deps: FederalAwardScraperDeps = {}) {}

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const timePeriod = this.deps.timePeriod ?? defaultTimePeriod();
    const resolverDeps: FederalPiResolverDeps = { resolveResearcherId: this.deps.resolveResearcherId };
    const fetcher = this.deps.fetchAgencyPage ?? fetchAgencyPage;
    const agencies = this.deps.agencies ?? FEDERAL_AGENCIES;
    const researchHomeResolver =
      this.deps.researchHomeResolver ?? resolveCanonicalResearchHomeForResearcher;

    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }
    const limit = limitOption ?? Infinity;

    ctx.log(
      `Fetching USAspending awards for "YALE UNIVERSITY" (${agencies
        .map((a) => a.abbreviation)
        .join('/')}) from ${timePeriod.start_date} to ${timePeriod.end_date}`,
    );

    const federalAwards: FederalAward[] = [];
    let totalFetched = 0;
    let withInlinePi = 0;

    for (const agency of agencies) {
      if (totalFetched >= limit) break;
      for (let page = 1; page <= MAX_PAGES; page++) {
        let payload: FetchAgencyPageResult;
        try {
          payload = await fetcher(agency, page, timePeriod, ctx.options.useCache, this.name);
        } catch (err: unknown) {
          ctx.log(
            `fetch failed for ${agency.abbreviation} page ${page}: ${sanitizeLogValue(
              err,
            )} - aborting this agency`,
          );
          break;
        }
        if (payload.awards.length === 0) break;
        for (const award of payload.awards) {
          if (totalFetched >= limit) break;
          totalFetched++;
          const pi = extractPiName(award.Description);
          if (!pi) continue;
          withInlinePi++;
          federalAwards.push({
            award,
            agencyAbbreviation: agency.abbreviation,
            piFirstName: pi.firstName,
            piLastName: pi.lastName,
          });
        }
        if (totalFetched >= limit) break;
        if (!payload.hasNext) break;
      }
    }

    ctx.log(
      `Fetched ${totalFetched} awards; ${withInlinePi} carried an inline PI in the description`,
    );

    const groups = groupAwardsByPi(federalAwards);
    ctx.log(`Grouped into ${groups.length} distinct inline-PI names`);

    let totalObs = 0;
    let piMatched = 0;
    let homesEnriched = 0;

    for (const group of groups) {
      const resolution = await resolveUserForPi(
        { firstName: group.piFirstName, lastName: group.piLastName },
        resolverDeps,
      );
      if (resolution.status !== 'matched') continue;
      piMatched++;
      const piUserId = resolution.userId;

      const homeResolution = await researchHomeResolver(piUserId);
      if (homeResolution.status === 'ambiguous' || homeResolution.status === 'ineligible') {
        continue;
      }
      const canonicalResearchHomeSlug =
        homeResolution.status === 'canonical' ? homeResolution.slug : null;

      const obs = buildResearchHomeObservations(
        group,
        piUserId,
        USASPENDING_SEARCH_URL,
        canonicalResearchHomeSlug,
      );
      await ctx.emit(obs);
      totalObs += obs.length;
      homesEnriched++;
    }

    ctx.log(
      `Emitted ${totalObs} observations for ${homesEnriched} research homes (${piMatched} inline PIs matched to Yale Users)`,
    );

    return {
      observationCount: totalObs,
      entitiesObserved: homesEnriched,
      notes:
        `USAspending awards fetched: ${totalFetched}, inline-PI awards: ${withInlinePi}, ` +
        `distinct PIs: ${groups.length}, matched to Users: ${piMatched}, homes enriched: ${homesEnriched}`,
    };
  }
}
