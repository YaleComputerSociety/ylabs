/**
 * Analytics dashboard page for admin usage statistics.
 */
import { FormEvent, useCallback, useContext, useEffect, useReducer, useState } from 'react';
import axios from '../utils/axios';
import swal from 'sweetalert';
import AdminPanel from '../components/admin/AdminPanel';
import useDocumentTitle from '../hooks/useDocumentTitle';
import UserContext from '../contexts/UserContext';
import {
  AnalyticsActionNeededResponse,
  AnalyticsFunnelResponse,
  AnalyticsFunnelStage,
  AnalyticsSearchQueryResponse,
  AnalyticsRange,
  AnalyticsSearchQualityResponse,
  AnalyticsUserActivityResponse,
  AnalyticsUserActivityRow,
  AnalyticsUserDrilldownResponse,
  AdminAccessResponse,
  analyticsReducer,
  createInitialAnalyticsState,
} from '../reducers/analyticsReducer';

type UserActivitySort = 'lastActive' | 'totalEvents' | 'logins' | 'searches' | 'views';
type SortOrder = 'asc' | 'desc';

const analyticsRanges: Array<{ value: AnalyticsRange; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
  { value: 'semester', label: 'Semester' },
  { value: 'all', label: 'All Time' },
];

const defaultUserActivity: AnalyticsUserActivityResponse = {
  users: [],
  total: 0,
  limit: 25,
};

const defaultAdminAccess: AdminAccessResponse = {
  activeCount: 0,
  grants: [],
  legacyAdminsWithoutGrant: [],
};

const Analytics = () => {
  useDocumentTitle('Analytics');
  const { user: currentUser } = useContext(UserContext);
  const [state, dispatch] = useReducer(
    analyticsReducer,
    undefined,
    () => createInitialAnalyticsState()
  );
  const { data, isLoading, lastUpdated, error } = state;
  const [userActivity, setUserActivity] =
    useState<AnalyticsUserActivityResponse>(defaultUserActivity);
  const [isUserActivityLoading, setIsUserActivityLoading] = useState(false);
  const [userActivityError, setUserActivityError] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [userTypeFilter, setUserTypeFilter] = useState('all');
  const [userActivityLimit, setUserActivityLimit] = useState(25);
  const [userActivitySort, setUserActivitySort] = useState<UserActivitySort>('lastActive');
  const [userActivityOrder, setUserActivityOrder] = useState<SortOrder>('desc');
  const [selectedNetid, setSelectedNetid] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<AnalyticsUserDrilldownResponse | null>(null);
  const [isSelectedUserLoading, setIsSelectedUserLoading] = useState(false);
  const [selectedUserError, setSelectedUserError] = useState<string | null>(null);
  const [adminAccess, setAdminAccess] = useState<AdminAccessResponse>(defaultAdminAccess);
  const [adminAccessError, setAdminAccessError] = useState<string | null>(null);
  const [adminGrantNetid, setAdminGrantNetid] = useState('');
  const [adminGrantNote, setAdminGrantNote] = useState('');
  const [adminAccessActionError, setAdminAccessActionError] = useState<string | null>(null);
  const [adminAccessActionMessage, setAdminAccessActionMessage] = useState<string | null>(null);
  const [adminAccessActionNetid, setAdminAccessActionNetid] = useState<string | null>(null);
  const [analyticsRange, setAnalyticsRange] = useState<AnalyticsRange>('30d');
  const [searchQuality, setSearchQuality] = useState<AnalyticsSearchQualityResponse | null>(null);
  const [searchQueries, setSearchQueries] = useState<AnalyticsSearchQueryResponse | null>(null);
  const [funnel, setFunnel] = useState<AnalyticsFunnelResponse | null>(null);
  const [actions, setActions] = useState<AnalyticsActionNeededResponse | null>(null);
  const [isImpactLoading, setIsImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async () => {
    dispatch({ type: 'FETCH_START' });
    try {
      const response = await axios.get('/analytics', { withCredentials: true });
      dispatch({
        type: 'FETCH_SUCCESS',
        payload: { data: response.data, timestamp: new Date().toLocaleString() },
      });
    } catch (error) {
      console.error('Error fetching analytics:', error);
      swal({
        text: 'Failed to load analytics data',
        icon: 'error',
      });
      dispatch({
        type: 'FETCH_FAILURE',
        payload: error instanceof Error ? error.message : 'Failed to load analytics data',
      });
    }
  }, []);

  const fetchUserActivity = useCallback(async () => {
    setIsUserActivityLoading(true);
    setUserActivityError(null);
    try {
      const response = await axios.get<AnalyticsUserActivityResponse>('/analytics/users', {
        withCredentials: true,
        params: {
          search: userSearch.trim() || undefined,
          userType: userTypeFilter === 'all' ? undefined : userTypeFilter,
          sort: userActivitySort,
          direction: userActivityOrder,
          limit: userActivityLimit,
        },
      });
      setUserActivity({
        ...defaultUserActivity,
        ...response.data,
        users: response.data.users || [],
      });
    } catch (error) {
      console.error('Error fetching user analytics:', error);
      setUserActivityError(
        error instanceof Error ? error.message : 'Failed to load user activity data'
      );
    } finally {
      setIsUserActivityLoading(false);
    }
  }, [userActivityLimit, userActivityOrder, userActivitySort, userSearch, userTypeFilter]);

  const fetchAdminAccess = useCallback(async () => {
    setAdminAccessError(null);
    try {
      const response = await axios.get<AdminAccessResponse>('/admin/admin-grants', {
        withCredentials: true,
      });
      setAdminAccess({
        ...defaultAdminAccess,
        ...response.data,
        grants: response.data.grants || [],
        legacyAdminsWithoutGrant: response.data.legacyAdminsWithoutGrant || [],
      });
    } catch (error) {
      console.error('Error fetching admin access:', error);
      setAdminAccess(defaultAdminAccess);
      setAdminAccessError(
        error instanceof Error ? error.message : 'Failed to load admin access data'
      );
    }
  }, []);

  const adminActorNetid = (currentUser?.netId || '').trim().toLowerCase();

  const adminAccessErrorMessage = (error: unknown, fallback: string) => {
    const responseError = error as { response?: { data?: { error?: string } }; message?: string };
    return responseError.response?.data?.error || responseError.message || fallback;
  };

  const handleGrantAdminAccess = useCallback(
    async (event?: FormEvent, requestedNetid?: string) => {
      event?.preventDefault();
      const netid = (requestedNetid || adminGrantNetid).trim().toLowerCase();
      if (!netid) {
        setAdminAccessActionError('NetID is required.');
        return;
      }
      setAdminAccessActionNetid(netid);
      setAdminAccessActionError(null);
      setAdminAccessActionMessage(null);
      try {
        await axios.post(
          '/admin/admin-grants',
          { netid, note: requestedNetid ? '' : adminGrantNote.trim() },
          { withCredentials: true },
        );
        setAdminGrantNetid('');
        if (!requestedNetid) setAdminGrantNote('');
        setAdminAccessActionMessage(`Admin access granted to ${netid}.`);
        await fetchAdminAccess();
      } catch (error) {
        setAdminAccessActionError(
          adminAccessErrorMessage(error, `Failed to grant admin access to ${netid}.`),
        );
      } finally {
        setAdminAccessActionNetid(null);
      }
    },
    [adminGrantNetid, adminGrantNote, fetchAdminAccess],
  );

  const handleRevokeAdminAccess = useCallback(
    async (netid: string) => {
      const normalizedNetid = netid.trim().toLowerCase();
      const confirmed = await swal({
        title: 'Revoke admin access?',
        text: `Revoke admin access for ${normalizedNetid}?`,
        icon: 'warning',
        buttons: ['Cancel', 'Revoke'],
        dangerMode: true,
      });
      if (!confirmed) return;

      setAdminAccessActionNetid(normalizedNetid);
      setAdminAccessActionError(null);
      setAdminAccessActionMessage(null);
      try {
        await axios.post(
          `/admin/admin-grants/${encodeURIComponent(normalizedNetid)}/revoke`,
          { note: '' },
          { withCredentials: true },
        );
        setAdminAccessActionMessage(`Admin access revoked for ${normalizedNetid}.`);
        await fetchAdminAccess();
      } catch (error) {
        setAdminAccessActionError(
          adminAccessErrorMessage(error, `Failed to revoke admin access for ${normalizedNetid}.`),
        );
      } finally {
        setAdminAccessActionNetid(null);
      }
    },
    [fetchAdminAccess],
  );

  const fetchSelectedUser = useCallback(async (netid: string) => {
    setIsSelectedUserLoading(true);
    setSelectedUserError(null);
    try {
      const response = await axios.get<AnalyticsUserDrilldownResponse>(
        `/analytics/users/${encodeURIComponent(netid)}`,
        { withCredentials: true }
      );
      setSelectedUser({
        ...response.data,
        events: response.data.events || [],
      });
    } catch (error) {
      console.error('Error fetching user drilldown:', error);
      setSelectedUser(null);
      setSelectedUserError(
        error instanceof Error ? error.message : 'Failed to load NetID activity'
      );
    } finally {
      setIsSelectedUserLoading(false);
    }
  }, []);

  const fetchImpactAnalytics = useCallback(async () => {
    setIsImpactLoading(true);
    setImpactError(null);

    try {
      const [searchQualityResponse, searchQueriesResponse, funnelResponse, actionsResponse] = await Promise.all([
        axios.get<AnalyticsSearchQualityResponse>('/analytics/search-quality', {
          withCredentials: true,
          params: { range: analyticsRange },
        }),
        axios.get<AnalyticsSearchQueryResponse>('/analytics/search-queries', {
          withCredentials: true,
          params: { range: analyticsRange, limit: 25 },
        }),
        axios.get<AnalyticsFunnelResponse>('/analytics/funnel', {
          withCredentials: true,
          params: { range: analyticsRange },
        }),
        axios.get<AnalyticsActionNeededResponse>('/analytics/actions', {
          withCredentials: true,
          params: { range: analyticsRange },
        }),
      ]);

      setSearchQuality(searchQualityResponse.data);
      setSearchQueries(searchQueriesResponse.data);
      setFunnel(funnelResponse.data);
      setActions(actionsResponse.data);
    } catch (error) {
      console.error('Error fetching impact analytics:', error);
      setImpactError(
        error instanceof Error ? error.message : 'Failed to load impact analytics data'
      );
    } finally {
      setIsImpactLoading(false);
    }
  }, [analyticsRange]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  useEffect(() => {
    if (data) {
      fetchUserActivity();
      fetchAdminAccess();
    }
  }, [data, fetchAdminAccess, fetchUserActivity]);

  useEffect(() => {
    if (data) {
      fetchImpactAnalytics();
    }
  }, [data, fetchImpactAnalytics]);

  useEffect(() => {
    if (selectedNetid) {
      fetchSelectedUser(selectedNetid);
    } else {
      setSelectedUser(null);
      setSelectedUserError(null);
    }
  }, [fetchSelectedUser, selectedNetid]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-xl">Loading analytics...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md rounded-lg border border-red-200 bg-[var(--yr-panel)] p-6 text-center shadow-sm">
          <h1 className="mb-3 text-2xl font-bold text-gray-900">Analytics unavailable</h1>
          <p className="mb-5 text-sm text-gray-600">
            {error || 'Failed to load analytics data'}
          </p>
          <button
            type="button"
            onClick={fetchAnalytics}
            className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            Retry Analytics
          </button>
        </div>
      </div>
    );
  }

  const StatCard = ({
    title,
    value,
    subtitle,
  }: {
    title: string;
    value: number | string;
    subtitle?: string;
  }) => (
    <div className="overflow-hidden rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] shadow-sm">
      <div className="p-6">
        <h3 className="text-sm font-medium text-gray-600 mb-2">{title}</h3>
        <p className="text-3xl font-bold text-gray-900">{value}</p>
        {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
      </div>
    </div>
  );

  const DashboardMetric = ({
    title,
    value,
    context,
    tone = 'blue',
  }: {
    title: string;
    value: number | string;
    context: string;
    tone?: 'blue' | 'green' | 'amber' | 'red';
  }) => {
    const toneClass = {
      blue: 'border-blue-200 bg-[var(--yr-blue-soft)] text-blue-800',
      green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      amber: 'border-amber-200 bg-amber-50 text-amber-800',
      red: 'border-red-200 bg-red-50 text-red-800',
    }[tone];

    return (
      <div className={`rounded-lg border p-4 ${toneClass}`}>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-2 text-3xl font-bold text-gray-950">{value}</p>
        <p className="mt-2 text-sm leading-5 opacity-85">{context}</p>
      </div>
    );
  };

  const DetailSectionHeader = ({
    title,
    description,
  }: {
    title: string;
    description?: string;
  }) => (
    <div className="mb-4 flex flex-col gap-1 border-b border-[var(--yr-line)] pb-3">
      <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
      {description && <p className="text-sm text-gray-500">{description}</p>}
    </div>
  );

  const formatUserType = (type: string) => {
    const typeMap: { [key: string]: string } = {
      undergraduate: 'Undergrads',
      graduate: 'Graduates',
      professor: 'Professors',
      faculty: 'Faculty',
      admin: 'Admins',
      unknown: 'Unknown',
    };
    return typeMap[type] || type;
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) {
      return 'Never';
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  };

  const formatEventType = (eventType: string) => {
    const labelMap: Record<string, string> = {
      listing_view: 'Opportunity View',
      listing_favorite: 'Opportunity Save',
      listing_unfavorite: 'Opportunity Unsave',
      listing_create: 'Opportunity Create',
      listing_update: 'Opportunity Update',
      listing_archive: 'Opportunity Archive',
      listing_unarchive: 'Opportunity Unarchive',
    };

    return (
      labelMap[eventType] ||
      eventType
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    );
  };

  const formatNumber = (value?: number | null, digits = 0) => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return '-';
    }

    return value.toLocaleString(undefined, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    });
  };

  const formatPercent = (value?: number | null) => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return '-';
    }

    return `${formatNumber(value > 1 ? value : value * 100, 1)}%`;
  };

  const formatCompactMetric = (value?: number | string | null) => {
    if (typeof value === 'number') {
      return formatNumber(value, value % 1 === 0 ? 0 : 1);
    }

    return value || '-';
  };

  const actionPriorityClass = (priority?: string) => {
    if (priority === 'high') {
      return 'border-red-200 bg-red-50 text-red-700';
    }

    if (priority === 'medium') {
      return 'border-amber-200 bg-amber-50 text-amber-700';
    }

    return 'border-[var(--yr-line)] bg-[var(--yr-panel-muted)] text-gray-700';
  };

  const updateUserActivitySort = (sort: UserActivitySort) => {
    if (sort === userActivitySort) {
      setUserActivityOrder(userActivityOrder === 'asc' ? 'desc' : 'asc');
      return;
    }

    setUserActivitySort(sort);
    setUserActivityOrder('desc');
  };

  const sortLabel = (sort: UserActivitySort) => {
    if (sort !== userActivitySort) {
      return '';
    }
    return userActivityOrder === 'asc' ? ' ^' : ' v';
  };

  const formatSearcherName = (searcher: { fname?: string; lname?: string; netid: string }) => {
    const name = [searcher.fname, searcher.lname].filter(Boolean).join(' ');
    return name ? `${searcher.netid} (${name})` : searcher.netid;
  };

  const selectedUserSummary: AnalyticsUserActivityRow | null =
    selectedUser?.user || userActivity.users.find((user) => user.netid === selectedNetid) || null;

  const searchTotal = searchQuality?.totalSearches || 0;
  const searchZeroResults = searchQuality?.zeroResultSearches || 0;
  const searchesWithResults =
    searchQuality?.searchesWithResults ?? Math.max(searchTotal - searchZeroResults, 0);
  const avgResults = searchQuality?.avgResults ?? searchQuality?.avgResultsPerSearch;
  const zeroResultQueries = searchQuality?.zeroResultQueries || [];
  const lowResultQueries = searchQuality?.lowResultQueries || [];
  const searchQueryRows = searchQueries?.queries || [];
  const actionCards = actions?.cards || [];
  const actionItems = actions?.items || [];
  const fallbackFunnelStages: AnalyticsFunnelStage[] = [
    { key: 'visitors', label: 'Visitors', count: funnel?.visitorCount || 0 },
    { key: 'searchers', label: 'Searched', count: funnel?.searcherCount || 0 },
    { key: 'viewers', label: 'Viewed Opportunities', count: funnel?.viewerCount || 0 },
    { key: 'favorites', label: 'Saved', count: funnel?.favoriteCount || 0 },
    { key: 'applications', label: 'Outreach Clicked', count: funnel?.applicantCount || 0 },
  ].filter((stage) => stage.count > 0);
  const funnelStages: AnalyticsFunnelStage[] =
    funnel?.stages ||
    fallbackFunnelStages;
  const opportunityViewDataHealth = data.engagement.opportunityViewDataHealth;
  const orphanedOpportunityViewEvents =
    opportunityViewDataHealth?.orphanedOpportunityViewEventsLast30Days || 0;
  const orphanedOpportunityIds = opportunityViewDataHealth?.orphanedOpportunityIds || [];
  const selectedRangeLabel =
    analyticsRanges.find((range) => range.value === analyticsRange)?.label || 'Selected range';
  const searchSuccessRate = searchTotal > 0 ? searchesWithResults / searchTotal : null;
  const activeOpportunityRate =
    data.listings.overview.total > 0
      ? data.listings.overview.active / data.listings.overview.total
      : null;
  const attentionCount =
    actionCards.length + zeroResultQueries.length + lowResultQueries.length + orphanedOpportunityIds.length;
  const healthTone =
    attentionCount > 4 || (searchSuccessRate !== null && searchSuccessRate < 0.75)
      ? 'red'
      : attentionCount > 0
        ? 'amber'
        : 'green';
  const topAction = actionCards[0]?.title || 'No urgent admin action returned';
  const largestFunnelStageCount = Math.max(...funnelStages.map((stage) => stage.count), 1);

  return (
    <div className="yr-page min-h-[calc(100vh-8rem)]">
    <div className="mx-auto max-w-7xl px-4 py-8">
      <section className="yr-panel mb-8 rounded-md">
        <div className="border-b border-[var(--yr-line)] p-5 lg:flex lg:items-start lg:justify-between lg:gap-8">
          <div className="max-w-3xl">
            <p className="yr-kicker">Primary dashboard question</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-950">Research Discovery Health</h1>
            <p className="mt-3 text-base leading-7 text-slate-600">
              Are students finding credible research next steps, and where should admins intervene?
            </p>
          </div>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end lg:mt-0">
            <label className="block sm:w-56">
              <span className="mb-1 block text-xs font-semibold uppercase text-gray-500">
                Range
              </span>
              <select
                value={analyticsRange}
                onChange={(event) => setAnalyticsRange(event.target.value as AnalyticsRange)}
                className="min-h-[44px] w-full rounded-md border border-[var(--yr-line-strong)] bg-[var(--yr-panel)] px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                {analyticsRanges.map((range) => (
                  <option key={range.value} value={range.value}>
                    {range.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => {
                fetchAnalytics();
                fetchImpactAnalytics();
                fetchAdminAccess();
              }}
              className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-[var(--yr-blue)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
            >
              Refresh Data
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-4">
          <DashboardMetric
            title="Search success"
            value={searchSuccessRate === null ? '-' : formatPercent(searchSuccessRate)}
            context={`${formatNumber(searchesWithResults)} of ${formatNumber(searchTotal)} searches returned results in ${selectedRangeLabel}.`}
            tone={searchSuccessRate !== null && searchSuccessRate < 0.75 ? 'amber' : 'green'}
          />
          <DashboardMetric
            title="Student action funnel"
            value={formatPercent(funnel?.overallConversionRate)}
            context="Share of visitors reaching a concrete save or outreach-style action."
            tone="blue"
          />
          <DashboardMetric
            title="Active opportunity supply"
            value={activeOpportunityRate === null ? '-' : formatPercent(activeOpportunityRate)}
            context={`${formatNumber(data.listings.overview.active)} active out of ${formatNumber(data.listings.overview.total)} posted opportunities.`}
            tone="blue"
          />
          <DashboardMetric
            title="Needs attention"
            value={formatNumber(attentionCount)}
            context={topAction}
            tone={healthTone}
          />
        </div>

        <div className="grid grid-cols-1 gap-5 border-t border-[var(--yr-line)] p-5 xl:grid-cols-[1fr_1.2fr]">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Decision Readout</h2>
            <div className="mt-3 space-y-3 text-sm leading-6 text-gray-600">
              <p>
                Start with search success and funnel movement: they show whether discovery intent
                becomes visible next-step behavior.
              </p>
              <p>
                Treat low-result queries and action cards as the work queue, not just warnings.
              </p>
              <p className="text-gray-500">Last updated: {lastUpdated || 'Not refreshed yet'}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Funnel Snapshot</h3>
              <div className="mt-3 space-y-3">
                {funnelStages.length > 0 ? (
                  funnelStages.map((stage) => (
                    <div key={stage.key || stage.stage || stage.label}>
                      <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                        <span className="font-medium text-gray-700">{stage.label}</span>
                        <span className="text-gray-500">{formatNumber(stage.count)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-[var(--yr-panel-muted)]">
                        <div
                          className="h-2 rounded-full bg-blue-600"
                          style={{
                            width: `${Math.min((stage.count / largestFunnelStageCount) * 100, 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-500">No funnel stages returned.</p>
                )}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900">Search Gaps</h3>
              <div className="mt-3 space-y-2">
                {[...zeroResultQueries, ...lowResultQueries].slice(0, 5).map((query, index) => (
                  <div
                    key={`${query.query}-${index}`}
                    className="flex items-center justify-between gap-3 rounded-md border border-[var(--yr-line)] px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate text-gray-700">
                      {query.query || '(empty search)'}
                    </span>
                    <span className="shrink-0 font-medium text-gray-900">
                      {formatCompactMetric(query.zeroResults ?? query.count)}
                    </span>
                  </div>
                ))}
                {zeroResultQueries.length === 0 && lowResultQueries.length === 0 && (
                  <p className="text-sm text-gray-500">No search quality flags returned.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mb-10">
        <div className="mb-4 flex flex-col gap-2 border-b border-slate-200 pb-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Admin Access</h2>
            <p className="text-sm text-gray-500">
              Current admin authority comes from active admin grants, not profile user type.
            </p>
          </div>
          <span className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800">
            {formatNumber(adminAccess.activeCount)} active admin
            {adminAccess.activeCount === 1 ? '' : 's'}
          </span>
        </div>

        {adminAccessError && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {adminAccessError}
          </div>
        )}

        <form
          className="mb-4 grid gap-3 rounded-lg border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]"
          onSubmit={(event) => {
            void handleGrantAdminAccess(event);
          }}
        >
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase text-gray-500">
              Grant admin NetID
            </span>
            <input
              className="min-h-[44px] w-full rounded-md border border-[var(--yr-line-strong)] px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              value={adminGrantNetid}
              onChange={(event) => setAdminGrantNetid(event.target.value)}
              placeholder="fixture-admin"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase text-gray-500">
              Admin grant note
            </span>
            <input
              className="min-h-[44px] w-full rounded-md border border-[var(--yr-line-strong)] px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              value={adminGrantNote}
              onChange={(event) => setAdminGrantNote(event.target.value)}
              placeholder="Optional"
            />
          </label>
          <button
            className="inline-flex min-h-[44px] items-center justify-center self-end rounded-md bg-[var(--yr-blue)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-900 disabled:cursor-not-allowed disabled:bg-blue-300"
            type="submit"
            disabled={adminAccessActionNetid !== null}
          >
            Grant Admin
          </button>
        </form>

        {adminAccessActionError && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {adminAccessActionError}
          </div>
        )}

        {adminAccessActionMessage && (
          <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {adminAccessActionMessage}
          </div>
        )}

        {adminAccess.legacyAdminsWithoutGrant.length > 0 && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {adminAccess.legacyAdminsWithoutGrant.length} legacy admin profile row
            {adminAccess.legacyAdminsWithoutGrant.length === 1 ? '' : 's'} without active grants:{' '}
            {adminAccess.legacyAdminsWithoutGrant.map((user) => user.netid).join(', ')}
            <div className="mt-3 flex flex-wrap gap-2">
              {adminAccess.legacyAdminsWithoutGrant.map((user) => (
                <button
                  key={user.netid}
                  type="button"
                  className="rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={adminAccessActionNetid !== null}
                  onClick={() => {
                    void handleGrantAdminAccess(undefined, user.netid);
                  }}
                >
                  Grant {user.netid}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-md">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                    NetID
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                    Person
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                    Source
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                    Granted
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                    Granted By
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {adminAccess.grants.length > 0 ? (
                  adminAccess.grants.map((grant) => {
                    const name = [grant.user?.fname, grant.user?.lname].filter(Boolean).join(' ');
                    const isCurrentAdmin = grant.netid === adminActorNetid;
                    return (
                      <tr key={`${grant.netid}-${grant.status}`} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{grant.netid}</td>
                        <td className="px-4 py-3 text-gray-700">
                          {name || grant.user?.email || '-'}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{grant.source}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {formatDateTime(grant.grantedAt)}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{grant.grantedBy || '-'}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-md px-2 py-1 text-xs font-semibold ${
                              grant.status === 'active'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {grant.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {grant.status !== 'active' ? (
                            <span className="text-sm text-gray-500">-</span>
                          ) : isCurrentAdmin ? (
                            <button
                              type="button"
                              disabled
                              className="rounded-md border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-500"
                            >
                              Current session
                            </button>
                          ) : (
                            <button
                              type="button"
                              aria-label={`Revoke ${grant.netid}`}
                              className="rounded-md border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={adminAccessActionNetid !== null}
                              onClick={() => {
                                void handleRevokeAdminAccess(grant.netid);
                              }}
                            >
                              Revoke
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td className="px-4 py-6 text-center text-gray-500" colSpan={7}>
                      No admin grants returned.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <DetailSectionHeader
        title="Supporting Detail"
        description="Operational tables and lower-priority counts remain below the readout for drilldown."
      />

      <nav
        aria-label="Analytics detail sections"
        className="mb-6 flex flex-wrap gap-2 text-sm font-semibold"
      >
        <a className="rounded-md border border-[var(--yr-line)] px-3 py-2 text-blue-700" href="#visitor-statistics">
          Visitors
        </a>
        <a className="rounded-md border border-[var(--yr-line)] px-3 py-2 text-blue-700" href="#diagnostics">
          Diagnostics
        </a>
        <a
          className="rounded-md border border-[var(--yr-line)] px-3 py-2 text-blue-700"
          href="#posted-opportunities-overview"
        >
          Opportunities
        </a>
      </nav>

      <section id="visitor-statistics" className="mb-10">
        <h2 className="text-2xl font-semibold mb-4 text-slate-950 border-b border-[var(--yr-line)] pb-2">
          Visitor Statistics
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <StatCard
            title="Total Visitors (Lifetime)"
            value={data.visitors.lifetime.total}
            subtitle="Unique users who've logged in"
          />
          <StatCard
            title="Visitors (Last 7 Days)"
            value={data.visitors.last7Days.total}
            subtitle="Active in past week"
          />
          <StatCard
            title="Visitors Today"
            value={data.visitors.today.total}
            subtitle="Logged in today"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <StatCard
            title="Total Login Events"
            value={data.visitors.loginFrequency.totalLogins}
            subtitle="All-time login count"
          />
          <StatCard
            title="Logins (Last 7 Days)"
            value={data.visitors.loginFrequency.loginsLast7Days}
            subtitle="Total logins this week"
          />
          <StatCard
            title="Logins Today"
            value={data.visitors.loginFrequency.loginsToday}
            subtitle="Login events today"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-[var(--yr-panel)] rounded-lg shadow-md p-6 border border-[var(--yr-line)]">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Lifetime Visitors by Type</h3>
            <div className="space-y-2">
              {data.visitors.lifetime.byType.map((item) => (
                <div key={item.userType} className="flex justify-between text-sm">
                  <span className="text-gray-600">{formatUserType(item.userType)}:</span>
                  <span className="font-medium">{item.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[var(--yr-panel)] rounded-lg shadow-md p-6 border border-[var(--yr-line)]">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Last 7 Days by Type</h3>
            <div className="space-y-2">
              {data.visitors.last7Days.byType.map((item) => (
                <div key={item.userType} className="flex justify-between text-sm">
                  <span className="text-gray-600">{formatUserType(item.userType)}:</span>
                  <span className="font-medium">{item.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[var(--yr-panel)] rounded-lg shadow-md p-6 border border-[var(--yr-line)]">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Today by Type</h3>
            <div className="space-y-2">
              {data.visitors.today.byType.length > 0 ? (
                data.visitors.today.byType.map((item) => (
                  <div key={item.userType} className="flex justify-between text-sm">
                    <span className="text-gray-600">{formatUserType(item.userType)}:</span>
                    <span className="font-medium">{item.count}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500">No visitors yet today</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section id="diagnostics" className="mb-10">
        <h2 className="text-2xl font-semibold mb-4 text-slate-950 border-b border-[var(--yr-line)] pb-2">
          User Engagement
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <StatCard
            title="Total Searches"
            value={data.engagement.search.totalSearches}
            subtitle="All-time search queries"
          />
          <StatCard
            title="Searches (Last 7 Days)"
            value={data.engagement.search.searchesLast7Days}
            subtitle="Recent searches"
          />
          <StatCard
            title="Searches Today"
            value={data.engagement.search.searchesToday}
            subtitle="Searches today"
          />
        </div>

        {data.engagement.topSearchQueries.length > 0 && (
          <div className="bg-[var(--yr-panel)] rounded-lg shadow-md p-6 border border-[var(--yr-line)] mb-6">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">
              Top Search Queries (Last 30 Days)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.engagement.topSearchQueries.map((item, index) => (
                <div key={index} className="flex justify-between border-b pb-2">
                  <span className="text-gray-700">{item.query || '(empty search)'}</span>
                  <span className="font-medium text-blue-600">{item.count} searches</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <StatCard
            title="Total View Events"
            value={data.engagement.views.totalViews}
            subtitle="Opportunity views tracked"
          />
          <StatCard
            title="Views (Last 7 Days)"
            value={data.engagement.views.viewsLast7Days}
            subtitle="Recent views"
          />
          <StatCard
            title="Views Today"
            value={data.engagement.views.viewsToday}
            subtitle="Views today"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <StatCard
            title="Active Users (Last 7 Days)"
            value={data.engagement.userActivity.activeUsers}
            subtitle="Users with activity"
          />
          <StatCard
            title="Avg Events Per User"
            value={data.engagement.userActivity.avgEventsPerUser.toFixed(1)}
            subtitle="Last 7 days"
          />
        </div>
      </section>

      {opportunityViewDataHealth && (
        <section className="mb-10">
          <h2 className="text-2xl font-semibold mb-4 text-slate-950 border-b border-[var(--yr-line)] pb-2">
            Analytics Data Health
          </h2>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <StatCard
              title="Opportunity view events (30 days)"
              value={formatNumber(opportunityViewDataHealth.opportunityViewEventsLast30Days)}
              subtitle="Tracked recent view events"
            />
            <StatCard
              title="Resolved opportunity view events"
              value={formatNumber(
                opportunityViewDataHealth.resolvedOpportunityViewEventsLast30Days
              )}
              subtitle="Mapped to current records"
            />
            <StatCard
              title="Orphaned opportunity view events"
              value={formatNumber(orphanedOpportunityViewEvents)}
              subtitle={`${formatNumber(orphanedOpportunityIds.length)} unresolved IDs`}
            />
          </div>

          {orphanedOpportunityViewEvents > 0 && (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Some recent opportunity view events reference retired or missing opportunity records.
              The trending table only shows events that map to current records.
            </div>
          )}
        </section>
      )}

      <section id="posted-opportunities-overview" className="mb-10">
        <div className="mb-4 flex flex-col gap-2 border-b border-[var(--yr-line)] pb-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">High-Impact Diagnostics</h2>
            <p className="text-sm text-gray-500">
              {analyticsRanges.find((range) => range.value === analyticsRange)?.label} snapshot
            </p>
          </div>
          {isImpactLoading && <span className="text-sm text-gray-500">Loading diagnostics...</span>}
        </div>

        {impactError && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {impactError}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="bg-[var(--yr-panel)] rounded-lg shadow-md border border-[var(--yr-line)] overflow-hidden">
            <div className="border-b border-[var(--yr-line)] p-4">
              <h3 className="text-lg font-semibold text-gray-800">Search Quality</h3>
              <p className="text-sm text-gray-500">Results coverage and failed intent signals</p>
            </div>
            <div className="grid grid-cols-3 gap-3 p-4 text-sm">
              <div>
                <p className="text-gray-500">Searches</p>
                <p className="text-xl font-semibold text-gray-900">{formatNumber(searchTotal)}</p>
              </div>
              <div>
                <p className="text-gray-500">With Results</p>
                <p className="text-xl font-semibold text-gray-900">
                  {formatNumber(searchesWithResults)}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Zero-Result</p>
                <p className="text-xl font-semibold text-gray-900">
                  {formatPercent(searchQuality?.zeroResultRate)}
                </p>
              </div>
            </div>
            <div className="border-t border-[var(--yr-line)] px-4 py-3 text-sm">
              <div className="mb-2 flex justify-between text-gray-600">
                <span>Avg results/search</span>
                <span className="font-medium text-gray-900">{formatNumber(avgResults, 1)}</span>
              </div>
              <div className="mb-3 flex justify-between text-gray-600">
                <span>Avg latency</span>
                <span className="font-medium text-gray-900">
                  {searchQuality?.avgLatencyMs ? `${formatNumber(searchQuality.avgLatencyMs)} ms` : '-'}
                </span>
              </div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Zero or Low Result Queries
              </h4>
              <div className="space-y-2">
                {[...zeroResultQueries, ...lowResultQueries].slice(0, 5).map((query, index) => (
                  <div
                    key={`${query.query}-${index}`}
                    className="flex items-center justify-between gap-3 border-b border-[var(--yr-line)] pb-2 last:border-0 last:pb-0"
                  >
                    <span className="min-w-0 truncate text-gray-700">
                      {query.query || '(empty search)'}
                    </span>
                    <span className="shrink-0 text-xs font-medium text-blue-600">
                      {query.zeroResults ?? query.count} hits
                    </span>
                  </div>
                ))}
                {zeroResultQueries.length === 0 && lowResultQueries.length === 0 && (
                  <p className="text-gray-500">No search quality flags returned.</p>
                )}
              </div>
            </div>
          </div>

          <div className="bg-[var(--yr-panel)] rounded-lg shadow-md border border-[var(--yr-line)] overflow-hidden">
            <div className="border-b border-[var(--yr-line)] p-4">
              <h3 className="text-lg font-semibold text-gray-800">Student Funnel</h3>
              <p className="text-sm text-gray-500">Visitor progression through key actions</p>
            </div>
            <div className="p-4">
              <div className="mb-4 rounded-md bg-[var(--yr-blue-soft)] p-3">
                <p className="text-sm text-blue-700">Overall conversion</p>
                <p className="text-2xl font-semibold text-blue-900">
                  {formatPercent(funnel?.overallConversionRate)}
                </p>
              </div>
              <div className="space-y-3">
                {funnelStages.length > 0 ? (
                  funnelStages.map((stage, index) => {
                    const previousCount = index > 0 ? funnelStages[index - 1].count : stage.count;
                    const derivedRate =
                      stage.conversionRate ??
                      (previousCount > 0 ? stage.count / previousCount : undefined);

                    return (
                      <div key={stage.key || stage.stage || stage.label}>
                        <div className="mb-1 flex items-center justify-between text-sm">
                          <span className="font-medium text-gray-700">{stage.label}</span>
                          <span className="text-gray-500">
                            {formatNumber(stage.count)} ({formatPercent(derivedRate)})
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-[var(--yr-panel-muted)]">
                          <div
                            className="h-full rounded-full bg-blue-600"
                            style={{ width: `${Math.min(Math.max((derivedRate || 0) * 100, 0), 100)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-gray-500">No funnel stages returned.</p>
                )}
              </div>
            </div>
          </div>

          <div className="bg-[var(--yr-panel)] rounded-lg shadow-md border border-[var(--yr-line)] overflow-hidden">
            <div className="border-b border-[var(--yr-line)] p-4">
              <h3 className="text-lg font-semibold text-gray-800">Action Needed</h3>
              <p className="text-sm text-gray-500">Highest-priority admin follow-ups</p>
            </div>
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-1">
              {actionCards.length > 0 ? (
                actionCards.slice(0, 4).map((card, index) => (
                  <div
                    key={card.id || card._id || `${card.title}-${index}`}
                    className={`rounded-md border px-3 py-2 ${actionPriorityClass(card.priority)}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium">{card.title}</p>
                      <span className="shrink-0 text-sm font-semibold">
                        {formatCompactMetric(card.metric ?? card.count)}
                      </span>
                    </div>
                    {(card.owner || card.department || card.type) && (
                      <p className="mt-1 text-xs opacity-80">
                        {[card.owner, card.department, card.type].filter(Boolean).join(' - ')}
                      </p>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500">No action cards returned.</p>
              )}
            </div>
            {actionItems.length > 0 && (
              <div className="border-t border-[var(--yr-line)] p-4">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b text-gray-600">
                        <th className="py-2 pr-3 text-left font-semibold">Item</th>
                        <th className="py-2 px-3 text-left font-semibold">Owner</th>
                        <th className="py-2 pl-3 text-right font-semibold">Metric</th>
                      </tr>
                    </thead>
                    <tbody>
                      {actionItems.slice(0, 5).map((item, index) => (
                        <tr
                          key={item.id || item._id || `${item.title}-${index}`}
                          className="border-b last:border-0"
                        >
                          <td className="py-2 pr-3 text-gray-800">{item.title}</td>
                          <td className="py-2 px-3 text-gray-600">{item.owner || '-'}</td>
                          <td className="py-2 pl-3 text-right font-medium text-gray-900">
                            {formatCompactMetric(item.metric ?? item.count)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="mb-10">
        <div className="mb-4 flex flex-col gap-2 border-b border-[var(--yr-line)] pb-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Search Query Analytics</h2>
            <p className="text-sm text-gray-500">
              Most popular search queries and the NetIDs behind them for the selected range.
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-[var(--yr-line)] bg-[var(--yr-panel)] shadow-md">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b bg-[var(--yr-panel-muted)]">
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                    Query
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                    Searches
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                    Searchers
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                    Zero Results
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                    Who Searched
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                    Last Search
                  </th>
                </tr>
              </thead>
              <tbody>
                {searchQueryRows.length > 0 ? (
                  searchQueryRows.map((query) => (
                    <tr key={query.query} className="border-b align-top hover:bg-[var(--yr-panel-muted)]">
                      <td className="max-w-xs px-4 py-3 font-medium text-gray-900">
                        {query.query || '(empty search)'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-blue-600">
                        {formatNumber(query.totalSearches)}
                      </td>
                      <td className="px-4 py-3 text-right">{formatNumber(query.uniqueSearchers)}</td>
                      <td className="px-4 py-3 text-right">
                        {formatNumber(query.zeroResultSearches || 0)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex max-w-xl flex-wrap gap-2">
                          {query.searchers.slice(0, 8).map((searcher) => (
                            <span
                              key={`${query.query}-${searcher.netid}`}
                              className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] px-2 py-1 text-xs text-gray-700"
                            >
                              {formatSearcherName(searcher)} - {searcher.searchCount}
                            </span>
                          ))}
                          {query.searchers.length > 8 && (
                            <span className="px-1 py-1 text-xs text-gray-500">
                              +{query.searchers.length - 8} more
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {formatDateTime(query.lastSearchedAt)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-6 text-center text-gray-500" colSpan={6}>
                      No tracked search queries for this range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {data.engagement.mostActiveUsers.length > 0 && (
        <section className="mb-10">
          <h2 className="text-2xl font-semibold mb-4 text-slate-950 border-b border-[var(--yr-line)] pb-2">
            Most Active Users (Last 30 Days)
          </h2>
          <div className="bg-[var(--yr-panel)] rounded-lg shadow-md p-6 border border-[var(--yr-line)]">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">User ID</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Type</th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-700">Events</th>
                  </tr>
                </thead>
                <tbody>
                  {data.engagement.mostActiveUsers.map((user, index) => (
                    <tr key={`${user.userId}-${index}`} className="border-b hover:bg-[var(--yr-panel-muted)]">
                      <td className="py-3 px-4 text-gray-800">{user.userId}</td>
                      <td className="py-3 px-4 text-gray-600">{formatUserType(user.userType)}</td>
                      <td className="py-3 px-4 text-right font-medium">{user.eventCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <section className="mb-10">
        <div className="flex flex-col gap-3 mb-4 border-b border-[var(--yr-line)] pb-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">NetID User Activity</h2>
            <p className="text-sm text-gray-500">
              Admin-only activity lookup from tracked analytics events
            </p>
          </div>
          <button
            type="button"
            onClick={fetchUserActivity}
            className="inline-flex min-h-[44px] items-center justify-center self-start rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300 md:self-auto"
            disabled={isUserActivityLoading}
          >
            {isUserActivityLoading ? 'Refreshing...' : 'Refresh Users'}
          </button>
        </div>

        <div className="bg-[var(--yr-panel)] rounded-lg shadow-md border border-[var(--yr-line)] overflow-hidden">
          <div className="grid grid-cols-1 gap-4 border-b border-[var(--yr-line)] p-4 lg:grid-cols-5">
            <label className="block lg:col-span-2">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Search NetID
              </span>
              <input
                type="search"
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
                placeholder="e.g. abc123"
                className="min-h-[44px] w-full rounded-md border border-[var(--yr-line-strong)] px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                User Type
              </span>
              <select
                value={userTypeFilter}
                onChange={(event) => setUserTypeFilter(event.target.value)}
                className="min-h-[44px] w-full rounded-md border border-[var(--yr-line-strong)] px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="all">All Types</option>
                <option value="undergraduate">Undergrads</option>
                <option value="graduate">Graduates</option>
                <option value="professor">Professors</option>
                <option value="faculty">Faculty</option>
                <option value="admin">Admins</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Sort
              </span>
              <select
                value={userActivitySort}
                onChange={(event) => setUserActivitySort(event.target.value as UserActivitySort)}
                className="min-h-[44px] w-full rounded-md border border-[var(--yr-line-strong)] px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="lastActive">Last Active</option>
                <option value="totalEvents">Total Events</option>
                <option value="logins">Logins</option>
                <option value="searches">Searches</option>
                <option value="views">Views</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Limit
              </span>
              <select
                value={userActivityLimit}
                onChange={(event) => setUserActivityLimit(Number(event.target.value))}
                className="min-h-[44px] w-full rounded-md border border-[var(--yr-line-strong)] px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value={10}>10 users</option>
                <option value={25}>25 users</option>
                <option value={50}>50 users</option>
                <option value={100}>100 users</option>
              </select>
            </label>
          </div>

          <div className="flex flex-col gap-6 p-4 xl:flex-row">
            <div className="min-w-0 flex-1">
              <div className="mb-3 flex flex-col gap-2 text-sm text-gray-500 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  Showing {userActivity.users.length} of {userActivity.total} matching users
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setUserActivityOrder(userActivityOrder === 'asc' ? 'desc' : 'asc')
                  }
                  className="inline-flex min-h-[44px] items-center self-start rounded-md border border-[var(--yr-line-strong)] px-3 py-2 text-gray-700 transition-colors hover:bg-[var(--yr-panel-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 sm:self-auto"
                >
                  Order: {userActivityOrder === 'asc' ? 'Ascending' : 'Descending'}
                </button>
              </div>

              {userActivityError && (
                <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {userActivityError}
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b bg-[var(--yr-panel-muted)]">
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                        NetID
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                        Type
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                        <button
                          type="button"
                          onClick={() => updateUserActivitySort('totalEvents')}
                          className="inline-flex min-h-[44px] items-center rounded-md px-2 hover:bg-[var(--yr-panel-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                        >
                          Events{sortLabel('totalEvents')}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                        <button
                          type="button"
                          onClick={() => updateUserActivitySort('logins')}
                          className="inline-flex min-h-[44px] items-center rounded-md px-2 hover:bg-[var(--yr-panel-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                        >
                          Logins{sortLabel('logins')}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                        <button
                          type="button"
                          onClick={() => updateUserActivitySort('searches')}
                          className="inline-flex min-h-[44px] items-center rounded-md px-2 hover:bg-[var(--yr-panel-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                        >
                          Searches{sortLabel('searches')}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                        <button
                          type="button"
                          onClick={() => updateUserActivitySort('views')}
                          className="inline-flex min-h-[44px] items-center rounded-md px-2 hover:bg-[var(--yr-panel-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                        >
                          Views{sortLabel('views')}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                        <button
                          type="button"
                          onClick={() => updateUserActivitySort('lastActive')}
                          className="inline-flex min-h-[44px] items-center rounded-md px-2 hover:bg-[var(--yr-panel-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                        >
                          Last Active{sortLabel('lastActive')}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {isUserActivityLoading && userActivity.users.length === 0 ? (
                      <tr>
                        <td className="px-4 py-6 text-center text-gray-500" colSpan={7}>
                          Loading user activity...
                        </td>
                      </tr>
                    ) : userActivity.users.length > 0 ? (
                      userActivity.users.map((user, index) => (
                        <tr
                          key={`${user.netid}-${index}`}
                          className={`cursor-pointer border-b transition-colors hover:bg-[var(--yr-blue-soft)] ${
                            selectedNetid === user.netid ? 'bg-[var(--yr-blue-soft)]' : ''
                          }`}
                          onClick={() => setSelectedNetid(user.netid)}
                        >
                          <td className="px-4 py-3 font-medium text-gray-900">{user.netid}</td>
                          <td className="px-4 py-3 text-gray-600">
                            {formatUserType(user.userType)}
                          </td>
                          <td className="px-4 py-3 text-right font-medium">{user.totalEvents}</td>
                          <td className="px-4 py-3 text-right">{user.logins}</td>
                          <td className="px-4 py-3 text-right">{user.searches}</td>
                          <td className="px-4 py-3 text-right">{user.views}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {formatDateTime(user.lastActive)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="px-4 py-6 text-center text-gray-500" colSpan={7}>
                          No users match the current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <aside className="w-full rounded-lg border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] p-4 xl:w-96">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">
                    {selectedNetid ? selectedNetid : 'Select a NetID'}
                  </h3>
                  {selectedUserSummary && (
                    <p className="text-sm text-gray-500">
                      {formatUserType(selectedUserSummary.userType)} -{' '}
                      {selectedUserSummary.totalEvents} events
                    </p>
                  )}
                </div>
                {selectedNetid && (
                  <button
                    type="button"
                    onClick={() => setSelectedNetid(null)}
                    className="inline-flex min-h-[44px] items-center rounded-md border border-[var(--yr-line-strong)] px-3 py-2 text-xs text-gray-600 hover:bg-[var(--yr-panel)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                  >
                    Clear
                  </button>
                )}
              </div>

              {!selectedNetid && (
                <p className="text-sm text-gray-500">
                  Pick a row to inspect the latest events for that NetID.
                </p>
              )}

              {selectedNetid && isSelectedUserLoading && (
                <p className="text-sm text-gray-500">Loading recent events...</p>
              )}

              {selectedNetid && selectedUserError && (
                <div className="rounded-md border border-red-200 bg-[var(--yr-panel)] px-3 py-2 text-sm text-red-700">
                  {selectedUserError}
                </div>
              )}

              {selectedUser && !isSelectedUserLoading && (
                <div>
                  <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-md bg-[var(--yr-panel)] p-3">
                      <p className="text-gray-500">Logins</p>
                      <p className="text-lg font-semibold text-gray-900">
                        {selectedUser.user.logins}
                      </p>
                    </div>
                    <div className="rounded-md bg-[var(--yr-panel)] p-3">
                      <p className="text-gray-500">Searches</p>
                      <p className="text-lg font-semibold text-gray-900">
                        {selectedUser.user.searches}
                      </p>
                    </div>
                    <div className="rounded-md bg-[var(--yr-panel)] p-3">
                      <p className="text-gray-500">Views</p>
                      <p className="text-lg font-semibold text-gray-900">
                        {selectedUser.user.views}
                      </p>
                    </div>
                    <div className="rounded-md bg-[var(--yr-panel)] p-3">
                      <p className="text-gray-500">Saves</p>
                      <p className="text-lg font-semibold text-gray-900">
                        {selectedUser.user.listingFavorites}
                      </p>
                    </div>
                  </div>

                  <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                    Recent Events
                  </h4>
                  <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
                    {selectedUser.events.length > 0 ? (
                      selectedUser.events.map((event, index) => (
                        <div
                          key={event.id || event._id || `${event.eventType}-${event.timestamp}-${index}`}
                          className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="font-medium text-gray-800">
                              {formatEventType(event.eventType)}
                            </p>
                            <p className="shrink-0 text-right text-xs text-gray-500">
                              {formatDateTime(event.timestamp)}
                            </p>
                          </div>
                          {event.searchQuery && (
                            <p className="mt-1 text-sm text-gray-600">Query: {event.searchQuery}</p>
                          )}
                          {event.listingId && (
                            <p className="mt-1 text-sm text-gray-600">
                              Opportunity: {event.listingId}
                            </p>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-gray-500">No recent events returned.</p>
                    )}
                  </div>
                </div>
              )}
            </aside>
          </div>
        </div>
      </section>

      {data.engagement.trendingListings.length > 0 && (
        <section className="mb-10">
          <h2 className="text-2xl font-semibold mb-4 text-slate-950 border-b border-[var(--yr-line)] pb-2">
            Trending Posted Opportunities (Last 30 Days)
          </h2>
          <div className="bg-[var(--yr-panel)] rounded-lg shadow-md p-6 border border-[var(--yr-line)]">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Title</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Owner</th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-700">Views</th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-700">
                      Unique Viewers
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.engagement.trendingListings.map((listing) => (
                    <tr key={listing.listingId} className="border-b hover:bg-[var(--yr-panel-muted)]">
                      <td className="py-3 px-4 text-gray-800">{listing.title}</td>
                      <td className="py-3 px-4 text-gray-600">
                        {listing.ownerFirstName} {listing.ownerLastName}
                      </td>
                      <td className="py-3 px-4 text-right font-medium">{listing.views}</td>
                      <td className="py-3 px-4 text-right font-medium">{listing.uniqueViewers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <section className="mb-10">
        <h2 className="text-2xl font-semibold mb-4 text-slate-950 border-b border-[var(--yr-line)] pb-2">
          Posted Opportunities Overview
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          <StatCard title="Total Posted Opportunities" value={data.listings.overview.total} />
          <StatCard title="Active Posted Opportunities" value={data.listings.overview.active} />
          <StatCard title="Archived Posted Opportunities" value={data.listings.overview.archived} />
          <StatCard
            title="Unconfirmed Posted Opportunities"
            value={data.listings.overview.unconfirmed}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatCard
            title="New Posted Opportunities (Last 7 Days)"
            value={data.listings.newListingsLast7Days}
            subtitle="Created in past week"
          />
          <StatCard
            title="New Posted Opportunities Today"
            value={data.listings.newListingsToday}
            subtitle="Created today"
          />
          <StatCard
            title="Posted Opportunities with 0 Views"
            value={data.listings.listingsWithZeroViews}
            subtitle="May need attention"
          />
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-2xl font-semibold mb-4 text-slate-950 border-b border-[var(--yr-line)] pb-2">
          Cumulative Engagement Metrics
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard title="Total Views (Counter)" value={data.engagement.totalViewsFromCounters} />
          <StatCard
            title="Total Saves (Counter)"
            value={data.engagement.totalFavoritesFromCounters}
          />
          <StatCard
            title="Avg Views per Posted Opportunity"
            value={data.engagement.avgViews.toFixed(1)}
          />
          <StatCard
            title="Avg Saves per Posted Opportunity"
            value={data.engagement.avgFavorites.toFixed(1)}
          />
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-2xl font-semibold mb-4 text-slate-950 border-b border-[var(--yr-line)] pb-2">
          Views by Department
        </h2>
        <div className="bg-[var(--yr-panel)] rounded-lg shadow-md p-6 border border-[var(--yr-line)]">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Department</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700">Total Views</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700">
                    Posted Opportunities
                  </th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700">Avg Views</th>
                </tr>
              </thead>
              <tbody>
                {data.engagement.viewsByDepartment.slice(0, 15).map((dept) => (
                  <tr key={dept.department} className="border-b hover:bg-[var(--yr-panel-muted)]">
                    <td className="py-3 px-4 text-gray-800">{dept.department}</td>
                    <td className="py-3 px-4 text-right font-medium">{dept.totalViews}</td>
                    <td className="py-3 px-4 text-right">{dept.listingCount}</td>
                    <td className="py-3 px-4 text-right">{dept.avgViews}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-2xl font-semibold mb-4 text-slate-950 border-b border-[var(--yr-line)] pb-2">
          Posted Opportunities by Department
        </h2>
        <div className="bg-[var(--yr-panel)] rounded-lg shadow-md p-6 border border-[var(--yr-line)]">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Department</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700">
                    Posted Opportunities
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.listings.byDepartment.slice(0, 15).map((dept) => (
                  <tr key={dept.department} className="border-b hover:bg-[var(--yr-panel-muted)]">
                    <td className="py-3 px-4 text-gray-800">{dept.department}</td>
                    <td className="py-3 px-4 text-right font-medium">{dept.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-2xl font-semibold mb-4 text-slate-950 border-b border-[var(--yr-line)] pb-2">
          Top Professors by Posted Opportunities
        </h2>
        <div className="bg-[var(--yr-panel)] rounded-lg shadow-md p-6 border border-[var(--yr-line)]">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Professor</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">NetID</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700">
                    Posted Opportunities
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.listings.byProfessor.map((prof) => (
                  <tr key={prof.netId} className="border-b hover:bg-[var(--yr-panel-muted)]">
                    <td className="py-3 px-4 text-gray-800">{prof.professorName}</td>
                    <td className="py-3 px-4 text-gray-600">{prof.netId}</td>
                    <td className="py-3 px-4 text-right font-medium">{prof.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-2xl font-semibold mb-4 text-slate-950 border-b border-[var(--yr-line)] pb-2">
          Top 10 Most Viewed Posted Opportunities (All-Time)
        </h2>
        <div className="bg-[var(--yr-panel)] rounded-lg shadow-md p-6 border border-[var(--yr-line)]">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Title</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Owner</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700">Views</th>
                </tr>
              </thead>
              <tbody>
                {data.listings.topViewedListings.map((listing) => (
                  <tr key={listing._id} className="border-b hover:bg-[var(--yr-panel-muted)]">
                    <td className="py-3 px-4 text-gray-800">{listing.title}</td>
                    <td className="py-3 px-4 text-gray-600">
                      {listing.ownerFirstName} {listing.ownerLastName}
                    </td>
                    <td className="py-3 px-4 text-right font-medium">{listing.views}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-2xl font-semibold mb-4 text-slate-950 border-b border-[var(--yr-line)] pb-2">
          Top 10 Most Saved Posted Opportunities
        </h2>
        <div className="bg-[var(--yr-panel)] rounded-lg shadow-md p-6 border border-[var(--yr-line)]">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Title</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Owner</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700">Saves</th>
                </tr>
              </thead>
              <tbody>
                {data.listings.topFavoritedListings.map((listing) => (
                  <tr key={listing._id} className="border-b hover:bg-[var(--yr-panel-muted)]">
                    <td className="py-3 px-4 text-gray-800">{listing.title}</td>
                    <td className="py-3 px-4 text-gray-600">
                      {listing.ownerFirstName} {listing.ownerLastName}
                    </td>
                    <td className="py-3 px-4 text-right font-medium">{listing.favorites}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-2xl font-semibold mb-4 text-slate-950 border-b border-[var(--yr-line)] pb-2">
          User Statistics
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          <StatCard title="Total Users" value={data.users.overview.total} />
          <StatCard title="Confirmed Users" value={data.users.overview.confirmed} />
          <StatCard title="New Users (7 Days)" value={data.users.newUsersLast7Days} />
          <StatCard title="New Users Today" value={data.users.newUsersToday} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-[var(--yr-panel)] rounded-lg shadow-md p-6 border border-[var(--yr-line)]">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">Users by Type</h3>
            <div className="space-y-3">
              {data.users.byType.map((item) => (
                <div key={item.userType} className="flex justify-between">
                  <span className="text-gray-600">{formatUserType(item.userType)}:</span>
                  <span className="font-bold text-lg">{item.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[var(--yr-panel)] rounded-lg shadow-md p-6 border border-[var(--yr-line)]">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">New Users Today by Type</h3>
            <div className="space-y-3">
              {data.users.newUsersTodayByType.length > 0 ? (
                data.users.newUsersTodayByType.map((item) => (
                  <div key={item.userType} className="flex justify-between">
                    <span className="text-gray-600">{formatUserType(item.userType)}:</span>
                    <span className="font-bold text-lg">{item.count}</span>
                  </div>
                ))
              ) : (
                <p className="text-gray-500">No new users today</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <AdminPanel />
    </div>
    </div>
  );
};

export default Analytics;
