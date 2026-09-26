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

/**
 * Whether an edit of the query continues the search before it on this surface.
 *
 * This is not whether the surface collapses repeats at all: an identical query
 * with an identical filter set is one search everywhere, because re-running a
 * result set - which a sort change does - is not asking again.
 *
 * What differs is an edit. The programs surface searches from a 500ms debounce
 * with no submit affordance, so a student who pauses mid-word records the
 * partial string and that snapshot belongs to the query being typed. Every
 * research search comes from a submit, a filter click, a sort change, a deep
 * link, or a result chip, so an edited query there is a second question the
 * student deliberately asked: folding it would erase the first, including the
 * zero-result row the report exists to surface.
 */
const SITE_SEARCH_SURFACE_FOLDS_QUERY_EDITS: Record<SiteSearchSurface, boolean> = {
  program: true,
  research_entity: false,
};

export const foldsQueryEdits = (surface: SiteSearchSurface): boolean =>
  SITE_SEARCH_SURFACE_FOLDS_QUERY_EDITS[surface] === true;

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
  // When the student's request arrived, captured before the search ran. Two
  // searches typed in order can finish out of order, so completion time would
  // let a stale partial query outrank the one they settled on.
  requestArrivedAt?: Date;
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
 * with it. Accepting that suggestion is a real search and is recorded normally.
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
      occurredAt: record.requestArrivedAt,
      foldQueryEdits: foldsQueryEdits(record.surface),
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
