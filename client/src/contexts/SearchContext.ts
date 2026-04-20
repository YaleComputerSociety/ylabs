/**
 * React context for listing search, filter, and sort state.
 */
import { createContext } from 'react';
import { Listing } from '../types/types';

export type FilterMode = 'intersection' | 'union';

export interface SearchContextType {
  queryString: string;
  setQueryString: (query: string) => void;

  selectedDepartments: string[];
  setSelectedDepartments: React.Dispatch<React.SetStateAction<string[]>>;

  selectedDisciplines: string[];
  setSelectedDisciplines: React.Dispatch<React.SetStateAction<string[]>>;

  selectedResearchAreas: string[];
  setSelectedResearchAreas: React.Dispatch<React.SetStateAction<string[]>>;

  departmentsFilterMode: FilterMode;
  setDepartmentsFilterMode: React.Dispatch<React.SetStateAction<FilterMode>>;
  disciplinesFilterMode: FilterMode;
  setDisciplinesFilterMode: React.Dispatch<React.SetStateAction<FilterMode>>;
  researchAreasFilterMode: FilterMode;
  setResearchAreasFilterMode: React.Dispatch<React.SetStateAction<FilterMode>>;

  sortBy: string;
  setSortBy: (sortBy: string) => void;
  sortOrder: number;
  setSortOrder: (sortOrder: number) => void;
  sortDirection: 'asc' | 'desc';
  onToggleSortDirection: () => void;

  listings: Listing[];
  isLoading: boolean;
  searchExhausted: boolean;
  totalCount: number;

  page: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  pageSize: number;

  allDepartments: string[];

  allDisciplines: string[];

  allResearchAreas: string[];

  sortableKeys: string[];

  refreshListings: () => void;

  filterBarHeight: number;
  setFilterBarHeight: (height: number) => void;

  quickFilter: string | null;
  setQuickFilter: (filter: string | null) => void;
}

export const defaultSearchContext: SearchContextType = {
  queryString: '',
  setQueryString: () => {},
  selectedDepartments: [],
  setSelectedDepartments: () => {},
  selectedDisciplines: [],
  setSelectedDisciplines: () => {},
  selectedResearchAreas: [],
  setSelectedResearchAreas: () => {},
  departmentsFilterMode: 'union',
  setDepartmentsFilterMode: () => {},
  disciplinesFilterMode: 'union',
  setDisciplinesFilterMode: () => {},
  researchAreasFilterMode: 'union',
  setResearchAreasFilterMode: () => {},
  sortBy: 'default',
  setSortBy: () => {},
  sortOrder: 1,
  setSortOrder: () => {},
  sortDirection: 'asc',
  onToggleSortDirection: () => {},
  listings: [],
  isLoading: false,
  searchExhausted: false,
  totalCount: 0,
  page: 1,
  setPage: () => {},
  pageSize: 20,
  allDepartments: [],
  allDisciplines: [],
  allResearchAreas: [],
  sortableKeys: [],
  refreshListings: () => {},
  filterBarHeight: 0,
  setFilterBarHeight: () => {},
  quickFilter: null,
  setQuickFilter: () => {},
};

export default createContext<SearchContextType>(defaultSearchContext);
