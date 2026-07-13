import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useInfiniteScroll } from '../useInfiniteScroll';

const originalIntersectionObserver = window.IntersectionObserver;
const originalGlobalIntersectionObserver = globalThis.IntersectionObserver;

const TestScroller = ({
  onAdvance,
  filteredCount,
  totalRawCount,
  quickFilterActive,
}: {
  onAdvance: () => void;
  filteredCount?: number;
  totalRawCount?: number;
  quickFilterActive?: boolean;
}) => {
  const sentinelRef = useInfiniteScroll({
    searchExhausted: false,
    isLoading: false,
    setPage: (update) => {
      if (typeof update === 'function') update(1);
      onAdvance();
    },
    filteredCount,
    totalRawCount,
    quickFilterActive,
  });

  return (
    <div data-scroll-container>
      <div ref={sentinelRef}>sentinel</div>
    </div>
  );
};

afterEach(() => {
  vi.restoreAllMocks();
  window.IntersectionObserver = originalIntersectionObserver;
  globalThis.IntersectionObserver = originalGlobalIntersectionObserver;
});

describe('useInfiniteScroll', () => {
  it('observes the sentinel inside the app scroll container', async () => {
    let observerRoot: Element | Document | null | undefined;

    class MockIntersectionObserver {
      constructor(_callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        observerRoot = options?.root;
      }

      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
    }

    window.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;
    globalThis.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      bottom: 2000,
      height: 1,
      left: 0,
      right: 1,
      top: 2000,
      width: 1,
      x: 0,
      y: 2000,
      toJSON: () => ({}),
    }));

    const onAdvance = vi.fn();

    const { container } = render(<TestScroller onAdvance={onAdvance} />);

    await waitFor(() => {
      expect(observerRoot).toBe(container.querySelector('[data-scroll-container]'));
    });
  });

  it('continues pagination when an active quick filter has zero loaded matches', async () => {
    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        callback([{ isIntersecting: true } as IntersectionObserverEntry], this as any);
      }

      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
    }

    window.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;
    globalThis.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      bottom: 0,
      height: 1,
      left: 0,
      right: 1,
      top: 0,
      width: 1,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));

    const onAdvance = vi.fn();

    render(
      <TestScroller onAdvance={onAdvance} filteredCount={0} totalRawCount={60} quickFilterActive />,
    );

    await waitFor(() => {
      expect(onAdvance).toHaveBeenCalled();
    });
  });
});
