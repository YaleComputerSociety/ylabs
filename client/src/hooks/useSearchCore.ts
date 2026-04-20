/**
 * Generic search-state hook factoring out the common pagination, sorting,
 * query-string, and fetch lifecycle shared by listing and fellowship search.
 * Domain-specific filter state is owned by the caller and threaded through
 * `filters` + `buildFilterQuery`; everything else (fetch, refresh, lifecycle,
 * sort direction, quickFilter, filterBarHeight) lives here.
 */
import { useCallback, useState } from 'react';
import axios from '../utils/axios';
import swal from 'sweetalert';
import { useSearchLifecycle } from './useSearchLifecycle';

export interface SearchResponse {
  items: any[];
  totalCount: number;
}

export interface UseSearchCoreConfig<TItem, TFilters> {
  endpoint: string;
  pageSize: number;
  sortableKeys: string[];
  defaultSortOrder?: 1 | -1;
  defaultSortDirection?: 'asc' | 'desc';
  ready: boolean;
  enabled: boolean;
  filters: TFilters;
  filterDeps: unknown[];
  buildFilterQuery: (filters: TFilters) => string;
  parseItem: (raw: any) => TItem;
  parseResponse: (data: any) => SearchResponse;
  errorMessage: string;
}

export function useSearchCore<TItem, TFilters>({
  endpoint,
  pageSize,
  sortableKeys,
  defaultSortOrder = 1,
  defaultSortDirection = 'asc',
  ready,
  enabled,
  filters,
  filterDeps,
  buildFilterQuery,
  parseItem,
  parseResponse,
  errorMessage,
}: UseSearchCoreConfig<TItem, TFilters>) {
  const [queryString, setQueryString] = useState<string>('');

  const [sortBy, setSortBy] = useState<string>(sortableKeys[0]);
  const [sortOrder, setSortOrder] = useState<number>(defaultSortOrder);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(defaultSortDirection);

  const [items, setItems] = useState<TItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchExhausted, setSearchExhausted] = useState<boolean>(false);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [page, setPage] = useState<number>(1);

  const [filterBarHeight, setFilterBarHeight] = useState<number>(0);
  const [quickFilter, setQuickFilter] = useState<string | null>(null);

  const onToggleSortDirection = useCallback(() => {
    const newDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    setSortDirection(newDirection);
    setSortOrder(newDirection === 'asc' ? 1 : -1);
  }, [sortDirection]);

  const handleSearch = useCallback((searchPage: number) => {
    const formattedQuery = queryString.trim();

    let url = `${endpoint}?query=${encodeURIComponent(formattedQuery)}&page=${searchPage}&pageSize=${pageSize}`;

    if (sortBy !== 'default') {
      url += `&sortBy=${sortBy}&sortOrder=${sortOrder}`;
    }

    url += buildFilterQuery(filters);

    setIsLoading(true);

    axios
      .get(url)
      .then((response) => {
        const { items: rawItems, totalCount: count } = parseResponse(response.data);
        const parsed = rawItems.map(parseItem);

        if (searchPage === 1) {
          setItems(parsed);
        } else {
          setItems((prev) => [...prev, ...parsed]);
        }
        setTotalCount(count);
        setSearchExhausted(parsed.length < pageSize);
        setIsLoading(false);
      })
      .catch((error) => {
        console.error(`Error loading ${endpoint}:`, error);
        swal({ text: errorMessage, icon: 'warning' });
        setIsLoading(false);
      });
  }, [queryString, filters, sortBy, sortOrder, endpoint, pageSize, buildFilterQuery, parseItem, parseResponse, errorMessage]);

  const refresh = useCallback(() => {
    setPage(1);
    handleSearch(1);
  }, [handleSearch]);

  useSearchLifecycle({
    enabled,
    ready,
    queryString,
    filterDeps: [...filterDeps, sortBy, sortOrder],
    page,
    setPage,
    onSearch: handleSearch,
  });

  return {
    queryString,
    setQueryString,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    sortDirection,
    onToggleSortDirection,
    items,
    isLoading,
    searchExhausted,
    totalCount,
    page,
    setPage,
    pageSize,
    filterBarHeight,
    setFilterBarHeight,
    quickFilter,
    setQuickFilter,
    refresh,
  };
}

export default useSearchCore;
