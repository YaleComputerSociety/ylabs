/**
 * Provider for the research (`/research`) browse-page search state.
 *
 * State transitions live in reducers/labSearchReducer.ts (pure & unit-tested);
 * this component owns side effects (axios, debouncing).
 */
import { FC, ReactNode, useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import axios from '../utils/axios';
import LabSearchContext from '../contexts/LabSearchContext';
import {
  createInitialLabSearchState,
  labSearchReducer,
} from '../reducers/labSearchReducer';
import {
  ResearchGroupSearchFilters,
  ResearchGroupSearchRequest,
  ResearchGroupSearchResponse,
  ResearchGroupSortBy,
  ResearchGroupSortOrder,
} from '../types/researchGroup';

interface LabSearchContextProviderProps {
  children: ReactNode;
}

const LabSearchContextProvider: FC<LabSearchContextProviderProps> = ({ children }) => {
  const [state, dispatch] = useReducer(labSearchReducer, undefined, () =>
    createInitialLabSearchState(),
  );

  const {
    queryString,
    filters,
    sortBy,
    sortOrder,
    page,
    pageSize,
    results,
    totalHits,
    isLoading,
    error,
    searchExhausted,
    queryStringLoaded,
    filtersLoaded,
    initialSearchDone,
  } = state;

  const setQueryString = useCallback((value: string) => {
    dispatch({ type: 'SET_QUERY_STRING', payload: value });
  }, []);

  const setFilters = useCallback(
    (value: React.SetStateAction<ResearchGroupSearchFilters>) => {
      dispatch({ type: 'SET_FILTERS', payload: value });
    },
    [],
  ) as React.Dispatch<React.SetStateAction<ResearchGroupSearchFilters>>;

  const clearFilters = useCallback(() => {
    dispatch({ type: 'CLEAR_FILTERS' });
  }, []);

  const setSortBy = useCallback((value: ResearchGroupSortBy | 'default') => {
    dispatch({ type: 'SET_SORT_BY', payload: value });
  }, []);

  const setSortOrder = useCallback((value: ResearchGroupSortOrder) => {
    dispatch({ type: 'SET_SORT_ORDER', payload: value });
  }, []);

  const setPage = useCallback((value: React.SetStateAction<number>) => {
    dispatch({ type: 'SET_PAGE', payload: value });
  }, []) as React.Dispatch<React.SetStateAction<number>>;

  const filtersRef = useRef({ queryString, filters, sortBy, sortOrder, pageSize });
  filtersRef.current = { queryString, filters, sortBy, sortOrder, pageSize };

  const runSearchAtPage = useCallback((searchPage: number) => {
    const f = filtersRef.current;
    const trimmedQuery = (f.queryString || '').trim();

    const body: ResearchGroupSearchRequest = {
      q: trimmedQuery,
      page: searchPage,
      pageSize: f.pageSize,
      filters: f.filters,
    };
    if (f.sortBy !== 'default') {
      body.sortBy = f.sortBy as ResearchGroupSortBy;
      body.sortOrder = f.sortOrder;
    }

    dispatch({ type: 'SEARCH_REQUEST' });

    axios
      .post<ResearchGroupSearchResponse>('/research/search', body)
      .then((response) => {
        const { hits, estimatedTotalHits } = response.data;
        dispatch({
          type: 'SEARCH_SUCCESS',
          payload: {
            results: hits,
            totalHits: estimatedTotalHits,
            pageSize: f.pageSize,
            append: searchPage !== 1,
          },
        });
      })
      .catch((err) => {
        const message =
          err?.response?.data?.error || err?.message || 'Unable to load research groups';
        console.error('Lab search failed:', err);
        dispatch({ type: 'SEARCH_FAILURE', payload: message });
      });
  }, []);

  const runSearch = useCallback(() => {
    dispatch({ type: 'SET_PAGE', payload: 1 });
    runSearchAtPage(1);
  }, [runSearchAtPage]);

  // Initial fetch: run once on mount.
  useEffect(() => {
    if (!initialSearchDone) {
      runSearchAtPage(1);
      dispatch({ type: 'MARK_INITIAL_SEARCH_DONE' });
    }
  }, [initialSearchDone, runSearchAtPage]);

  // Debounced re-search on query string change.
  useEffect(() => {
    const t = setTimeout(() => {
      if (queryStringLoaded) {
        dispatch({ type: 'SET_PAGE', payload: 1 });
        runSearchAtPage(1);
      }
      dispatch({ type: 'MARK_QUERY_STRING_LOADED' });
    }, 400);
    return () => clearTimeout(t);
  }, [queryString, runSearchAtPage]);

  // Re-search on filter / sort change.
  useEffect(() => {
    if (filtersLoaded) {
      dispatch({ type: 'SET_PAGE', payload: 1 });
      runSearchAtPage(1);
    }
    dispatch({ type: 'MARK_FILTERS_LOADED' });
  }, [filters, sortBy, sortOrder, runSearchAtPage]);

  // Page-bumped: just fetch the next page (append).
  useEffect(() => {
    if (page > 1) {
      runSearchAtPage(page);
    }
  }, [page, runSearchAtPage]);

  const value = useMemo(
    () => ({
      queryString,
      setQueryString,
      filters,
      setFilters,
      clearFilters,
      sortBy,
      setSortBy,
      sortOrder,
      setSortOrder,
      page,
      setPage,
      pageSize,
      results,
      totalHits,
      isLoading,
      error,
      searchExhausted,
      runSearch,
    }),
    [
      queryString,
      setQueryString,
      filters,
      setFilters,
      clearFilters,
      sortBy,
      setSortBy,
      sortOrder,
      setSortOrder,
      page,
      setPage,
      pageSize,
      results,
      totalHits,
      isLoading,
      error,
      searchExhausted,
      runSearch,
    ],
  );

  return <LabSearchContext.Provider value={value}>{children}</LabSearchContext.Provider>;
};

export default LabSearchContextProvider;
