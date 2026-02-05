import { createContext } from "react";
import { Fellowship, FellowshipFilterOptions } from "../types/types";

export interface FellowshipSearchContextType {
  // Query state
  queryString: string;
  setQueryString: (query: string) => void;

  // Filter state
  selectedYearOfStudy: string[];
  setSelectedYearOfStudy: React.Dispatch<React.SetStateAction<string[]>>;
  selectedTermOfAward: string[];
  setSelectedTermOfAward: React.Dispatch<React.SetStateAction<string[]>>;
  selectedPurpose: string[];
  setSelectedPurpose: React.Dispatch<React.SetStateAction<string[]>>;
  selectedRegions: string[];
  setSelectedRegions: React.Dispatch<React.SetStateAction<string[]>>;
  selectedCitizenship: string[];
  setSelectedCitizenship: React.Dispatch<React.SetStateAction<string[]>>;

  // Sort state
  sortBy: string;
  setSortBy: (sortBy: string) => void;
  sortOrder: number;
  setSortOrder: (sortOrder: number) => void;
  sortDirection: 'asc' | 'desc';
  onToggleSortDirection: () => void;

  // Results
  fellowships: Fellowship[];
  isLoading: boolean;
  searchExhausted: boolean;

  // Pagination
  page: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  pageSize: number;
  total: number;

  // Filter options (loaded from backend)
  filterOptions: FellowshipFilterOptions;

  // Sortable keys
  sortableKeys: string[];

  // Refresh function
  refreshFellowships: () => void;

  // Filter bar height for dynamic layout
  filterBarHeight: number;
  setFilterBarHeight: (height: number) => void;
}

export const defaultFellowshipSearchContext: FellowshipSearchContextType = {
  queryString: '',
  setQueryString: () => {},
  selectedYearOfStudy: [],
  setSelectedYearOfStudy: () => {},
  selectedTermOfAward: [],
  setSelectedTermOfAward: () => {},
  selectedPurpose: [],
  setSelectedPurpose: () => {},
  selectedRegions: [],
  setSelectedRegions: () => {},
  selectedCitizenship: [],
  setSelectedCitizenship: () => {},
  sortBy: 'default',
  setSortBy: () => {},
  sortOrder: -1,
  setSortOrder: () => {},
  sortDirection: 'desc',
  onToggleSortDirection: () => {},
  fellowships: [],
  isLoading: false,
  searchExhausted: false,
  page: 1,
  setPage: () => {},
  pageSize: 20,
  total: 0,
  filterOptions: {
    yearOfStudy: [],
    termOfAward: [],
    purpose: [],
    globalRegions: [],
    citizenshipStatus: [],
  },
  sortableKeys: [],
  refreshFellowships: () => {},
  filterBarHeight: 0,
  setFilterBarHeight: () => {},
};

export default createContext<FellowshipSearchContextType>(defaultFellowshipSearchContext);
