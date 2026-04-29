/**
 * Pure reducer for the labs (`/labs`) browse-page search state.
 *
 * Mirrors searchReducer.ts (listings) and fellowshipSearchReducer.ts in shape
 * so consumers and tests are familiar. The provider that wraps this reducer
 * owns side effects (axios calls, debouncing, lifecycle); the reducer here is
 * pure so transitions are easy to test.
 */
import {
  ResearchGroup,
  ResearchGroupSearchFilters,
  ResearchGroupSortBy,
  ResearchGroupSortOrder,
} from '../types/researchGroup';

export interface LabSearchState {
  queryString: string;
  filters: ResearchGroupSearchFilters;
  sortBy: ResearchGroupSortBy | 'default';
  sortOrder: ResearchGroupSortOrder;
  page: number;
  pageSize: number;
  results: ResearchGroup[];
  totalHits: number;
  isLoading: boolean;
  error: string | null;
  searchExhausted: boolean;
  /** Lifecycle flags so the provider can debounce / coalesce initial loads. */
  queryStringLoaded: boolean;
  filtersLoaded: boolean;
  initialSearchDone: boolean;
}

export type LabSearchAction =
  | { type: 'SET_QUERY_STRING'; payload: string }
  | {
      type: 'SET_FILTERS';
      payload:
        | ResearchGroupSearchFilters
        | ((prev: ResearchGroupSearchFilters) => ResearchGroupSearchFilters);
    }
  | { type: 'CLEAR_FILTERS' }
  | { type: 'SET_SORT_BY'; payload: ResearchGroupSortBy | 'default' }
  | { type: 'SET_SORT_ORDER'; payload: ResearchGroupSortOrder }
  | { type: 'SET_PAGE'; payload: number | ((prev: number) => number) }
  | { type: 'SEARCH_REQUEST' }
  | {
      type: 'SEARCH_SUCCESS';
      payload: {
        results: ResearchGroup[];
        totalHits?: number;
        pageSize: number;
        append: boolean;
      };
    }
  | { type: 'SEARCH_FAILURE'; payload?: string }
  | { type: 'MARK_QUERY_STRING_LOADED' }
  | { type: 'MARK_FILTERS_LOADED' }
  | { type: 'MARK_INITIAL_SEARCH_DONE' };

export const createInitialLabSearchState = (
  overrides: Partial<LabSearchState> = {},
): LabSearchState => ({
  queryString: '',
  // `acceptanceLevel: 'all'` preserves the prior behavior where the labs page
  // shows every group regardless of acceptance signal. Switching to
  // 'verified' or 'verified-or-likely' is opt-in via the filter sidebar.
  filters: { acceptanceLevel: 'all' },
  sortBy: 'default',
  sortOrder: 'desc',
  page: 1,
  pageSize: 24,
  results: [],
  totalHits: 0,
  isLoading: false,
  error: null,
  searchExhausted: false,
  queryStringLoaded: false,
  filtersLoaded: false,
  initialSearchDone: false,
  ...overrides,
});

const resolve = <T>(payload: T | ((prev: T) => T), prev: T): T =>
  typeof payload === 'function' ? (payload as (prev: T) => T)(prev) : payload;

export function labSearchReducer(state: LabSearchState, action: LabSearchAction): LabSearchState {
  switch (action.type) {
    case 'SET_QUERY_STRING':
      return { ...state, queryString: action.payload };

    case 'SET_FILTERS':
      return { ...state, filters: resolve(action.payload, state.filters) };

    case 'CLEAR_FILTERS':
      // Preserve the default acceptanceLevel so clearing filters doesn't drop
      // the user into an undefined state on the backend.
      return { ...state, filters: { acceptanceLevel: 'all' } };

    case 'SET_SORT_BY':
      return { ...state, sortBy: action.payload };

    case 'SET_SORT_ORDER':
      return { ...state, sortOrder: action.payload };

    case 'SET_PAGE':
      return { ...state, page: resolve(action.payload, state.page) };

    case 'SEARCH_REQUEST':
      return { ...state, isLoading: true, error: null };

    case 'SEARCH_SUCCESS': {
      const { results, totalHits, pageSize, append } = action.payload;
      return {
        ...state,
        results: append ? [...state.results, ...results] : results,
        totalHits: totalHits !== undefined ? totalHits : state.totalHits,
        searchExhausted: results.length < pageSize,
        isLoading: false,
        error: null,
      };
    }

    case 'SEARCH_FAILURE':
      return {
        ...state,
        isLoading: false,
        error: action.payload ?? 'Search failed',
      };

    case 'MARK_QUERY_STRING_LOADED':
      return { ...state, queryStringLoaded: true };

    case 'MARK_FILTERS_LOADED':
      return { ...state, filtersLoaded: true };

    case 'MARK_INITIAL_SEARCH_DONE':
      return { ...state, initialSearchDone: true };

    default:
      return state;
  }
}
