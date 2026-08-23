import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Analytics from '../analytics';
import axios from '../../utils/axios';
import { AnalyticsData } from '../../reducers/analyticsReducer';
import swal from 'sweetalert';
import UserContext from '../../contexts/UserContext';

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('sweetalert', () => ({
  default: vi.fn(),
}));

vi.mock('../../components/admin/AdminPanel', () => ({
  default: () => <div data-testid="admin-panel" />,
}));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};
const mockedSwal = vi.mocked(swal);

const analyticsData: AnalyticsData = {
  visitors: {
    lifetime: { total: 1, byType: [{ userType: 'admin', count: 1 }] },
    last7Days: { total: 1, byType: [{ userType: 'admin', count: 1 }] },
    today: { total: 1, byType: [{ userType: 'admin', count: 1 }] },
    loginFrequency: { totalLogins: 1, loginsLast7Days: 1, loginsToday: 1 },
  },
  engagement: {
    search: { totalSearches: 0, searchesLast7Days: 0, searchesToday: 0 },
    topSearchQueries: [],
    views: { totalViews: 0, viewsLast7Days: 0, viewsToday: 0 },
    favorites: [],
    trendingListings: [],
    userActivity: { activeUsers: 0, avgEventsPerUser: 0 },
    mostActiveUsers: [],
    totalViewsFromCounters: 0,
    totalFavoritesFromCounters: 0,
    avgViews: 0,
    avgFavorites: 0,
    viewsByDepartment: [],
  },
  research: {
    byEventType: [
      { eventType: 'research_view', total: 12, last7Days: 5, today: 1 },
      { eventType: 'pathway_save', total: 4, last7Days: 2, today: 0 },
      { eventType: 'contact_route_click', total: 3, last7Days: 1, today: 0 },
    ],
    byEntityType: [
      { entityType: 'profile', eventType: 'research_view', count: 7 },
      { entityType: 'listing', eventType: 'pathway_save', count: 4 },
    ],
    byUserType: [{ userType: 'undergraduate', count: 6 }],
    topEntities: [
      {
        entityType: 'profile',
        entityId: 'fixture-professor',
        views: 5,
        uniqueViewers: 3,
      },
    ],
  },
  listings: {
    overview: { total: 0, active: 0, archived: 0, unconfirmed: 0 },
    newListingsLast7Days: 0,
    newListingsToday: 0,
    byDepartment: [],
    byProfessor: [],
    listingsWithZeroViews: 0,
    topViewedListings: [],
    topFavoritedListings: [],
  },
  users: {
    overview: { total: 1, confirmed: 1 },
    byType: [{ userType: 'admin', count: 1 }],
    newUsersLast7Days: 0,
    newUsersToday: 0,
    newUsersTodayByType: [],
  },
  researchEntities: {
    overview: { active: 40, total: 40 },
    byType: [
      { entityType: 'LAB', count: 30 },
      { entityType: 'CENTER', count: 10 },
    ],
    byVisibilityTier: [{ tier: 'student_ready', count: 12 }],
    byOpenness: [{ status: 'unknown', count: 25 }],
    freshness: {
      observedLast7Days: 8,
      observedLast30Days: 20,
      neverObserved: 4,
      staleOver90Days: 6,
    },
    scholarly: { withRecentGrants: 9 },
  },
  timestamp: '2026-05-17T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Analytics page', () => {
  it('shows a recoverable error when the initial dashboard request fails', async () => {
    mockedAxios.get.mockRejectedValue(new Error('Request failed with status code 500'));

    render(<Analytics />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Analytics unavailable' })).toBeTruthy();
    });

    expect(screen.getByText('Failed to load analytics data')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry Analytics' })).toBeTruthy();
    expect(screen.queryByText('Loading analytics...')).toBeNull();
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get).toHaveBeenCalledWith('/analytics', {
      withCredentials: true,
      params: { range: '30d' },
    });
  });

  it('leads with scraped research coverage instead of posted-opportunity metrics', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/analytics') {
        return Promise.resolve({ data: analyticsData });
      }

      if (url === '/analytics/users') {
        return Promise.resolve({ data: { users: [], total: 0, limit: 25 } });
      }

      if (url === '/admin/admin-grants') {
        return Promise.resolve({
          data: { activeCount: 0, grants: [], legacyAdminsWithoutGrant: [] },
        });
      }

      if (url === '/analytics/search-quality') {
        return Promise.resolve({ data: { totalSearches: 0, zeroResultSearches: 0 } });
      }

      if (url === '/analytics/search-queries') {
        return Promise.resolve({
          data: {
            queries: [
              {
                query: 'machine learning',
                totalSearches: 3,
                uniqueSearchers: 2,
                searchers: [
                  {
                    netid: 'fixture_searcher',
                    userType: 'undergraduate',
                    fname: 'Fixture',
                    lname: 'Searcher',
                    searchCount: 2,
                  },
                ],
              },
            ],
          },
        });
      }

      if (url === '/analytics/funnel') {
        return Promise.resolve({ data: { stages: [] } });
      }

      if (url === '/analytics/actions') {
        return Promise.resolve({ data: { cards: [], items: [] } });
      }

      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    render(<Analytics />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Research Data Coverage/ })).toBeTruthy();
    });

    // Scraped-data coverage is the focus; legacy posted-opportunity sections are gone.
    expect(screen.getByText('Active Research Entities')).toBeTruthy();
    expect(screen.getByText('Student-Ready')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'By Entity Type' })).toBeTruthy();
    expect(screen.getByText('Lab')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Posted Opportunities Overview' })).toBeNull();
    expect(screen.queryByText('Total Posted Opportunities')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Analytics Data Health' })).toBeNull();
    expect(screen.getByText('Search Query Analytics')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('machine learning')).toBeTruthy();
    });
    expect(screen.getByText(/fixture_searcher/)).toBeTruthy();
    expect(screen.queryByText(/Listings/i)).toBeNull();
    expect(screen.queryByText(/Favorites/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh Data' }).className).toContain(
      'min-h-[44px]',
    );
    expect(screen.getByLabelText('Range', { exact: false }).className).toContain('min-h-[44px]');
    expect(screen.getByRole('button', { name: 'Refresh Users' }).className).toContain(
      'min-h-[44px]',
    );
    expect(screen.getByLabelText('Search NetID').className).toContain('min-h-[44px]');
    expect(screen.getByLabelText('User Type').className).toContain('min-h-[44px]');
    expect(screen.getByRole('button', { name: /Order:/ }).className).toContain('min-h-[44px]');
  });

  it('prioritizes a decision-oriented analytics command center', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/analytics') {
        return Promise.resolve({ data: analyticsData });
      }

      if (url === '/analytics/users') {
        return Promise.resolve({ data: { users: [], total: 0, limit: 25 } });
      }

      if (url === '/admin/admin-grants') {
        return Promise.resolve({
          data: { activeCount: 0, grants: [], legacyAdminsWithoutGrant: [] },
        });
      }

      if (url === '/analytics/search-quality') {
        return Promise.resolve({
          data: {
            totalSearches: 20,
            searchesWithResults: 16,
            zeroResultSearches: 4,
            zeroResultRate: 0.2,
            engagedSearches: 6,
            returnedButIgnoredSearches: 10,
            engagementRate: 0.3,
            attributionWindowMinutes: 30,
            avgResults: 7.5,
            lowResultQueries: [{ query: 'quantum materials', count: 2 }],
          },
        });
      }

      if (url === '/analytics/search-queries') {
        return Promise.resolve({ data: { queries: [], limit: 25 } });
      }

      if (url === '/analytics/funnel') {
        return Promise.resolve({
          data: {
            overallConversionRate: 0.25,
            stages: [
              { key: 'visitors', label: 'Visitors', count: 40, conversionRate: 1 },
              { key: 'searchers', label: 'Searched', count: 30, conversionRate: 0.75 },
              { key: 'viewers', label: 'Viewed Opportunities', count: 20, conversionRate: 0.67 },
              { key: 'applications', label: 'Outreach Clicked', count: 10, conversionRate: 0.5 },
            ],
          },
        });
      }

      if (url === '/analytics/actions') {
        return Promise.resolve({
          data: {
            cards: [
              {
                id: 'action-1',
                title: 'Review zero-result searches',
                priority: 'high',
                metric: 4,
                type: 'Search Coverage',
              },
            ],
            items: [],
          },
        });
      }

      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    render(<Analytics />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Research Discovery Health' })).toBeTruthy();
    });

    expect(screen.getByText('Primary dashboard question')).toBeTruthy();
    expect(screen.getByText(/Are students finding credible research next steps/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Decision Readout' })).toBeTruthy();
    expect(screen.getByText('Search success')).toBeTruthy();
    expect(screen.getByText('Student action funnel')).toBeTruthy();
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText('Supporting Detail')).toBeTruthy();
    const detailNav = screen.getByRole('navigation', { name: 'Analytics detail sections' });
    expect(detailNav).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Visitors' }).getAttribute('href')).toBe(
      '#visitor-statistics',
    );
    expect(screen.getByRole('link', { name: 'Diagnostics' }).getAttribute('href')).toBe(
      '#diagnostics',
    );
    expect(screen.getByRole('link', { name: 'Research Coverage' }).getAttribute('href')).toBe(
      '#research-coverage',
    );
    await waitFor(() => {
      expect(screen.getAllByText('Review zero-result searches').length).toBeGreaterThan(0);
      expect(screen.getAllByText('quantum materials').length).toBeGreaterThan(0);
      expect(
        screen.getByText(
          /6 of 20 site searches \(legacy\) led to a view or save within 30 minutes/,
        ),
      ).toBeTruthy();
    });

    expect(screen.getAllByText('quantum materials')).toHaveLength(1);
    expect(screen.getAllByText('Outreach Clicked')).toHaveLength(1);
    expect(screen.getByText('Returned but ignored')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'High-Impact Diagnostics' }).getAttribute('href')).toBe(
      '#high-impact-diagnostics',
    );
  });

  it('keeps the Needs attention count, tone, and caption self-consistent when only queries drive it', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/analytics') {
        return Promise.resolve({ data: analyticsData });
      }
      if (url === '/analytics/users') {
        return Promise.resolve({ data: { users: [], total: 0, limit: 25 } });
      }
      if (url === '/admin/admin-grants') {
        return Promise.resolve({
          data: { activeCount: 0, grants: [], legacyAdminsWithoutGrant: [] },
        });
      }
      if (url === '/analytics/search-quality') {
        return Promise.resolve({
          data: {
            totalSearches: 40,
            engagedSearches: 36,
            zeroResultQueries: [
              { query: 'alpha' },
              { query: 'beta' },
              { query: 'gamma' },
              { query: 'delta' },
              { query: 'epsilon' },
            ],
            lowResultQueries: [{ query: 'zeta' }],
          },
        });
      }
      if (url === '/analytics/search-queries') {
        return Promise.resolve({ data: { queries: [], limit: 25 } });
      }
      if (url === '/analytics/funnel') {
        return Promise.resolve({ data: { stages: [] } });
      }
      if (url === '/analytics/actions') {
        return Promise.resolve({ data: { cards: [], items: [] } });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    render(<Analytics />);

    const tile = await waitFor(() => {
      const heading = screen.getByText('Needs attention');
      const container = heading.closest('div') as HTMLElement;
      expect(container.querySelector('.text-3xl')?.textContent).toBe('6');
      return container;
    });

    expect(tile).toBeTruthy();
    expect(tile.querySelector('.text-3xl')?.textContent).toBe('6');
    expect(tile.className).toContain('bg-red-50');
    expect(tile.textContent).toContain('5 zero-result queries, 1 low-result query to review.');
    expect(tile.textContent).not.toContain('No urgent admin action returned');
  });

  it('shows the no-action caption only when nothing drives the Needs attention count', async () => {
    mockDashboardEndpoints();

    render(<Analytics />);

    const tile = await waitFor(() => {
      const heading = screen.getByText('Needs attention');
      return heading.closest('div') as HTMLElement;
    });

    expect(tile.querySelector('.text-3xl')?.textContent).toBe('0');
    expect(tile.className).toContain('bg-emerald-50');
    expect(tile.textContent).toContain('No urgent admin action returned');
  });

  it('shows current admin access from the admin grants source of truth', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/analytics') {
        return Promise.resolve({ data: analyticsData });
      }

      if (url === '/analytics/users') {
        return Promise.resolve({ data: { users: [], total: 0, limit: 25 } });
      }

      if (url === '/admin/admin-grants') {
        return Promise.resolve({
          data: {
            activeCount: 1,
            grants: [
              {
                netid: 'fixture-admin',
                status: 'active',
                source: 'manual',
                grantedAt: '2026-05-25T12:00:00.000Z',
                grantedBy: 'fixture-bootstrap',
                user: {
                  fname: 'Fixture',
                  lname: 'Admin',
                  email: 'fixture-admin@example.invalid',
                },
              },
            ],
            legacyAdminsWithoutGrant: [
              {
                netid: 'fixture-legacy-admin',
                fname: 'Fixture',
                lname: 'Legacy',
                email: 'fixture-legacy-admin@example.invalid',
              },
            ],
          },
        });
      }

      if (url === '/analytics/search-quality') {
        return Promise.resolve({ data: { totalSearches: 0, zeroResultSearches: 0 } });
      }

      if (url === '/analytics/search-queries') {
        return Promise.resolve({ data: { queries: [], limit: 25 } });
      }

      if (url === '/analytics/funnel') {
        return Promise.resolve({ data: { stages: [] } });
      }

      if (url === '/analytics/actions') {
        return Promise.resolve({ data: { cards: [], items: [] } });
      }

      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    render(<Analytics />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Admin Access' })).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByText('1 active admin')).toBeTruthy();
    });
    expect(screen.getByText('fixture-admin')).toBeTruthy();
    expect(screen.getByText('Fixture Admin')).toBeTruthy();
    expect(screen.getByText('manual')).toBeTruthy();
    expect(screen.getByText(/profile-derived admin authority is present without/i)).toBeTruthy();
    expect(screen.queryByText('fixture-legacy-admin')).toBeNull();
  });

  it('grants admin access from the analytics admin access section', async () => {
    let grantFetchCount = 0;
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/analytics') return Promise.resolve({ data: analyticsData });
      if (url === '/analytics/users') {
        return Promise.resolve({ data: { users: [], total: 0, limit: 25 } });
      }
      if (url === '/admin/admin-grants') {
        grantFetchCount += 1;
        return Promise.resolve({
          data:
            grantFetchCount === 1
              ? { activeCount: 0, grants: [], legacyAdminsWithoutGrant: [] }
              : {
                  activeCount: 1,
                  grants: [
                    {
                      netid: 'fixture-new-admin',
                      status: 'active',
                      source: 'manual',
                      grantedAt: '2026-05-25T12:00:00.000Z',
                      grantedBy: 'fixture-actor',
                    },
                  ],
                  legacyAdminsWithoutGrant: [],
                },
        });
      }
      if (url === '/analytics/search-quality') {
        return Promise.resolve({ data: { totalSearches: 0, zeroResultSearches: 0 } });
      }
      if (url === '/analytics/search-queries') {
        return Promise.resolve({ data: { queries: [], limit: 25 } });
      }
      if (url === '/analytics/funnel') return Promise.resolve({ data: { stages: [] } });
      if (url === '/analytics/actions') return Promise.resolve({ data: { cards: [], items: [] } });
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });
    mockedAxios.post.mockResolvedValue({ data: { grant: { netid: 'fixture-new-admin' } } });

    render(<Analytics />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Admin Access' })).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Grant admin NetID'), {
      target: { value: 'fixture-new-admin' },
    });
    fireEvent.change(screen.getByLabelText('Admin grant note'), {
      target: { value: 'Temporary coverage' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review Grant' }));
    expect(mockedAxios.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Confirm target NetID'), {
      target: { value: 'fixture-new-admin' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Grant' }));

    await waitFor(() => {
      expect(mockedAxios.post).toHaveBeenCalledWith(
        '/admin/admin-grants',
        { netid: 'fixture-new-admin', note: 'Temporary coverage' },
        { withCredentials: true },
      );
    });
    await waitFor(() => {
      expect(screen.getByText('fixture-new-admin')).toBeTruthy();
    });
  });

  it('revokes admin access after confirmation and blocks self-revoke controls', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/analytics') return Promise.resolve({ data: analyticsData });
      if (url === '/analytics/users') {
        return Promise.resolve({ data: { users: [], total: 0, limit: 25 } });
      }
      if (url === '/admin/admin-grants') {
        return Promise.resolve({
          data: {
            activeCount: 2,
            grants: [
              {
                netid: 'fixture-admin',
                status: 'active',
                source: 'manual',
                grantedAt: '2026-05-25T12:00:00.000Z',
                grantedBy: 'fixture-bootstrap',
              },
              {
                netid: 'devadmin',
                status: 'active',
                source: 'bootstrap',
                grantedAt: '2026-05-25T12:00:00.000Z',
                grantedBy: 'fixture-bootstrap',
              },
            ],
            legacyAdminsWithoutGrant: [],
          },
        });
      }
      if (url === '/analytics/search-quality') {
        return Promise.resolve({ data: { totalSearches: 0, zeroResultSearches: 0 } });
      }
      if (url === '/analytics/search-queries') {
        return Promise.resolve({ data: { queries: [], limit: 25 } });
      }
      if (url === '/analytics/funnel') return Promise.resolve({ data: { stages: [] } });
      if (url === '/analytics/actions') return Promise.resolve({ data: { cards: [], items: [] } });
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });
    mockedAxios.post.mockResolvedValue({ data: { grant: { netid: 'fixture-admin' } } });
    mockedSwal.mockResolvedValue(true);

    render(
      <UserContext.Provider
        value={{
          isLoading: false,
          isAuthenticated: true,
          user: {
            netId: 'devadmin',
            userType: 'admin',
            userConfirmed: true,
            profileVerified: true,
          },
          checkContext: vi.fn(),
        }}
      >
        <Analytics />
      </UserContext.Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText('fixture-admin')).toBeTruthy();
    });

    expect(screen.getByRole('button', { name: 'Current session' })).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Revoke fixture-admin' }));

    await waitFor(() => {
      expect(mockedAxios.post).toHaveBeenCalledWith(
        '/admin/admin-grants/fixture-admin/revoke',
        { note: 'Revoked through the Admin Access panel.' },
        { withCredentials: true },
      );
    });
  });

  const mockDashboardEndpoints = () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/analytics') {
        return Promise.resolve({ data: analyticsData });
      }
      if (url === '/analytics/users') {
        return Promise.resolve({ data: { users: [], total: 0, limit: 25 } });
      }
      if (url === '/admin/admin-grants') {
        return Promise.resolve({
          data: { activeCount: 0, grants: [], legacyAdminsWithoutGrant: [] },
        });
      }
      if (url === '/analytics/search-quality') {
        return Promise.resolve({ data: { totalSearches: 0, zeroResultSearches: 0 } });
      }
      if (url === '/analytics/search-queries') {
        return Promise.resolve({ data: { queries: [], limit: 25 } });
      }
      if (url === '/analytics/funnel') {
        return Promise.resolve({ data: { stages: [] } });
      }
      if (url === '/analytics/actions') {
        return Promise.resolve({ data: { cards: [], items: [] } });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });
  };

  it('labels usage metrics with the selected range and threads the range to the server', async () => {
    mockDashboardEndpoints();

    render(<Analytics />);

    await waitFor(() => {
      expect(screen.getByText('Visitors (30 Days)')).toBeTruthy();
    });
    expect(screen.getByText('Login Events (30 Days)')).toBeTruthy();
    expect(screen.getByText('Site searches (30 Days)')).toBeTruthy();
    expect(screen.getByText('Visitors (Last 7 Days)')).toBeTruthy();
    expect(screen.getByText('Visitors Today')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Last 7 Days by Type' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Today by Type' })).toBeTruthy();
    expect(mockedAxios.get).toHaveBeenCalledWith('/analytics', {
      withCredentials: true,
      params: { range: '30d' },
    });

    fireEvent.change(screen.getByLabelText('Range', { exact: false }), {
      target: { value: 'today' },
    });

    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith('/analytics', {
        withCredentials: true,
        params: { range: 'today' },
      });
    });
    await waitFor(() => {
      expect(screen.getByText('Visitors (Today)')).toBeTruthy();
    });
    expect(screen.getByText('Login Events (Today)')).toBeTruthy();
    expect(screen.queryByText('Visitors (Last 7 Days)')).toBeNull();
    expect(screen.queryByText('Visitors Today')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Last 7 Days by Type' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Today by Type' })).toBeNull();
  });

  it('marks corpus and account sections as current snapshots regardless of range', async () => {
    mockDashboardEndpoints();

    render(<Analytics />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Research Data Coverage/ })).toBeTruthy();
    });
    expect(screen.getAllByText('Current snapshot').length).toBeGreaterThanOrEqual(2);

    fireEvent.change(screen.getByLabelText('Range', { exact: false }), {
      target: { value: 'today' },
    });

    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith('/analytics', {
        withCredentials: true,
        params: { range: 'today' },
      });
    });
    expect(screen.getAllByText('Current snapshot').length).toBeGreaterThanOrEqual(2);
  });

  it('renders display names alongside NetIDs in the operator user tables', async () => {
    const withActiveUsers: AnalyticsData = {
      ...analyticsData,
      engagement: {
        ...analyticsData.engagement,
        mostActiveUsers: [
          {
            userId: 'analyst01',
            userType: 'undergraduate',
            eventCount: 9,
            fname: 'Ada',
            lname: 'Analyst',
          },
          { userId: 'nameless02', userType: 'graduate', eventCount: 4 },
        ],
      },
    };

    const userRow = (netid: string, fname?: string, lname?: string) => ({
      netid,
      userType: netid === 'analyst01' ? 'undergraduate' : 'graduate',
      fname,
      lname,
      totalEvents: 9,
      logins: 2,
      searches: 4,
      views: 3,
      fellowshipViews: 0,
      listingFavorites: 0,
      listingUnfavorites: 0,
      fellowshipFavorites: 0,
      fellowshipUnfavorites: 0,
      outreachClicks: 0,
      outreachOutcomes: 0,
      listingCreates: 0,
      listingUpdates: 0,
      listingArchives: 0,
      listingUnarchives: 0,
      profileUpdates: 0,
      loginCount: 2,
      lastActive: '2026-05-17T00:00:00.000Z',
    });

    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/analytics') {
        return Promise.resolve({ data: withActiveUsers });
      }
      if (url === '/analytics/users') {
        return Promise.resolve({
          data: {
            users: [userRow('analyst01', 'Ada', 'Analyst'), userRow('nameless02')],
            total: 2,
            limit: 25,
          },
        });
      }
      if (url === '/admin/admin-grants') {
        return Promise.resolve({
          data: { activeCount: 0, grants: [], legacyAdminsWithoutGrant: [] },
        });
      }
      if (url === '/analytics/search-quality') {
        return Promise.resolve({ data: { totalSearches: 0, zeroResultSearches: 0 } });
      }
      if (url === '/analytics/search-queries') {
        return Promise.resolve({ data: { queries: [], limit: 25 } });
      }
      if (url === '/analytics/funnel') {
        return Promise.resolve({ data: { stages: [] } });
      }
      if (url === '/analytics/actions') {
        return Promise.resolve({ data: { cards: [], items: [] } });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    render(<Analytics />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Most Active Users/ })).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'NetID User Activity' })).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getAllByText('Ada Analyst').length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getAllByText('analyst01').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('nameless02').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('undefined')).toBeNull();
  });
});
