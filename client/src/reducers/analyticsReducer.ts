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
    outreach: {
      summary: {
        totalReveals: number;
        totalAttempts: number;
        totalOutcomes: number;
        revealsLast7Days: number;
        attemptsLast7Days: number;
        outcomesLast7Days: number;
      };
      byOutcome: Array<{ outcome: string; count: number; last7Days: number }>;
      topListings: Array<{
        listingId: string;
        title?: string;
        ownerFirstName?: string;
        ownerLastName?: string;
        departments: string[];
        reveals: number;
        attempts: number;
        outcomes: number;
        uniqueUsers: number;
        lastEventAt: string;
      }>;
      recentEvents: Array<{
        eventType: string;
        netid: string;
        userType: string;
        listingId: string;
        title?: string;
        ownerFirstName?: string;
        ownerLastName?: string;
        outcome?: string;
        channel?: string;
        timestamp: string;
      }>;
    };
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
    opportunityViewDataHealth?: {
      opportunityViewEventsLast30Days: number;
      resolvedOpportunityViewEventsLast30Days: number;
      orphanedOpportunityViewEventsLast30Days: number;
      orphanedOpportunityIds: string[];
    };
  };
  research: {
    byEventType: Array<{ eventType: string; total: number; last7Days: number; today: number }>;
    byEntityType: Array<{ entityType: string; eventType: string; count: number }>;
    byUserType: Array<{ userType: string; count: number }>;
    topEntities: Array<{
      entityType: string;
      entityId: string;
      views: number;
      uniqueViewers: number;
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
  researchEntities: {
    overview: { active: number; archived: number; total: number };
    byType: Array<{ entityType: string; count: number }>;
    byVisibilityTier: Array<{ tier: string; count: number }>;
    byOpenness: Array<{ status: string; count: number }>;
    freshness: {
      observedLast7Days: number;
      observedLast30Days: number;
      neverObserved: number;
      staleOver90Days: number;
    };
    scholarly: {
      withRecentPapers: number;
      withRecentGrants: number;
    };
  };
  timestamp: string;
}

export interface AnalyticsUserActivityRow {
  netid: string;
  userType: string;
  fname?: string;
  lname?: string;
  email?: string;
  totalEvents: number;
  logins: number;
  searches: number;
  views: number;
  fellowshipViews: number;
  listingFavorites: number;
  listingUnfavorites: number;
  fellowshipFavorites: number;
  fellowshipUnfavorites: number;
  outreachClicks: number;
  outreachOutcomes: number;
  listingCreates: number;
  listingUpdates: number;
  listingArchives: number;
  listingUnarchives: number;
  profileUpdates: number;
  loginCount: number;
  lastEventAt?: string | null;
  lastLogin?: string | null;
  lastActive: string | null;
  firstSeen?: string | null;
}

export interface AnalyticsUserEvent {
  id?: string;
  _id?: string;
  eventType: string;
  timestamp: string;
  listingId?: string;
  fellowshipId?: string;
  searchQuery?: string;
  searchDepartments?: string[];
  metadata?: Record<string, unknown>;
}

export interface AnalyticsUserActivityResponse {
  users: AnalyticsUserActivityRow[];
  total: number;
  limit: number;
}

export interface AnalyticsUserDrilldownResponse {
  user: AnalyticsUserActivityRow;
  events: AnalyticsUserEvent[];
  limit: number;
}

export interface AdminAccessUser {
  netid: string;
  fname?: string;
  lname?: string;
  email?: string;
  userType?: string;
}

export interface AdminAccessGrant {
  netid: string;
  status: 'active' | 'revoked';
  source: 'bootstrap' | 'manual' | 'migration';
  grantedBy?: string;
  grantedAt?: string | null;
  revokedBy?: string;
  revokedAt?: string | null;
  note?: string;
  user?: AdminAccessUser;
}

export interface AdminAccessResponse {
  activeCount: number;
  grants: AdminAccessGrant[];
  legacyAdminsWithoutGrant: AdminAccessUser[];
}

export type AnalyticsRange = 'today' | '7d' | '30d' | 'semester' | 'all';

export interface AnalyticsSearchQualityQuery {
  query: string;
  count?: number;
  totalSearches?: number;
  zeroResults?: number;
  zeroResultSearches?: number;
  entityType?: string;
  avgResults?: number;
  avgResultCount?: number;
  avgResultsPerSearch?: number;
  lastSearchedAt?: string | null;
}

export interface AnalyticsSearchQualityResponse {
  range?: AnalyticsRange;
  totalSearches?: number;
  searchesWithResults?: number;
  zeroResultSearches?: number;
  zeroResultRate?: number;
  avgResults?: number;
  avgResultsPerSearch?: number;
  avgLatencyMs?: number;
  topQueries?: AnalyticsSearchQualityQuery[];
  zeroResultQueries?: AnalyticsSearchQualityQuery[];
  topZeroResultQueries?: AnalyticsSearchQualityQuery[];
  lowResultQueries?: AnalyticsSearchQualityQuery[];
}

export interface AnalyticsSearchQuerySearcher {
  netid: string;
  userType: string;
  fname?: string;
  lname?: string;
  email?: string;
  searchCount: number;
  lastSearchedAt?: string | null;
}

export interface AnalyticsSearchQueryRow {
  query: string;
  totalSearches: number;
  uniqueSearchers: number;
  zeroResultSearches?: number;
  avgResultCount?: number;
  lastSearchedAt?: string | null;
  searchers: AnalyticsSearchQuerySearcher[];
}

export interface AnalyticsSearchQueryResponse {
  queries: AnalyticsSearchQueryRow[];
  limit: number;
}

export interface AnalyticsFunnelStage {
  key?: string;
  stage?: string;
  label: string;
  count: number;
  conversionRate?: number;
  dropoffRate?: number;
}

export interface AnalyticsFunnelResponse {
  range?: AnalyticsRange;
  stages?: AnalyticsFunnelStage[];
  visitorCount?: number;
  searcherCount?: number;
  viewerCount?: number;
  favoriteCount?: number;
  applicantCount?: number;
  profileUpdateCount?: number;
  listingCreateCount?: number;
  overallConversionRate?: number;
}

export interface AnalyticsActionNeededItem {
  id?: string;
  _id?: string;
  type?: string;
  priority?: 'high' | 'medium' | 'low' | string;
  title: string;
  owner?: string;
  department?: string;
  count?: number;
  metric?: number | string;
  lastActivityAt?: string | null;
  url?: string;
}

export interface AnalyticsActionNeededResponse {
  range?: AnalyticsRange;
  cards?: AnalyticsActionNeededItem[];
  items?: AnalyticsActionNeededItem[];
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
  overrides: Partial<AnalyticsState> = {},
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
