import { describe, expect, it } from 'vitest';

import { adminTableReducer, createInitialAdminTableState } from '../adminTableReducer';

type Sort = 'title' | 'createdAt';
type Filter = 'archived' | 'confirmed';

interface Row {
  _id: string;
  title: string;
}
const make = (id: string): Row => ({ _id: id, title: id });

const makeState = (overrides: Partial<ReturnType<typeof initial>> = {}) => ({
  ...initial(),
  ...overrides,
});

const initial = () =>
  createInitialAdminTableState<Row, Sort, Filter>({
    sortBy: 'createdAt',
    filters: { archived: '', confirmed: '' },
  });

describe('adminTableReducer (generic)', () => {
  describe('initial state', () => {
    it('uses defaults passed in', () => {
      const state = initial();
      expect(state.sortBy).toBe('createdAt');
      expect(state.sortOrder).toBe('desc');
      expect(state.pageSize).toBe(25);
      expect(state.filters).toEqual({ archived: '', confirmed: '' });
      expect(state.isLoading).toBe(true);
      expect(state.page).toBe(1);
    });

    it('respects optional overrides', () => {
      const state = createInitialAdminTableState<Row, Sort, Filter>({
        sortBy: 'title',
        sortOrder: 'asc',
        pageSize: 10,
        filters: { archived: 'true', confirmed: '' },
      });
      expect(state.sortOrder).toBe('asc');
      expect(state.pageSize).toBe(10);
      expect(state.filters.archived).toBe('true');
    });

    it('clones the filters object so mutation does not leak', () => {
      const filters = { archived: '', confirmed: '' };
      const state = createInitialAdminTableState<Row, Sort, Filter>({
        sortBy: 'createdAt',
        filters,
      });
      state.filters.archived = 'true';
      expect(filters.archived).toBe('');
    });
  });

  describe('fetch lifecycle', () => {
    it('FETCH_START flips loading', () => {
      const state = makeState({ isLoading: false });
      expect(adminTableReducer<Row, Sort, Filter>(state, { type: 'FETCH_START' }).isLoading).toBe(
        true,
      );
    });

    it('FETCH_SUCCESS populates items/total/totalPages and clears loading', () => {
      const state = initial();
      const next = adminTableReducer<Row, Sort, Filter>(state, {
        type: 'FETCH_SUCCESS',
        items: [make('a'), make('b')],
        total: 42,
        totalPages: 3,
      });
      expect(next.items).toHaveLength(2);
      expect(next.total).toBe(42);
      expect(next.totalPages).toBe(3);
      expect(next.isLoading).toBe(false);
    });

    it('FETCH_FAILURE clears loading but preserves stale items', () => {
      const withData = adminTableReducer<Row, Sort, Filter>(initial(), {
        type: 'FETCH_SUCCESS',
        items: [make('keep')],
        total: 1,
        totalPages: 1,
      });
      const next = adminTableReducer<Row, Sort, Filter>(withData, { type: 'FETCH_FAILURE' });
      expect(next.isLoading).toBe(false);
      expect(next.items).toHaveLength(1);
    });
  });

  describe('page-reset invariant', () => {
    const onPage5 = () => makeState({ page: 5 });

    it('SET_SEARCH resets page', () => {
      expect(
        adminTableReducer<Row, Sort, Filter>(onPage5(), { type: 'SET_SEARCH', payload: 'q' }).page,
      ).toBe(1);
    });

    it('SET_FILTER resets page and updates only the named filter', () => {
      const next = adminTableReducer<Row, Sort, Filter>(onPage5(), {
        type: 'SET_FILTER',
        filter: 'archived',
        value: 'true',
      });
      expect(next.page).toBe(1);
      expect(next.filters).toEqual({ archived: 'true', confirmed: '' });
    });

    it('SET_PAGE_SIZE resets page', () => {
      expect(
        adminTableReducer<Row, Sort, Filter>(onPage5(), {
          type: 'SET_PAGE_SIZE',
          payload: 50,
        }).page,
      ).toBe(1);
    });

    it('TOGGLE_SORT resets page', () => {
      expect(
        adminTableReducer<Row, Sort, Filter>(onPage5(), {
          type: 'TOGGLE_SORT',
          field: 'title',
        }).page,
      ).toBe(1);
    });

    it('SET_SORT_BY resets page', () => {
      expect(
        adminTableReducer<Row, Sort, Filter>(onPage5(), {
          type: 'SET_SORT_BY',
          field: 'title',
        }).page,
      ).toBe(1);
    });

    it('TOGGLE_SORT_ORDER resets page', () => {
      expect(
        adminTableReducer<Row, Sort, Filter>(onPage5(), {
          type: 'TOGGLE_SORT_ORDER',
        }).page,
      ).toBe(1);
    });

    it('SET_PAGE is the only navigation that does NOT reset', () => {
      expect(
        adminTableReducer<Row, Sort, Filter>(onPage5(), { type: 'SET_PAGE', payload: 7 }).page,
      ).toBe(7);
    });
  });

  describe('sort behavior', () => {
    it('TOGGLE_SORT on the same field flips direction', () => {
      const state = makeState({ sortBy: 'title', sortOrder: 'asc' });
      const next = adminTableReducer<Row, Sort, Filter>(state, {
        type: 'TOGGLE_SORT',
        field: 'title',
      });
      expect(next.sortOrder).toBe('desc');
    });

    it('TOGGLE_SORT on a new field resets direction to desc', () => {
      const state = makeState({ sortBy: 'title', sortOrder: 'asc' });
      const next = adminTableReducer<Row, Sort, Filter>(state, {
        type: 'TOGGLE_SORT',
        field: 'createdAt',
      });
      expect(next.sortBy).toBe('createdAt');
      expect(next.sortOrder).toBe('desc');
    });

    it('SET_SORT_BY switches column without touching direction', () => {
      const state = makeState({ sortBy: 'title', sortOrder: 'asc' });
      const next = adminTableReducer<Row, Sort, Filter>(state, {
        type: 'SET_SORT_BY',
        field: 'createdAt',
      });
      expect(next.sortBy).toBe('createdAt');
      expect(next.sortOrder).toBe('asc');
    });
  });

  describe('edit modal', () => {
    it('OPEN/CLOSE roundtrip', () => {
      const row = make('x');
      const state = initial();
      const opened = adminTableReducer<Row, Sort, Filter>(state, {
        type: 'OPEN_EDIT',
        item: row,
      });
      expect(opened.editing).toBe(row);
      expect(
        adminTableReducer<Row, Sort, Filter>(opened, { type: 'CLOSE_EDIT' }).editing,
      ).toBeNull();
    });
  });

  describe('purity and extended state', () => {
    it('does not mutate prior state', () => {
      const state = initial();
      const snapshot = JSON.stringify(state);
      adminTableReducer<Row, Sort, Filter>(state, {
        type: 'SET_FILTER',
        filter: 'archived',
        value: 'true',
      });
      adminTableReducer<Row, Sort, Filter>(state, {
        type: 'FETCH_SUCCESS',
        items: [make('a')],
        total: 1,
        totalPages: 1,
      });
      expect(JSON.stringify(state)).toBe(snapshot);
    });

    it('preserves extra fields when used with an extended state shape', () => {
      // Consumers that extend AdminTableState (e.g. AdminListingsTable's
      // URL-check fields) rely on the reducer preserving unknown keys.
      const extended = { ...initial(), extra: 'keep-me', checking: 'abc' };
      const next = adminTableReducer<Row, Sort, Filter, typeof extended>(extended, {
        type: 'FETCH_SUCCESS',
        items: [make('a')],
        total: 1,
        totalPages: 1,
      });
      expect(next.extra).toBe('keep-me');
      expect(next.checking).toBe('abc');
    });
  });
});
