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
  filteredCount,
  totalRawCount,
  quickFilterActive,
}: UseInfiniteScrollOptions) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  const isLoadingRef = useRef(isLoading);
  const searchExhaustedRef = useRef(searchExhausted);
  const filteredCountRef = useRef(filteredCount);
  const totalRawCountRef = useRef(totalRawCount);
  const quickFilterActiveRef = useRef(quickFilterActive);

  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);
  useEffect(() => { searchExhaustedRef.current = searchExhausted; }, [searchExhausted]);
  useEffect(() => { filteredCountRef.current = filteredCount; }, [filteredCount]);
  useEffect(() => { totalRawCountRef.current = totalRawCount; }, [totalRawCount]);
  useEffect(() => { quickFilterActiveRef.current = quickFilterActive; }, [quickFilterActive]);

  useEffect(() => {
    if (searchExhausted) return;
    const el = sentinelRef.current;
    if (!el) return;

    const canAdvance = () => {
      if (isLoadingRef.current || searchExhaustedRef.current) return false;
      if (
        quickFilterActiveRef.current &&
        filteredCountRef.current !== undefined &&
        totalRawCountRef.current !== undefined &&
        filteredCountRef.current === 0 &&
        totalRawCountRef.current >= 60
      ) {
        return false;
      }
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
      { threshold: 0, rootMargin },
    );

    observer.observe(el);

    // Re-check when loading transitions false with the sentinel already visible.
    if (!isLoading) {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight + 600) advance();
    }

    return () => observer.disconnect();
  }, [searchExhausted, isLoading, setPage, rootMargin, filteredCount, totalRawCount, quickFilterActive]);

  return sentinelRef;
}
