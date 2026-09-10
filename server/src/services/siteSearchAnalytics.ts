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
  metadata?: Record<string, unknown>;
}

export const hasActiveSiteSearchFilters = (filters: SiteSearchFilters): boolean =>
  Object.values(filters).some((values) => Array.isArray(values) && values.length > 0);

/**
 * A search is worth recording when a signed-in student asked for something on
 * the first page of results.
 *
 * Page 2 and beyond are the same search being paged through, and the programs
 * surface walks every page in a loop, so logging per request turns one search
 * into as many events as the result set has pages. An empty query with no
 * filters is an unfiltered browse load, not a search.
 */
export const shouldRecordSiteSearch = (record: SiteSearchRecord): boolean => {
  if (!record.netid) return false;
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
      metadata: {
        entityType: record.surface,
        resultCount: record.resultCount,
        filters: activeFilters,
        page: record.page,
        ...record.metadata,
      },
    });
  } catch (error) {
    console.error('Error logging site search event:', sanitizeLogValue(error));
    return false;
  }

  return true;
};
