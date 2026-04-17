/**
 * Pure reducer for listing search state.
 *
 * Split out from SearchContextProvider so state transitions can be unit-tested
 * in isolation without mounting React or mocking network calls.
 */
import { Listing } from '../types/types';
import { FilterMode } from '../contexts/SearchContext';

export interface SearchState {
  queryString: string;
  selectedDepartments: string[];
  selectedResearchAreas: string[];
  selectedListingResearchAreas: string[];
  departmentsFilterMode: FilterMode;
  researchAreasFilterMode: FilterMode;
  listingResearchAreasFilterMode: FilterMode;
  sortBy: string;
  sortOrder: number;
  sortDirection: 'asc' | 'desc';
  page: number;
  quickFilter: string | null;
  filterBarHeight: number;
  listings: Listing[];
  isLoading: boolean;
  searchExhausted: boolean;
  totalCount: number;
  queryStringLoaded: boolean;
  departmentsLoaded: boolean;
  initialSearchDone: boolean;
}

export type SearchAction =
  | { type: 'SET_QUERY_STRING'; payload: string }
  | { type: 'SET_SELECTED_DEPARTMENTS'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_SELECTED_RESEARCH_AREAS'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_SELECTED_LISTING_RESEARCH_AREAS'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_DEPARTMENTS_FILTER_MODE'; payload: FilterMode | ((prev: FilterMode) => FilterMode) }
  | { type: 'SET_RESEARCH_AREAS_FILTER_MODE'; payload: FilterMode | ((prev: FilterMode) => FilterMode) }
  | { type: 'SET_LISTING_RESEARCH_AREAS_FILTER_MODE'; payload: FilterMode | ((prev: FilterMode) => FilterMode) }
  | { type: 'SET_SORT_BY'; payload: string }
  | { type: 'SET_SORT_ORDER'; payload: number }
  | { type: 'TOGGLE_SORT_DIRECTION' }
  | { type: 'SET_PAGE'; payload: number | ((prev: number) => number) }
  | { type: 'SET_QUICK_FILTER'; payload: string | null }
  | { type: 'SET_FILTER_BAR_HEIGHT'; payload: number }
  | { type: 'SEARCH_REQUEST' }
  | {
      type: 'SEARCH_SUCCESS';
      payload: { listings: Listing[]; totalCount?: number; pageSize: number; append: boolean };
    }
  | { type: 'SEARCH_FAILURE' }
  | { type: 'MARK_QUERY_STRING_LOADED' }
  | { type: 'MARK_DEPARTMENTS_LOADED' }
  | { type: 'MARK_INITIAL_SEARCH_DONE' };

export const createInitialSearchState = (
  overrides: Partial<SearchState> = {}
): SearchState => ({
  queryString: '',
  selectedDepartments: [],
  selectedResearchAreas: [],
  selectedListingResearchAreas: [],
  departmentsFilterMode: 'union',
  researchAreasFilterMode: 'union',
  listingResearchAreasFilterMode: 'union',
  sortBy: 'default',
  sortOrder: 1,
  sortDirection: 'asc',
  page: 1,
  quickFilter: null,
  filterBarHeight: 0,
  listings: [],
  isLoading: false,
  searchExhausted: false,
  totalCount: 0,
  queryStringLoaded: false,
  departmentsLoaded: false,
  initialSearchDone: false,
  ...overrides,
});

const resolve = <T>(payload: T | ((prev: T) => T), prev: T): T =>
  typeof payload === 'function' ? (payload as (prev: T) => T)(prev) : payload;

export function searchReducer(state: SearchState, action: SearchAction): SearchState {
  switch (action.type) {
    case 'SET_QUERY_STRING':
      return { ...state, queryString: action.payload };

    case 'SET_SELECTED_DEPARTMENTS':
      return { ...state, selectedDepartments: resolve(action.payload, state.selectedDepartments) };

    case 'SET_SELECTED_RESEARCH_AREAS':
      return {
        ...state,
        selectedResearchAreas: resolve(action.payload, state.selectedResearchAreas),
      };

    case 'SET_SELECTED_LISTING_RESEARCH_AREAS':
      return {
        ...state,
        selectedListingResearchAreas: resolve(
          action.payload,
          state.selectedListingResearchAreas
        ),
      };

    case 'SET_DEPARTMENTS_FILTER_MODE':
      return {
        ...state,
        departmentsFilterMode: resolve(action.payload, state.departmentsFilterMode),
      };

    case 'SET_RESEARCH_AREAS_FILTER_MODE':
      return {
        ...state,
        researchAreasFilterMode: resolve(action.payload, state.researchAreasFilterMode),
      };

    case 'SET_LISTING_RESEARCH_AREAS_FILTER_MODE':
      return {
        ...state,
        listingResearchAreasFilterMode: resolve(
          action.payload,
          state.listingResearchAreasFilterMode
        ),
      };

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

    case 'SEARCH_REQUEST':
      return { ...state, isLoading: true };

    case 'SEARCH_SUCCESS': {
      const { listings, totalCount, pageSize, append } = action.payload;
      return {
        ...state,
        listings: append ? [...state.listings, ...listings] : listings,
        totalCount: totalCount !== undefined ? totalCount : state.totalCount,
        searchExhausted: listings.length < pageSize,
        isLoading: false,
      };
    }

    case 'SEARCH_FAILURE':
      return { ...state, isLoading: false };

    case 'MARK_QUERY_STRING_LOADED':
      return { ...state, queryStringLoaded: true };

    case 'MARK_DEPARTMENTS_LOADED':
      return { ...state, departmentsLoaded: true };

    case 'MARK_INITIAL_SEARCH_DONE':
      return { ...state, initialSearchDone: true };

    default:
      return state;
  }
}
