import { describe, expect, it } from 'vitest';

import {
  adminListingsTableReducer,
  createInitialAdminListingsTableState,
} from '../adminListingsTableReducer';

interface TestListing {
  _id: string;
  title: string;
}
const make = (id: string): TestListing => ({ _id: id, title: `Listing ${id}` });

describe('adminListingsTableReducer (generic + URL-check extensions)', () => {
  it('initial state includes the three listing filters and empty url-check state', () => {
    const state = createInitialAdminListingsTableState<TestListing>();
    expect(state.filters).toEqual({ archived: '', confirmed: '', audited: '' });
    expect(state.urlResults).toEqual({});
    expect(state.checkingUrls).toBeNull();
  });

  it('delegates generic actions (FETCH_SUCCESS) through to the base reducer', () => {
    const state = createInitialAdminListingsTableState<TestListing>();
    const next = adminListingsTableReducer<TestListing>(state, {
      type: 'FETCH_SUCCESS',
      items: [make('a')],
      total: 1,
      totalPages: 1,
    });
    expect(next.items).toHaveLength(1);
    expect(next.isLoading).toBe(false);
  });

  it('SET_FILTER on confirmed updates only the named filter and resets page', () => {
    const state = {
      ...createInitialAdminListingsTableState<TestListing>(),
      page: 5,
    };
    const next = adminListingsTableReducer<TestListing>(state, {
      type: 'SET_FILTER',
      filter: 'confirmed',
      value: 'false',
    });
    expect(next.filters.confirmed).toBe('false');
    expect(next.filters.archived).toBe('');
    expect(next.page).toBe(1);
  });

  describe('URL_CHECK extension', () => {
    it('URL_CHECK_START records the listing being checked', () => {
      const state = createInitialAdminListingsTableState<TestListing>();
      const next = adminListingsTableReducer<TestListing>(state, {
        type: 'URL_CHECK_START',
        listingId: 'abc',
      });
      expect(next.checkingUrls).toBe('abc');
    });

    it('URL_CHECK_SUCCESS stores results per listing and clears the active check', () => {
      const state = {
        ...createInitialAdminListingsTableState<TestListing>(),
        checkingUrls: 'abc',
      };
      const results = [{ url: 'https://a', reachable: true }];
      const next = adminListingsTableReducer<TestListing>(state, {
        type: 'URL_CHECK_SUCCESS',
        listingId: 'abc',
        results,
      });
      expect(next.checkingUrls).toBeNull();
      expect(next.urlResults.abc).toBe(results);
    });

    it('URL_CHECK_SUCCESS preserves existing entries for other listings', () => {
      const state = {
        ...createInitialAdminListingsTableState<TestListing>(),
        urlResults: { first: [{ url: 'x', reachable: false }] },
      };
      const next = adminListingsTableReducer<TestListing>(state, {
        type: 'URL_CHECK_SUCCESS',
        listingId: 'second',
        results: [{ url: 'y', reachable: true }],
      });
      expect(next.urlResults.first).toBeDefined();
      expect(next.urlResults.second).toBeDefined();
    });

    it('URL_CHECK_FAILURE clears the active check', () => {
      const state = {
        ...createInitialAdminListingsTableState<TestListing>(),
        checkingUrls: 'abc',
      };
      const next = adminListingsTableReducer<TestListing>(state, {
        type: 'URL_CHECK_FAILURE',
      });
      expect(next.checkingUrls).toBeNull();
    });

    it('URL_CHECK actions do not reset page or touch filters', () => {
      const state = {
        ...createInitialAdminListingsTableState<TestListing>(),
        page: 3,
        filters: { archived: 'true', confirmed: '', audited: '' },
      };
      const next = adminListingsTableReducer<TestListing>(state, {
        type: 'URL_CHECK_START',
        listingId: 'x',
      });
      expect(next.page).toBe(3);
      expect(next.filters.archived).toBe('true');
    });
  });
});
