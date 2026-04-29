/**
 * React context for the labs (`/labs`) browse-page search state.
 *
 * Mirrors SearchContext but for ResearchGroup rather than Listing. Provider
 * wires this onto labSearchReducer + a runSearch() function that calls
 * `POST /api/research-groups/search`.
 */
import { createContext } from 'react';
import {
  ResearchGroup,
  ResearchGroupSearchFilters,
  ResearchGroupSortBy,
  ResearchGroupSortOrder,
} from '../types/researchGroup';

export interface LabSearchContextType {
  queryString: string;
  setQueryString: (query: string) => void;

  filters: ResearchGroupSearchFilters;
  setFilters: React.Dispatch<React.SetStateAction<ResearchGroupSearchFilters>>;
  clearFilters: () => void;

  sortBy: ResearchGroupSortBy | 'default';
  setSortBy: (sortBy: ResearchGroupSortBy | 'default') => void;
  sortOrder: ResearchGroupSortOrder;
  setSortOrder: (sortOrder: ResearchGroupSortOrder) => void;

  page: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  pageSize: number;

  results: ResearchGroup[];
  totalHits: number;
  isLoading: boolean;
  error: string | null;
  searchExhausted: boolean;

  runSearch: () => void;
}

export const defaultLabSearchContext: LabSearchContextType = {
  queryString: '',
  setQueryString: () => {},
  filters: {},
  setFilters: () => {},
  clearFilters: () => {},
  sortBy: 'default',
  setSortBy: () => {},
  sortOrder: 'desc',
  setSortOrder: () => {},
  page: 1,
  setPage: () => {},
  pageSize: 24,
  results: [],
  totalHits: 0,
  isLoading: false,
  error: null,
  searchExhausted: false,
  runSearch: () => {},
};

export default createContext<LabSearchContextType>(defaultLabSearchContext);
