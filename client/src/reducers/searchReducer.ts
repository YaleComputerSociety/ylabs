import { SearchState, SearchAction } from '../contexts/SearchContext';

export const initialSearchState: SearchState = {
  query: '',
  selectedDepartments: [],
  sortBy: 'default',
  sortOrder: 1,
  page: 1,
  pageSize: 20,
  searchExhausted: false,
  listings: [],
  isLoading: false,
};

export function searchReducer(state: SearchState, action: SearchAction): SearchState {
  switch (action.type) {
    // Query actions
    case 'SET_QUERY':
      return {
        ...state,
        query: action.payload,
        page: 1, // Reset page when query changes
      };

    // Department filter actions
    case 'ADD_DEPARTMENT':
      // Prevent duplicates
      if (state.selectedDepartments.includes(action.payload)) {
        return state;
      }
      return {
        ...state,
        selectedDepartments: [...state.selectedDepartments, action.payload],
        page: 1, // Reset page when filters change
      };

    case 'REMOVE_DEPARTMENT':
      return {
        ...state,
        selectedDepartments: state.selectedDepartments.filter(
          (dept) => dept !== action.payload
        ),
        page: 1, // Reset page when filters change
      };

    case 'CLEAR_DEPARTMENTS':
      return {
        ...state,
        selectedDepartments: [],
        page: 1,
      };

    // Sort actions
    case 'SET_SORT':
      return {
        ...state,
        sortBy: action.payload.sortBy,
        sortOrder: action.payload.sortOrder,
        page: 1, // Reset page when sort changes
      };

    case 'TOGGLE_SORT_DIRECTION':
      return {
        ...state,
        sortOrder: state.sortOrder === 1 ? -1 : 1,
        page: 1, // Reset page when sort direction changes
      };

    // Pagination actions
    case 'SET_PAGE':
      return {
        ...state,
        page: action.payload,
      };

    case 'INCREMENT_PAGE':
      return {
        ...state,
        page: state.page + 1,
      };

    case 'RESET_PAGE':
      return {
        ...state,
        page: 1,
      };

    // Listings actions
    case 'SET_LISTINGS':
      return {
        ...state,
        listings: action.payload,
        searchExhausted: action.payload.length < state.pageSize,
      };

    case 'APPEND_LISTINGS':
      return {
        ...state,
        listings: [...state.listings, ...action.payload],
        searchExhausted: action.payload.length < state.pageSize,
      };

    case 'SET_SEARCH_EXHAUSTED':
      return {
        ...state,
        searchExhausted: action.payload,
      };

    // Loading actions
    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.payload,
      };

    // Reset all
    case 'RESET_SEARCH':
      return initialSearchState;

    default:
      return state;
  }
}
