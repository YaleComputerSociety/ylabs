/**
 * Orchestrates the common search-lifecycle effects shared between
 * SearchContextProvider and FellowshipSearchContextProvider:
 *   - initial search once prerequisites are ready
 *   - debounced re-search on query-string change
 *   - immediate re-search on filter/sort change
 *   - pagination advance on page change
 *   - state reset when the context becomes inactive
 *
 * Callers supply an `onSearch(page)` function and dependency lists describing
 * which values gate the lifecycle and which trigger re-search.
 */
import { useEffect, useRef, useState } from 'react';

interface UseSearchLifecycleOptions {
  enabled: boolean;
  ready: boolean;
  queryString: string;
  filterDeps: unknown[];
  page: number;
  setPage: (p: number) => void;
  onSearch: (page: number) => void;
  debounceMs?: number;
}

export function useSearchLifecycle({
  enabled,
  ready,
  queryString,
  filterDeps,
  page,
  setPage,
  onSearch,
  debounceMs = 500,
}: UseSearchLifecycleOptions) {
  const [queryStringLoaded, setQueryStringLoaded] = useState(false);
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  const [initialSearchDone, setInitialSearchDone] = useState(false);

  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;

  useEffect(() => {
    if (!enabled) {
      setInitialSearchDone(false);
      setQueryStringLoaded(false);
      setFiltersLoaded(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !ready) return;
    if (initialSearchDone) return;
    setPage(1);
    onSearchRef.current(1);
    setInitialSearchDone(true);
  }, [enabled, ready, initialSearchDone, setPage]);

  useEffect(() => {
    if (!enabled || !ready) return;

    const t = setTimeout(() => {
      if (queryStringLoaded) {
        setPage(1);
        onSearchRef.current(1);
      }
      setQueryStringLoaded(true);
    }, debounceMs);

    return () => clearTimeout(t);
  }, [queryString, enabled, ready, debounceMs, setPage]);

  useEffect(() => {
    if (!enabled || !ready) return;
    if (filtersLoaded) {
      setPage(1);
      onSearchRef.current(1);
    }
    setFiltersLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ready, ...filterDeps]);

  useEffect(() => {
    if (!enabled || !ready) return;
    if (page > 1) {
      onSearchRef.current(page);
    }
  }, [page, enabled, ready]);
}

export default useSearchLifecycle;
