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
  useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from '../utils/axios';
import swal from 'sweetalert';

import SearchContext, { FilterMode } from '../contexts/SearchContext';
import UserContext from '../contexts/UserContext';
import { Listing } from '../types/types';
import { createListing } from '../utils/apiCleaner';
import { useConfig } from '../hooks/useConfig';
import { searchReducer, createInitialSearchState } from '../reducers/searchReducer';
import {
  parsePublicResearchUrlState,
  serializePublicResearchUrlState,
} from '../utils/publicResearchUrlState';

interface SearchContextProviderProps {
  children: ReactNode;
}

const LISTING_SORTABLE_KEYS = ['default', 'createdAt', 'ownerLastName', 'ownerFirstName', 'title'];
const PUBLIC_RESEARCH_SORTABLE_KEYS = ['default', 'createdAt', 'updatedAt'];

const SearchContextProvider: FC<SearchContextProviderProps> = ({ children }) => {
  const pageSize = 20;

  const { isAuthenticated, isLoading: authLoading } = useContext(UserContext);
  const location = useLocation();
  const navigate = useNavigate();
  const isResearchRoute =
    location.pathname === '/research' || location.pathname.startsWith('/research/');
  const sortableKeys = isResearchRoute ? PUBLIC_RESEARCH_SORTABLE_KEYS : LISTING_SORTABLE_KEYS;

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
  const currentPublicResearchUrl = isResearchRoute
    ? `${location.pathname}${location.search}`
    : null;
  const [hydratedPublicResearchUrl, setHydratedPublicResearchUrl] = useState<string | null>(
    null,
  );
  const urlStateReady =
    !isResearchRoute || hydratedPublicResearchUrl === currentPublicResearchUrl;

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
    initialSearchDone,
  } = state;
  const queryStringLoadedRef = useRef(false);
  const departmentsLoadedRef = useRef(false);
  const lastSerializedPublicResearchUrlRef = useRef<string | null>(null);

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

  useEffect(() => {
    if (!sortableKeys.includes(sortBy)) {
      dispatch({ type: 'SET_SORT_BY', payload: sortableKeys[0] });
    }
  }, [sortBy, sortableKeys]);

  useEffect(() => {
    if (!isResearchRoute) {
      setHydratedPublicResearchUrl(null);
      lastSerializedPublicResearchUrlRef.current = null;
      return;
    }

    const urlState = parsePublicResearchUrlState(location.search);
    lastSerializedPublicResearchUrlRef.current = serializePublicResearchUrlState(urlState);
    dispatch({
      type: 'HYDRATE_SEARCH_STATE',
      payload: {
        ...urlState,
        page: 1,
      },
    });
    setHydratedPublicResearchUrl(currentPublicResearchUrl);
  }, [isResearchRoute, location.search, currentPublicResearchUrl]);

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

  useEffect(() => {
    if (!isResearchRoute || !urlStateReady) return;

    const nextSearch = serializePublicResearchUrlState({
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
      quickFilter,
    });

    if (
      nextSearch === location.search ||
      nextSearch === lastSerializedPublicResearchUrlRef.current
    ) {
      return;
    }

    lastSerializedPublicResearchUrlRef.current = nextSearch;
    navigate({ pathname: location.pathname, search: nextSearch }, { replace: true });
  }, [
    isResearchRoute,
    urlStateReady,
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
    quickFilter,
    location.pathname,
    location.search,
    navigate,
  ]);

  const handleSearch = useCallback(
    (searchPage: number) => {
      const f = filtersRef.current;
      const formattedQuery = f.queryString.trim();

      const endpoint = isResearchRoute ? '/research' : '/listings/search';
      let url = `${endpoint}?query=${encodeURIComponent(formattedQuery)}&page=${searchPage}&pageSize=${pageSize}`;

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
    [isResearchRoute, pageSize],
  );

  const refreshListings = useCallback(() => {
    if (!urlStateReady) return;

    dispatch({ type: 'SET_PAGE', payload: 1 });
    handleSearch(1);
  }, [handleSearch, urlStateReady]);

  useEffect(() => {
    if (
      urlStateReady &&
      configLoaded &&
      !authLoading &&
      (isAuthenticated || isResearchRoute) &&
      !initialSearchDone
    ) {
      dispatch({ type: 'SET_PAGE', payload: 1 });
      handleSearch(1);
      dispatch({ type: 'MARK_INITIAL_SEARCH_DONE' });
    }
  }, [
    configLoaded,
    urlStateReady,
    authLoading,
    isAuthenticated,
    isResearchRoute,
    initialSearchDone,
    handleSearch,
  ]);

  useEffect(() => {
    if (!urlStateReady || !configLoaded || authLoading || (!isAuthenticated && !isResearchRoute))
      return;

    const debounceTimeout = setTimeout(() => {
      if (queryStringLoadedRef.current) {
        dispatch({ type: 'SET_PAGE', payload: 1 });
        handleSearch(1);
      }
      queryStringLoadedRef.current = true;
      dispatch({ type: 'MARK_QUERY_STRING_LOADED' });
    }, 500);

    return () => {
      clearTimeout(debounceTimeout);
    };
  }, [
    queryString,
    configLoaded,
    urlStateReady,
    authLoading,
    isAuthenticated,
    isResearchRoute,
    handleSearch,
  ]);

  useEffect(() => {
    if (!urlStateReady || !configLoaded || authLoading || (!isAuthenticated && !isResearchRoute))
      return;

    if (departmentsLoadedRef.current) {
      dispatch({ type: 'SET_PAGE', payload: 1 });
      handleSearch(1);
    }
    departmentsLoadedRef.current = true;
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
    urlStateReady,
    authLoading,
    isAuthenticated,
    isResearchRoute,
    handleSearch,
  ]);

  useEffect(() => {
    if (
      page > 1 &&
      urlStateReady &&
      configLoaded &&
      !authLoading &&
      (isAuthenticated || isResearchRoute)
    ) {
      handleSearch(page);
    }
  }, [
    page,
    urlStateReady,
    configLoaded,
    authLoading,
    isAuthenticated,
    isResearchRoute,
    handleSearch,
  ]);

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
