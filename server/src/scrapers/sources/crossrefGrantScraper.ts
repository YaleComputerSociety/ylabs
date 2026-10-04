/**
 * CrossrefGrantScraper
 *
 * Reads the grant records funders register with Crossref
 * (https://api.crossref.org/types/grant/works) for Yale-affiliated investigators. Each
 * record is deposited by the funder itself and resolves to the funder's own public award
 * page, so it reaches private and international funders no federal lane covers.
 *
 * A grant proves that a person is funded, never that a research row should exist, so
 * this lane only enriches the existing row the canonical resolver names for a Yale lead
 * investigator who resolves to exactly one researcher, and never mints one (#3145).
 * The investigator's ORCID decides first. A fellowship or salary award names the
 * trainee rather than the lab head, so it attaches only through an ORCID match. A
 * `facilities` record is an instrument-time allocation rather than funding and is never
 * attached.
 *
 * Fail-closed: an unreachable or unreadable page, or a cursor walk that serves fewer
 * records than Crossref reports, leaves the corpus incomplete, so the run writes nothing
 * rather than an undercount (#4593).
 */
import axios from 'axios';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { ssrfSafeAgents } from '../../utils/ssrfGuard';
import { getCached, setCached } from '../snapshotCache';
import {
  resolveCanonicalResearchHomeForResearcher,
  type CanonicalResearchHomeResolution,
} from '../canonicalResearchHomeResolver';
import {
  resolveResearcherIdForOrcid,
  resolveResearcherIdForPersonName,
  type ResearcherPersonNameResolution,
} from '../../services/researcherPersonNameResolver';
import {
  countGrantAttach,
  emptyGrantAttachTally,
  grantAttachSummary,
  resolveGrantEnrichmentTarget,
  type GrantPersonResolution,
} from '../utils/grantEnrichmentTarget';
import { grantAwardIdentity } from '../utils/grantAwardIdentity';
import { recentGrantPeriodsOf } from '../utils/recentGrantPeriods';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import { retryOnRetryableStatus } from '../utils/httpFetch';

export const CROSSREF_GRANT_WORKS_URL = 'https://api.crossref.org/types/grant/works';
const DOI_RESOLVER = 'https://doi.org/';
const YALE_ROR = 'https://ror.org/03v76x132';
const AFFILIATION_QUERY = 'yale';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 60_000;
const PAGE_ROWS = 1000;
const MAX_PAGES = 20;
const DEFAULT_LOOKBACK_YEARS = 6;
const MAX_GRANTS_PER_ROW = 10;
const NON_FUNDING_TYPES = new Set(['facilities']);
const TRAINEE_FUNDING_TYPES = new Set(['fellowship', 'salary-award']);
// Adding a federal lane to GRANT_LANE_SOURCE_NAMES requires adding its funder here, or
// an award both lanes report counts twice under two agency labels.
const FEDERAL_LANE_FUNDER_DOIS = new Set([
  '10.13039/100000001',
  '10.13039/100000002',
  '10.13039/100000015',
  '10.13039/100000048',
]);
const FEDERAL_LANE_FUNDER_NAME =
  /^(?:u\.?\s?s\.?\s+|united states\s+)?(?:department of energy|national science foundation|national endowment for the humanities|national institutes of health)$/i;

interface CrossrefDateParts {
  'date-parts'?: unknown[][];
}

interface CrossrefAffiliation {
  name?: string;
  id?: Array<{ id?: string; 'id-type'?: string }>;
}

export interface CrossrefInvestigator {
  given?: string;
  family?: string;
  ORCID?: string;
  affiliation?: CrossrefAffiliation[];
}

interface CrossrefFunding {
  type?: string;
  funder?: { name?: string; id?: Array<{ id?: string }> };
}

interface CrossrefProject {
  'project-title'?: Array<{ title?: string }>;
  'project-description'?: Array<{ description?: string }>;
  'award-amount'?: { amount?: number; currency?: string };
  'award-start'?: CrossrefDateParts;
  'award-end'?: CrossrefDateParts;
  funding?: CrossrefFunding[];
  'lead-investigator'?: CrossrefInvestigator[];
}

export interface CrossrefGrantItem {
  DOI?: string;
  award?: string;
  'award-start'?: CrossrefDateParts;
  project?: CrossrefProject[];
}

export interface CrossrefGrantPage {
  items: CrossrefGrantItem[];
  totalResults: number;
  nextCursor?: string;
}

export interface CrossrefGrant {
  doi: string;
  awardNumber: string;
  funderName: string;
  title: string;
  description: string;
  startDate?: Date;
  endDate?: Date;
  amountUsd?: number;
  lead: { given: string; family: string; orcid?: string };
  traineeAward: boolean;
}

export type CrossrefGrantRefusal =
  | 'nonFunding'
  | 'federalFunder'
  | 'noYaleLead'
  | 'noFunder'
  | 'noAwardNumber'
  | 'undated'
  | 'outsideWindow';

export type CrossrefGrantExtraction =
  { kind: 'grant'; grant: CrossrefGrant } | { kind: 'refused'; reason: CrossrefGrantRefusal };

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

const CONTROL_CHARACTERS = /\p{Cc}/gu;

export function parseCrossrefGrantPage(text: string): CrossrefGrantPage | null {
  let body: any;
  try {
    body = JSON.parse(text.replace(CONTROL_CHARACTERS, ' '));
  } catch {
    return null;
  }
  const message = body?.message;
  if (!message || !Array.isArray(message.items)) return null;
  const totalResults = Number(message['total-results']);
  if (!Number.isSafeInteger(totalResults) || totalResults < 0) return null;
  const nextCursor =
    typeof message['next-cursor'] === 'string' ? message['next-cursor'] : undefined;
  return { items: message.items, totalResults, nextCursor };
}

export function crossrefPageUrl(cursor: string): string {
  const params = new URLSearchParams({
    'query.affiliation': AFFILIATION_QUERY,
    rows: String(PAGE_ROWS),
    cursor,
  });
  return `${CROSSREF_GRANT_WORKS_URL}?${params.toString()}`;
}

const collapseWhitespace = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export function isYaleAffiliation(affiliation: CrossrefAffiliation): boolean {
  if ((affiliation.id ?? []).some((entry) => entry.id === YALE_ROR)) return true;
  const name = collapseWhitespace(affiliation.name);
  return /\byale\b/i.test(name) && !/yale[-\s]*nus|new haven hospital/i.test(name);
}

export function yaleLeadInvestigator(project: CrossrefProject): CrossrefInvestigator | undefined {
  return (project['lead-investigator'] ?? []).find((investigator) =>
    (investigator.affiliation ?? []).some(isYaleAffiliation),
  );
}

export function crossrefDate(value: CrossrefDateParts | undefined): Date | undefined {
  const parts = value?.['date-parts']?.[0];
  if (!Array.isArray(parts) || parts.length === 0) return undefined;
  const [year, month = 1, day = 1] = parts.map(Number);
  if (!Number.isInteger(year) || year < 1900) return undefined;
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export function isFederalLaneFunder(funder: CrossrefFunding['funder']): boolean {
  if (
    (funder?.id ?? []).some((entry) => FEDERAL_LANE_FUNDER_DOIS.has(collapseWhitespace(entry.id)))
  ) {
    return true;
  }
  return FEDERAL_LANE_FUNDER_NAME.test(collapseWhitespace(funder?.name));
}

export function extractCrossrefGrant(
  item: CrossrefGrantItem,
  cutoffYear: number,
): CrossrefGrantExtraction {
  const project = item.project?.[0] ?? {};
  const fundingTypes = (project.funding ?? []).map((funding) =>
    collapseWhitespace(funding.type).toLowerCase(),
  );
  if (fundingTypes.some((type) => NON_FUNDING_TYPES.has(type))) {
    return { kind: 'refused', reason: 'nonFunding' };
  }
  if ((project.funding ?? []).some((funding) => isFederalLaneFunder(funding.funder))) {
    return { kind: 'refused', reason: 'federalFunder' };
  }
  const lead = yaleLeadInvestigator(project);
  const family = collapseWhitespace(lead?.family);
  if (!lead || !family) return { kind: 'refused', reason: 'noYaleLead' };
  const funderName = collapseWhitespace(project.funding?.[0]?.funder?.name);
  if (!funderName) return { kind: 'refused', reason: 'noFunder' };
  const awardNumber = collapseWhitespace(item.award);
  const doi = collapseWhitespace(item.DOI);
  if (!awardNumber || !doi) return { kind: 'refused', reason: 'noAwardNumber' };
  const startDate = crossrefDate(project['award-start'] ?? item['award-start']);
  const endDate = crossrefDate(project['award-end']);
  const windowDate = endDate ?? startDate;
  if (!windowDate) return { kind: 'refused', reason: 'undated' };
  if (windowDate.getUTCFullYear() < cutoffYear) return { kind: 'refused', reason: 'outsideWindow' };
  const amount = project['award-amount'];
  const amountUsd =
    amount?.currency?.toUpperCase() === 'USD' &&
    typeof amount.amount === 'number' &&
    Number.isFinite(amount.amount) &&
    amount.amount > 0
      ? amount.amount
      : undefined;
  return {
    kind: 'grant',
    grant: {
      doi,
      awardNumber,
      funderName,
      title: collapseWhitespace(project['project-title']?.[0]?.title),
      description: collapseWhitespace(project['project-description']?.[0]?.description),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
      ...(amountUsd !== undefined ? { amountUsd } : {}),
      lead: {
        given: collapseWhitespace(lead.given),
        family,
        ...(lead.ORCID ? { orcid: lead.ORCID } : {}),
      },
      traineeAward: fundingTypes.some((type) => TRAINEE_FUNDING_TYPES.has(type)),
    },
  };
}

export function crossrefGrantUrl(doi: string): string {
  return `${DOI_RESOLVER}${doi}`;
}

export function grantToRecord(grant: CrossrefGrant): RecentGrantRecord {
  return {
    id: grant.awardNumber,
    agency: grant.funderName,
    title: grant.title,
    abstract: grant.description,
    startDate: grant.startDate,
    endDate: grant.endDate,
    dollarAmount: grant.amountUsd,
    url: crossrefGrantUrl(grant.doi),
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

export interface RowGrants {
  slug: string;
  researcherIds: Set<string>;
  grants: CrossrefGrant[];
}

export function buildResearchEntityObservations(row: RowGrants): ObservationInput[] {
  const byIdentity = new Map<string, RecentGrantRecord>();
  for (const grant of row.grants) {
    const record = grantToRecord(grant);
    const identity = grantAwardIdentity(record);
    if (identity && !byIdentity.has(identity)) byIdentity.set(identity, record);
  }
  const records = [...byIdentity.values()];
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: row.slug,
    sourceUrl: CROSSREF_GRANT_WORKS_URL,
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
    {
      ...base,
      field: 'fundingAgencies',
      value: Array.from(new Set(records.map((record) => record.agency))).sort(),
    },
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
      confidenceOverride: 0.7,
    });
  }
  return out;
}

async function fetchCrossrefGrantPage(
  cursor: string,
  useCache: boolean,
  sourceName: string,
): Promise<string> {
  const cacheKey = `grant-works:affiliation=${AFFILIATION_QUERY}:rows=${PAGE_ROWS}:cursor=${cursor}`;
  if (useCache) {
    const cached = await getCached<{ text: string }>(sourceName, cacheKey);
    if (cached) return cached.text;
  }
  const agents = ssrfSafeAgents();
  const res = await retryOnRetryableStatus(() =>
    axios.get(crossrefPageUrl(cursor), {
      timeout: FETCH_TIMEOUT_MS,
      httpAgent: agents.httpAgent,
      httpsAgent: agents.httpsAgent,
      responseType: 'text',
      transformResponse: [(data) => data],
      maxRedirects: 0,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    }),
  );
  const text = typeof res.data === 'string' ? res.data : String(res.data ?? '');
  if (useCache) await setCached(sourceName, cacheKey, { text });
  return text;
}

const asGrantPerson = (resolution: ResearcherPersonNameResolution): GrantPersonResolution => {
  if (resolution.status === 'ambiguous') return { status: 'ambiguous' };
  if (resolution.status === 'matched' && resolution.researcherId) {
    return { status: 'matched', userId: resolution.researcherId.toString() };
  }
  return { status: 'absent' };
};

export interface CrossrefGrantScraperDeps {
  fetchPage?: typeof fetchCrossrefGrantPage;
  resolveByName?: typeof resolveResearcherIdForPersonName;
  resolveByOrcid?: typeof resolveResearcherIdForOrcid;
  researchHomeResolver?: (researcherId: string) => Promise<CanonicalResearchHomeResolution>;
  lookbackYears?: number;
  currentYear?: number;
}

export type CrossrefCorpusRead =
  | { kind: 'complete'; items: CrossrefGrantItem[]; pages: number; totalResults: number }
  | { kind: 'incomplete'; reason: string; pages: number };

export async function readCrossrefGrantCorpus(
  fetchPage: (cursor: string) => Promise<string>,
): Promise<CrossrefCorpusRead> {
  const items: CrossrefGrantItem[] = [];
  let cursor = '*';
  for (let page = 1; page <= MAX_PAGES; page++) {
    let text: string;
    try {
      text = await fetchPage(cursor);
    } catch (err: unknown) {
      return {
        kind: 'incomplete',
        reason: `page ${page} unreachable: ${sanitizeLogValue(err)}`,
        pages: page - 1,
      };
    }
    const parsed = parseCrossrefGrantPage(text);
    if (!parsed) return { kind: 'incomplete', reason: `page ${page} unreadable`, pages: page - 1 };
    const { totalResults } = parsed;
    items.push(...parsed.items);
    if (items.length >= totalResults || parsed.items.length === 0) {
      if (items.length < totalResults) {
        return {
          kind: 'incomplete',
          reason: `served ${items.length} of ${totalResults} reported records`,
          pages: page,
        };
      }
      return { kind: 'complete', items, pages: page, totalResults };
    }
    if (!parsed.nextCursor) {
      return { kind: 'incomplete', reason: `page ${page} carried no next cursor`, pages: page };
    }
    cursor = parsed.nextCursor;
  }
  return { kind: 'incomplete', reason: `page cap ${MAX_PAGES} reached`, pages: MAX_PAGES };
}

const summarizeRefusals = (refusals: Record<CrossrefGrantRefusal, number>): string =>
  `${refusals.nonFunding} non-funding (facilities), ` +
  `${refusals.federalFunder} from a funder a federal lane reports, ${refusals.noYaleLead} no Yale lead investigator, ` +
  `${refusals.noFunder} no funder, ${refusals.noAwardNumber} no award number, ` +
  `${refusals.undated} undated, ${refusals.outsideWindow} outside the window`;

export class CrossrefGrantScraper implements IScraper {
  readonly name = 'crossref-grants';
  readonly displayName = 'Crossref grant records (funder-registered Yale grants)';

  constructor(private readonly deps: CrossrefGrantScraperDeps = {}) {}

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const fetchPage = this.deps.fetchPage ?? fetchCrossrefGrantPage;
    const resolveByName = this.deps.resolveByName ?? resolveResearcherIdForPersonName;
    const resolveByOrcid = this.deps.resolveByOrcid ?? resolveResearcherIdForOrcid;
    const researchHomeResolver =
      this.deps.researchHomeResolver ?? resolveCanonicalResearchHomeForResearcher;
    const lookbackYears = this.deps.lookbackYears ?? DEFAULT_LOOKBACK_YEARS;
    const currentYear = this.deps.currentYear ?? new Date().getFullYear();
    const cutoffYear = currentYear - lookbackYears;

    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }
    const grantLimit = limitOption ?? Infinity;

    ctx.log(
      `Reading Crossref grant records with a "${AFFILIATION_QUERY}" investigator affiliation`,
    );
    const corpus = await readCrossrefGrantCorpus((cursor) =>
      fetchPage(cursor, ctx.options.useCache, this.name),
    );
    if (corpus.kind === 'incomplete') {
      const notes = `Crossref grant corpus incomplete after ${corpus.pages} page(s) (${corpus.reason}); failed closed with no writes rather than undercount grants`;
      ctx.log(notes);
      return { observationCount: 0, entitiesObserved: 0, notes, failedClosed: true };
    }

    const refusals: Record<CrossrefGrantRefusal, number> = {
      nonFunding: 0,
      federalFunder: 0,
      noYaleLead: 0,
      noFunder: 0,
      noAwardNumber: 0,
      undated: 0,
      outsideWindow: 0,
    };
    const grants: CrossrefGrant[] = [];
    for (const item of corpus.items) {
      const extraction = extractCrossrefGrant(item, cutoffYear);
      if (extraction.kind === 'refused') refusals[extraction.reason]++;
      else grants.push(extraction.grant);
    }
    ctx.log(
      `Admitted ${grants.length} of ${corpus.items.length} grant record(s) ending since ${cutoffYear}`,
    );

    const attach = emptyGrantAttachTally();
    let traineeAwardsWithoutOrcidMatch = 0;
    let resolvedByOrcid = 0;
    let processed = 0;
    const rows = new Map<string, RowGrants>();
    for (const grant of grants) {
      if (processed >= grantLimit) break;
      processed++;
      const claimedName = `${grant.lead.given} ${grant.lead.family}`.trim();
      const byOrcid = await resolveByOrcid(grant.lead.orcid, claimedName);
      if (byOrcid.status === 'matched') resolvedByOrcid++;
      let person: ResearcherPersonNameResolution = byOrcid;
      if (byOrcid.status === 'absent') {
        if (grant.traineeAward) {
          traineeAwardsWithoutOrcidMatch++;
          continue;
        }
        person = await resolveByName(claimedName);
      }
      const target = await resolveGrantEnrichmentTarget(
        asGrantPerson(person),
        researchHomeResolver,
      );
      countGrantAttach(attach, target);
      if (target.status !== 'enrich') continue;
      const row = rows.get(target.slug) ?? {
        slug: target.slug,
        researcherIds: new Set(),
        grants: [],
      };
      row.researcherIds.add(target.researcherId);
      row.grants.push(grant);
      rows.set(target.slug, row);
    }

    let totalObs = 0;
    for (const row of rows.values()) {
      const observations = buildResearchEntityObservations(row);
      await ctx.emit(observations);
      totalObs += observations.length;
    }

    const notes =
      `Crossref grant records: ${corpus.items.length} read over ${corpus.pages} page(s); ` +
      `admitted ${grants.length} ending since ${cutoffYear}; refused ${summarizeRefusals(refusals)}; ` +
      `${processed} processed, ${resolvedByOrcid} resolved by ORCID, ` +
      `${traineeAwardsWithoutOrcidMatch} fellowship or salary award(s) skipped without an ORCID match; ` +
      `${rows.size} distinct row(s) enriched; ${grantAttachSummary(attach)}`;
    ctx.log(`Emitted ${totalObs} observations. ${notes}`);
    return { observationCount: totalObs, entitiesObserved: rows.size, notes };
  }
}
