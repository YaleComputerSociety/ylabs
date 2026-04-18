import { describe, expect, it } from 'vitest';

import { Listing } from '../../types/types';
import { SearchState, createInitialSearchState, searchReducer } from '../searchReducer';

const makeListing = (overrides: Partial<Listing> = {}): Listing => ({
  id: 'id-1',
  ownerId: 'owner-1',
  ownerFirstName: 'First',
  ownerLastName: 'Last',
  ownerEmail: 'owner@example.com',
  professorIds: [],
  professorNames: [],
  title: 'A listing',
  departments: [],
  emails: [],
  websites: [],
  description: '',
  applicantDescription: '',
  keywords: [],
  researchAreas: [],
  established: '',
  views: 0,
  favorites: 0,
  hiringStatus: 0,
  archived: false,
  updatedAt: '',
  createdAt: '',
  confirmed: false,
  audited: false,
  ...overrides,
});

describe('searchReducer', () => {
  describe('initial state', () => {
    it('produces sensible defaults', () => {
      const state = createInitialSearchState();
      expect(state.queryString).toBe('');
      expect(state.selectedDepartments).toEqual([]);
      expect(state.departmentsFilterMode).toBe('union');
      expect(state.sortDirection).toBe('asc');
      expect(state.sortOrder).toBe(1);
      expect(state.page).toBe(1);
      expect(state.listings).toEqual([]);
      expect(state.isLoading).toBe(false);
    });

    it('applies overrides', () => {
      const state = createInitialSearchState({ sortBy: 'createdAt', page: 3 });
      expect(state.sortBy).toBe('createdAt');
      expect(state.page).toBe(3);
    });
  });

  describe('simple setters', () => {
    it('SET_QUERY_STRING updates the query', () => {
      const state = createInitialSearchState();
      const next = searchReducer(state, { type: 'SET_QUERY_STRING', payload: 'neuro' });
      expect(next.queryString).toBe('neuro');
      expect(next).not.toBe(state);
    });

    it('SET_SORT_BY and SET_SORT_ORDER update sort fields independently', () => {
      const state = createInitialSearchState();
      const afterSortBy = searchReducer(state, { type: 'SET_SORT_BY', payload: 'title' });
      expect(afterSortBy.sortBy).toBe('title');
      const afterOrder = searchReducer(afterSortBy, { type: 'SET_SORT_ORDER', payload: -1 });
      expect(afterOrder.sortOrder).toBe(-1);
      expect(afterOrder.sortBy).toBe('title');
    });

    it('SET_QUICK_FILTER supports clearing via null', () => {
      let state: SearchState = createInitialSearchState();
      state = searchReducer(state, { type: 'SET_QUICK_FILTER', payload: 'recent' });
      expect(state.quickFilter).toBe('recent');
      state = searchReducer(state, { type: 'SET_QUICK_FILTER', payload: null });
      expect(state.quickFilter).toBeNull();
    });
  });

  describe('collection setters accept value or updater', () => {
    it('SET_SELECTED_DEPARTMENTS replaces with an array payload', () => {
      const state = createInitialSearchState({ selectedDepartments: ['A'] });
      const next = searchReducer(state, {
        type: 'SET_SELECTED_DEPARTMENTS',
        payload: ['B', 'C'],
      });
      expect(next.selectedDepartments).toEqual(['B', 'C']);
    });

    it('SET_SELECTED_RESEARCH_AREAS accepts a functional updater', () => {
      const state = createInitialSearchState({ selectedResearchAreas: ['x', 'y', 'z'] });
      const next = searchReducer(state, {
        type: 'SET_SELECTED_RESEARCH_AREAS',
        payload: (prev) => prev.filter((a) => a !== 'y'),
      });
      expect(next.selectedResearchAreas).toEqual(['x', 'z']);
    });

    it('SET_SELECTED_LISTING_RESEARCH_AREAS updater receives previous state', () => {
      const state = createInitialSearchState({ selectedListingResearchAreas: ['a'] });
      const next = searchReducer(state, {
        type: 'SET_SELECTED_LISTING_RESEARCH_AREAS',
        payload: (prev) => [...prev, 'b'],
      });
      expect(next.selectedListingResearchAreas).toEqual(['a', 'b']);
    });
  });

  describe('TOGGLE_SORT_DIRECTION', () => {
    it('flips asc → desc and sets sortOrder to -1', () => {
      const state = createInitialSearchState();
      const next = searchReducer(state, { type: 'TOGGLE_SORT_DIRECTION' });
      expect(next.sortDirection).toBe('desc');
      expect(next.sortOrder).toBe(-1);
    });

    it('flips desc → asc and sets sortOrder to 1', () => {
      const state = createInitialSearchState({ sortDirection: 'desc', sortOrder: -1 });
      const next = searchReducer(state, { type: 'TOGGLE_SORT_DIRECTION' });
      expect(next.sortDirection).toBe('asc');
      expect(next.sortOrder).toBe(1);
    });

    it('is its own inverse', () => {
      const state = createInitialSearchState();
      const once = searchReducer(state, { type: 'TOGGLE_SORT_DIRECTION' });
      const twice = searchReducer(once, { type: 'TOGGLE_SORT_DIRECTION' });
      expect(twice.sortDirection).toBe(state.sortDirection);
      expect(twice.sortOrder).toBe(state.sortOrder);
    });
  });

  describe('SET_PAGE', () => {
    it('accepts a numeric value', () => {
      const state = createInitialSearchState({ page: 1 });
      const next = searchReducer(state, { type: 'SET_PAGE', payload: 5 });
      expect(next.page).toBe(5);
    });

    it('accepts an updater that increments the page', () => {
      const state = createInitialSearchState({ page: 2 });
      const next = searchReducer(state, {
        type: 'SET_PAGE',
        payload: (prev) => prev + 1,
      });
      expect(next.page).toBe(3);
    });
  });

  describe('search lifecycle', () => {
    it('SEARCH_REQUEST sets isLoading true', () => {
      const state = createInitialSearchState();
      const next = searchReducer(state, { type: 'SEARCH_REQUEST' });
      expect(next.isLoading).toBe(true);
    });

    it('SEARCH_SUCCESS with append=false replaces listings and clears loading', () => {
      const state = createInitialSearchState({
        listings: [makeListing({ id: 'old' })],
        isLoading: true,
      });
      const newListings = [makeListing({ id: 'a' }), makeListing({ id: 'b' })];
      const next = searchReducer(state, {
        type: 'SEARCH_SUCCESS',
        payload: { listings: newListings, totalCount: 2, pageSize: 20, append: false },
      });
      expect(next.listings.map((l) => l.id)).toEqual(['a', 'b']);
      expect(next.totalCount).toBe(2);
      expect(next.isLoading).toBe(false);
    });

    it('SEARCH_SUCCESS with append=true concatenates', () => {
      const state = createInitialSearchState({
        listings: [makeListing({ id: 'a' })],
      });
      const next = searchReducer(state, {
        type: 'SEARCH_SUCCESS',
        payload: {
          listings: [makeListing({ id: 'b' })],
          pageSize: 20,
          append: true,
          totalCount: 100,
        },
      });
      expect(next.listings.map((l) => l.id)).toEqual(['a', 'b']);
    });

    it('SEARCH_SUCCESS marks exhausted when fewer results than pageSize', () => {
      const state = createInitialSearchState();
      const next = searchReducer(state, {
        type: 'SEARCH_SUCCESS',
        payload: { listings: [makeListing()], pageSize: 20, append: false },
      });
      expect(next.searchExhausted).toBe(true);
    });

    it('SEARCH_SUCCESS does not mark exhausted when a full page returns', () => {
      const page = Array.from({ length: 20 }, (_, i) => makeListing({ id: String(i) }));
      const state = createInitialSearchState();
      const next = searchReducer(state, {
        type: 'SEARCH_SUCCESS',
        payload: { listings: page, pageSize: 20, append: false },
      });
      expect(next.searchExhausted).toBe(false);
    });

    it('SEARCH_SUCCESS preserves prior totalCount when payload totalCount is undefined', () => {
      const state = createInitialSearchState({ totalCount: 42 });
      const next = searchReducer(state, {
        type: 'SEARCH_SUCCESS',
        payload: { listings: [], pageSize: 20, append: true },
      });
      expect(next.totalCount).toBe(42);
    });

    it('SEARCH_FAILURE clears loading without touching listings', () => {
      const original = [makeListing({ id: 'keep' })];
      const state = createInitialSearchState({ listings: original, isLoading: true });
      const next = searchReducer(state, { type: 'SEARCH_FAILURE' });
      expect(next.isLoading).toBe(false);
      expect(next.listings).toBe(original);
    });
  });

  describe('lifecycle flags', () => {
    it('MARK_* actions flip their respective flags', () => {
      let state = createInitialSearchState();
      state = searchReducer(state, { type: 'MARK_QUERY_STRING_LOADED' });
      state = searchReducer(state, { type: 'MARK_DEPARTMENTS_LOADED' });
      state = searchReducer(state, { type: 'MARK_INITIAL_SEARCH_DONE' });
      expect(state.queryStringLoaded).toBe(true);
      expect(state.departmentsLoaded).toBe(true);
      expect(state.initialSearchDone).toBe(true);
    });
  });

  describe('purity', () => {
    it('does not mutate prior state', () => {
      const state = createInitialSearchState({ selectedDepartments: ['A'] });
      const snapshot = JSON.stringify(state);
      searchReducer(state, { type: 'SET_SELECTED_DEPARTMENTS', payload: ['B'] });
      searchReducer(state, { type: 'TOGGLE_SORT_DIRECTION' });
      searchReducer(state, {
        type: 'SEARCH_SUCCESS',
        payload: { listings: [makeListing()], pageSize: 20, append: true },
      });
      expect(JSON.stringify(state)).toBe(snapshot);
    });

    it('returns the same reference for unknown action types', () => {
      const state = createInitialSearchState();
      // @ts-expect-error intentionally invalid action
      const next = searchReducer(state, { type: 'NOPE' });
      expect(next).toBe(state);
    });
  });
});
