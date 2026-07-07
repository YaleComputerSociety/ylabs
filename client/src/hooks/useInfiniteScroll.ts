/**
 * Infinite scroll pagination driven by a single effect that reacts to the
 * sentinel via IntersectionObserver and re-checks eligibility when loading
 * state or filter bookkeeping changes.
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
}: UseInfiniteScrollOptions) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  const isLoadingRef = useRef(isLoading);
  const searchExhaustedRef = useRef(searchExhausted);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);
  useEffect(() => {
    searchExhaustedRef.current = searchExhausted;
  }, [searchExhausted]);

  useEffect(() => {
    if (searchExhausted) return;
    if (typeof IntersectionObserver !== 'function') return;
    const el = sentinelRef.current;
    if (!el) return;
    const scrollRoot = el.closest<HTMLElement>('[data-scroll-container]');

    const canAdvance = () => {
      if (isLoadingRef.current || searchExhaustedRef.current) return false;
      return true;
    };

    const advance = () => {
      if (!canAdvance()) return;
      setPage((prev) => prev + 1);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) advance();
      },
      { threshold: 0, root: scrollRoot, rootMargin },
    );

    observer.observe(el);

    // Re-check when loading transitions false with the sentinel already visible.
    if (!isLoading) {
      const rect = el.getBoundingClientRect();
      const rootBottom = scrollRoot ? scrollRoot.getBoundingClientRect().bottom : window.innerHeight;
      if (rect.top < rootBottom + 600) advance();
    }

    return () => observer.disconnect();
  }, [searchExhausted, isLoading, setPage, rootMargin]);

  return sentinelRef;
}
