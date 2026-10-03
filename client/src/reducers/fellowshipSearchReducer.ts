/**
 * Pure reducer for fellowship search state.
 *
 * Mirrors searchReducer but for the fellowships listing flow. Extracted so
 * state transitions are testable without mounting the provider.
 */
import { Fellowship, FellowshipFilterOptions, StudentVisibilityTier } from '../types/types';

export type FellowshipQuickFilter =
  | 'open'
  | 'closingSoon'
  | 'nextCycle'
  | 'firstYear'
  | 'noMentorFirst'
  | 'guidance'
  | 'applicationsOnly'
  | null;

export interface StudentProgramFilters {
  selectedYearOfStudy: string[];
  selectedProgramCategory: string[];
  selectedProgramKind: string[];
  selectedEntryMode: string[];
  selectedStudentFacingCategory: string[];
  selectedTermOfAward: string[];
  selectedPurpose: string[];
  selectedSubjects: string[];
  selectedRegions: string[];
  selectedCitizenship: string[];
  quickFilter: FellowshipQuickFilter;
}

export const createEmptyStudentProgramFilters = (): StudentProgramFilters => ({
  selectedYearOfStudy: [],
  selectedProgramCategory: [],
  selectedProgramKind: [],
  selectedEntryMode: [],
  selectedStudentFacingCategory: [],
  selectedTermOfAward: [],
  selectedPurpose: [],
  selectedSubjects: [],
  selectedRegions: [],
  selectedCitizenship: [],
  quickFilter: null,
});

export interface ProgramSearchQueryCorrection {
  originalQuery: string;
  correctedQuery: string;
}

export interface FellowshipSearchState extends StudentProgramFilters {
  queryString: string;
  exactSpelling: boolean;
  queryCorrection: ProgramSearchQueryCorrection | null;
  selectedStudentVisibilityTier: StudentVisibilityTier[];
  sortBy: string;
  sortOrder: number;
  sortDirection: 'asc' | 'desc';
  fellowships: Fellowship[];
  isLoading: boolean;
  loadError: boolean;
  searchExhausted: boolean;
  total: number;
  page: number;
  filterOptions: FellowshipFilterOptions;
  filterBarHeight: number;
  filterOptionsLoaded: boolean;
}

export type FellowshipSearchAction =
  | { type: 'SET_QUERY_STRING'; payload: string }
  | { type: 'SEARCH_TYPED_SPELLING'; payload: string }
  | { type: 'SET_SELECTED_PROGRAM_CATEGORY'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_SELECTED_PROGRAM_KIND'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_SELECTED_ENTRY_MODE'; payload: string[] | ((prev: string[]) => string[]) }
  | {
      type: 'SET_SELECTED_STUDENT_FACING_CATEGORY';
      payload: string[] | ((prev: string[]) => string[]);
    }
  | { type: 'SET_SELECTED_YEAR_OF_STUDY'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_SELECTED_TERM_OF_AWARD'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_SELECTED_PURPOSE'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_SELECTED_SUBJECTS'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_SELECTED_REGIONS'; payload: string[] | ((prev: string[]) => string[]) }
  | { type: 'SET_SELECTED_CITIZENSHIP'; payload: string[] | ((prev: string[]) => string[]) }
  | {
      type: 'SET_SELECTED_STUDENT_VISIBILITY_TIER';
      payload:
        StudentVisibilityTier[] | ((prev: StudentVisibilityTier[]) => StudentVisibilityTier[]);
    }
  | { type: 'SET_SORT_BY'; payload: string }
  | { type: 'SET_SORT_ORDER'; payload: number }
  | { type: 'TOGGLE_SORT_DIRECTION' }
  | { type: 'SET_PAGE'; payload: number | ((prev: number) => number) }
  | { type: 'SET_QUICK_FILTER'; payload: FellowshipQuickFilter }
  | { type: 'RESET_PROGRAM_FILTERS' }
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
        queryCorrection?: ProgramSearchQueryCorrection | null;
      };
    }
  | { type: 'SEARCH_FAILURE' }
  | { type: 'LOAD_MORE_FAILURE' }
  | { type: 'MARK_FILTER_OPTIONS_LOADED' }
  | { type: 'RESET_LIFECYCLE_FLAGS' };

export const createInitialFellowshipSearchState = (
  overrides: Partial<FellowshipSearchState> = {},
): FellowshipSearchState => ({
  queryString: '',
  exactSpelling: false,
  queryCorrection: null,
  ...createEmptyStudentProgramFilters(),
  selectedStudentVisibilityTier: [],
  sortBy: 'default',
  sortOrder: -1,
  sortDirection: 'desc',
  fellowships: [],
  isLoading: true,
  loadError: false,
  searchExhausted: false,
  total: 0,
  page: 1,
  filterOptions: {
    programCategory: [],
    programKind: [],
    entryMode: [],
    studentFacingCategory: [],
    yearOfStudy: [],
    termOfAward: [],
    purpose: [],
    globalRegions: [],
    citizenshipStatus: [],
    subjects: [],
  },
  filterBarHeight: 0,
  filterOptionsLoaded: false,
  ...overrides,
});

const resolve = <T>(payload: T | ((prev: T) => T), prev: T): T =>
  typeof payload === 'function' ? (payload as (prev: T) => T)(prev) : payload;

export function fellowshipSearchReducer(
  state: FellowshipSearchState,
  action: FellowshipSearchAction,
): FellowshipSearchState {
  switch (action.type) {
    case 'SET_QUERY_STRING':
      return {
        ...state,
        queryString: action.payload,
        exactSpelling: action.payload === state.queryString ? state.exactSpelling : false,
      };

    case 'SEARCH_TYPED_SPELLING':
      return { ...state, queryString: action.payload, exactSpelling: true };

    case 'SET_SELECTED_PROGRAM_CATEGORY':
      return {
        ...state,
        selectedProgramCategory: resolve(action.payload, state.selectedProgramCategory),
      };

    case 'SET_SELECTED_PROGRAM_KIND':
      return {
        ...state,
        selectedProgramKind: resolve(action.payload, state.selectedProgramKind),
      };

    case 'SET_SELECTED_ENTRY_MODE':
      return {
        ...state,
        selectedEntryMode: resolve(action.payload, state.selectedEntryMode),
      };

    case 'SET_SELECTED_STUDENT_FACING_CATEGORY':
      return {
        ...state,
        selectedStudentFacingCategory: resolve(action.payload, state.selectedStudentFacingCategory),
      };

    case 'SET_SELECTED_YEAR_OF_STUDY':
      return { ...state, selectedYearOfStudy: resolve(action.payload, state.selectedYearOfStudy) };

    case 'SET_SELECTED_TERM_OF_AWARD':
      return { ...state, selectedTermOfAward: resolve(action.payload, state.selectedTermOfAward) };

    case 'SET_SELECTED_PURPOSE':
      return { ...state, selectedPurpose: resolve(action.payload, state.selectedPurpose) };

    case 'SET_SELECTED_SUBJECTS':
      return { ...state, selectedSubjects: resolve(action.payload, state.selectedSubjects) };

    case 'SET_SELECTED_REGIONS':
      return { ...state, selectedRegions: resolve(action.payload, state.selectedRegions) };

    case 'SET_SELECTED_CITIZENSHIP':
      return { ...state, selectedCitizenship: resolve(action.payload, state.selectedCitizenship) };

    case 'SET_SELECTED_STUDENT_VISIBILITY_TIER':
      return {
        ...state,
        selectedStudentVisibilityTier: resolve(action.payload, state.selectedStudentVisibilityTier),
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

    case 'RESET_PROGRAM_FILTERS':
      return { ...state, ...createEmptyStudentProgramFilters() };

    case 'SET_FILTER_BAR_HEIGHT':
      return { ...state, filterBarHeight: action.payload };

    case 'SET_FILTER_OPTIONS':
      return { ...state, filterOptions: action.payload };

    case 'SEARCH_REQUEST':
      return { ...state, isLoading: true, loadError: false };

    case 'SEARCH_SUCCESS': {
      const { fellowships, total, pageSize, append, queryCorrection } = action.payload;
      const nextFellowships = append ? [...state.fellowships, ...fellowships] : fellowships;
      const nextTotal = total !== undefined ? total : nextFellowships.length;
      return {
        ...state,
        fellowships: nextFellowships,
        total: nextTotal,
        searchExhausted:
          total !== undefined ? nextFellowships.length >= total : fellowships.length < pageSize,
        isLoading: false,
        queryCorrection: append ? state.queryCorrection : (queryCorrection ?? null),
      };
    }

    case 'SEARCH_FAILURE':
      return {
        ...state,
        fellowships: [],
        total: 0,
        searchExhausted: true,
        isLoading: false,
        loadError: true,
        queryCorrection: null,
      };

    case 'LOAD_MORE_FAILURE':
      return { ...state, isLoading: false };

    case 'MARK_FILTER_OPTIONS_LOADED':
      return { ...state, filterOptionsLoaded: true };

    case 'RESET_LIFECYCLE_FLAGS':
      return {
        ...state,
        filterOptionsLoaded: false,
      };

    default:
      return state;
  }
}
