/**
 * Custom hook for infinite scroll pagination.
 */
import { useEffect, useRef } from 'react';

interface UseInfiniteScrollOptions {
  searchExhausted: boolean;
  isLoading: boolean;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  rootMargin?: string;
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

  useEffect(() => {
    if (isLoading || searchExhausted) return;

    if (
      quickFilterActive &&
      filteredCount !== undefined &&
      totalRawCount !== undefined &&
      filteredCount === 0 &&
      totalRawCount >= 60
    ) {
      return;
    }

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
