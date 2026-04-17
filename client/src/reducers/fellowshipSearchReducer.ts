/**
 * Pure reducer for fellowship search state.
 *
 * Mirrors searchReducer but for the fellowships listing flow. Extracted so
 * state transitions are testable without mounting the provider.
 */
import { Fellowship, FellowshipFilterOptions } from '../types/types';

export type FellowshipQuickFilter = 'open' | 'closingSoon' | 'recent' | null;

export interface FellowshipSearchState {
  queryString: string;
  selectedYearOfStudy: string[];
  selectedTermOfAward: string[];
  selectedPurpose: string[];
  selectedRegions: string[];
  selectedCitizenship: string[];
  sortBy: string;
  sortOrder: number;
  sortDirection: 'asc' | 'desc';
  fellowships: Fellowship[];
  isLoading: boolean;
  searchExhausted: boolean;
  total: number;
  page: number;
  filterOptions: FellowshipFilterOptions;
  quickFilter: FellowshipQuickFilter;
  filterBarHeight: number;
  queryStringLoaded: boolean;
  filtersLoaded: boolean;
  initialSearchDone: boolean;
  filterOptionsLoaded: boolean;
}

export type FellowshipSearchAction =
  | { type: 'SET_QUERY_STRING'; payload: string }
  | { type: 'SET_SELECTED_YEAR_OF_STUDY'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_SELECTED_TERM_OF_AWARD'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_SELECTED_PURPOSE'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_SELECTED_REGIONS'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_SELECTED_CITIZENSHIP'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_SORT_BY'; payload: string }
  | { type: 'SET_SORT_ORDER'; payload: number }
  | { type: 'TOGGLE_SORT_DIRECTION' }
  | { type: 'SET_PAGE'; payload: number | ((prev: number) => number) }
  | { type: 'SET_QUICK_FILTER'; payload: FellowshipQuickFilter }
  | { type: 'SET_FILTER_BAR_HEIGHT'; payload: number }
  | { type: 'SET_FILTER_OPTIONS'; payload: FellowshipFilterOptions }
  | { type: 'SEARCH_REQUEST' }
  | {
      type: 'SEARCH_SUCCESS';
      payload: {
        fellowships: Fellowship[];
        total?: number;
        pageSize: number;
        append: boolean;
      };
    }
  | { type: 'SEARCH_FAILURE' }
  | { type: 'MARK_QUERY_STRING_LOADED' }
  | { type: 'MARK_FILTERS_LOADED' }
  | { type: 'MARK_INITIAL_SEARCH_DONE' }
  | { type: 'MARK_FILTER_OPTIONS_LOADED' }
  | { type: 'RESET_LIFECYCLE_FLAGS' };

export const createInitialFellowshipSearchState = (
  overrides: Partial<FellowshipSearchState> = {}
): FellowshipSearchState => ({
  queryString: '',
  selectedYearOfStudy: [],
  selectedTermOfAward: [],
  selectedPurpose: [],
  selectedRegions: [],
  selectedCitizenship: [],
  sortBy: 'default',
  sortOrder: -1,
  sortDirection: 'desc',
  fellowships: [],
  isLoading: false,
  searchExhausted: false,
  total: 0,
  page: 1,
  filterOptions: {
    yearOfStudy: [],
    termOfAward: [],
    purpose: [],
    globalRegions: [],
    citizenshipStatus: [],
  },
  quickFilter: null,
  filterBarHeight: 0,
  queryStringLoaded: false,
  filtersLoaded: false,
  initialSearchDone: false,
  filterOptionsLoaded: false,
  ...overrides,
});

const resolve = <T>(payload: T | ((prev: T) => T), prev: T): T =>
  typeof payload === 'function' ? (payload as (prev: T) => T)(prev) : payload;

export function fellowshipSearchReducer(
  state: FellowshipSearchState,
  action: FellowshipSearchAction
): FellowshipSearchState {
  switch (action.type) {
    case 'SET_QUERY_STRING':
      return { ...state, queryString: action.payload };

    case 'SET_SELECTED_YEAR_OF_STUDY':
      return { ...state, selectedYearOfStudy: resolve(action.payload, state.selectedYearOfStudy) };

    case 'SET_SELECTED_TERM_OF_AWARD':
      return { ...state, selectedTermOfAward: resolve(action.payload, state.selectedTermOfAward) };

    case 'SET_SELECTED_PURPOSE':
      return { ...state, selectedPurpose: resolve(action.payload, state.selectedPurpose) };

    case 'SET_SELECTED_REGIONS':
      return { ...state, selectedRegions: resolve(action.payload, state.selectedRegions) };

    case 'SET_SELECTED_CITIZENSHIP':
      return { ...state, selectedCitizenship: resolve(action.payload, state.selectedCitizenship) };

    case 'SET_SORT_BY':
      return { ...state, sortBy: action.payload };

    case 'SET_SORT_ORDER':
      return { ...state, sortOrder: action.payload };

    case 'TOGGLE_SORT_DIRECTION': {
      const sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
      return {
        ...state,
        sortDirection,
        sortOrder: sortDirection === 'asc' ? 1 : -1,
      };
    }

    case 'SET_PAGE':
      return { ...state, page: resolve(action.payload, state.page) };

    case 'SET_QUICK_FILTER':
      return { ...state, quickFilter: action.payload };

    case 'SET_FILTER_BAR_HEIGHT':
      return { ...state, filterBarHeight: action.payload };

    case 'SET_FILTER_OPTIONS':
      return { ...state, filterOptions: action.payload };

    case 'SEARCH_REQUEST':
      return { ...state, isLoading: true };

    case 'SEARCH_SUCCESS': {
      const { fellowships, total, pageSize, append } = action.payload;
      return {
        ...state,
        fellowships: append ? [...state.fellowships, ...fellowships] : fellowships,
        total: total !== undefined ? total : fellowships.length,
        searchExhausted: fellowships.length < pageSize,
        isLoading: false,
      };
    }

    case 'SEARCH_FAILURE':
      return { ...state, isLoading: false };

    case 'MARK_QUERY_STRING_LOADED':
      return { ...state, queryStringLoaded: true };

    case 'MARK_FILTERS_LOADED':
      return { ...state, filtersLoaded: true };

    case 'MARK_INITIAL_SEARCH_DONE':
      return { ...state, initialSearchDone: true };

    case 'MARK_FILTER_OPTIONS_LOADED':
      return { ...state, filterOptionsLoaded: true };

    case 'RESET_LIFECYCLE_FLAGS':
      return {
        ...state,
        initialSearchDone: false,
        filterOptionsLoaded: false,
        queryStringLoaded: false,
        filtersLoaded: false,
      };

    default:
      return state;
  }
}
