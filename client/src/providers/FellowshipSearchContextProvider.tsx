/**
 * Provider component managing fellowship search state and API calls.
 *
 * State transitions live in reducers/fellowshipSearchReducer.ts; this component
 * owns side effects and maps reducer state/dispatch onto the context API.
 */
import { FC, useEffect, useCallback, useContext, useReducer, useRef, ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import axios from '../utils/axios';
import swal from 'sweetalert';

import FellowshipSearchContext from '../contexts/FellowshipSearchContext';
import UserContext from '../contexts/UserContext';
import { Fellowship, StudentVisibilityTier } from '../types/types';
import { createFellowship } from '../utils/createFellowship';
import {
  fellowshipSearchReducer,
  createInitialFellowshipSearchState,
  FellowshipQuickFilter,
} from '../reducers/fellowshipSearchReducer';

interface FellowshipSearchContextProviderProps {
  children: ReactNode;
}

const FELLOWSHIP_SORTABLE_KEYS = ['default', 'deadline', 'title'];

const FellowshipSearchContextProvider: FC<FellowshipSearchContextProviderProps> = ({
  children,
}) => {
  const pageSize = 500;
  const sortableKeys = FELLOWSHIP_SORTABLE_KEYS;

  const location = useLocation();
  const isActive = location.pathname === '/programs';

  const { isAuthenticated, isLoading: authLoading } = useContext(UserContext);
  const { user } = useContext(UserContext);
  const authReady = !authLoading && isAuthenticated;
  const isAdmin = user?.userType === 'admin';

  const [state, dispatch] = useReducer(fellowshipSearchReducer, undefined, () =>
    createInitialFellowshipSearchState({ sortBy: sortableKeys[0] }),
  );

  const {
    queryString,
    selectedProgramCategory,
    selectedProgramKind,
    selectedEntryMode,
    selectedStudentFacingCategory,
    selectedYearOfStudy,
    selectedTermOfAward,
    selectedPurpose,
    selectedSubjects,
    selectedRegions,
    selectedCitizenship,
    selectedStudentVisibilityTier,
    sortBy,
    sortOrder,
    sortDirection,
    fellowships,
    isLoading,
    searchExhausted,
    total,
    page,
    filterOptions,
    quickFilter,
    filterBarHeight,
    queryStringLoaded,
    filtersLoaded,
    initialSearchDone,
    filterOptionsLoaded,
  } = state;

  const setQueryString = useCallback((value: string) => {
    dispatch({ type: 'SET_QUERY_STRING', payload: value });
  }, []);

  const setSelectedYearOfStudy = useCallback((value: React.SetStateAction<string[]>) => {
    dispatch({ type: 'SET_SELECTED_YEAR_OF_STUDY', payload: value });
  }, []) as React.Dispatch<React.SetStateAction<string[]>>;

  const setSelectedProgramCategory = useCallback((value: React.SetStateAction<string[]>) => {
    dispatch({ type: 'SET_SELECTED_PROGRAM_CATEGORY', payload: value });
  }, []) as React.Dispatch<React.SetStateAction<string[]>>;

  const setSelectedProgramKind = useCallback((value: React.SetStateAction<string[]>) => {
    dispatch({ type: 'SET_SELECTED_PROGRAM_KIND', payload: value });
  }, []) as React.Dispatch<React.SetStateAction<string[]>>;

  const setSelectedEntryMode = useCallback((value: React.SetStateAction<string[]>) => {
    dispatch({ type: 'SET_SELECTED_ENTRY_MODE', payload: value });
  }, []) as React.Dispatch<React.SetStateAction<string[]>>;

  const setSelectedStudentFacingCategory = useCallback((value: React.SetStateAction<string[]>) => {
    dispatch({ type: 'SET_SELECTED_STUDENT_FACING_CATEGORY', payload: value });
  }, []) as React.Dispatch<React.SetStateAction<string[]>>;

  const setSelectedTermOfAward = useCallback((value: React.SetStateAction<string[]>) => {
    dispatch({ type: 'SET_SELECTED_TERM_OF_AWARD', payload: value });
  }, []) as React.Dispatch<React.SetStateAction<string[]>>;

  const setSelectedPurpose = useCallback((value: React.SetStateAction<string[]>) => {
    dispatch({ type: 'SET_SELECTED_PURPOSE', payload: value });
  }, []) as React.Dispatch<React.SetStateAction<string[]>>;

  const setSelectedSubjects = useCallback((value: React.SetStateAction<string[]>) => {
    dispatch({ type: 'SET_SELECTED_SUBJECTS', payload: value });
  }, []) as React.Dispatch<React.SetStateAction<string[]>>;

  const setSelectedRegions = useCallback((value: React.SetStateAction<string[]>) => {
    dispatch({ type: 'SET_SELECTED_REGIONS', payload: value });
  }, []) as React.Dispatch<React.SetStateAction<string[]>>;

  const setSelectedCitizenship = useCallback((value: React.SetStateAction<string[]>) => {
    dispatch({ type: 'SET_SELECTED_CITIZENSHIP', payload: value });
  }, []) as React.Dispatch<React.SetStateAction<string[]>>;

  const setSelectedStudentVisibilityTier = useCallback(
    (value: React.SetStateAction<StudentVisibilityTier[]>) => {
      dispatch({ type: 'SET_SELECTED_STUDENT_VISIBILITY_TIER', payload: value });
    },
    [],
  ) as React.Dispatch<React.SetStateAction<StudentVisibilityTier[]>>;

  const setSortBy = useCallback((value: string) => {
    dispatch({
      type: 'SET_SORT_BY',
      payload: sortableKeys.includes(value) ? value : sortableKeys[0],
    });
  }, []);

  const setSortOrder = useCallback((value: number) => {
    dispatch({ type: 'SET_SORT_ORDER', payload: value });
  }, []);

  const setPage = useCallback((value: React.SetStateAction<number>) => {
    dispatch({ type: 'SET_PAGE', payload: value });
  }, []) as React.Dispatch<React.SetStateAction<number>>;

  const setQuickFilter = useCallback((value: FellowshipQuickFilter) => {
    dispatch({ type: 'SET_QUICK_FILTER', payload: value });
  }, []);

  const setFilterBarHeight = useCallback((value: number) => {
    dispatch({ type: 'SET_FILTER_BAR_HEIGHT', payload: value });
  }, []);

  const onToggleSortDirection = useCallback(() => {
    dispatch({ type: 'TOGGLE_SORT_DIRECTION' });
  }, []);

  const filtersRef = useRef({
    queryString,
    selectedProgramCategory,
    selectedProgramKind,
    selectedEntryMode,
    selectedStudentFacingCategory,
    selectedYearOfStudy,
    selectedTermOfAward,
    selectedPurpose,
    selectedSubjects,
    selectedRegions,
    selectedCitizenship,
    selectedStudentVisibilityTier,
    sortBy,
    sortOrder,
  });
  filtersRef.current = {
    queryString,
    selectedProgramCategory,
    selectedProgramKind,
    selectedEntryMode,
    selectedStudentFacingCategory,
    selectedYearOfStudy,
    selectedTermOfAward,
    selectedPurpose,
    selectedSubjects,
    selectedRegions,
    selectedCitizenship,
    selectedStudentVisibilityTier,
    sortBy,
    sortOrder,
  };

  useEffect(() => {
    if (!isActive) {
      dispatch({ type: 'RESET_LIFECYCLE_FLAGS' });
    }
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;
    if (!authReady) return;

    axios
      .get('/programs/filters')
      .then((response) => {
        dispatch({
          type: 'SET_FILTER_OPTIONS',
          payload: {
            yearOfStudy: response.data.yearOfStudy || [],
            programCategory: response.data.programCategory || [],
            programKind: response.data.programKind || [],
            entryMode: response.data.entryMode || [],
            studentFacingCategory: response.data.studentFacingCategory || [],
            termOfAward: response.data.termOfAward || [],
            purpose: response.data.purpose || [],
            globalRegions: response.data.globalRegions || [],
            citizenshipStatus: response.data.citizenshipStatus || [],
            subjects: response.data.subjects || [],
          },
        });
        dispatch({ type: 'MARK_FILTER_OPTIONS_LOADED' });
      })
      .catch(() => {
        console.error('Error loading fellowship filter options.');
        dispatch({ type: 'MARK_FILTER_OPTIONS_LOADED' });
      });
  }, [isActive, authReady]);

  const handleSearch = useCallback(
    (searchPage: number) => {
      const f = filtersRef.current;
      const formattedQuery = f.queryString.trim();

      let url = `/programs/search?query=${encodeURIComponent(formattedQuery)}&page=${searchPage}&pageSize=${pageSize}`;

      if (f.sortBy !== 'default') {
        url += `&sortBy=${f.sortBy}&sortOrder=${f.sortOrder}`;
      }

      if (f.selectedProgramCategory.length > 0) {
        url += `&programCategory=${encodeURIComponent(f.selectedProgramCategory.join(','))}`;
      }
      if (f.selectedProgramKind.length > 0) {
        url += `&programKind=${encodeURIComponent(f.selectedProgramKind.join(','))}`;
      }
      if (f.selectedEntryMode.length > 0) {
        url += `&entryMode=${encodeURIComponent(f.selectedEntryMode.join(','))}`;
      }
      if (f.selectedStudentFacingCategory.length > 0) {
        url += `&studentFacingCategory=${encodeURIComponent(f.selectedStudentFacingCategory.join(','))}`;
      }
      if (f.selectedYearOfStudy.length > 0) {
        url += `&yearOfStudy=${encodeURIComponent(f.selectedYearOfStudy.join(','))}`;
      }
      if (f.selectedTermOfAward.length > 0) {
        url += `&termOfAward=${encodeURIComponent(f.selectedTermOfAward.join(','))}`;
      }
      if (f.selectedPurpose.length > 0) {
        url += `&purpose=${encodeURIComponent(f.selectedPurpose.join(','))}`;
      }
      if (f.selectedSubjects.length > 0) {
        url += `&subjects=${encodeURIComponent(f.selectedSubjects.join(','))}`;
      }
      if (f.selectedRegions.length > 0) {
        url += `&globalRegions=${encodeURIComponent(f.selectedRegions.join(','))}`;
      }
      if (f.selectedCitizenship.length > 0) {
        url += `&citizenshipStatus=${encodeURIComponent(f.selectedCitizenship.join(','))}`;
      }
      if (isAdmin && f.selectedStudentVisibilityTier.length > 0) {
        url += `&studentVisibilityTier=${encodeURIComponent(f.selectedStudentVisibilityTier.join(','))}`;
        if (f.selectedStudentVisibilityTier.includes('operator_review')) {
          url += '&includeOperatorReview=true';
        }
        if (f.selectedStudentVisibilityTier.includes('suppressed')) {
          url += '&includeSuppressed=true';
        }
      }

      dispatch({ type: 'SEARCH_REQUEST' });

      axios
        .get(url)
        .then((response) => {
          const responseFellowships: Fellowship[] = response.data.results.map((elem: any) =>
            createFellowship(elem),
          );

          dispatch({
            type: 'SEARCH_SUCCESS',
            payload: {
              fellowships: responseFellowships,
              total: response.data.total,
              pageSize,
              append: searchPage !== 1,
            },
          });
        })
        .catch((error) => {
          console.error('Error loading fellowships.');
          if (error?.response?.status !== 401) {
            swal({
              text: 'Unable to load fellowships. Please try again later.',
              icon: 'warning',
            });
          }
          dispatch({ type: 'SEARCH_FAILURE' });
        });
    },
    [isAdmin, pageSize],
  );

  const refreshFellowships = useCallback(() => {
    dispatch({ type: 'SET_PAGE', payload: 1 });
    handleSearch(1);
  }, [handleSearch]);

  useEffect(() => {
    if (!isActive) return;
    if (!authReady) return;
    if (filterOptionsLoaded && !initialSearchDone) {
      dispatch({ type: 'SET_PAGE', payload: 1 });
      handleSearch(1);
      dispatch({ type: 'MARK_INITIAL_SEARCH_DONE' });
    }
  }, [filterOptionsLoaded, initialSearchDone, handleSearch, isActive, authReady]);

  useEffect(() => {
    if (!isActive) return;
    if (!filterOptionsLoaded) return;

    const debounceTimeout = setTimeout(() => {
      if (queryStringLoaded) {
        dispatch({ type: 'SET_PAGE', payload: 1 });
        handleSearch(1);
      }
      dispatch({ type: 'MARK_QUERY_STRING_LOADED' });
    }, 500);

    return () => {
      clearTimeout(debounceTimeout);
    };
  }, [queryString, filterOptionsLoaded, isActive]);

  useEffect(() => {
    if (!isActive) return;
    if (!filterOptionsLoaded) return;

    if (filtersLoaded) {
      dispatch({ type: 'SET_PAGE', payload: 1 });
      handleSearch(1);
    }
    dispatch({ type: 'MARK_FILTERS_LOADED' });
  }, [
    selectedYearOfStudy,
    selectedProgramCategory,
    selectedProgramKind,
    selectedEntryMode,
    selectedStudentFacingCategory,
    selectedTermOfAward,
    selectedPurpose,
    selectedSubjects,
    selectedRegions,
    selectedCitizenship,
    selectedStudentVisibilityTier,
    sortBy,
    sortOrder,
    filterOptionsLoaded,
    isActive,
  ]);

  useEffect(() => {
    if (!isActive) return;
    if (page > 1 && filterOptionsLoaded) {
      handleSearch(page);
    }
  }, [page, filterOptionsLoaded, isActive]);

  return (
    <FellowshipSearchContext.Provider
      value={{
        queryString,
        setQueryString,
        selectedProgramCategory,
        setSelectedProgramCategory,
        selectedProgramKind,
        setSelectedProgramKind,
        selectedEntryMode,
        setSelectedEntryMode,
        selectedStudentFacingCategory,
        setSelectedStudentFacingCategory,
        selectedYearOfStudy,
        setSelectedYearOfStudy,
        selectedTermOfAward,
        setSelectedTermOfAward,
        selectedPurpose,
        setSelectedPurpose,
        selectedSubjects,
        setSelectedSubjects,
        selectedRegions,
        setSelectedRegions,
        selectedCitizenship,
        selectedStudentVisibilityTier,
        setSelectedStudentVisibilityTier,
        setSelectedCitizenship,
        sortBy,
        setSortBy,
        sortOrder,
        setSortOrder,
        sortDirection,
        onToggleSortDirection,
        fellowships,
        isLoading,
        searchExhausted,
        page,
        setPage,
        pageSize,
        total,
        filterOptions,
        sortableKeys,
        refreshFellowships,
        quickFilter,
        setQuickFilter,
        filterBarHeight,
        setFilterBarHeight,
      }}
    >
      {children}
    </FellowshipSearchContext.Provider>
  );
};

export default FellowshipSearchContextProvider;
