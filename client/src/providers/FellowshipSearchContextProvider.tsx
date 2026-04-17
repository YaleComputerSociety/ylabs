/**
 * Provider component managing fellowship search state and API calls.
 *
 * State transitions live in reducers/fellowshipSearchReducer.ts; this component
 * owns side effects and maps reducer state/dispatch onto the context API.
 */
import { FC, useEffect, useCallback, useContext, useReducer, useRef, ReactNode } from "react";
import { useLocation } from "react-router-dom";
import axios from "../utils/axios";
import swal from "sweetalert";

import FellowshipSearchContext from "../contexts/FellowshipSearchContext";
import UserContext from "../contexts/UserContext";
import { Fellowship } from "../types/types";
import { createFellowship } from "../utils/createFellowship";
import {
  fellowshipSearchReducer,
  createInitialFellowshipSearchState,
  FellowshipQuickFilter,
} from "../reducers/fellowshipSearchReducer";

interface FellowshipSearchContextProviderProps {
  children: ReactNode;
}

const FellowshipSearchContextProvider: FC<FellowshipSearchContextProviderProps> = ({ children }) => {
  const pageSize = 500;
  const sortableKeys = ['default', 'createdAt', 'deadline', 'title'];

  const location = useLocation();
  const isActive = location.pathname === '/fellowships';

  const { isAuthenticated, isLoading: authLoading } = useContext(UserContext);
  const authReady = !authLoading && isAuthenticated;

  const [state, dispatch] = useReducer(
    fellowshipSearchReducer,
    undefined,
    () => createInitialFellowshipSearchState({ sortBy: sortableKeys[0] })
  );

  const {
    queryString,
    selectedYearOfStudy,
    selectedTermOfAward,
    selectedPurpose,
    selectedRegions,
    selectedCitizenship,
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

  const setSelectedYearOfStudy = useCallback(
    (value: React.SetStateAction<string[]>) => {
      dispatch({ type: 'SET_SELECTED_YEAR_OF_STUDY', payload: value });
    },
    []
  ) as React.Dispatch<React.SetStateAction<string[]>>;

  const setSelectedTermOfAward = useCallback(
    (value: React.SetStateAction<string[]>) => {
      dispatch({ type: 'SET_SELECTED_TERM_OF_AWARD', payload: value });
    },
    []
  ) as React.Dispatch<React.SetStateAction<string[]>>;

  const setSelectedPurpose = useCallback(
    (value: React.SetStateAction<string[]>) => {
      dispatch({ type: 'SET_SELECTED_PURPOSE', payload: value });
    },
    []
  ) as React.Dispatch<React.SetStateAction<string[]>>;

  const setSelectedRegions = useCallback(
    (value: React.SetStateAction<string[]>) => {
      dispatch({ type: 'SET_SELECTED_REGIONS', payload: value });
    },
    []
  ) as React.Dispatch<React.SetStateAction<string[]>>;

  const setSelectedCitizenship = useCallback(
    (value: React.SetStateAction<string[]>) => {
      dispatch({ type: 'SET_SELECTED_CITIZENSHIP', payload: value });
    },
    []
  ) as React.Dispatch<React.SetStateAction<string[]>>;

  const setSortBy = useCallback((value: string) => {
    dispatch({ type: 'SET_SORT_BY', payload: value });
  }, []);

  const setSortOrder = useCallback((value: number) => {
    dispatch({ type: 'SET_SORT_ORDER', payload: value });
  }, []);

  const setPage = useCallback(
    (value: React.SetStateAction<number>) => {
      dispatch({ type: 'SET_PAGE', payload: value });
    },
    []
  ) as React.Dispatch<React.SetStateAction<number>>;

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
    selectedYearOfStudy,
    selectedTermOfAward,
    selectedPurpose,
    selectedRegions,
    selectedCitizenship,
    sortBy,
    sortOrder,
  });
  filtersRef.current = {
    queryString,
    selectedYearOfStudy,
    selectedTermOfAward,
    selectedPurpose,
    selectedRegions,
    selectedCitizenship,
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
      .get('/fellowships/filters')
      .then((response) => {
        dispatch({
          type: 'SET_FILTER_OPTIONS',
          payload: {
            yearOfStudy: response.data.yearOfStudy || [],
            termOfAward: response.data.termOfAward || [],
            purpose: response.data.purpose || [],
            globalRegions: response.data.globalRegions || [],
            citizenshipStatus: response.data.citizenshipStatus || [],
          },
        });
        dispatch({ type: 'MARK_FILTER_OPTIONS_LOADED' });
      })
      .catch((error) => {
        console.error('Error loading fellowship filter options:', error);
        dispatch({ type: 'MARK_FILTER_OPTIONS_LOADED' });
      });
  }, [isActive, authReady]);

  const handleSearch = useCallback((searchPage: number) => {
    const f = filtersRef.current;
    const formattedQuery = f.queryString.trim();

    let url = `/fellowships/search?query=${encodeURIComponent(formattedQuery)}&page=${searchPage}&pageSize=${pageSize}`;

    if (f.sortBy !== 'default') {
      url += `&sortBy=${f.sortBy}&sortOrder=${f.sortOrder}`;
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
    if (f.selectedRegions.length > 0) {
      url += `&globalRegions=${encodeURIComponent(f.selectedRegions.join(','))}`;
    }
    if (f.selectedCitizenship.length > 0) {
      url += `&citizenshipStatus=${encodeURIComponent(f.selectedCitizenship.join(','))}`;
    }

    dispatch({ type: 'SEARCH_REQUEST' });

    axios
      .get(url)
      .then((response) => {
        const responseFellowships: Fellowship[] = response.data.results.map(
          (elem: any) => createFellowship(elem)
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
        console.error('Error loading fellowships:', error);
        if (error?.response?.status !== 401) {
          swal({
            text: 'Unable to load fellowships. Please try again later.',
            icon: 'warning',
          });
        }
        dispatch({ type: 'SEARCH_FAILURE' });
      });
  }, [pageSize]);

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
  }, [selectedYearOfStudy, selectedTermOfAward, selectedPurpose, selectedRegions, selectedCitizenship, sortBy, sortOrder, filterOptionsLoaded, isActive]);

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
        selectedYearOfStudy,
        setSelectedYearOfStudy,
        selectedTermOfAward,
        setSelectedTermOfAward,
        selectedPurpose,
        setSelectedPurpose,
        selectedRegions,
        setSelectedRegions,
        selectedCitizenship,
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
