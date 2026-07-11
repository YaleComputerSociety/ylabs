/**
 * React context for fellowship search, filter, and sort state.
 */
import { createContext } from 'react';
import { Fellowship, FellowshipFilterOptions, StudentVisibilityTier } from '../types/types';
import { FellowshipQuickFilter } from '../reducers/fellowshipSearchReducer';

export interface FellowshipSearchContextType {
  queryString: string;
  setQueryString: (query: string) => void;

  selectedYearOfStudy: string[];
  selectedProgramCategory: string[];
  selectedProgramKind: string[];
  selectedEntryMode: string[];
  selectedStudentFacingCategory: string[];
  setSelectedProgramCategory: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedProgramKind: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedEntryMode: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedStudentFacingCategory: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedYearOfStudy: React.Dispatch<React.SetStateAction<string[]>>;
  selectedTermOfAward: string[];
  setSelectedTermOfAward: React.Dispatch<React.SetStateAction<string[]>>;
  selectedPurpose: string[];
  setSelectedPurpose: React.Dispatch<React.SetStateAction<string[]>>;
  selectedSubjects: string[];
  setSelectedSubjects: React.Dispatch<React.SetStateAction<string[]>>;
  selectedRegions: string[];
  setSelectedRegions: React.Dispatch<React.SetStateAction<string[]>>;
  selectedCitizenship: string[];
  setSelectedCitizenship: React.Dispatch<React.SetStateAction<string[]>>;
  selectedStudentVisibilityTier: StudentVisibilityTier[];
  setSelectedStudentVisibilityTier: React.Dispatch<React.SetStateAction<StudentVisibilityTier[]>>;

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

  quickFilter: string | null;
  setQuickFilter: (filter: FellowshipQuickFilter) => void;

  filterBarHeight: number;
  setFilterBarHeight: (height: number) => void;
}

export const defaultFellowshipSearchContext: FellowshipSearchContextType = {
  queryString: '',
  setQueryString: () => {},
  selectedYearOfStudy: [],
  selectedProgramCategory: [],
  selectedProgramKind: [],
  selectedEntryMode: [],
  selectedStudentFacingCategory: [],
  setSelectedProgramCategory: () => {},
  setSelectedProgramKind: () => {},
  setSelectedEntryMode: () => {},
  setSelectedStudentFacingCategory: () => {},
  setSelectedYearOfStudy: () => {},
  selectedTermOfAward: [],
  setSelectedTermOfAward: () => {},
  selectedPurpose: [],
  setSelectedPurpose: () => {},
  selectedSubjects: [],
  setSelectedSubjects: () => {},
  selectedRegions: [],
  setSelectedRegions: () => {},
  selectedCitizenship: [],
  setSelectedCitizenship: () => {},
  selectedStudentVisibilityTier: [],
  setSelectedStudentVisibilityTier: () => {},
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
  sortableKeys: [],
  refreshFellowships: () => {},
  quickFilter: null,
  setQuickFilter: () => {},
  filterBarHeight: 0,
  setFilterBarHeight: () => {},
};

export default createContext<FellowshipSearchContextType>(defaultFellowshipSearchContext);
