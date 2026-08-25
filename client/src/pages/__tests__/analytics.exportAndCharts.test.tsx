import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Analytics from '../analytics';
import axios from '../../utils/axios';
import { AnalyticsData } from '../../reducers/analyticsReducer';

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

const analyticsData: AnalyticsData = {
  visitors: {
    lifetime: {
      total: 3,
      byType: [
        { userType: 'undergraduate', count: 2 },
        { userType: 'graduate', count: 1 },
      ],
    },
    last7Days: { total: 1, byType: [{ userType: 'undergraduate', count: 1 }] },
    today: { total: 1, byType: [{ userType: 'undergraduate', count: 1 }] },
    loginFrequency: { totalLogins: 5, loginsLast7Days: 2, loginsToday: 1 },
  },
  engagement: {
    search: { totalSearches: 4, searchesLast7Days: 2, searchesToday: 1 },
    topSearchQueries: [],
    views: { totalViews: 0, viewsLast7Days: 0, viewsToday: 0 },
    favorites: [],
    trendingListings: [],
    userActivity: { activeUsers: 1, avgEventsPerUser: 4 },
    mostActiveUsers: [],
    totalViewsFromCounters: 0,
    totalFavoritesFromCounters: 0,
    avgViews: 0,
    avgFavorites: 0,
    viewsByDepartment: [],
  },
  research: { byEventType: [], byEntityType: [], byUserType: [], topEntities: [] },
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
    overview: { total: 3, confirmed: 3 },
    byType: [{ userType: 'undergraduate', count: 3 }],
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

const userRow = {
  netid: 'analyst01',
  userType: 'undergraduate',
  fname: 'Ada',
  lname: 'Analyst',
  totalEvents: 9,
  logins: 2,
  searches: 4,
  views: 3,
  researchViews: 2,
  fellowshipViews: 0,
  listingFavorites: 0,
  listingUnfavorites: 0,
  fellowshipFavorites: 0,
  fellowshipUnfavorites: 0,
  outreachClicks: 1,
  outreachOutcomes: 0,
  listingCreates: 0,
  listingUpdates: 0,
  listingArchives: 0,
  listingUnarchives: 0,
  profileUpdates: 0,
  loginCount: 2,
  lastActive: '2026-05-17T00:00:00.000Z',
};

const mockEndpoints = () => {
  mockedAxios.get.mockImplementation((url: string) => {
    switch (url) {
      case '/analytics':
        return Promise.resolve({ data: analyticsData });
      case '/analytics/users':
        return Promise.resolve({ data: { users: [userRow], total: 1, limit: 25, offset: 0 } });
      case '/admin/admin-grants':
        return Promise.resolve({
          data: { activeCount: 0, grants: [], legacyAdminsWithoutGrant: [] },
        });
      case '/analytics/search-quality':
        return Promise.resolve({ data: { totalSearches: 4, zeroResultSearches: 0 } });
      case '/analytics/search-queries':
        return Promise.resolve({
          data: {
            queries: [
              {
                query: 'machine learning',
                totalSearches: 3,
                uniqueSearchers: 1,
                zeroResultSearches: 0,
                searchers: [{ netid: 'analyst01', userType: 'undergraduate', searchCount: 3 }],
              },
            ],
            limit: 25,
          },
        });
      case '/analytics/funnel':
        return Promise.resolve({
          data: {
            overallConversionRate: 0.25,
            stages: [
              { key: 'visitors', label: 'Visitors', count: 40, conversionRate: 1 },
              { key: 'applications', label: 'Outreach Clicked', count: 10, conversionRate: 0.25 },
            ],
          },
        });
      case '/analytics/actions':
        return Promise.resolve({ data: { cards: [], items: [] } });
      default:
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
    }
  });
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Analytics charts and CSV export', () => {
  it('renders accessible breakdown charts for range-scoped data', async () => {
    mockEndpoints();
    render(<Analytics />);

    await waitFor(() => {
      expect(screen.getByRole('group', { name: 'Active research entities by type' })).toBeTruthy();
    });
    expect(screen.getByRole('group', { name: 'Student action counts' })).toBeTruthy();
    expect(screen.getByRole('group', { name: /Visitors by type/ })).toBeTruthy();
    expect(screen.getAllByText('Outreach Clicked')).toHaveLength(1);
    expect(screen.getByText('Lab')).toBeTruthy();
  });

  it('exports the user activity and search query tables as CSV', async () => {
    mockEndpoints();
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:fixture');
    const revokeObjectURL = vi.fn();
    class MockURL extends URL {}
    (MockURL as unknown as { createObjectURL: typeof createObjectURL }).createObjectURL =
      createObjectURL;
    (MockURL as unknown as { revokeObjectURL: typeof revokeObjectURL }).revokeObjectURL =
      revokeObjectURL;
    vi.stubGlobal('URL', MockURL);

    render(<Analytics />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'NetID User Activity' })).toBeTruthy();
    });

    const exportButtons = await screen.findAllByRole('button', { name: 'Export CSV' });
    expect(exportButtons).toHaveLength(2);

    await waitFor(() => {
      expect(screen.getByText('machine learning')).toBeTruthy();
    });

    exportButtons.forEach((button) => fireEvent.click(button));
    expect(createObjectURL).toHaveBeenCalledTimes(2);
  });
});
