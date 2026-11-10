import axios from 'axios';
import { Researcher } from '../../models/researcher';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import { retryOnRetryableStatus } from '../utils/httpFetch';
import { filledProjectYearsBy, parseTobinRaBoard, TOBIN_RA_BOARD_URL } from '../utils/tobinRaBoard';
import {
  buildObservationsForAdvisor,
  existingLeadRowSlugForOwner,
  researcherToUserMatch,
} from './undergradFellowshipRecipientScraper';

export const TOBIN_RA_PROJECTS_SOURCE = 'tobin-ra-projects';

const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;

export type SponsorRowResolver = (sponsorProfileUrl: string) => Promise<string | null>;

export interface TobinRaProjectsScraperDeps {
  fetchHtml?: (url: string, useCache: boolean) => Promise<string>;
  sponsorRowSlug?: SponsorRowResolver;
}

async function defaultFetchHtml(url: string, useCache: boolean): Promise<string> {
  const safeUrlText = (await assertPublicHttpUrl(url)).toString();
  const cacheKey = `page:${safeUrlText}`;
  if (useCache) {
    const cached = await getCached<string>(TOBIN_RA_PROJECTS_SOURCE, cacheKey);
    if (cached) return cached;
  }
  const agents = ssrfSafeAgents();
  const response = await retryOnRetryableStatus(() =>
    axios.get(safeUrlText, {
      timeout: FETCH_TIMEOUT_MS,
      headers: { 'User-Agent': USER_AGENT },
      maxRedirects: 5,
      httpAgent: agents.httpAgent,
      httpsAgent: agents.httpsAgent,
    }),
  );
  const html = String(response.data ?? '');
  if (useCache) await setCached(TOBIN_RA_PROJECTS_SOURCE, cacheKey, html);
  return html;
}

const profileUrlVariants = (url: string): string[] => [
  url,
  `${url}/`,
  url.replace(/^https:\/\//, 'http://'),
  `${url.replace(/^https:\/\//, 'http://')}/`,
];

/** A sponsor resolves only by an exact profile URL on a live researcher, never by name. */
export const defaultSponsorRowSlug: SponsorRowResolver = async (sponsorProfileUrl) => {
  const holders: any[] = await Researcher.find({
    archived: { $ne: true },
    'profileLinks.url': { $in: profileUrlVariants(sponsorProfileUrl) },
  })
    .select('_id displayName profile identifiers')
    .limit(2)
    .lean();
  if (holders.length !== 1) return null;
  return existingLeadRowSlugForOwner(researcherToUserMatch(holders[0], ''));
};

/**
 * Tobin Undergraduate Research Assistantships pair a Yale College student with an economics
 * faculty sponsor. A filled project is evidence the sponsor has hosted an undergraduate, so
 * it becomes a name-free `pastUndergradAdvisees` entry on the row that sponsor leads (#3551).
 * The board is an archive of every semester; the lane asserts nothing about open projects.
 */
export class TobinRaProjectsScraper implements IScraper {
  readonly name = TOBIN_RA_PROJECTS_SOURCE;
  readonly displayName = 'Tobin Undergraduate Research Assistantships';
  private readonly fetchHtml: (url: string, useCache: boolean) => Promise<string>;
  private readonly sponsorRowSlug: SponsorRowResolver;

  constructor(deps: TobinRaProjectsScraperDeps = {}) {
    this.fetchHtml = deps.fetchHtml ?? defaultFetchHtml;
    this.sponsorRowSlug = deps.sponsorRowSlug ?? defaultSponsorRowSlug;
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    ctx.log(`Fetching ${TOBIN_RA_BOARD_URL}`);
    let html: string;
    try {
      html = await this.fetchHtml(TOBIN_RA_BOARD_URL, ctx.options.useCache);
    } catch (error) {
      throw new Error(`Tobin RA board fetch failed: ${sanitizeLogValue(error)}`);
    }
    const board = parseTobinRaBoard(html);
    if (board.projectBlocks === 0) {
      throw new Error('Tobin RA board listed no project blocks; refusing to treat it as empty.');
    }

    const yearsBySponsor = filledProjectYearsBy(board.projects);
    const rowSlugBySponsor = new Map<string, string | null>();
    for (const sponsorUrl of yearsBySponsor.keys()) {
      rowSlugBySponsor.set(sponsorUrl, await this.sponsorRowSlug(sponsorUrl));
    }
    const unmatchedSponsors = [...rowSlugBySponsor.values()].filter((slug) => !slug).length;
    const yearsByRow = filledProjectYearsBy(
      board.projects,
      (sponsorUrl) => rowSlugBySponsor.get(sponsorUrl) ?? null,
    );

    let observationCount = 0;
    for (const [slug, years] of yearsByRow) {
      const observations: ObservationInput[] = buildObservationsForAdvisor(
        slug,
        years,
        TOBIN_RA_BOARD_URL,
      );
      await ctx.emit(observations);
      observationCount += observations.length;
    }

    const filledProjects = board.projects.filter((project) => project.filled).length;
    return {
      observationCount,
      entitiesObserved: yearsByRow.size,
      notes: [
        `projects=${board.projects.length}`,
        `filled=${filledProjects}`,
        `sponsorsWithFilledProjects=${yearsBySponsor.size}`,
        `sponsorsUnmatched=${unmatchedSponsors}`,
        `rowsEmitted=${yearsByRow.size}`,
      ].join(' '),
    };
  }
}
