import { createContext } from "react";
import { Listing } from "../types/types";

export type FilterMode = 'intersection' | 'union';

export interface SearchContextType {
  // Query state
  queryString: string;
  setQueryString: (query: string) => void;

  // Department filter state
  selectedDepartments: string[];
  setSelectedDepartments: React.Dispatch<React.SetStateAction<string[]>>;

  // Research area filter state (Academic Disciplines)
  selectedResearchAreas: string[];
  setSelectedResearchAreas: React.Dispatch<React.SetStateAction<string[]>>;

  // Listing research area filter state (specific tags like "Machine Learning", etc.)
  selectedListingResearchAreas: string[];
  setSelectedListingResearchAreas: React.Dispatch<React.SetStateAction<string[]>>;

  // Per-filter combination modes (intersection = AND, union = OR)
  departmentsFilterMode: FilterMode;
  setDepartmentsFilterMode: React.Dispatch<React.SetStateAction<FilterMode>>;
  researchAreasFilterMode: FilterMode;
  setResearchAreasFilterMode: React.Dispatch<React.SetStateAction<FilterMode>>;
  listingResearchAreasFilterMode: FilterMode;
  setListingResearchAreasFilterMode: React.Dispatch<React.SetStateAction<FilterMode>>;

  // Sort state
  sortBy: string;
  setSortBy: (sortBy: string) => void;
  sortOrder: number;
  setSortOrder: (sortOrder: number) => void;
  sortDirection: 'asc' | 'desc';
  onToggleSortDirection: () => void;

  // Results
  listings: Listing[];
  isLoading: boolean;
  searchExhausted: boolean;
  totalCount: number;

  // Pagination
  page: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  pageSize: number;

  // Department data
  allDepartments: string[];

  // Research area data
  allResearchAreas: string[];

  // Listing research area data (specific tags)
  allListingResearchAreas: string[];

  // Sortable keys
  sortableKeys: string[];

  // Refresh function
  refreshListings: () => void;

  // Filter bar height for dynamic layout
  filterBarHeight: number;
  setFilterBarHeight: (height: number) => void;

  // Quick filter state (client-side filters like "Open Only", "Recently Added")
  quickFilter: string | null;
  setQuickFilter: (filter: string | null) => void;
}

export const defaultSearchContext: SearchContextType = {
  queryString: '',
  setQueryString: () => {},
  selectedDepartments: [],
  setSelectedDepartments: () => {},
  selectedResearchAreas: [],
  setSelectedResearchAreas: () => {},
  selectedListingResearchAreas: [],
  setSelectedListingResearchAreas: () => {},
  departmentsFilterMode: 'union',
  setDepartmentsFilterMode: () => {},
  researchAreasFilterMode: 'union',
  setResearchAreasFilterMode: () => {},
  listingResearchAreasFilterMode: 'union',
  setListingResearchAreasFilterMode: () => {},
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
  allResearchAreas: [],
  allListingResearchAreas: [],
  sortableKeys: [],
  refreshListings: () => {},
  filterBarHeight: 0,
  setFilterBarHeight: () => {},
  quickFilter: null,
  setQuickFilter: () => {},
};

export default createContext<SearchContextType>(defaultSearchContext);
