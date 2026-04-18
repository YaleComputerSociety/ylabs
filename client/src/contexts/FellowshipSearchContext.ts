/**
 * React context for fellowship search, filter, and sort state.
 */
import { createContext } from 'react';
import { Fellowship, FellowshipFilterOptions } from '../types/types';

export interface FellowshipSearchContextType {
  queryString: string;
  setQueryString: (query: string) => void;

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

  sortBy: string;
  setSortBy: (sortBy: string) => void;
  sortOrder: number;
  setSortOrder: (sortOrder: number) => void;
  sortDirection: 'asc' | 'desc';
  onToggleSortDirection: () => void;

  fellowships: Fellowship[];
  isLoading: boolean;
  searchExhausted: boolean;

  page: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  pageSize: number;
  total: number;

  filterOptions: FellowshipFilterOptions;

  sortableKeys: string[];

  refreshFellowships: () => void;

  quickFilter: 'open' | 'closingSoon' | 'recent' | null;
  setQuickFilter: (filter: 'open' | 'closingSoon' | 'recent' | null) => void;

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
  quickFilter: null,
  setQuickFilter: () => {},
  filterBarHeight: 0,
  setFilterBarHeight: () => {},
};

export default createContext<FellowshipSearchContextType>(defaultFellowshipSearchContext);
