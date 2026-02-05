import { FC, useReducer, useCallback, useEffect, useMemo } from 'react';
import SearchContext, { SearchAction } from '../contexts/SearchContext';
import { searchReducer, initialSearchState } from '../reducers/searchReducer';
import axios from '../utils/axios';
import { createListing } from '../utils/apiCleaner';
import swal from 'sweetalert';
import { Listing } from '../types/types';

interface SearchContextProviderProps {
  children: React.ReactNode;
}

const SearchContextProvider: FC<SearchContextProviderProps> = ({ children }) => {
  const [state, dispatch] = useReducer(searchReducer, initialSearchState);

  // Helper methods for cleaner API
  const setQuery = useCallback((query: string) => {
    dispatch({ type: 'SET_QUERY', payload: query });
  }, []);

  const addDepartment = useCallback((department: string) => {
    dispatch({ type: 'ADD_DEPARTMENT', payload: department });
  }, []);

  const removeDepartment = useCallback((department: string) => {
    dispatch({ type: 'REMOVE_DEPARTMENT', payload: department });
  }, []);

  const clearDepartments = useCallback(() => {
    dispatch({ type: 'CLEAR_DEPARTMENTS' });
  }, []);

  const setSort = useCallback((sortBy: string, sortOrder: 1 | -1) => {
    dispatch({ type: 'SET_SORT', payload: { sortBy, sortOrder } });
  }, []);

  const toggleSortDirection = useCallback(() => {
    dispatch({ type: 'TOGGLE_SORT_DIRECTION' });
  }, []);

  const nextPage = useCallback(() => {
    dispatch({ type: 'INCREMENT_PAGE' });
  }, []);

  const resetSearch = useCallback(() => {
    dispatch({ type: 'RESET_SEARCH' });
  }, []);

  // Execute search whenever relevant state changes
  const executeSearch = useCallback(async () => {
    const { query, selectedDepartments, sortBy, sortOrder, page, pageSize } = state;

    // Build URL
    const backendBaseURL = window.location.host.includes('yalelabs.io')
      ? 'https://yalelabs.io/api'
      : import.meta.env.VITE_APP_SERVER + '/api';

    const formattedQuery = query.trim();
    const formattedDepartments = selectedDepartments.join(',');

    let url: string;
    if (sortBy === 'default') {
      url = `${backendBaseURL}/listings/search?query=${formattedQuery}&page=${page}&pageSize=${pageSize}`;
    } else {
      url = `${backendBaseURL}/listings/search?query=${formattedQuery}&sortBy=${sortBy}&sortOrder=${sortOrder}&page=${page}&pageSize=${pageSize}`;
    }

    if (formattedDepartments) {
      url += `&departments=${formattedDepartments}`;
    }

    // Set loading
    dispatch({ type: 'SET_LOADING', payload: true });

    try {
      const response = await axios.get(url, { withCredentials: true });
      const responseListings: Listing[] = response.data.results.map((elem: any) =>
        createListing(elem)
      );

      // If page 1, replace listings; otherwise append
      if (page === 1) {
        dispatch({ type: 'SET_LISTINGS', payload: responseListings });
      } else {
        dispatch({ type: 'APPEND_LISTINGS', payload: responseListings });
      }
    } catch (error) {
      console.error('Error loading listings:', error);
      swal({
        text: 'Unable to load listings. Please try again later.',
        icon: 'warning',
      });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [state]);

  // Debounced search effect for query changes
  useEffect(() => {
    const debounceTimeout = setTimeout(() => {
      executeSearch();
    }, 500);

    return () => {
      clearTimeout(debounceTimeout);
    };
  }, [state.query]);

  // Immediate search for department/sort changes
  useEffect(() => {
    executeSearch();
  }, [state.selectedDepartments, state.sortBy, state.sortOrder]);

  // Search when page changes (infinite scroll)
  useEffect(() => {
    if (state.page > 1) {
      executeSearch();
    }
  }, [state.page]);

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo(
    () => ({
      state,
      dispatch,
      setQuery,
      addDepartment,
      removeDepartment,
      clearDepartments,
      setSort,
      toggleSortDirection,
      nextPage,
      resetSearch,
    }),
    [
      state,
      setQuery,
      addDepartment,
      removeDepartment,
      clearDepartments,
      setSort,
      toggleSortDirection,
      nextPage,
      resetSearch,
    ]
  );

  return <SearchContext.Provider value={contextValue}>{children}</SearchContext.Provider>;
};

export default SearchContextProvider;
