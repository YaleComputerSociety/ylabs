import { createContext } from 'react';
import { Listing } from '../types/types';

export interface SearchState {
  query: string;
  selectedDepartments: string[];

  sortBy: string;
  sortOrder: 1 | -1;

  page: number;
  pageSize: number;
  searchExhausted: boolean;

  listings: Listing[];
  isLoading: boolean;
}

export type SearchAction =
  | { type: 'SET_QUERY'; payload: string }

  | { type: 'ADD_DEPARTMENT'; payload: string }
  | { type: 'REMOVE_DEPARTMENT'; payload: string }
  | { type: 'CLEAR_DEPARTMENTS' }

  | { type: 'SET_SORT'; payload: { sortBy: string; sortOrder: 1 | -1 } }
  | { type: 'TOGGLE_SORT_DIRECTION' }

  | { type: 'SET_PAGE'; payload: number }
  | { type: 'INCREMENT_PAGE' }
  | { type: 'RESET_PAGE' }

  | { type: 'SET_LISTINGS'; payload: Listing[] }
  | { type: 'APPEND_LISTINGS'; payload: Listing[] }
  | { type: 'SET_SEARCH_EXHAUSTED'; payload: boolean }

  | { type: 'SET_LOADING'; payload: boolean }

  | { type: 'RESET_SEARCH' };

export interface SearchContextType {
  state: SearchState;
  dispatch: React.Dispatch<SearchAction>;

  setQuery: (query: string) => void;
  addDepartment: (department: string) => void;
  removeDepartment: (department: string) => void;
  clearDepartments: () => void;
  setSort: (sortBy: string, sortOrder: 1 | -1) => void;
  toggleSortDirection: () => void;
  nextPage: () => void;
  resetSearch: () => void;
}

const SearchContext = createContext<SearchContextType>({
  state: {
    query: '',
    selectedDepartments: [],
    sortBy: 'default',
    sortOrder: 1,
    page: 1,
    pageSize: 20,
    searchExhausted: false,
    listings: [],
    isLoading: false,
  },
  dispatch: () => {},
  setQuery: () => {},
  addDepartment: () => {},
  removeDepartment: () => {},
  clearDepartments: () => {},
  setSort: () => {},
  toggleSortDirection: () => {},
  nextPage: () => {},
  resetSearch: () => {},
});

export default SearchContext;
