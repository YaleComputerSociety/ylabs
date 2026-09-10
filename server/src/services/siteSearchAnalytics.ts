/**
 * Records the searches a student actually performed on a discovery surface.
 *
 * Both search surfaces run live: results refresh from a debounce or a submit
 * without the request itself carrying any notion of intent. So the decision of
 * what counts as a search lives here rather than in each route, and the typing
 * states that lead up to a search are folded together downstream by
 * `logEvent`'s search-episode supersede.
 */
import { logEvent } from './analyticsService';
import { AnalyticsEventType } from '../models/index';
import { sanitizeLogValue } from '../utils/logSanitizer';

export type SiteSearchSurface = 'program' | 'research_entity';

export interface SiteSearchFilters {
  [key: string]: string[] | undefined;
}

export interface SiteSearchRecord {
  netid?: string;
  userType?: string;
  surface: SiteSearchSurface;
  searchQuery: string;
  filters: SiteSearchFilters;
  resultCount: number;
  page: number;
  suggestionProbe?: boolean;
  startsNewSearchEpisode?: boolean;
  metadata?: Record<string, unknown>;
}

export const hasActiveSiteSearchFilters = (filters: SiteSearchFilters): boolean =>
  Object.values(filters).some((values) => Array.isArray(values) && values.length > 0);

/**
 * The page a search request was served, preferring what the response reported
 * over what the request asked for.
 *
 * Reporting page 1 for a later page would record the same search again for every
 * page of a walk, so an unreadable page number resolves to the requested one
 * rather than to the default that `shouldRecordSiteSearch` counts.
 */
export const resolveSiteSearchPage = (responsePage: unknown, requestedPage: unknown): number => {
  if (typeof responsePage === 'number' && Number.isFinite(responsePage)) return responsePage;
  const requested = Number.parseInt(String(requestedPage ?? ''), 10);
  return Number.isFinite(requested) && requested > 0 ? requested : 1;
};

/**
 * A search is worth recording when a signed-in student asked for something on
 * the first page of results.
 *
 * Page 2 and beyond are the same search being paged through, and the programs
 * surface walks every page in a loop, so logging per request turns one search
 * into as many events as the result set has pages. An empty query with no
 * filters is an unfiltered browse load, not a search.
 *
 * A suggestion probe is the page itself asking whether a query the student never
 * typed would have matched anything, so recording it would both invent a query
 * and let the episode supersede overwrite the student's real zero-result search
 * with it. Accepting that suggestion is a real search, and it sets
 * `startsNewSearchEpisode` instead so the fold cannot swallow the zero-result row
 * the suggestion came from.
 */
export const shouldRecordSiteSearch = (record: SiteSearchRecord): boolean => {
  if (!record.netid) return false;
  if (record.suggestionProbe) return false;
  if (record.page !== 1) return false;
  return record.searchQuery.trim() !== '' || hasActiveSiteSearchFilters(record.filters);
};

export const recordSiteSearch = async (record: SiteSearchRecord): Promise<boolean> => {
  if (!shouldRecordSiteSearch(record)) return false;

  const activeFilters = Object.fromEntries(
    Object.entries(record.filters).filter(
      ([, values]) => Array.isArray(values) && values.length > 0,
    ),
  );

  try {
    await logEvent({
      eventType: AnalyticsEventType.SEARCH,
      netid: record.netid as string,
      userType: record.userType ?? 'unknown',
      searchQuery: record.searchQuery,
      startsNewSearchEpisode: record.startsNewSearchEpisode === true,
      metadata: {
        ...record.metadata,
        entityType: record.surface,
        resultCount: record.resultCount,
        filters: activeFilters,
        page: record.page,
      },
    });
  } catch (error) {
    console.error('Error logging site search event:', sanitizeLogValue(error));
    return false;
  }

  return true;
};
