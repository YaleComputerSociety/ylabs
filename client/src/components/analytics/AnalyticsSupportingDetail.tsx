import { Dispatch, SetStateAction } from 'react';
import { Link } from 'react-router-dom';
import {
  AnalyticsActionNeededResponse,
  AnalyticsData,
  AnalyticsFunnelResponse,
  AnalyticsFunnelStage,
  AnalyticsSearchQualityResponse,
  AnalyticsSearchQueryResponse,
  AnalyticsUserActivityResponse,
  AnalyticsUserActivityRow,
  AnalyticsUserDrilldownResponse,
} from '../../reducers/analyticsReducer';
import { SortOrder, UserActivitySort } from './analyticsTypes';
import BarChart from './charts/BarChart';
import { csvTimestampSuffix, downloadRowsAsCsv } from '../../utils/csvExport';
import {
  DetailSectionHeader,
  ScopeBadge,
  StatCard,
  actionPriorityClass,
  formatCompactMetric,
  formatDateTime,
  formatEntityType,
  formatEventType,
  formatFullName,
  formatNumber,
  formatOutcome,
  formatPercent,
  formatSearcherName,
  formatUserType,
  formatVisibilityTier,
} from './analyticsPresentation';

export interface AnalyticsSupportingDetailProps {
  data: AnalyticsData;
  selectedRangeLabel: string;
  showSevenDayBreakdown: boolean;
  showTodayBreakdown: boolean;
  searchQuality: AnalyticsSearchQualityResponse | null;
  searchQueries: AnalyticsSearchQueryResponse | null;
  funnel: AnalyticsFunnelResponse | null;
  actions: AnalyticsActionNeededResponse | null;
  isImpactLoading: boolean;
  impactError: string | null;
  userActivity: AnalyticsUserActivityResponse;
  isUserActivityLoading: boolean;
  userActivityError: string | null;
  userSearch: string;
  setUserSearch: Dispatch<SetStateAction<string>>;
  userTypeFilter: string;
  setUserTypeFilter: Dispatch<SetStateAction<string>>;
  userActivitySort: UserActivitySort;
  setUserActivitySort: Dispatch<SetStateAction<UserActivitySort>>;
  userActivityOrder: SortOrder;
  setUserActivityOrder: Dispatch<SetStateAction<SortOrder>>;
  userActivityLimit: number;
  setUserActivityLimit: Dispatch<SetStateAction<number>>;
  setUserActivityOffset: Dispatch<SetStateAction<number>>;
  fetchUserActivity: () => void;
  updateUserActivitySort: (sort: UserActivitySort) => void;
  sortLabel: (sort: UserActivitySort) => string;
  selectedNetid: string | null;
  setSelectedNetid: Dispatch<SetStateAction<string | null>>;
  selectedUser: AnalyticsUserDrilldownResponse | null;
  isSelectedUserLoading: boolean;
  selectedUserError: string | null;
}

const AnalyticsSupportingDetail = ({
  data,
  selectedRangeLabel,
  showSevenDayBreakdown,
  showTodayBreakdown,
  searchQuality,
  searchQueries,
  funnel,
  actions,
  isImpactLoading,
  impactError,
  userActivity,
  isUserActivityLoading,
  userActivityError,
  userSearch,
  setUserSearch,
  userTypeFilter,
  setUserTypeFilter,
  userActivitySort,
  setUserActivitySort,
  userActivityOrder,
  setUserActivityOrder,
  userActivityLimit,
  setUserActivityLimit,
  setUserActivityOffset,
  fetchUserActivity,
  updateUserActivitySort,
  sortLabel,
  selectedNetid,
  setSelectedNetid,
  selectedUser,
  isSelectedUserLoading,
  selectedUserError,
}: AnalyticsSupportingDetailProps) => {
  const researchCoverage = data.researchEntities;
  const activeEntities = researchCoverage.overview.active;
  const studentReadyEntities =
    researchCoverage.byVisibilityTier.find((tier) => tier.tier === 'student_ready')?.count || 0;
  const studentReadyShare = activeEntities > 0 ? studentReadyEntities / activeEntities : null;
  const freshEntities = researchCoverage.freshness.observedLast30Days;
  const freshShare = activeEntities > 0 ? freshEntities / activeEntities : null;
  const staleEntities =
    researchCoverage.freshness.staleOver90Days + researchCoverage.freshness.neverObserved;

  const searchTotal = searchQuality?.totalSearches || 0;
  const engagedSearches = searchQuality?.engagedSearches || 0;
  const returnedButIgnoredSearches = searchQuality?.returnedButIgnoredSearches || 0;
  const avgResults = searchQuality?.avgResults ?? searchQuality?.avgResultsPerSearch;
  const zeroResultQueries = searchQuality?.zeroResultQueries || [];
  const lowResultQueries = searchQuality?.lowResultQueries || [];
  const flaggedQueries = [
    ...zeroResultQueries.map((query) => ({ query, isZeroResult: true })),
    ...lowResultQueries.map((query) => ({ query, isZeroResult: false })),
  ].slice(0, 5);
  const searchQueryRows = searchQueries?.queries || [];
  const actionCards = actions?.cards || [];
  const fallbackFunnelStages: AnalyticsFunnelStage[] = [
    { key: 'visitors', label: 'Visitors', count: funnel?.visitorCount || 0 },
    { key: 'searchers', label: 'Searched', count: funnel?.searcherCount || 0 },
    { key: 'viewers', label: 'Viewed Opportunities', count: funnel?.viewerCount || 0 },
    { key: 'applications', label: 'Used a qualified route', count: funnel?.applicantCount || 0 },
  ].filter((stage) => stage.count > 0);
  const funnelStages: AnalyticsFunnelStage[] = funnel?.stages || fallbackFunnelStages;

  const selectedUserSummary: AnalyticsUserActivityRow | null =
    selectedUser?.user || userActivity.users.find((user) => user.netid === selectedNetid) || null;

  const userActivityPageStart = userActivity.total === 0 ? 0 : userActivity.offset + 1;
  const userActivityPageEnd = userActivity.offset + userActivity.users.length;
  const userActivityHasPrev = userActivity.offset > 0;
  const userActivityHasNext = userActivityPageEnd < userActivity.total;

  const exportUserActivityCsv = () => {
    downloadRowsAsCsv(`user-activity-${csvTimestampSuffix()}.csv`, userActivity.users, [
      { header: 'NetID', value: (row) => row.netid },
      { header: 'Name', value: (row) => formatFullName(row.fname, row.lname) },
      { header: 'Type', value: (row) => formatUserType(row.userType) },
      { header: 'Total Events', value: (row) => row.totalEvents },
      { header: 'Logins', value: (row) => row.logins },
      { header: 'Site Searches', value: (row) => row.searches },
      { header: 'Research Views', value: (row) => row.researchViews },
      {
        header: 'Last Active',
        value: (row) => (row.lastActive ? formatDateTime(row.lastActive) : ''),
      },
    ]);
  };

  const exportSearchQueriesCsv = () => {
    downloadRowsAsCsv(`search-queries-${csvTimestampSuffix()}.csv`, searchQueryRows, [
      { header: 'Query', value: (row) => row.query || '(empty search)' },
      { header: 'Site Searches', value: (row) => row.totalSearches },
      { header: 'Unique Searchers', value: (row) => row.uniqueSearchers },
      { header: 'Zero Results', value: (row) => row.zeroResultSearches || 0 },
      {
        header: 'Last Search',
        value: (row) => (row.lastSearchedAt ? formatDateTime(row.lastSearchedAt) : ''),
      },
      {
        header: 'Who Searched',
        value: (row) =>
          row.searchers.map((searcher) => `${searcher.netid} (${searcher.searchCount})`).join('; '),
      },
    ]);
  };

  return (
    <>
      <section id="research-coverage" className="mb-10">
        <div className="mb-4 flex flex-col gap-2 border-b border-[var(--yr-line)] pb-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">
              Research Data Coverage
              <ScopeBadge label="Current snapshot" />
            </h2>
            <p className="text-sm text-gray-500">
              Scraped ResearchEntity corpus — the primary catalog students browse. Counts cover
              active (non-archived) entities and reflect current state, not the selected range.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          <StatCard
            title="Active Research Entities"
            value={researchCoverage.overview.active}
            subtitle="Source-discovered catalog"
          />
          <StatCard
            title="Student-Ready"
            value={studentReadyEntities}
            subtitle={
              studentReadyShare === null
                ? undefined
                : `${formatPercent(studentReadyShare)} of active`
            }
          />
          <StatCard
            title="Refreshed (30 Days)"
            value={freshEntities}
            subtitle={freshShare === null ? undefined : `${formatPercent(freshShare)} of active`}
          />
          <StatCard
            title="Stale or Never Observed"
            value={staleEntities}
            subtitle={`${formatNumber(researchCoverage.freshness.neverObserved)} never observed`}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="bg-[var(--yr-panel)] rounded-lg shadow-md border border-[var(--yr-line)] overflow-hidden">
            <div className="border-b border-[var(--yr-line)] p-4">
              <h3 className="text-lg font-semibold text-gray-800">By Entity Type</h3>
              <p className="text-sm text-gray-500">What kinds of research homes exist</p>
            </div>
            <div className="p-4">
              <BarChart
                ariaLabel="Active research entities by type"
                emptyMessage="No research entities returned."
                showShareOfTotal
                valueFormatter={(value) => formatNumber(value)}
                data={researchCoverage.byType.map((row) => ({
                  label: formatEntityType(row.entityType),
                  value: row.count,
                }))}
              />
            </div>
          </div>

          <div className="bg-[var(--yr-panel)] rounded-lg shadow-md border border-[var(--yr-line)] overflow-hidden">
            <div className="border-b border-[var(--yr-line)] p-4">
              <h3 className="text-lg font-semibold text-gray-800">By Visibility Tier</h3>
              <p className="text-sm text-gray-500">Student-facing exposure gating</p>
            </div>
            <div className="p-4">
              <BarChart
                ariaLabel="Research entities by visibility tier"
                emptyMessage="No tier data returned."
                showShareOfTotal
                valueFormatter={(value) => formatNumber(value)}
                data={researchCoverage.byVisibilityTier.map((row) => ({
                  label: formatVisibilityTier(row.tier),
                  value: row.count,
                }))}
              />
            </div>
          </div>

          <div className="bg-[var(--yr-panel)] rounded-lg shadow-md border border-[var(--yr-line)] overflow-hidden">
            <div className="border-b border-[var(--yr-line)] p-4">
              <h3 className="text-lg font-semibold text-gray-800">Scholarly Signal</h3>
              <p className="text-sm text-gray-500">Recent activity</p>
            </div>
            <div className="space-y-2 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-600">With recent grants</span>
                <span className="font-medium text-gray-900">
                  {formatNumber(researchCoverage.scholarly.withRecentGrants)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="visitor-statistics" className="mb-10">
        <h2 className="text-2xl font-semibold mb-4 text-slate-950 border-b border-[var(--yr-line)] pb-2">
          Visitor Statistics
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <StatCard
            title={`Visitors (${selectedRangeLabel})`}
            value={data.visitors.lifetime.total}
            subtitle="Unique users who logged in"
          />
          {showSevenDayBreakdown && (
            <StatCard
              title="Visitors (Last 7 Days)"
              value={data.visitors.last7Days.total}
              subtitle="Active in past week"
            />
          )}
          {showTodayBreakdown && (
            <StatCard
              title="Visitors Today"
              value={data.visitors.today.total}
              subtitle="Logged in today"
            />
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <StatCard
            title={`Login Events (${selectedRangeLabel})`}
            value={data.visitors.loginFrequency.totalLogins}
            subtitle="Total sign-ins in range; one visitor can sign in many times"
          />
          {showSevenDayBreakdown && (
            <StatCard
              title="Logins (Last 7 Days)"
              value={data.visitors.loginFrequency.loginsLast7Days}
              subtitle="Total logins this week"
            />
          )}
          {showTodayBreakdown && (
            <StatCard
              title="Logins Today"
              value={data.visitors.loginFrequency.loginsToday}
              subtitle="Login events today"
            />
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-[var(--yr-panel)] rounded-lg shadow-md p-6 border border-[var(--yr-line)]">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              Visitors by Type ({selectedRangeLabel})
            </h3>
            <BarChart
              ariaLabel={`Visitors by type for ${selectedRangeLabel}`}
              emptyMessage="No visitors in range."
              showShareOfTotal
              data={data.visitors.lifetime.byType.map((item) => ({
                label: formatUserType(item.userType),
                value: item.count,
              }))}
            />
          </div>

          {showSevenDayBreakdown && (
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
          )}

          {showTodayBreakdown && (
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
          )}
        </div>
      </section>

      <section id="diagnostics" className="mb-10">
        <h2 className="text-2xl font-semibold mb-4 text-slate-950 border-b border-[var(--yr-line)] pb-2">
          User Engagement
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <StatCard
            title={`Site searches (${selectedRangeLabel})`}
            value={data.engagement.search.totalSearches}
            subtitle="Legacy site-wide search, distinct from Research searches"
          />
          {showSevenDayBreakdown && (
            <StatCard
              title="Site searches (Last 7 Days)"
              value={data.engagement.search.searchesLast7Days}
              subtitle="Recent site-wide searches"
            />
          )}
          {showTodayBreakdown && (
            <StatCard
              title="Site searches Today"
              value={data.engagement.search.searchesToday}
              subtitle="Site-wide searches today"
            />
          )}
        </div>

        {data.engagement.topSearchQueries.length > 0 && (
          <div className="bg-[var(--yr-panel)] rounded-lg shadow-md p-6 border border-[var(--yr-line)] mb-6">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">
              Top Search Queries ({selectedRangeLabel})
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <StatCard
            title={`Active Users (${selectedRangeLabel})`}
            value={data.engagement.userActivity.activeUsers}
            subtitle="Users with activity in range"
          />
          <StatCard
            title="Avg Events Per User"
            value={data.engagement.userActivity.avgEventsPerUser.toFixed(1)}
            subtitle={`Events (logins, searches, research views) per active user in ${selectedRangeLabel}`}
          />
        </div>
      </section>


      <section id="high-impact-diagnostics" className="mb-10">
        <div className="mb-4 flex flex-col gap-2 border-b border-[var(--yr-line)] pb-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">High-Impact Diagnostics</h2>
            <p className="text-sm text-gray-500">{selectedRangeLabel} snapshot</p>
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
              <p className="text-sm text-gray-500">
                Legacy site-wide search - results coverage and failed intent signals
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 p-4 text-sm">
              <div>
                <p className="text-gray-500">Site searches</p>
                <p className="text-xl font-semibold text-gray-900">{formatNumber(searchTotal)}</p>
              </div>
              <div>
                <p className="text-gray-500">Led to Action</p>
                <p className="text-xl font-semibold text-gray-900">
                  {formatNumber(engagedSearches)}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Zero-Result rate</p>
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
              <div className="mb-2 flex justify-between text-gray-600">
                <span>Avg latency</span>
                <span className="font-medium text-gray-900">
                  {searchQuality?.avgLatencyMs
                    ? `${formatNumber(searchQuality.avgLatencyMs)} ms`
                    : '-'}
                </span>
              </div>
              <div className="mb-3 flex justify-between text-gray-600">
                <span>Returned but ignored</span>
                <span className="font-medium text-gray-900">
                  {formatNumber(returnedButIgnoredSearches)}
                </span>
              </div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Zero or Low Result Queries
              </h4>
              <div className="space-y-2">
                {flaggedQueries.map(({ query, isZeroResult }, index) => {
                  const searchCount =
                    query.zeroResults ??
                    query.zeroResultSearches ??
                    query.count ??
                    query.totalSearches ??
                    0;
                  const avgResults =
                    query.avgResults ?? query.avgResultsPerSearch ?? query.avgResultCount;
                  const resultLabel = isZeroResult
                    ? '0 results'
                    : avgResults != null
                      ? `~${formatNumber(avgResults, 1)} results`
                      : 'few results';
                  return (
                    <div
                      key={`${query.query}-${index}`}
                      className="flex items-center justify-between gap-3 border-b border-[var(--yr-line)] pb-2 last:border-0 last:pb-0"
                    >
                      <span className="min-w-0 truncate text-gray-700">
                        {query.query || '(empty search)'}
                      </span>
                      <span className="shrink-0 text-right text-xs font-medium text-blue-600">
                        {formatNumber(searchCount)} {searchCount === 1 ? 'search' : 'searches'} ·{' '}
                        {resultLabel}
                      </span>
                    </div>
                  );
                })}
                {flaggedQueries.length === 0 && (
                  <p className="text-gray-500">No search quality flags returned.</p>
                )}
              </div>
            </div>
          </div>

          <div className="bg-[var(--yr-panel)] rounded-lg shadow-md border border-[var(--yr-line)] overflow-hidden">
            <div className="border-b border-[var(--yr-line)] p-4">
              <h3 className="text-lg font-semibold text-gray-800">Student Action Counts</h3>
              <p className="text-sm text-gray-500">
                Distinct students who took each research action in this range. These are independent
                counts, not a nested funnel, so a later action can exceed an earlier one.
              </p>
            </div>
            <div className="p-4">
              <div className="mb-4 rounded-md bg-[var(--yr-blue-soft)] p-3">
                <p className="text-sm text-blue-700">Official next-step rate</p>
                <p className="text-2xl font-semibold text-blue-900">
                  {formatPercent(funnel?.overallConversionRate)}
                </p>
                <p className="mt-1 text-xs text-blue-700">
                  Students reaching an official next step, as a share of logged-in students.
                </p>
              </div>
              <BarChart
                ariaLabel="Student action counts"
                emptyMessage="No student actions returned."
                valueFormatter={(value) => formatNumber(value)}
                data={funnelStages.map((stage) => ({
                  label: stage.label,
                  value: stage.count,
                }))}
              />
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
          <button
            type="button"
            onClick={exportSearchQueriesCsv}
            disabled={searchQueryRows.length === 0}
            className="inline-flex min-h-[44px] items-center justify-center self-start rounded-md border border-[var(--yr-line-strong)] px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-[var(--yr-panel-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-50 md:self-auto"
          >
            Export CSV
          </button>
        </div>

        <div className="overflow-hidden rounded-lg border border-[var(--yr-line)] bg-[var(--yr-panel)] shadow-md">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b bg-[var(--yr-panel-muted)]">
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Query</th>
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
                    <tr
                      key={query.query}
                      className="border-b align-top hover:bg-[var(--yr-panel-muted)]"
                    >
                      <td className="max-w-xs px-4 py-3 font-medium text-gray-900">
                        {query.query || '(empty search)'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-blue-600">
                        {formatNumber(query.totalSearches)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {formatNumber(query.uniqueSearchers)}
                      </td>
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
            Most Active Users ({selectedRangeLabel})
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
                    <tr
                      key={`${user.userId}-${index}`}
                      className="border-b hover:bg-[var(--yr-panel-muted)]"
                    >
                      <td className="py-3 px-4 text-gray-800">
                        <div className="font-medium text-gray-900">{user.userId}</div>
                        {formatFullName(user.fname, user.lname) && (
                          <div className="text-xs text-gray-500">
                            {formatFullName(user.fname, user.lname)}
                          </div>
                        )}
                      </td>
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
          <div className="flex flex-wrap gap-2 self-start md:self-auto">
            <button
              type="button"
              onClick={exportUserActivityCsv}
              disabled={userActivity.users.length === 0}
              className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-[var(--yr-line-strong)] px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-[var(--yr-panel-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={fetchUserActivity}
              className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-navy disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={isUserActivityLoading}
            >
              {isUserActivityLoading ? 'Refreshing...' : 'Refresh Users'}
            </button>
          </div>
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
                <option value="professor">Faculty & Professors</option>
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
                <option value="searches">Site searches</option>
                <option value="researchViews">Research Views</option>
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
                  Showing {userActivityPageStart}-{userActivityPageEnd} of {userActivity.total}{' '}
                  matching users
                </span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setUserActivityOffset((offset) => Math.max(0, offset - userActivityLimit))
                    }
                    disabled={isUserActivityLoading || !userActivityHasPrev}
                    className="inline-flex min-h-[44px] items-center rounded-md border border-[var(--yr-line-strong)] px-3 py-2 text-gray-700 transition-colors hover:bg-[var(--yr-panel-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => setUserActivityOffset((offset) => offset + userActivityLimit)}
                    disabled={isUserActivityLoading || !userActivityHasNext}
                    className="inline-flex min-h-[44px] items-center rounded-md border border-[var(--yr-line-strong)] px-3 py-2 text-gray-700 transition-colors hover:bg-[var(--yr-panel-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
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
                          Site searches{sortLabel('searches')}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                        <button
                          type="button"
                          onClick={() => updateUserActivitySort('researchViews')}
                          className="inline-flex min-h-[44px] items-center rounded-md px-2 hover:bg-[var(--yr-panel-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                        >
                          Research Views{sortLabel('researchViews')}
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
                        <td className="px-4 py-6 text-center text-gray-500" colSpan={8}>
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
                          <td className="px-4 py-3 font-medium text-gray-900">
                            <div>{user.netid}</div>
                            {formatFullName(user.fname, user.lname) && (
                              <div className="text-xs font-normal text-gray-500">
                                {formatFullName(user.fname, user.lname)}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            {formatUserType(user.userType)}
                          </td>
                          <td className="px-4 py-3 text-right font-medium">{user.totalEvents}</td>
                          <td className="px-4 py-3 text-right">{user.logins}</td>
                          <td className="px-4 py-3 text-right">{user.searches}</td>
                          <td className="px-4 py-3 text-right">{user.researchViews}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {formatDateTime(user.lastActive)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="px-4 py-6 text-center text-gray-500" colSpan={8}>
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
                    {selectedNetid
                      ? formatFullName(selectedUserSummary?.fname, selectedUserSummary?.lname) ||
                        selectedNetid
                      : 'Select a NetID'}
                  </h3>
                  {selectedNetid &&
                    formatFullName(selectedUserSummary?.fname, selectedUserSummary?.lname) && (
                      <p className="text-xs text-gray-500">{selectedNetid}</p>
                    )}
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
                      <p className="text-gray-500">Site searches</p>
                      <p className="text-lg font-semibold text-gray-900">
                        {selectedUser.user.searches}
                      </p>
                    </div>
                    <div className="rounded-md bg-[var(--yr-panel)] p-3">
                      <p className="text-gray-500">Research Views</p>
                      <p className="text-lg font-semibold text-gray-900">
                        {selectedUser.user.researchViews}
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
                          key={
                            event.id ||
                            event._id ||
                            `${event.eventType}-${event.timestamp}-${index}`
                          }
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
                          {event.fellowshipId && (
                            <p className="mt-1 text-sm text-gray-600">
                              Fellowship: {event.fellowshipTitle || event.fellowshipId}
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

      <section className="mb-10">
        <DetailSectionHeader
          title="Research Engagement"
          description={`Student-facing research surface events across profiles, opportunities, and programs. Scoped to ${selectedRangeLabel}.`}
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          {data.research.byEventType.slice(0, 3).map((item) => (
            <StatCard
              key={item.eventType}
              title={formatEventType(item.eventType)}
              value={item.total}
              subtitle={
                [
                  showSevenDayBreakdown ? `${item.last7Days} last 7 days` : null,
                  showTodayBreakdown ? `${item.today} today` : null,
                ]
                  .filter(Boolean)
                  .join(', ') || selectedRangeLabel
              }
            />
          ))}
          {data.research.byEventType.length === 0 && (
            <div className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-6 text-sm text-gray-500 md:col-span-3">
              No research engagement events yet.
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-[var(--yr-panel)] rounded-lg shadow-md p-6 border border-[var(--yr-line)]">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">Events by Entity</h3>
            <div className="space-y-2">
              {data.research.byEntityType.length > 0 ? (
                data.research.byEntityType.slice(0, 8).map((item) => (
                  <div
                    key={`${item.entityType}-${item.eventType}`}
                    className="flex justify-between gap-3 text-sm"
                  >
                    <span className="text-gray-600">
                      {formatEntityType(item.entityType)} / {formatEventType(item.eventType)}
                    </span>
                    <span className="font-medium">{item.count}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500">No entity events yet.</p>
              )}
            </div>
          </div>

          <div className="bg-[var(--yr-panel)] rounded-lg shadow-md p-6 border border-[var(--yr-line)]">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">Research Users</h3>
            <div className="space-y-2">
              {data.research.byUserType.length > 0 ? (
                data.research.byUserType.map((item) => (
                  <div key={item.userType} className="flex justify-between text-sm">
                    <span className="text-gray-600">{formatUserType(item.userType)}</span>
                    <span className="font-medium">{item.count}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500">No research users yet.</p>
              )}
            </div>
          </div>

          <div className="bg-[var(--yr-panel)] rounded-lg shadow-md p-6 border border-[var(--yr-line)]">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">
              Top Research Entities ({selectedRangeLabel})
            </h3>
            <div className="space-y-2">
              {data.research.topEntities.length > 0 ? (
                data.research.topEntities.slice(0, 8).map((item) => {
                  const label = item.name || item.entityId;
                  const detail = (
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">
                        <span className="text-gray-500">{formatEntityType(item.entityType)}:</span>{' '}
                        <span className="font-medium">{label}</span>
                      </span>
                      {item.name && (
                        <span className="truncate text-xs text-gray-400">{item.entityId}</span>
                      )}
                    </span>
                  );
                  return (
                    <div
                      key={`${item.entityType}-${item.entityId}`}
                      className="flex items-start justify-between gap-3 text-sm"
                    >
                      {item.href ? (
                        <Link to={item.href} className="min-w-0 text-blue-700 hover:underline">
                          {detail}
                        </Link>
                      ) : (
                        <span className="min-w-0 text-gray-600">{detail}</span>
                      )}
                      <span className="whitespace-nowrap font-medium">
                        {item.views} {item.views === 1 ? 'view' : 'views'} / {item.uniqueViewers}{' '}
                        {item.uniqueViewers === 1 ? 'user' : 'users'}
                      </span>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-gray-500">No viewed entities yet.</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-2xl font-semibold mb-4 text-slate-950 border-b border-[var(--yr-line)] pb-2">
          User Statistics
          <ScopeBadge label="Current snapshot" />
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
    </>
  );
};

export default AnalyticsSupportingDetail;
