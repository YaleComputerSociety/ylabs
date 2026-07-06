/**
 * Provider component managing listing search state and API calls.
 *
 * State transitions live in reducers/searchReducer.ts so they are pure and
 * unit-testable. This component owns side effects (network, debounced effects)
 * and maps the reducer state/dispatch onto the existing SearchContext API.
 */
import {
  FC,
  useEffect,
  useCallback,
  useMemo,
  useReducer,
  useRef,
  useContext,
  ReactNode,
} from 'react';
import axios from '../utils/axios';
import swal from 'sweetalert';

import SearchContext, { FilterMode } from '../contexts/SearchContext';
import UserContext from '../contexts/UserContext';
import { Listing } from '../types/types';
import { createListing } from '../utils/apiCleaner';
import { useConfig } from '../hooks/useConfig';
import { searchReducer, createInitialSearchState } from '../reducers/searchReducer';

interface SearchContextProviderProps {
  children: ReactNode;
}

const SearchContextProvider: FC<SearchContextProviderProps> = ({ children }) => {
  const pageSize = 20;
  const sortableKeys = ['default', 'createdAt', 'ownerLastName', 'ownerFirstName', 'title'];

  const { isAuthenticated, isLoading: authLoading } = useContext(UserContext);

  const { departments, departmentCategories, researchAreas, isLoaded: configLoaded } = useConfig();

  const allDepartments = useMemo(
    () => departments.map((d) => d.displayName).sort((a, b) => a.localeCompare(b)),
    [departments],
  );

  const allResearchAreas = useMemo(
    () => [...departmentCategories].sort((a, b) => a.localeCompare(b)),
    [departmentCategories],
  );

  const allListingResearchAreas = useMemo(
    () => researchAreas.map((area) => area.name).sort((a, b) => a.localeCompare(b)),
    [researchAreas],
  );

  const [state, dispatch] = useReducer(searchReducer, undefined, () =>
    createInitialSearchState({ sortBy: sortableKeys[0] }),
  );

  const {
    queryString,
    selectedDepartments,
    selectedResearchAreas,
    selectedListingResearchAreas,
    departmentsFilterMode,
    researchAreasFilterMode,
    listingResearchAreasFilterMode,
    sortBy,
    sortOrder,
    sortDirection,
    listings,
    isLoading,
    searchExhausted,
    totalCount,
    page,
    filterBarHeight,
    quickFilter,
    queryStringLoaded,
    departmentsLoaded,
    initialSearchDone,
  } = state;

  // Context setter API preserved for compatibility with existing call sites
  // (some pass a value, some pass an updater function).
  const setQueryString = useCallback((query: string) => {
    dispatch({ type: 'SET_QUERY_STRING', payload: query });
  }, []);

  const setSelectedDepartments = useCallback((value: React.SetStateAction<string[]>) => {
    dispatch({ type: 'SET_SELECTED_DEPARTMENTS', payload: value });
  }, []) as React.Dispatch<React.SetStateAction<string[]>>;

  const setSelectedResearchAreas = useCallback((value: React.SetStateAction<string[]>) => {
    dispatch({ type: 'SET_SELECTED_RESEARCH_AREAS', payload: value });
  }, []) as React.Dispatch<React.SetStateAction<string[]>>;

  const setSelectedListingResearchAreas = useCallback((value: React.SetStateAction<string[]>) => {
    dispatch({ type: 'SET_SELECTED_LISTING_RESEARCH_AREAS', payload: value });
  }, []) as React.Dispatch<React.SetStateAction<string[]>>;

  const setDepartmentsFilterMode = useCallback((value: React.SetStateAction<FilterMode>) => {
    dispatch({ type: 'SET_DEPARTMENTS_FILTER_MODE', payload: value });
  }, []) as React.Dispatch<React.SetStateAction<FilterMode>>;

  const setResearchAreasFilterMode = useCallback((value: React.SetStateAction<FilterMode>) => {
    dispatch({ type: 'SET_RESEARCH_AREAS_FILTER_MODE', payload: value });
  }, []) as React.Dispatch<React.SetStateAction<FilterMode>>;

  const setListingResearchAreasFilterMode = useCallback(
    (value: React.SetStateAction<FilterMode>) => {
      dispatch({ type: 'SET_LISTING_RESEARCH_AREAS_FILTER_MODE', payload: value });
    },
    [],
  ) as React.Dispatch<React.SetStateAction<FilterMode>>;

  const setSortBy = useCallback((value: string) => {
    dispatch({ type: 'SET_SORT_BY', payload: value });
  }, []);

  const setSortOrder = useCallback((value: number) => {
    dispatch({ type: 'SET_SORT_ORDER', payload: value });
  }, []);

  const setPage = useCallback((value: React.SetStateAction<number>) => {
    dispatch({ type: 'SET_PAGE', payload: value });
  }, []) as React.Dispatch<React.SetStateAction<number>>;

  const setQuickFilter = useCallback((value: string | null) => {
    dispatch({ type: 'SET_QUICK_FILTER', payload: value });
  }, []);

  const setFilterBarHeight = useCallback((value: number) => {
    dispatch({ type: 'SET_FILTER_BAR_HEIGHT', payload: value });
  }, []);

  const onToggleSortDirection = useCallback(() => {
    dispatch({ type: 'TOGGLE_SORT_DIRECTION' });
  }, []);

  // Keep latest filter values in a ref so handleSearch can remain stable.
  const filtersRef = useRef({
    queryString,
    selectedDepartments,
    selectedResearchAreas,
    selectedListingResearchAreas,
    departmentsFilterMode,
    researchAreasFilterMode,
    listingResearchAreasFilterMode,
    sortBy,
    sortOrder,
  });
  filtersRef.current = {
    queryString,
    selectedDepartments,
    selectedResearchAreas,
    selectedListingResearchAreas,
    departmentsFilterMode,
    researchAreasFilterMode,
    listingResearchAreasFilterMode,
    sortBy,
    sortOrder,
  };

  const handleSearch = useCallback(
    (searchPage: number) => {
      const f = filtersRef.current;
      const formattedQuery = f.queryString.trim();

      let url = `/listings/search?query=${encodeURIComponent(formattedQuery)}&page=${searchPage}&pageSize=${pageSize}`;

      if (f.sortBy !== 'default') {
        url += `&sortBy=${f.sortBy}&sortOrder=${f.sortOrder}`;
      }

      if (f.selectedDepartments.length > 0) {
        url += `&departments=${encodeURIComponent(f.selectedDepartments.join('||'))}`;
      }

      if (f.selectedResearchAreas.length > 0) {
        url += `&academicDisciplines=${encodeURIComponent(f.selectedResearchAreas.join('||'))}`;
      }

      if (f.selectedListingResearchAreas.length > 0) {
        url += `&researchAreas=${encodeURIComponent(f.selectedListingResearchAreas.join(','))}`;
      }

      url += `&departmentsMode=${f.departmentsFilterMode}`;
      url += `&academicDisciplinesMode=${f.researchAreasFilterMode}`;
      url += `&researchAreasMode=${f.listingResearchAreasFilterMode}`;

      dispatch({ type: 'SEARCH_REQUEST' });

      axios
        .get(url)
        .then((response) => {
          const responseListings: Listing[] = response.data.results.map(function (elem: any) {
            return createListing(elem);
          });

          dispatch({
            type: 'SEARCH_SUCCESS',
            payload: {
              listings: responseListings,
              totalCount: response.data.totalCount,
              pageSize,
              append: searchPage !== 1,
            },
          });
        })
        .catch((error) => {
          console.error('Error loading listings:', error);
          if (error?.response?.status !== 401) {
            swal({
              text: 'Unable to load listings. Please try again later.',
              icon: 'warning',
            });
          }
          dispatch({ type: 'SEARCH_FAILURE' });
        });
    },
    [pageSize],
  );

  const refreshListings = useCallback(() => {
    dispatch({ type: 'SET_PAGE', payload: 1 });
    handleSearch(1);
  }, [handleSearch]);

  useEffect(() => {
    if (configLoaded && !authLoading && isAuthenticated && !initialSearchDone) {
      dispatch({ type: 'SET_PAGE', payload: 1 });
      handleSearch(1);
      dispatch({ type: 'MARK_INITIAL_SEARCH_DONE' });
    }
  }, [configLoaded, authLoading, isAuthenticated, initialSearchDone, handleSearch]);

  useEffect(() => {
    if (!configLoaded) return;

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
  }, [queryString, configLoaded]);

  useEffect(() => {
    if (!configLoaded) return;

    if (departmentsLoaded) {
      dispatch({ type: 'SET_PAGE', payload: 1 });
      handleSearch(1);
    }
    dispatch({ type: 'MARK_DEPARTMENTS_LOADED' });
  }, [
    selectedDepartments,
    selectedResearchAreas,
    selectedListingResearchAreas,
    departmentsFilterMode,
    researchAreasFilterMode,
    listingResearchAreasFilterMode,
    sortBy,
    sortOrder,
    configLoaded,
  ]);

  useEffect(() => {
    if (page > 1 && configLoaded) {
      handleSearch(page);
    }
  }, [page, configLoaded]);

  return (
    <SearchContext.Provider
      value={{
        queryString,
        setQueryString,
        selectedDepartments,
        setSelectedDepartments,
        selectedResearchAreas,
        setSelectedResearchAreas,
        selectedListingResearchAreas,
        setSelectedListingResearchAreas,
        allListingResearchAreas,
        departmentsFilterMode,
        setDepartmentsFilterMode,
        researchAreasFilterMode,
        setResearchAreasFilterMode,
        listingResearchAreasFilterMode,
        setListingResearchAreasFilterMode,
        sortBy,
        setSortBy,
        sortOrder,
        setSortOrder,
        sortDirection,
        onToggleSortDirection,
        listings,
        isLoading,
        searchExhausted,
        totalCount,
        page,
        setPage,
        pageSize,
        allDepartments,
        allResearchAreas,
        sortableKeys,
        refreshListings,
        filterBarHeight,
        setFilterBarHeight,
        quickFilter,
        setQuickFilter,
      }}
    >
      {children}
    </SearchContext.Provider>
  );
};

export default SearchContextProvider;
