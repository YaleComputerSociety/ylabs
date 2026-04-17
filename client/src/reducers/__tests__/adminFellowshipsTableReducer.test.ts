import { describe, expect, it } from 'vitest';

import {
  adminFellowshipsTableReducer,
  createInitialAdminFellowshipsTableState,
} from '../adminFellowshipsTableReducer';

// The reducer is generic over the fellowship shape. For tests, a minimal
// stand-in keeps assertions readable.
interface TestFellowship {
  _id: string;
  title: string;
}
const make = (id: string): TestFellowship => ({ _id: id, title: `Fellowship ${id}` });

describe('adminFellowshipsTableReducer', () => {
  it('initial state starts loading on page 1 with default sort', () => {
    const state = createInitialAdminFellowshipsTableState<TestFellowship>();
    expect(state.isLoading).toBe(true);
    expect(state.page).toBe(1);
    expect(state.pageSize).toBe(25);
    expect(state.sortBy).toBe('createdAt');
    expect(state.sortOrder).toBe('desc');
    expect(state.search).toBe('');
    expect(state.editingFellowship).toBeNull();
  });

  describe('fetch lifecycle', () => {
    it('FETCH_START sets isLoading', () => {
      const state = createInitialAdminFellowshipsTableState<TestFellowship>({ isLoading: false });
      const next = adminFellowshipsTableReducer<TestFellowship>(state, { type: 'FETCH_START' });
      expect(next.isLoading).toBe(true);
    });

    it('FETCH_SUCCESS populates results and clears loading', () => {
      const state = createInitialAdminFellowshipsTableState<TestFellowship>();
      const next = adminFellowshipsTableReducer<TestFellowship>(state, {
        type: 'FETCH_SUCCESS',
        payload: {
          fellowships: [make('a'), make('b')],
          total: 42,
          totalPages: 2,
        },
      });
      expect(next.isLoading).toBe(false);
      expect(next.fellowships).toHaveLength(2);
      expect(next.total).toBe(42);
      expect(next.totalPages).toBe(2);
    });

    it('FETCH_FAILURE clears loading but preserves prior results', () => {
      const withData = adminFellowshipsTableReducer<TestFellowship>(
        createInitialAdminFellowshipsTableState<TestFellowship>(),
        {
          type: 'FETCH_SUCCESS',
          payload: { fellowships: [make('keep')], total: 1, totalPages: 1 },
        }
      );
      const next = adminFellowshipsTableReducer<TestFellowship>(withData, { type: 'FETCH_FAILURE' });
      expect(next.isLoading).toBe(false);
      expect(next.fellowships).toHaveLength(1);
      expect(next.total).toBe(1);
    });
  });

  describe('query params reset page to 1', () => {
    const onPageN = (n: number) =>
      createInitialAdminFellowshipsTableState<TestFellowship>({ page: n });

    it('SET_SEARCH resets page', () => {
      const next = adminFellowshipsTableReducer<TestFellowship>(onPageN(5), {
        type: 'SET_SEARCH',
        payload: 'query',
      });
      expect(next.search).toBe('query');
      expect(next.page).toBe(1);
    });

    it('SET_ARCHIVED_FILTER resets page', () => {
      const next = adminFellowshipsTableReducer<TestFellowship>(onPageN(5), {
        type: 'SET_ARCHIVED_FILTER',
        payload: 'true',
      });
      expect(next.page).toBe(1);
    });

    it('SET_AUDITED_FILTER resets page', () => {
      const next = adminFellowshipsTableReducer<TestFellowship>(onPageN(5), {
        type: 'SET_AUDITED_FILTER',
        payload: 'false',
      });
      expect(next.page).toBe(1);
    });

    it('SET_PAGE_SIZE resets page', () => {
      const next = adminFellowshipsTableReducer<TestFellowship>(onPageN(5), {
        type: 'SET_PAGE_SIZE',
        payload: 50,
      });
      expect(next.pageSize).toBe(50);
      expect(next.page).toBe(1);
    });
  });

  it('SET_PAGE just updates the page (e.g. paging through results)', () => {
    const state = createInitialAdminFellowshipsTableState<TestFellowship>();
    const next = adminFellowshipsTableReducer<TestFellowship>(state, {
      type: 'SET_PAGE',
      payload: 3,
    });
    expect(next.page).toBe(3);
  });

  describe('TOGGLE_SORT', () => {
    it('clicking the same column flips direction', () => {
      const state = createInitialAdminFellowshipsTableState<TestFellowship>({
        sortBy: 'views',
        sortOrder: 'asc',
      });
      const next = adminFellowshipsTableReducer<TestFellowship>(state, {
        type: 'TOGGLE_SORT',
        field: 'views',
      });
      expect(next.sortOrder).toBe('desc');
    });

    it('clicking a new column resets to desc', () => {
      const state = createInitialAdminFellowshipsTableState<TestFellowship>({
        sortBy: 'views',
        sortOrder: 'asc',
      });
      const next = adminFellowshipsTableReducer<TestFellowship>(state, {
        type: 'TOGGLE_SORT',
        field: 'deadline',
      });
      expect(next.sortBy).toBe('deadline');
      expect(next.sortOrder).toBe('desc');
    });

    it('TOGGLE_SORT always resets page to 1', () => {
      const state = createInitialAdminFellowshipsTableState<TestFellowship>({ page: 7 });
      const next = adminFellowshipsTableReducer<TestFellowship>(state, {
        type: 'TOGGLE_SORT',
        field: 'title',
      });
      expect(next.page).toBe(1);
    });
  });

  describe('edit modal', () => {
    it('OPEN_EDIT stores the fellowship', () => {
      const f = make('x');
      const state = createInitialAdminFellowshipsTableState<TestFellowship>();
      const next = adminFellowshipsTableReducer<TestFellowship>(state, {
        type: 'OPEN_EDIT',
        fellowship: f,
      });
      expect(next.editingFellowship).toBe(f);
    });

    it('CLOSE_EDIT clears the fellowship', () => {
      const state = createInitialAdminFellowshipsTableState<TestFellowship>({
        editingFellowship: make('x'),
      });
      const next = adminFellowshipsTableReducer<TestFellowship>(state, { type: 'CLOSE_EDIT' });
      expect(next.editingFellowship).toBeNull();
    });
  });

  it('does not mutate prior state', () => {
    const state = createInitialAdminFellowshipsTableState<TestFellowship>();
    const snapshot = JSON.stringify(state);
    adminFellowshipsTableReducer<TestFellowship>(state, {
      type: 'FETCH_SUCCESS',
      payload: { fellowships: [make('a')], total: 1, totalPages: 1 },
    });
    adminFellowshipsTableReducer<TestFellowship>(state, {
      type: 'TOGGLE_SORT',
      field: 'title',
    });
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});
