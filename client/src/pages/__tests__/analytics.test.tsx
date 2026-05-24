import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Analytics from '../analytics';
import axios from '../../utils/axios';
import { AnalyticsData } from '../../reducers/analyticsReducer';

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(),
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
};

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
    opportunityViewDataHealth: {
      opportunityViewEventsLast30Days: 7,
      resolvedOpportunityViewEventsLast30Days: 0,
      orphanedOpportunityViewEventsLast30Days: 7,
      orphanedOpportunityIds: ['stale-1', 'stale-2'],
    },
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

    expect(screen.getByText('Request failed with status code 500')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry Analytics' })).toBeTruthy();
    expect(screen.queryByText('Loading analytics...')).toBeNull();
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get).toHaveBeenCalledWith('/analytics', { withCredentials: true });
  });

  it('uses posted opportunity language instead of legacy listing labels', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/analytics') {
        return Promise.resolve({ data: analyticsData });
      }

      if (url === '/analytics/users') {
        return Promise.resolve({ data: { users: [], total: 0, limit: 25 } });
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
      expect(screen.getByRole('heading', { name: 'Posted Opportunities Overview' })).toBeTruthy();
    });

    expect(screen.getByText('Opportunity views tracked')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Analytics Data Health' })).toBeTruthy();
    expect(screen.getByText('Orphaned opportunity view events')).toBeTruthy();
    expect(screen.getAllByText('7').length).toBeGreaterThan(0);
    expect(screen.getByText('Total Posted Opportunities')).toBeTruthy();
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
    expect(screen.getByLabelText('Range').className).toContain('min-h-[44px]');
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

      if (url === '/analytics/search-quality') {
        return Promise.resolve({
          data: {
            totalSearches: 20,
            searchesWithResults: 16,
            zeroResultSearches: 4,
            zeroResultRate: 0.2,
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
    await waitFor(() => {
      expect(screen.getAllByText('Review zero-result searches').length).toBeGreaterThan(0);
      expect(screen.getAllByText('quantum materials').length).toBeGreaterThan(0);
    });
  });
});
