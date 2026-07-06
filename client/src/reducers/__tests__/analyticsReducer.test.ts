import { describe, expect, it } from 'vitest';

import {
  AnalyticsData,
  analyticsReducer,
  createInitialAnalyticsState,
} from '../analyticsReducer';

const sampleData: AnalyticsData = {
  visitors: {
    lifetime: { total: 10, byType: [{ userType: 'undergraduate', count: 10 }] },
    last7Days: { total: 3, byType: [] },
    today: { total: 1, byType: [] },
    loginFrequency: { totalLogins: 20, loginsLast7Days: 5, loginsToday: 1 },
  },
  engagement: {
    search: { totalSearches: 100, searchesLast7Days: 10, searchesToday: 2 },
    topSearchQueries: [],
    views: { totalViews: 50, viewsLast7Days: 8, viewsToday: 1 },
    favorites: [],
    trendingListings: [],
    userActivity: { activeUsers: 4, avgEventsPerUser: 2.5 },
    mostActiveUsers: [],
    totalViewsFromCounters: 50,
    totalFavoritesFromCounters: 12,
    avgViews: 5,
    avgFavorites: 1.2,
    viewsByDepartment: [],
  },
  listings: {
    overview: { total: 10, active: 8, archived: 1, unconfirmed: 1 },
    newListingsLast7Days: 2,
    newListingsToday: 0,
    byDepartment: [],
    byProfessor: [],
    listingsWithZeroViews: 3,
    topViewedListings: [],
    topFavoritedListings: [],
  },
  users: {
    overview: { total: 15, confirmed: 12 },
    byType: [],
    newUsersLast7Days: 2,
    newUsersToday: 0,
    newUsersTodayByType: [],
  },
  timestamp: '2026-04-16T00:00:00.000Z',
};

describe('analyticsReducer', () => {
  it('initial state starts in loading with no data, empty lastUpdated, and no error', () => {
    const state = createInitialAnalyticsState();
    expect(state.isLoading).toBe(true);
    expect(state.data).toBeNull();
    expect(state.lastUpdated).toBe('');
    expect(state.error).toBeNull();
  });

  it('FETCH_START sets loading and clears prior error', () => {
    const state = createInitialAnalyticsState({ error: 'stale failure', isLoading: false });
    const next = analyticsReducer(state, { type: 'FETCH_START' });
    expect(next.isLoading).toBe(true);
    expect(next.error).toBeNull();
  });

  it('FETCH_SUCCESS populates data + lastUpdated and clears error', () => {
    const state = createInitialAnalyticsState({ error: 'previous error' });
    const next = analyticsReducer(state, {
      type: 'FETCH_SUCCESS',
      payload: { data: sampleData, timestamp: '4/16/2026, 12:00:00 PM' },
    });
    expect(next.isLoading).toBe(false);
    expect(next.data).toEqual(sampleData);
    expect(next.lastUpdated).toBe('4/16/2026, 12:00:00 PM');
    expect(next.error).toBeNull();
  });

  it('FETCH_SUCCESS updates lastUpdated on refetch', () => {
    const first = analyticsReducer(createInitialAnalyticsState(), {
      type: 'FETCH_SUCCESS',
      payload: { data: sampleData, timestamp: '4/16/2026, 12:00:00 PM' },
    });
    const second = analyticsReducer(first, {
      type: 'FETCH_SUCCESS',
      payload: { data: sampleData, timestamp: '4/16/2026, 1:00:00 PM' },
    });
    expect(second.lastUpdated).toBe('4/16/2026, 1:00:00 PM');
    expect(first.lastUpdated).toBe('4/16/2026, 12:00:00 PM');
  });

  it('FETCH_FAILURE records the error, stops loading, and preserves prior data', () => {
    const loaded = analyticsReducer(createInitialAnalyticsState(), {
      type: 'FETCH_SUCCESS',
      payload: { data: sampleData, timestamp: '4/16/2026, 12:00:00 PM' },
    });
    const next = analyticsReducer(loaded, {
      type: 'FETCH_FAILURE',
      payload: 'Server down',
    });
    expect(next.error).toBe('Server down');
    expect(next.isLoading).toBe(false);
    // Stale-over-empty: a failed refresh must not wipe the dashboard.
    expect(next.data).toEqual(sampleData);
    expect(next.lastUpdated).toBe('4/16/2026, 12:00:00 PM');
  });

  it('reducer does not mutate prior state', () => {
    const state = createInitialAnalyticsState();
    const snapshot = JSON.stringify(state);
    analyticsReducer(state, {
      type: 'FETCH_SUCCESS',
      payload: { data: sampleData, timestamp: 't' },
    });
    analyticsReducer(state, { type: 'FETCH_FAILURE', payload: 'x' });
    analyticsReducer(state, { type: 'FETCH_START' });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('returns same reference for unknown action', () => {
    const state = createInitialAnalyticsState();
    // @ts-expect-error intentionally invalid
    expect(analyticsReducer(state, { type: 'NOPE' })).toBe(state);
  });
});
