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
    userActivity: {
      activeUsers: number;
      avgEventsPerUser: number;
    };
    mostActiveUsers: Array<{
      userId: string;
      userType: string;
      eventCount: number;
      fname?: string;
      lname?: string;
    }>;
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
      name?: string;
      href?: string;
    }>;
  };
  users: {
    overview: { total: number; confirmed: number };
    byType: Array<{ userType: string; count: number }>;
    newUsersLast7Days: number;
    newUsersToday: number;
    newUsersTodayByType: Array<{ userType: string; count: number }>;
  };
  researchEntities: {
    overview: { active: number; total: number };
    byType: Array<{ entityType: string; count: number }>;
    byVisibilityTier: Array<{ tier: string; count: number }>;
    freshness: {
      observedLast7Days: number;
      observedLast30Days: number;
      neverObserved: number;
      staleOver90Days: number;
    };
    scholarly: {
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
  researchViews: number;
  fellowshipViews: number;
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
  fellowshipId?: string;
  fellowshipTitle?: string;
  searchQuery?: string;
  searchDepartments?: string[];
  metadata?: Record<string, unknown>;
}

export interface AnalyticsUserActivityResponse {
  users: AnalyticsUserActivityRow[];
  total: number;
  limit: number;
  offset: number;
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

export interface AdminAccessGrantHistoryEntry {
  action: 'granted' | 'revoked';
  actorNetid: string;
  note: string;
  at: string | null;
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
  history?: AdminAccessGrantHistoryEntry[];
  user?: AdminAccessUser;
}

export interface AdminAccessHistoryEntry {
  action: 'granted' | 'revoked';
  actorNetid: string;
  note: string;
  at: string | null;
  subjectNetid: string;
}

export interface AdminAccessResponse {
  activeCount: number;
  grants: AdminAccessGrant[];
  legacyAdminsWithoutGrant: AdminAccessUser[];
  history: AdminAccessHistoryEntry[];
}

export interface AdminAuditEventSummary {
  fields?: string[];
  note?: string;
  status?: string;
}

export interface AdminAuditEvent {
  id: string;
  actorNetid: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: AdminAuditEventSummary | null;
  timestamp: string | null;
}

export interface AdminAuditEventsResponse {
  events: AdminAuditEvent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
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
  engagedSearches?: number;
  returnedButIgnoredSearches?: number;
  engagementRate?: number;
  attributionWindowMinutes?: number;
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
  applicantCount?: number;
  profileUpdateCount?: number;
  overallConversionRate?: number;
  journeyMetrics?: {
    sourceInspections: number;
    officialRouteAttempts: number;
    applicationOpens: number;
  };
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
