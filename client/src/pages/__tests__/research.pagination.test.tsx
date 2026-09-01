import { describe, expect, it, vi } from 'vitest';

import { isResearchEntitySearchExhausted } from '../research';

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const page = (overrides: {
  count: number;
  page: number;
  pageSize?: number;
  estimatedTotalHits: number;
  depthLimited?: boolean;
}) => ({
  ...(overrides.depthLimited === undefined ? {} : { depthLimited: overrides.depthLimited }),
  researchEntities: Array.from({ length: overrides.count }, (_unused, index) => ({
    slug: `entity-${index}`,
  })) as never[],
  estimatedTotalHits: overrides.estimatedTotalHits,
  page: overrides.page,
  pageSize: overrides.pageSize ?? 18,
  facetDistribution: {},
});

describe('isResearchEntitySearchExhausted', () => {
  it('does not treat an empty mid-corpus page as exhaustion', () => {
    expect(
      isResearchEntitySearchExhausted(page({ count: 0, page: 148, estimatedTotalHits: 2707 })),
    ).toBe(false);
  });

  it('keeps advancing past a short mid-corpus page', () => {
    expect(
      isResearchEntitySearchExhausted(page({ count: 7, page: 100, estimatedTotalHits: 2707 })),
    ).toBe(false);
  });

  it('stops once a short page passes the reported total', () => {
    expect(
      isResearchEntitySearchExhausted(page({ count: 5, page: 151, estimatedTotalHits: 2707 })),
    ).toBe(true);
  });

  it('stops on an empty page once the reported total is reached', () => {
    expect(
      isResearchEntitySearchExhausted(page({ count: 0, page: 151, estimatedTotalHits: 2707 })),
    ).toBe(true);
  });

  it('treats a genuinely empty result set as exhausted', () => {
    expect(
      isResearchEntitySearchExhausted(page({ count: 0, page: 1, estimatedTotalHits: 0 })),
    ).toBe(true);
  });

  it('stops on a depth-limited page even though its total says rows remain', () => {
    // The server ran no search for a page past its reachable depth, so the page
    // carries no total of its own and must not be walked past on the stale one.
    expect(
      isResearchEntitySearchExhausted(
        page({ count: 0, page: 209, pageSize: 24, estimatedTotalHits: 6000, depthLimited: true }),
      ),
    ).toBe(true);
  });

  it('keeps advancing while a full page is returned', () => {
    expect(
      isResearchEntitySearchExhausted(page({ count: 18, page: 148, estimatedTotalHits: 2707 })),
    ).toBe(false);
  });
});
