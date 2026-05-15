import { describe, expect, it } from 'vitest';

import { ResearchEntity } from '../../types/researchEntity';
import {
  LabSearchState,
  createInitialLabSearchState,
  labSearchReducer,
} from '../labSearchReducer';

const makeGroup = (overrides: Partial<ResearchEntity> = {}): ResearchEntity => ({
  _id: 'g-1',
  slug: 'group-1',
  name: 'Group 1',
  kind: 'lab',
  description: '',
  websiteUrl: '',
  location: '',
  departments: [],
  researchAreas: [],
  school: '',
  openness: 'open',
  acceptingUndergrads: true,
  typicalUndergradRoles: [],
  prerequisiteCourses: [],
  creditOptions: [],
  fundingPrograms: [],
  contactEmail: '',
  contactName: '',
  contactRole: '',
  sourceUrls: [],
  ...overrides,
});

describe('labSearchReducer', () => {
  describe('initial state', () => {
    it('produces sensible defaults', () => {
      const state = createInitialLabSearchState();
      expect(state.queryString).toBe('');
      // Default acceptanceLevel: 'all' is the noop value (no server filter).
      expect(state.filters).toEqual({ acceptanceLevel: 'all' });
      expect(state.sortBy).toBe('default');
      expect(state.sortOrder).toBe('desc');
      expect(state.page).toBe(1);
      expect(state.pageSize).toBe(24);
      expect(state.results).toEqual([]);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.searchExhausted).toBe(false);
      expect(state.initialSearchDone).toBe(false);
    });

    it('applies overrides', () => {
      const state = createInitialLabSearchState({
        sortBy: 'name',
        page: 3,
        pageSize: 50,
      });
      expect(state.sortBy).toBe('name');
      expect(state.page).toBe(3);
      expect(state.pageSize).toBe(50);
    });
  });

  describe('simple setters', () => {
    it('SET_QUERY_STRING updates the query', () => {
      const state = createInitialLabSearchState();
      const next = labSearchReducer(state, { type: 'SET_QUERY_STRING', payload: 'neuro' });
      expect(next.queryString).toBe('neuro');
      expect(next).not.toBe(state);
    });

    it('SET_SORT_BY and SET_SORT_ORDER update sort fields independently', () => {
      const state = createInitialLabSearchState();
      const afterSortBy = labSearchReducer(state, { type: 'SET_SORT_BY', payload: 'name' });
      expect(afterSortBy.sortBy).toBe('name');
      const afterOrder = labSearchReducer(afterSortBy, {
        type: 'SET_SORT_ORDER',
        payload: 'asc',
      });
      expect(afterOrder.sortOrder).toBe('asc');
      expect(afterOrder.sortBy).toBe('name');
    });
  });

  describe('filter setters', () => {
    it('SET_FILTERS replaces with an object payload', () => {
      const state = createInitialLabSearchState({ filters: { kind: ['lab'] } });
      const next = labSearchReducer(state, {
        type: 'SET_FILTERS',
        payload: { school: ['School of Medicine'] },
      });
      expect(next.filters).toEqual({ school: ['School of Medicine'] });
    });

    it('SET_FILTERS accepts a functional updater that receives previous filters', () => {
      const state = createInitialLabSearchState({ filters: { kind: ['lab'] } });
      const next = labSearchReducer(state, {
        type: 'SET_FILTERS',
        payload: (prev) => ({ ...prev, openness: ['open'] }),
      });
      expect(next.filters).toEqual({ kind: ['lab'], openness: ['open'] });
    });

    it('CLEAR_FILTERS resets to the default filter object (preserves acceptanceLevel=all)', () => {
      const state = createInitialLabSearchState({
        filters: { kind: ['lab'], school: ['SOM'], acceptingUndergrads: true },
      });
      const next = labSearchReducer(state, { type: 'CLEAR_FILTERS' });
      expect(next.filters).toEqual({ acceptanceLevel: 'all' });
    });
  });

  describe('acceptanceLevel filter', () => {
    it('SET_FILTERS can set acceptanceLevel via functional updater', () => {
      const state = createInitialLabSearchState();
      const next = labSearchReducer(state, {
        type: 'SET_FILTERS',
        payload: (prev) => ({ ...prev, acceptanceLevel: 'verified' }),
      });
      expect(next.filters.acceptanceLevel).toBe('verified');
    });

    it('SET_FILTERS can switch acceptanceLevel between values', () => {
      const state = createInitialLabSearchState({
        filters: { acceptanceLevel: 'verified' },
      });
      const next = labSearchReducer(state, {
        type: 'SET_FILTERS',
        payload: { acceptanceLevel: 'verified-or-likely' },
      });
      expect(next.filters.acceptanceLevel).toBe('verified-or-likely');
    });
  });

  describe('SET_PAGE', () => {
    it('accepts a numeric value', () => {
      const state = createInitialLabSearchState({ page: 1 });
      const next = labSearchReducer(state, { type: 'SET_PAGE', payload: 5 });
      expect(next.page).toBe(5);
    });

    it('accepts an updater that increments the page', () => {
      const state = createInitialLabSearchState({ page: 2 });
      const next = labSearchReducer(state, {
        type: 'SET_PAGE',
        payload: (prev) => prev + 1,
      });
      expect(next.page).toBe(3);
    });
  });

  describe('search lifecycle', () => {
    it('SEARCH_REQUEST sets isLoading true and clears error', () => {
      const state = createInitialLabSearchState({ error: 'previous' });
      const next = labSearchReducer(state, { type: 'SEARCH_REQUEST' });
      expect(next.isLoading).toBe(true);
      expect(next.error).toBeNull();
    });

    it('SEARCH_SUCCESS with append=false replaces results and clears loading', () => {
      const state = createInitialLabSearchState({
        results: [makeGroup({ _id: 'old' })],
        isLoading: true,
      });
      const newResults = [makeGroup({ _id: 'a' }), makeGroup({ _id: 'b' })];
      const next = labSearchReducer(state, {
        type: 'SEARCH_SUCCESS',
        payload: { results: newResults, totalHits: 2, pageSize: 24, append: false },
      });
      expect(next.results.map((r) => r._id)).toEqual(['a', 'b']);
      expect(next.totalHits).toBe(2);
      expect(next.isLoading).toBe(false);
    });

    it('SEARCH_SUCCESS with append=true concatenates', () => {
      const state = createInitialLabSearchState({ results: [makeGroup({ _id: 'a' })] });
      const next = labSearchReducer(state, {
        type: 'SEARCH_SUCCESS',
        payload: {
          results: [makeGroup({ _id: 'b' })],
          totalHits: 100,
          pageSize: 24,
          append: true,
        },
      });
      expect(next.results.map((r) => r._id)).toEqual(['a', 'b']);
    });

    it('SEARCH_SUCCESS marks exhausted when fewer results than pageSize', () => {
      const state = createInitialLabSearchState();
      const next = labSearchReducer(state, {
        type: 'SEARCH_SUCCESS',
        payload: { results: [makeGroup()], totalHits: 1, pageSize: 24, append: false },
      });
      expect(next.searchExhausted).toBe(true);
    });

    it('SEARCH_SUCCESS does not mark exhausted when a full page returns', () => {
      const page = Array.from({ length: 24 }, (_, i) =>
        makeGroup({ _id: String(i), slug: `g-${i}` }),
      );
      const state = createInitialLabSearchState();
      const next = labSearchReducer(state, {
        type: 'SEARCH_SUCCESS',
        payload: { results: page, totalHits: 100, pageSize: 24, append: false },
      });
      expect(next.searchExhausted).toBe(false);
    });

    it('SEARCH_SUCCESS preserves prior totalHits when omitted', () => {
      const state = createInitialLabSearchState({ totalHits: 42 });
      const next = labSearchReducer(state, {
        type: 'SEARCH_SUCCESS',
        payload: { results: [], pageSize: 24, append: true },
      });
      expect(next.totalHits).toBe(42);
    });

    it('SEARCH_FAILURE clears loading, sets error, leaves results intact', () => {
      const original = [makeGroup({ _id: 'keep' })];
      const state = createInitialLabSearchState({ results: original, isLoading: true });
      const next = labSearchReducer(state, {
        type: 'SEARCH_FAILURE',
        payload: 'meili down',
      });
      expect(next.isLoading).toBe(false);
      expect(next.error).toBe('meili down');
      expect(next.results).toBe(original);
    });

    it('SEARCH_FAILURE without payload uses a default error string', () => {
      const state = createInitialLabSearchState({ isLoading: true });
      const next = labSearchReducer(state, { type: 'SEARCH_FAILURE' });
      expect(next.error).toBe('Search failed');
    });
  });

  describe('lifecycle flags', () => {
    it('MARK_* actions flip their respective flags', () => {
      let state = createInitialLabSearchState();
      state = labSearchReducer(state, { type: 'MARK_QUERY_STRING_LOADED' });
      state = labSearchReducer(state, { type: 'MARK_FILTERS_LOADED' });
      state = labSearchReducer(state, { type: 'MARK_INITIAL_SEARCH_DONE' });
      expect(state.queryStringLoaded).toBe(true);
      expect(state.filtersLoaded).toBe(true);
      expect(state.initialSearchDone).toBe(true);
    });
  });

  describe('purity', () => {
    it('does not mutate prior state', () => {
      const state = createInitialLabSearchState({ filters: { kind: ['lab'] } });
      const snapshot = JSON.stringify(state);
      labSearchReducer(state, { type: 'SET_FILTERS', payload: { kind: ['center'] } });
      labSearchReducer(state, { type: 'SET_QUERY_STRING', payload: 'n' });
      labSearchReducer(state, {
        type: 'SEARCH_SUCCESS',
        payload: { results: [makeGroup()], pageSize: 24, append: true },
      });
      expect(JSON.stringify(state)).toBe(snapshot);
    });

    it('returns the same reference for unknown action types', () => {
      const state = createInitialLabSearchState();
      // @ts-expect-error intentionally invalid action
      const next = labSearchReducer(state, { type: 'NOPE' });
      expect(next).toBe(state);
    });
  });
});
