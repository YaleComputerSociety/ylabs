/**
 * Verifies each attached lead against the research home's own website.
 *
 * The engine already fetches lab microsites for descriptions; it never checks
 * whether the site names the researcher we attached as lead. A `<Surname> Lab`
 * page is exactly where a namesake collision lands, and the page itself usually
 * carries the answer - a lab-scoped `/profile/<person>` link, or prose naming its
 * own lead. This lane reads that and records a per-lead verdict.
 *
 * It writes ONLY the `leadVerification` field. No lead is attached, detached, or
 * suppressed here: acting on a contradiction is a separate change that needs its
 * own visibility re-gate (issue #2714).
 */
import axios from 'axios';
import { RoleAssignment } from '../../models/roleAssignment';
import { Researcher } from '../../models/researcher';
import { ResearchEntity } from '../../models/researchEntity';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import {
  LAB_SITE_LEAD_VERIFICATION_SOURCE,
  MAX_PEOPLE_SUBPAGES,
  buildLabSiteLeadVerification,
  peopleSubpageUrls,
  unreachableLabSiteVerification,
  type LabSiteLeadCandidate,
  type LabSiteLeadVerification,
} from '../utils/labSiteLeadVerification';

export { LAB_SITE_LEAD_VERIFICATION_SOURCE };

const VERIFIED_LEAD_ROLES = ['PI', 'CO_PI', 'DIRECTOR', 'CO_DIRECTOR'] as const;
const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';

export interface LabSiteVerificationCandidate {
  entityId: string;
  slug: string;
  website: string;
  leads: LabSiteLeadCandidate[];
}

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const firstHttpUrl = (...values: unknown[]): string =>
  values.map(textValue).find((value) => /^https?:\/\//i.test(value)) || '';

/**
 * Live entities that both publish a research home and claim a lead. An entity
 * with no website has nothing to check against, and one with no lead has nothing
 * to check.
 */
export async function readLabSiteVerificationCandidates(options: {
  only?: string[];
  limit?: number;
}): Promise<LabSiteVerificationCandidate[]> {
  const only = options.only?.map((value) => value.trim().toLowerCase()).filter(Boolean) || [];
  const entities = (await ResearchEntity.find(
    {
      archived: { $ne: true },
      $or: [{ website: /^https?:\/\//i }, { websiteUrl: /^https?:\/\//i }],
      ...(only.length ? { slug: { $in: only } } : {}),
    },
    { _id: 1, slug: 1, website: 1, websiteUrl: 1 },
  ).lean()) as Array<{ _id: unknown; slug?: string; website?: string; websiteUrl?: string }>;
  if (!entities.length) return [];

  const entityIds = entities.map((entity) => entity._id);
  const assignments = (await RoleAssignment.find(
    {
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': { $in: entityIds },
      archived: { $ne: true },
      role: { $in: [...VERIFIED_LEAD_ROLES] },
    },
    { personId: 1, role: 1, 'target.id': 1 },
  ).lean()) as unknown as Array<{ personId: unknown; role: string; target: { id: unknown } }>;
  if (!assignments.length) return [];

  const personIds = [...new Set(assignments.map((row) => String(row.personId)))];
  const researchers = (await Researcher.find(
    { _id: { $in: personIds } },
    { _id: 1, displayName: 1, profileLinks: 1 },
  ).lean()) as Array<{
    _id: unknown;
    displayName?: string;
    profileLinks?: Array<{ kind?: string; url?: string }>;
  }>;
  const byPersonId = new Map(researchers.map((person) => [String(person._id), person]));

  const leadsByEntityId = new Map<string, LabSiteLeadCandidate[]>();
  const seen = new Set<string>();
  for (const assignment of assignments) {
    const entityId = String(assignment.target?.id || '');
    const personId = String(assignment.personId || '');
    if (!entityId || !personId) continue;
    const dedupeKey = `${entityId}:${personId}:${assignment.role}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const person = byPersonId.get(personId);
    const displayName = textValue(person?.displayName);
    if (!displayName) continue;
    const officialProfileUrls = (person?.profileLinks || [])
      .filter((link) => link?.kind === 'YALE_OFFICIAL')
      .map((link) => textValue(link?.url))
      .filter(Boolean);
    leadsByEntityId.set(entityId, [
      ...(leadsByEntityId.get(entityId) || []),
      { personId, role: assignment.role, displayName, officialProfileUrls },
    ]);
  }

  const candidates: LabSiteVerificationCandidate[] = [];
  for (const entity of entities) {
    const entityId = String(entity._id);
    const leads = leadsByEntityId.get(entityId);
    const slug = textValue(entity.slug);
    const website = firstHttpUrl(entity.website, entity.websiteUrl);
    if (!leads?.length || !slug || !website) continue;
    candidates.push({ entityId, slug, website, leads });
  }
  candidates.sort((a, b) => a.slug.localeCompare(b.slug));
  return typeof options.limit === 'number' && options.limit > 0
    ? candidates.slice(0, options.limit)
    : candidates;
}

interface FetchedPage {
  html: string;
  finalUrl: string;
  httpStatusCode?: number;
}

async function fetchPage(url: string, useCache: boolean): Promise<FetchedPage> {
  const safeUrl = await assertPublicHttpUrl(url);
  const cacheKey = safeUrl.toString();
  if (useCache) {
    const cached = await getCached<FetchedPage>(LAB_SITE_LEAD_VERIFICATION_SOURCE, cacheKey);
    if (cached?.html) return cached;
  }
  const agents = ssrfSafeAgents();
  const response = await axios.get(cacheKey, {
    timeout: FETCH_TIMEOUT_MS,
    maxRedirects: 5,
    responseType: 'text',
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
  });
  const page: FetchedPage = {
    html: String(response.data || ''),
    finalUrl: cacheKey,
    httpStatusCode: response.status,
  };
  if (useCache) await setCached(LAB_SITE_LEAD_VERIFICATION_SOURCE, cacheKey, page);
  return page;
}

/**
 * Reads the research home plus a bounded set of its own people pages. A YSM lab
 * landing page usually does NOT name its PI - the members page does - so reading
 * the landing page alone reports a correct attachment as unstated.
 */
export async function readLabSite(
  website: string,
  useCache: boolean,
  fetcher: (url: string, useCache: boolean) => Promise<FetchedPage> = fetchPage,
): Promise<{ html: string; visitedUrls: string[]; httpStatusCode?: number } | null> {
  let landing: FetchedPage;
  try {
    landing = await fetcher(website, useCache);
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    return status ? { html: '', visitedUrls: [], httpStatusCode: status } : null;
  }
  if (!landing.html) return { html: '', visitedUrls: [], httpStatusCode: landing.httpStatusCode };
  const pages = [landing];
  for (const subpageUrl of peopleSubpageUrls(landing.html, landing.finalUrl, MAX_PEOPLE_SUBPAGES)) {
    try {
      const subpage = await fetcher(subpageUrl, useCache);
      if (subpage.html) pages.push(subpage);
    } catch {
      // A missing members page is not evidence about the lead, so it is skipped
      // rather than downgrading the landing page's own verdict.
    }
  }
  return {
    html: pages.map((page) => page.html).join('\n'),
    visitedUrls: pages.map((page) => page.finalUrl),
    httpStatusCode: landing.httpStatusCode,
  };
}

export function labSiteLeadVerificationObservation(
  slug: string,
  verification: LabSiteLeadVerification,
  observedAt: Date,
): ObservationInput {
  return {
    entityType: 'researchEntity',
    entityKey: slug,
    field: 'leadVerification',
    value: verification,
    sourceUrl: verification.checkedUrl,
    observedAt,
  };
}

export class LabSiteLeadVerificationScraper implements IScraper {
  readonly name = LAB_SITE_LEAD_VERIFICATION_SOURCE;
  readonly displayName = 'Lab-site lead verification';

  constructor(
    private readonly readCandidates: (options: {
      only?: string[];
      limit?: number;
    }) => Promise<LabSiteVerificationCandidate[]> = readLabSiteVerificationCandidates,
    private readonly readSite: (
      website: string,
      useCache: boolean,
    ) => Promise<{ html: string; visitedUrls: string[]; httpStatusCode?: number } | null> = (
      website,
      useCache,
    ) => readLabSite(website, useCache),
  ) {}

  async run(context: ScraperContext): Promise<ScraperResult> {
    const candidates = await this.readCandidates({
      only: context.options.only,
      limit: context.options.limit,
    });
    const tally = { verified: 0, partial: 0, contradicted: 0, unstated: 0, unreachable: 0 };
    let observationCount = 0;
    let contradictedLeads = 0;

    for (const candidate of candidates) {
      const observedAt = new Date();
      const reading = await this.readSite(candidate.website, context.options.useCache);
      const verification =
        reading && reading.html
          ? buildLabSiteLeadVerification(
              candidate.leads,
              {
                website: candidate.website,
                visitedUrls: reading.visitedUrls,
                html: reading.html,
                httpStatusCode: reading.httpStatusCode,
              },
              observedAt,
            )
          : unreachableLabSiteVerification(candidate.website, observedAt, reading?.httpStatusCode);
      tally[verification.state] += 1;
      contradictedLeads += verification.contradictedCount;
      await context.emit(
        labSiteLeadVerificationObservation(candidate.slug, verification, observedAt),
      );
      observationCount += 1;
      context.log(
        `${candidate.slug}: ${verification.state} (${verification.confirmedCount} confirmed, ${verification.contradictedCount} contradicted, ${verification.unstatedCount} unstated across ${verification.pagesRead} pages)`,
      );
    }

    return {
      observationCount,
      entitiesObserved: candidates.length,
      notes:
        `verified=${tally.verified}; partial=${tally.partial}; contradicted=${tally.contradicted}; ` +
        `unstated=${tally.unstated}; unreachable=${tally.unreachable}; contradictedLeads=${contradictedLeads}. ` +
        'Records verdicts only; no lead is attached, detached, or suppressed.',
    };
  }
}
