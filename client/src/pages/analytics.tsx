/**
 * Analytics dashboard page for admin usage statistics.
 */
import {
  FormEvent,
  Suspense,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import axios from '../utils/axios';
import swal from 'sweetalert';
import { clientErrorMessage } from '../utils/clientErrorMessage';
import useDocumentTitle from '../hooks/useDocumentTitle';
import UserContext from '../contexts/UserContext';
import {
  AnalyticsActionNeededResponse,
  AnalyticsFunnelResponse,
  AnalyticsSearchQueryResponse,
  AnalyticsRange,
  AnalyticsSearchQualityResponse,
  AnalyticsUserActivityResponse,
  AnalyticsUserDrilldownResponse,
  AdminAccessResponse,
  AdminAuditEvent,
  AdminAuditEventsResponse,
  analyticsReducer,
  createInitialAnalyticsState,
} from '../reducers/analyticsReducer';
import { SortOrder, UserActivitySort } from '../components/analytics/analyticsTypes';
import {
  AUDIT_ACTION_LABELS,
  DashboardMetric,
  DetailSectionHeader,
  auditActionLabel,
  formatDateTime,
  formatNumber,
  formatPercent,
} from '../components/analytics/analyticsPresentation';

const AnalyticsSupportingDetail = lazy(
  () => import('../components/analytics/AnalyticsSupportingDetail'),
);
const AdminPanel = lazy(() => import('../components/admin/AdminPanel'));

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
  offset: 0,
};

const defaultAuditEvents: AdminAuditEventsResponse = {
  events: [],
  total: 0,
  page: 1,
  pageSize: 25,
  totalPages: 1,
};

const defaultAdminAccess: AdminAccessResponse = {
  activeCount: 0,
  grants: [],
  legacyAdminsWithoutGrant: [],
  history: [],
};

const SectionLoadingFallback = ({ label }: { label: string }) => (
  <div
    aria-busy="true"
    aria-live="polite"
    className="mb-10 animate-pulse rounded-lg border border-[var(--yr-line)] bg-[var(--yr-panel)] p-6"
  >
    <div className="mb-4 h-6 w-64 rounded bg-[var(--yr-panel-muted)]" />
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <div className="h-24 rounded bg-[var(--yr-panel-muted)]" />
      <div className="h-24 rounded bg-[var(--yr-panel-muted)]" />
      <div className="h-24 rounded bg-[var(--yr-panel-muted)]" />
    </div>
    <span className="sr-only">{label}</span>
  </div>
);

const Analytics = () => {
  useDocumentTitle('Analytics');
  const { user: currentUser } = useContext(UserContext);
  const [state, dispatch] = useReducer(analyticsReducer, undefined, () =>
    createInitialAnalyticsState(),
  );
  const { data, isLoading, lastUpdated, error } = state;
  const [userActivity, setUserActivity] =
    useState<AnalyticsUserActivityResponse>(defaultUserActivity);
  const [isUserActivityLoading, setIsUserActivityLoading] = useState(false);
  const [userActivityError, setUserActivityError] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [userTypeFilter, setUserTypeFilter] = useState('all');
  const [userActivityLimit, setUserActivityLimit] = useState(25);
  const [userActivityOffset, setUserActivityOffset] = useState(0);
  const [userActivitySort, setUserActivitySort] = useState<UserActivitySort>('lastActive');
  const [userActivityOrder, setUserActivityOrder] = useState<SortOrder>('desc');
  const [auditEvents, setAuditEvents] = useState<AdminAuditEventsResponse>(defaultAuditEvents);
  const [isAuditLoading, setIsAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditActorFilter, setAuditActorFilter] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('all');
  const [auditTargetTypeFilter, setAuditTargetTypeFilter] = useState('all');
  const [auditPage, setAuditPage] = useState(1);
  const [selectedNetid, setSelectedNetid] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<AnalyticsUserDrilldownResponse | null>(null);
  const [isSelectedUserLoading, setIsSelectedUserLoading] = useState(false);
  const [selectedUserError, setSelectedUserError] = useState<string | null>(null);
  const [adminAccess, setAdminAccess] = useState<AdminAccessResponse>(defaultAdminAccess);
  const [adminAccessError, setAdminAccessError] = useState<string | null>(null);
  const [adminGrantNetid, setAdminGrantNetid] = useState('');
  const [adminGrantNote, setAdminGrantNote] = useState('');
  const [pendingAdminGrantNetid, setPendingAdminGrantNetid] = useState<string | null>(null);
  const [adminGrantConfirmation, setAdminGrantConfirmation] = useState('');
  const grantDialogCancelRef = useRef<HTMLButtonElement>(null);
  const grantReviewButtonRef = useRef<HTMLButtonElement>(null);
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
      const response = await axios.get('/analytics', {
        withCredentials: true,
        params: { range: analyticsRange },
      });
      dispatch({
        type: 'FETCH_SUCCESS',
        payload: { data: response.data, timestamp: new Date().toLocaleString() },
      });
    } catch {
      console.error('Error fetching analytics.');
      swal({
        text: 'Failed to load analytics data',
        icon: 'error',
      });
      dispatch({
        type: 'FETCH_FAILURE',
        payload: 'Failed to load analytics data',
      });
    }
  }, [analyticsRange]);

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
          offset: userActivityOffset,
        },
      });
      setUserActivity({
        ...defaultUserActivity,
        ...response.data,
        users: response.data.users || [],
      });
    } catch {
      console.error('Error fetching user analytics.');
      setUserActivityError('Failed to load user activity data');
    } finally {
      setIsUserActivityLoading(false);
    }
  }, [
    userActivityLimit,
    userActivityOffset,
    userActivityOrder,
    userActivitySort,
    userSearch,
    userTypeFilter,
  ]);

  const fetchAuditEvents = useCallback(async () => {
    setIsAuditLoading(true);
    setAuditError(null);
    try {
      const response = await axios.get<AdminAuditEventsResponse>('/admin/audit-events', {
        withCredentials: true,
        params: {
          actor: auditActorFilter.trim().toLowerCase() || undefined,
          action: auditActionFilter === 'all' ? undefined : auditActionFilter,
          targetType: auditTargetTypeFilter === 'all' ? undefined : auditTargetTypeFilter,
          page: auditPage,
          pageSize: defaultAuditEvents.pageSize,
        },
      });
      setAuditEvents({
        ...defaultAuditEvents,
        ...response.data,
        events: response.data.events || [],
      });
    } catch {
      console.error('Error fetching admin audit events.');
      setAuditError('Failed to load admin audit log');
    } finally {
      setIsAuditLoading(false);
    }
  }, [auditActionFilter, auditActorFilter, auditPage, auditTargetTypeFilter]);

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
        history: response.data.history || [],
      });
    } catch {
      console.error('Error fetching admin access.');
      setAdminAccess(defaultAdminAccess);
      setAdminAccessError('Failed to load admin access data');
    }
  }, []);

  const adminActorNetid = (currentUser?.netId || '').trim().toLowerCase();

  const adminAccessErrorMessage = (error: unknown, fallback: string) => {
    return clientErrorMessage(error, fallback);
  };

  const requestGrantAdminAccess = (event: FormEvent) => {
    event.preventDefault();
    const netid = adminGrantNetid.trim().toLowerCase();
    if (!netid || !adminGrantNote.trim()) {
      setAdminAccessActionError('NetID and reviewer note are required.');
      return;
    }
    setAdminAccessActionError(null);
    setAdminGrantConfirmation('');
    setPendingAdminGrantNetid(netid);
  };
  const closeGrantDialog = () => {
    setPendingAdminGrantNetid(null);
    setAdminGrantConfirmation('');
    window.setTimeout(() => grantReviewButtonRef.current?.focus(), 0);
  };

  const handleGrantAdminAccess = useCallback(async () => {
    const netid = pendingAdminGrantNetid || '';
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
        { netid, note: adminGrantNote.trim() },
        { withCredentials: true },
      );
      setAdminGrantNetid('');
      setAdminGrantNote('');
      setPendingAdminGrantNetid(null);
      setAdminGrantConfirmation('');
      setAdminAccessActionMessage(`Admin access granted to ${netid}.`);
      await fetchAdminAccess();
    } catch (error) {
      setAdminAccessActionError(
        adminAccessErrorMessage(error, `Failed to grant admin access to ${netid}.`),
      );
    } finally {
      setAdminAccessActionNetid(null);
    }
  }, [pendingAdminGrantNetid, adminGrantNote, fetchAdminAccess]);

  useEffect(() => {
    if (pendingAdminGrantNetid) grantDialogCancelRef.current?.focus();
  }, [pendingAdminGrantNetid]);

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
          { note: 'Revoked through the Admin Access panel.' },
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
        { withCredentials: true },
      );
      setSelectedUser({
        ...response.data,
        events: response.data.events || [],
      });
    } catch {
      console.error('Error fetching user drilldown.');
      setSelectedUser(null);
      setSelectedUserError('Failed to load NetID activity');
    } finally {
      setIsSelectedUserLoading(false);
    }
  }, []);

  const fetchImpactAnalytics = useCallback(async () => {
    setIsImpactLoading(true);
    setImpactError(null);

    try {
      const [searchQualityResponse, searchQueriesResponse, funnelResponse, actionsResponse] =
        await Promise.all([
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
    } catch {
      console.error('Error fetching impact analytics.');
      setImpactError('Failed to load impact analytics data');
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
    setUserActivityOffset(0);
  }, [userSearch, userTypeFilter, userActivitySort, userActivityOrder, userActivityLimit]);

  useEffect(() => {
    setAuditPage(1);
  }, [auditActorFilter, auditActionFilter, auditTargetTypeFilter]);

  useEffect(() => {
    if (data) {
      fetchAuditEvents();
    }
  }, [data, fetchAuditEvents]);

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
          <p className="mb-5 text-sm text-gray-600">{error || 'Failed to load analytics data'}</p>
          <button
            type="button"
            onClick={fetchAnalytics}
            className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy yr-focus-ring"
          >
            Retry Analytics
          </button>
        </div>
      </div>
    );
  }

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

  const adminAccessHistory = adminAccess.history || [];

  const searchTotal = searchQuality?.totalSearches || 0;
  const engagedSearches = searchQuality?.engagedSearches || 0;
  const zeroResultQueries = searchQuality?.zeroResultQueries || [];
  const lowResultQueries = searchQuality?.lowResultQueries || [];
  const actionCards = actions?.cards || [];
  const journeyMetrics = funnel?.journeyMetrics || {
    sourceInspections: 0,
    officialRouteAttempts: 0,
    applicationOpens: 0,
  };
  const selectedRangeLabel =
    analyticsRanges.find((range) => range.value === analyticsRange)?.label || 'Selected range';
  const showSevenDayBreakdown =
    analyticsRange === '30d' || analyticsRange === 'semester' || analyticsRange === 'all';
  const showTodayBreakdown = analyticsRange !== 'today';
  const searchSuccessRate = searchTotal > 0 ? engagedSearches / searchTotal : null;
  const researchCoverage = data.researchEntities;
  const activeEntities = researchCoverage.overview.active;
  const studentReadyEntities =
    researchCoverage.byVisibilityTier.find((tier) => tier.tier === 'student_ready')?.count || 0;
  const studentReadyShare = activeEntities > 0 ? studentReadyEntities / activeEntities : null;
  const attentionCount = actionCards.length + zeroResultQueries.length + lowResultQueries.length;
  const healthTone =
    attentionCount > 4 || (searchSuccessRate !== null && searchSuccessRate < 0.75)
      ? 'red'
      : attentionCount > 0
        ? 'amber'
        : 'green';
  const attentionDrivers = [
    actionCards.length > 0
      ? `${formatNumber(actionCards.length)} action card${actionCards.length === 1 ? '' : 's'}`
      : null,
    zeroResultQueries.length > 0
      ? `${formatNumber(zeroResultQueries.length)} zero-result quer${zeroResultQueries.length === 1 ? 'y' : 'ies'}`
      : null,
    lowResultQueries.length > 0
      ? `${formatNumber(lowResultQueries.length)} low-result quer${lowResultQueries.length === 1 ? 'y' : 'ies'}`
      : null,
  ].filter((driver): driver is string => driver !== null);
  const topActionTitle = actionCards[0]?.title;
  const attentionContext =
    attentionCount === 0
      ? 'No urgent admin action returned'
      : `${attentionDrivers.join(', ')} to review${
          topActionTitle ? `, starting with "${topActionTitle}"` : ''
        }.`;

  return (
    <div className="yr-page min-h-[calc(100vh-8rem)]">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <section className="yr-panel mb-8 rounded-md">
          <div className="border-b border-[var(--yr-line)] p-5 lg:flex lg:items-start lg:justify-between lg:gap-8">
            <div className="max-w-3xl">
              <p className="yr-kicker">Primary dashboard question</p>
              <h1 className="mt-2 text-3xl font-semibold text-slate-950">
                Research Discovery Health
              </h1>
              <p className="mt-3 text-base leading-7 text-slate-600">
                Are students finding credible research next steps, and where should admins
                intervene?
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
                  className="min-h-[44px] w-full rounded-md border border-[var(--yr-line-strong)] bg-[var(--yr-panel)] px-3 py-2 text-sm focus:border-brand yr-focus-ring"
                >
                  {analyticsRanges.map((range) => (
                    <option key={range.value} value={range.value}>
                      {range.label}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-gray-500">
                  Scopes usage metrics. Corpus and account snapshots show current state.
                </span>
              </label>
              <button
                onClick={() => {
                  fetchAnalytics();
                  fetchImpactAnalytics();
                  fetchAdminAccess();
                }}
                className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-[var(--yr-blue)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy yr-focus-ring"
              >
                Refresh Data
              </button>
            </div>
          </div>

          <h2 className="sr-only">Key metrics</h2>
          <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-4">
            <DashboardMetric
              title="Search success"
              value={searchSuccessRate === null ? '-' : formatPercent(searchSuccessRate)}
              context={`${formatNumber(engagedSearches)} of ${formatNumber(searchTotal)} site searches (legacy) led to a view or save within ${formatNumber(searchQuality?.attributionWindowMinutes || 30)} minutes in ${selectedRangeLabel}.`}
              tone={searchSuccessRate !== null && searchSuccessRate < 0.75 ? 'amber' : 'green'}
            />
            <DashboardMetric
              title="Official next-step rate"
              value={formatPercent(funnel?.overallConversionRate)}
              context={`Share of logged-in students who reached an official next step (application, open position, or reviewed route) in ${selectedRangeLabel}.`}
              tooltip="Distinct students who reached an official next step, divided by distinct logged-in students, for the selected range."
              tone="blue"
            />
            <DashboardMetric
              title="Student-ready research"
              value={studentReadyShare === null ? '-' : formatPercent(studentReadyShare)}
              context={`${formatNumber(studentReadyEntities)} of ${formatNumber(activeEntities)} active research entities are student-ready.`}
              tone="blue"
            />
            <DashboardMetric
              title="Items to review"
              value={formatNumber(attentionCount)}
              context={attentionContext}
              tone={healthTone}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 border-t border-[var(--yr-line)] p-5 sm:grid-cols-2 lg:grid-cols-4">
            <DashboardMetric
              title="Source reviewers"
              value={formatNumber(journeyMetrics.sourceInspections)}
              context={`Students who opened a profile, publication, website, ORCID, or evidence record in ${selectedRangeLabel}.`}
              tooltip="Distinct students who opened at least one source detail (profile, publication, website, ORCID, or evidence). Research reads, not applications."
              tone="blue"
            />
            <DashboardMetric
              title="Official-route reach"
              value={formatNumber(journeyMetrics.officialRouteAttempts)}
              context={`Students who clicked an application, open-position, or reviewed-route link in ${selectedRangeLabel}.`}
              tooltip="Distinct students who clicked at least one official-route link: application, open position, or reviewed route."
              tone="blue"
            />
            <DashboardMetric
              title="Application opens"
              value={formatNumber(journeyMetrics.applicationOpens)}
              context={`Students who opened an application or open-position link in ${selectedRangeLabel}.`}
              tooltip="Distinct students who opened an application or open-position link. A subset of official-route reach."
              tone="green"
            />
          </div>

          <div className="border-t border-[var(--yr-line)] p-5">
            <h2 className="text-lg font-semibold text-gray-900">Decision Readout</h2>
            <div className="mt-3 space-y-3 text-sm leading-6 text-gray-600">
              <p>
                Start with search success and the official next-step rate: they show whether
                discovery intent becomes visible next-step behavior.
              </p>
              <p>Treat low-result queries and action cards as the work queue, not just warnings.</p>
              <p>
                See the full student action counts and zero- or low-result queries in{' '}
                <a
                  href="#high-impact-diagnostics"
                  className="font-medium text-brand underline-offset-2 hover:underline"
                >
                  High-Impact Diagnostics
                </a>
                .
              </p>
              <p className="text-gray-500">Last updated: {lastUpdated || 'Not refreshed yet'}</p>
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
            <span className="rounded-md border border-line-brand bg-brand-soft px-3 py-2 text-sm font-semibold text-brand">
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
            onSubmit={requestGrantAdminAccess}
          >
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase text-gray-500">
                Grant admin NetID
              </span>
              <input
                className="min-h-[44px] w-full rounded-md border border-[var(--yr-line-strong)] px-3 py-2 text-sm focus:border-brand yr-focus-ring"
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
                className="min-h-[44px] w-full rounded-md border border-[var(--yr-line-strong)] px-3 py-2 text-sm focus:border-brand yr-focus-ring"
                value={adminGrantNote}
                onChange={(event) => setAdminGrantNote(event.target.value)}
                placeholder="Required reason for this grant"
                maxLength={512}
              />
            </label>
            <button
              ref={grantReviewButtonRef}
              className="inline-flex min-h-[44px] items-center justify-center self-end rounded-md bg-[var(--yr-blue)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy disabled:cursor-not-allowed disabled:bg-slate-300"
              type="submit"
              disabled={adminAccessActionNetid !== null}
            >
              Review Grant
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
              {adminAccess.legacyAdminsWithoutGrant.length} profile-derived admin authorit
              {adminAccess.legacyAdminsWithoutGrant.length === 1 ? 'y is' : 'ies are'} present
              without an active grant. These records are shown separately and do not silently change
              the production authorization policy.
              <div className="mt-3 flex flex-wrap gap-2">
                {adminAccess.legacyAdminsWithoutGrant.map((user) => (
                  <button
                    key={user.netid}
                    type="button"
                    className="rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={adminAccessActionNetid !== null}
                    onClick={() => {
                      setAdminGrantNetid(user.netid);
                      setAdminGrantNote('');
                    }}
                  >
                    Review profile authority
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
                        <tr
                          key={`${grant.netid}-${grant.status}`}
                          className="border-b hover:bg-gray-50"
                        >
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

          <div className="mt-6">
            <h3 className="text-lg font-semibold text-gray-800">Admin access history</h3>
            <p className="mb-3 text-sm text-gray-500">
              Every grant and revoke, newest first, from the recorded grant history.
            </p>
            {adminAccessHistory.length > 0 ? (
              <ol className="space-y-2 border-l border-[var(--yr-line-strong)] pl-4">
                {adminAccessHistory.map((entry, index) => (
                  <li
                    key={`${entry.subjectNetid}-${entry.action}-${entry.at ?? index}`}
                    className="relative rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] px-3 py-2 text-sm"
                  >
                    <span
                      className={`mr-2 rounded-md px-2 py-0.5 text-xs font-semibold ${
                        entry.action === 'granted'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-red-50 text-red-700'
                      }`}
                    >
                      {entry.action}
                    </span>
                    <span className="font-medium text-gray-900">{entry.subjectNetid}</span>
                    <span className="text-gray-600"> by {entry.actorNetid || '-'}</span>
                    <span className="ml-2 text-xs text-gray-500">{formatDateTime(entry.at)}</span>
                    {entry.note && (
                      <p className="mt-1 text-xs italic text-gray-600">{entry.note}</p>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-gray-500">No admin access history recorded yet.</p>
            )}
          </div>
          {pendingAdminGrantNetid && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
              role="presentation"
              onKeyDown={(event) => {
                if (event.key === 'Escape') closeGrantDialog();
              }}
            >
              <div
                aria-describedby="admin-grant-confirm-description"
                aria-labelledby="admin-grant-confirm-title"
                aria-modal="true"
                className="w-full max-w-lg rounded-md bg-white p-6 shadow-xl"
                role="dialog"
              >
                <h3 id="admin-grant-confirm-title" className="text-lg font-bold text-gray-900">
                  Confirm admin grant
                </h3>
                <p id="admin-grant-confirm-description" className="mt-2 text-sm text-gray-700">
                  Grant admin authority to <strong>{pendingAdminGrantNetid}</strong>. Enter the
                  target NetID again to confirm this deliberate access change.
                </p>
                <label className="mt-4 block text-sm font-semibold text-gray-700">
                  Confirm target NetID
                  <input
                    autoComplete="off"
                    className="mt-1 min-h-[44px] w-full rounded-md border px-3 py-2"
                    value={adminGrantConfirmation}
                    onChange={(event) => setAdminGrantConfirmation(event.target.value)}
                  />
                </label>
                <div className="mt-5 flex justify-end gap-3">
                  <button
                    ref={grantDialogCancelRef}
                    type="button"
                    className="rounded-md border px-4 py-2 text-sm font-semibold"
                    onClick={closeGrantDialog}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-[var(--yr-blue)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    disabled={
                      adminAccessActionNetid !== null ||
                      adminGrantConfirmation.trim().toLowerCase() !== pendingAdminGrantNetid
                    }
                    onClick={() => void handleGrantAdminAccess()}
                  >
                    Confirm Grant
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="mb-10">
          <div className="mb-4 flex flex-col gap-2 border-b border-slate-200 pb-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-800">Admin Action Audit Log</h2>
              <p className="text-sm text-gray-500">
                Append-only record of privileged operator mutations. Filter by actor, action, or
                target.
              </p>
            </div>
            <button
              type="button"
              onClick={fetchAuditEvents}
              className="inline-flex min-h-[44px] items-center justify-center self-start rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-navy disabled:cursor-not-allowed disabled:bg-slate-300 md:self-auto"
              disabled={isAuditLoading}
            >
              {isAuditLoading ? 'Refreshing...' : 'Refresh Log'}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 rounded-lg border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4 lg:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Actor NetID
              </span>
              <input
                type="search"
                value={auditActorFilter}
                onChange={(event) => setAuditActorFilter(event.target.value)}
                placeholder="e.g. abc1234"
                className="min-h-[44px] w-full rounded-md border border-[var(--yr-line-strong)] px-3 py-2 text-sm focus:border-brand yr-focus-ring"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Action
              </span>
              <select
                value={auditActionFilter}
                onChange={(event) => setAuditActionFilter(event.target.value)}
                className="min-h-[44px] w-full rounded-md border border-[var(--yr-line-strong)] px-3 py-2 text-sm focus:border-brand yr-focus-ring"
              >
                <option value="all">All actions</option>
                {Object.entries(AUDIT_ACTION_LABELS).map(([action, label]) => (
                  <option key={action} value={action}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Target Type
              </span>
              <select
                value={auditTargetTypeFilter}
                onChange={(event) => setAuditTargetTypeFilter(event.target.value)}
                className="min-h-[44px] w-full rounded-md border border-[var(--yr-line-strong)] px-3 py-2 text-sm focus:border-brand yr-focus-ring"
              >
                <option value="all">All targets</option>
                <option value="adminGrant">Admin grant</option>
                <option value="profile">Profile</option>
                <option value="department">Department</option>
                <option value="researchArea">Research area</option>
                <option value="fellowship">Fellowship</option>
                <option value="researchEntity">Research entity</option>
                <option value="accessReviewRecord">Access review record</option>
              </select>
            </label>
          </div>

          {auditError && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {auditError}
            </div>
          )}

          <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-md">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                      When
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                      Actor
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                      Action
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                      Target
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                      Details
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {isAuditLoading && auditEvents.events.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-center text-gray-500" colSpan={5}>
                        Loading audit log...
                      </td>
                    </tr>
                  ) : auditEvents.events.length > 0 ? (
                    auditEvents.events.map((event: AdminAuditEvent) => (
                      <tr key={event.id} className="border-b align-top hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {formatDateTime(event.timestamp)}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">{event.actorNetid}</td>
                        <td className="px-4 py-3 text-gray-700">
                          {auditActionLabel(event.action)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {event.targetType ? (
                            <>
                              <span className="font-medium text-gray-700">{event.targetType}</span>
                              {event.targetId && (
                                <span className="block break-all text-xs text-gray-500">
                                  {event.targetId}
                                </span>
                              )}
                            </>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">
                          {event.summary?.status && (
                            <span className="mr-2 rounded-md bg-brand-soft px-2 py-0.5 font-semibold text-brand">
                              {event.summary.status}
                            </span>
                          )}
                          {event.summary?.fields && event.summary.fields.length > 0 && (
                            <span className="text-gray-500">{event.summary.fields.join(', ')}</span>
                          )}
                          {event.summary?.note && (
                            <p className="mt-1 italic text-gray-600">{event.summary.note}</p>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-4 py-6 text-center text-gray-500" colSpan={5}>
                        No admin actions recorded for these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-2 text-sm text-gray-500 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Page {auditEvents.page} of {auditEvents.totalPages} - {auditEvents.total} total
              actions
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAuditPage((page) => Math.max(1, page - 1))}
                disabled={isAuditLoading || auditEvents.page <= 1}
                className="inline-flex min-h-[44px] items-center rounded-md border border-[var(--yr-line-strong)] px-3 py-2 text-gray-700 transition-colors hover:bg-[var(--yr-panel-muted)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setAuditPage((page) => Math.min(auditEvents.totalPages, page + 1))}
                disabled={isAuditLoading || auditEvents.page >= auditEvents.totalPages}
                className="inline-flex min-h-[44px] items-center rounded-md border border-[var(--yr-line-strong)] px-3 py-2 text-gray-700 transition-colors hover:bg-[var(--yr-panel-muted)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
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
          <a
            className="rounded-md border border-[var(--yr-line)] px-3 py-2 text-brand"
            href="#visitor-statistics"
          >
            Visitors
          </a>
          <a
            className="rounded-md border border-[var(--yr-line)] px-3 py-2 text-brand"
            href="#diagnostics"
          >
            Diagnostics
          </a>
          <a
            className="rounded-md border border-[var(--yr-line)] px-3 py-2 text-brand"
            href="#research-coverage"
          >
            Research Coverage
          </a>
        </nav>

        <Suspense fallback={<SectionLoadingFallback label="Loading detailed analytics sections" />}>
          <AnalyticsSupportingDetail
            data={data}
            selectedRangeLabel={selectedRangeLabel}
            showSevenDayBreakdown={showSevenDayBreakdown}
            showTodayBreakdown={showTodayBreakdown}
            searchQuality={searchQuality}
            searchQueries={searchQueries}
            funnel={funnel}
            actions={actions}
            isImpactLoading={isImpactLoading}
            impactError={impactError}
            userActivity={userActivity}
            isUserActivityLoading={isUserActivityLoading}
            userActivityError={userActivityError}
            userSearch={userSearch}
            setUserSearch={setUserSearch}
            userTypeFilter={userTypeFilter}
            setUserTypeFilter={setUserTypeFilter}
            userActivitySort={userActivitySort}
            setUserActivitySort={setUserActivitySort}
            userActivityOrder={userActivityOrder}
            setUserActivityOrder={setUserActivityOrder}
            userActivityLimit={userActivityLimit}
            setUserActivityLimit={setUserActivityLimit}
            setUserActivityOffset={setUserActivityOffset}
            fetchUserActivity={fetchUserActivity}
            updateUserActivitySort={updateUserActivitySort}
            sortLabel={sortLabel}
            selectedNetid={selectedNetid}
            setSelectedNetid={setSelectedNetid}
            selectedUser={selectedUser}
            isSelectedUserLoading={isSelectedUserLoading}
            selectedUserError={selectedUserError}
          />
        </Suspense>

        <Suspense fallback={<SectionLoadingFallback label="Loading admin controls" />}>
          <AdminPanel />
        </Suspense>
      </div>
    </div>
  );
};

export default Analytics;
