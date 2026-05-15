/**
 * React context for the research (`/research`) browse-page search state.
 *
 * Mirrors SearchContext but for ResearchEntity rather than Listing. Provider
 * wires this onto labSearchReducer + a runSearch() function that calls
 * `POST /api/research/search`.
 */
import { createContext } from 'react';
import {
  ResearchEntity,
  ResearchEntitySearchFilters,
  ResearchEntitySortBy,
  ResearchEntitySortOrder,
} from '../types/researchEntity';

export interface LabSearchContextType {
  queryString: string;
  setQueryString: (query: string) => void;

  filters: ResearchEntitySearchFilters;
  setFilters: React.Dispatch<React.SetStateAction<ResearchEntitySearchFilters>>;
  clearFilters: () => void;

  sortBy: ResearchEntitySortBy | 'default';
  setSortBy: (sortBy: ResearchEntitySortBy | 'default') => void;
  sortOrder: ResearchEntitySortOrder;
  setSortOrder: (sortOrder: ResearchEntitySortOrder) => void;

  page: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  pageSize: number;

  results: ResearchEntity[];
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
