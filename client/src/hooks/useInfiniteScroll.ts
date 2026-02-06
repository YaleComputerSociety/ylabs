import { useEffect, useRef } from 'react';

interface UseInfiniteScrollOptions {
  searchExhausted: boolean;
  isLoading: boolean;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  rootMargin?: string;
  // Optional: count of currently displayed items + total raw items
  // Used to prevent infinite reload loops when quick filters produce 0 results
  filteredCount?: number;
  totalRawCount?: number;
  quickFilterActive?: boolean;
}

export function useInfiniteScroll({
  searchExhausted,
  isLoading,
  setPage,
  rootMargin = '600px',
  filteredCount,
  totalRawCount,
  quickFilterActive,
}: UseInfiniteScrollOptions) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const isFetchingRef = useRef(false);

  // Observer setup: only recreated when searchExhausted changes.
  // Uses a fetch lock ref instead of depending on `isLoading`, so the observer
  // stays stable and doesn't cascade re-creation on every load cycle.
  useEffect(() => {
    if (searchExhausted) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingRef.current) {
          isFetchingRef.current = true;
          setPage((prev) => prev + 1);
        }
      },
      { threshold: 0, rootMargin }
    );

    const el = sentinelRef.current;
    if (el) observer.observe(el);

    return () => observer.disconnect();
  }, [searchExhausted, setPage, rootMargin]);

  // Post-load continuation: after each fetch completes, check if the sentinel
  // is still in the loadable zone. Handles quick-filter scenarios where the
  // filtered list is short and the sentinel is immediately visible.
  useEffect(() => {
    if (isLoading || searchExhausted) return;

    // Guard: if a quick filter is active and produces 0 results from a large
    // dataset, stop trying to load more — prevents infinite reload loops
    if (
      quickFilterActive &&
      filteredCount !== undefined &&
      totalRawCount !== undefined &&
      filteredCount === 0 &&
      totalRawCount >= 60
    ) {
      return;
    }

    // Release the lock so the observer or this check can trigger the next page
    isFetchingRef.current = false;

    const el = sentinelRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight + 600) {
      isFetchingRef.current = true;
      setPage((prev) => prev + 1);
    }
  }, [isLoading, searchExhausted, setPage, filteredCount, totalRawCount, quickFilterActive]);

  return sentinelRef;
}
