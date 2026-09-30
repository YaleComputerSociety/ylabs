import { type ReactNode, useLayoutEffect, useRef } from 'react';

export const STICKY_FILTER_BAR_HEIGHT_PROPERTY = '--yr-sticky-filter-bar-height';

const ResearchStickyFilterBar = ({ children }: { children: ReactNode }) => {
  const barRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const bar = barRef.current;
    const scrollContainer = bar?.closest<HTMLElement>('[data-scroll-container]');
    if (!bar || !scrollContainer) return undefined;

    const reserveBarHeight = () => {
      scrollContainer.style.setProperty(STICKY_FILTER_BAR_HEIGHT_PROPERTY, `${bar.offsetHeight}px`);
    };
    reserveBarHeight();
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(reserveBarHeight);
    resizeObserver?.observe(bar);

    return () => {
      resizeObserver?.disconnect();
      scrollContainer.style.removeProperty(STICKY_FILTER_BAR_HEIGHT_PROPERTY);
    };
  }, []);

  return (
    <div ref={barRef} className="sticky top-0 z-30 bg-[var(--yr-paper)] pb-2">
      {children}
    </div>
  );
};

export default ResearchStickyFilterBar;
