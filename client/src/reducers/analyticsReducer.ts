/**
 * Pure reducer for the analytics dashboard page.
 *
 * Models the fetch lifecycle (loading → loaded/error) so the page's state
 * transitions can be unit-tested without mounting React or mocking axios.
 *
 * On FETCH_FAILURE we deliberately preserve any previously-loaded data
 * (stale-over-empty invariant): a failed refresh should not wipe the
 * dashboard the user is already looking at.
 */

export interface AnalyticsData {
  visitors: {
    lifetime: {
      total: number;
      byType: Array<{ userType: string; count: number }>;
    };
    last7Days: {
      total: number;
      byType: Array<{ userType: string; count: number }>;
    };
    today: {
      total: number;
      byType: Array<{ userType: string; count: number }>;
    };
    loginFrequency: {
      totalLogins: number;
      loginsLast7Days: number;
      loginsToday: number;
    };
  };
  engagement: {
    search: {
      totalSearches: number;
      searchesLast7Days: number;
      searchesToday: number;
    };
    topSearchQueries: Array<{ query: string; count: number }>;
    views: {
      totalViews: number;
      viewsLast7Days: number;
      viewsToday: number;
    };
    favorites: Array<{ eventType: string; total: number; last7Days: number }>;
    trendingListings: Array<any>;
    userActivity: {
      activeUsers: number;
      avgEventsPerUser: number;
    };
    mostActiveUsers: Array<{ userId: string; userType: string; eventCount: number }>;
    totalViewsFromCounters: number;
    totalFavoritesFromCounters: number;
    avgViews: number;
    avgFavorites: number;
    viewsByDepartment: Array<{
      department: string;
      totalViews: number;
      listingCount: number;
      avgViews: number;
    }>;
  };
  listings: {
    overview: {
      total: number;
      active: number;
      archived: number;
      unconfirmed: number;
    };
    newListingsLast7Days: number;
    newListingsToday: number;
    byDepartment: Array<{ department: string; count: number }>;
    byProfessor: Array<{ professorName: string; netId: string; count: number }>;
    listingsWithZeroViews: number;
    topViewedListings: Array<any>;
    topFavoritedListings: Array<any>;
  };
  users: {
    overview: { total: number; confirmed: number };
    byType: Array<{ userType: string; count: number }>;
    newUsersLast7Days: number;
    newUsersToday: number;
    newUsersTodayByType: Array<{ userType: string; count: number }>;
  };
  timestamp: string;
}

export interface AnalyticsState {
  data: AnalyticsData | null;
  isLoading: boolean;
  lastUpdated: string;
  error: string | null;
}

export type AnalyticsAction =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; payload: { data: AnalyticsData; timestamp: string } }
  | { type: 'FETCH_FAILURE'; payload: string };

export const createInitialAnalyticsState = (
  overrides: Partial<AnalyticsState> = {}
): AnalyticsState => ({
  data: null,
  isLoading: true,
  lastUpdated: '',
  error: null,
  ...overrides,
});

export function analyticsReducer(state: AnalyticsState, action: AnalyticsAction): AnalyticsState {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, isLoading: true, error: null };

    case 'FETCH_SUCCESS':
      return {
        ...state,
        isLoading: false,
        error: null,
        data: action.payload.data,
        lastUpdated: action.payload.timestamp,
      };

    case 'FETCH_FAILURE':
      // Preserve stale data + lastUpdated — the user keeps seeing the last
      // successful snapshot instead of being bounced to an empty dashboard.
      return {
        ...state,
        isLoading: false,
        error: action.payload,
      };

    default:
      return state;
  }
}
