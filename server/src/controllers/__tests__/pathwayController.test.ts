import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  searchPathways: vi.fn(),
  searchPathwaysViaMeili: vi.fn(),
}));

vi.mock('../../services/pathwaySearchService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/pathwaySearchService')>();
  return {
    ...actual,
    searchPathways: mocks.searchPathways,
  };
});

vi.mock('../../services/pathwaySearchIndexService', () => ({
  searchPathwaysViaMeili: mocks.searchPathwaysViaMeili,
}));

import { searchPathwaysHandler } from '../pathwayController';

const originalBackend = process.env.PATHWAY_SEARCH_BACKEND;

const response = () => ({
  statusCode: 0,
  body: undefined as unknown,
  status(code: number) {
    this.statusCode = code;
    return this;
  },
  json(body: unknown) {
    this.body = body;
    return this;
  },
});

describe('pathwayController', () => {
  beforeEach(() => {
    delete process.env.PATHWAY_SEARCH_BACKEND;
    mocks.searchPathways.mockReset();
    mocks.searchPathwaysViaMeili.mockReset();
    mocks.searchPathways.mockResolvedValue({ hits: [], estimatedTotalHits: 0, page: 1, pageSize: 100 });
    mocks.searchPathwaysViaMeili.mockResolvedValue({
      hits: [],
      estimatedTotalHits: 0,
      page: 1,
      pageSize: 24,
    });
  });

  afterEach(() => {
    if (originalBackend === undefined) {
      delete process.env.PATHWAY_SEARCH_BACKEND;
    } else {
      process.env.PATHWAY_SEARCH_BACKEND = originalBackend;
    }
  });

  it('uses Mongo by default and sanitizes pathway search input', async () => {
    const res = response();

    await searchPathwaysHandler(
      {
        body: {
          q: 'summer data',
          page: -4,
          pageSize: 500,
          sortBy: 'confidence',
          sortOrder: 'asc',
          filters: {
            pathwayIds: ['67d8928150621bcef434a1d5'],
            entityIds: ['67d8928150621bcef434a1d6'],
            pathwayType: ['POSTED_ROLE', 'BAD_TYPE'],
            compensation: 'PAID',
            status: ['ACTIVE'],
            evidenceStrength: ['DIRECT'],
            entityType: ['LAB'],
            departments: ['Computer Science'],
            researchAreas: ['AI'],
            hasActivePostedOpportunity: true,
            bestNextStepCategory: ['apply', 'bad-category'],
          },
        },
      } as any,
      res as any,
    );

    expect(mocks.searchPathwaysViaMeili).not.toHaveBeenCalled();
    expect(mocks.searchPathways).toHaveBeenCalledWith({
      q: 'summer data',
      page: 1,
      pageSize: 100,
      sort: { sortBy: 'confidence', sortOrder: 'asc' },
      filters: {
        pathwayIds: ['67d8928150621bcef434a1d5'],
        entityIds: ['67d8928150621bcef434a1d6'],
        pathwayType: ['POSTED_ROLE'],
        compensation: ['PAID'],
        status: ['ACTIVE'],
        evidenceStrength: ['DIRECT'],
        entityType: ['LAB'],
        departments: ['Computer Science'],
        researchAreas: ['AI'],
        hasActivePostedOpportunity: true,
        bestNextStepCategory: ['apply'],
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it('caps pathway search page before dispatching search work', async () => {
    const res = response();

    await searchPathwaysHandler(
      {
        body: {
          q: 'summer',
          page: 999_999_999,
          pageSize: 500,
        },
      } as any,
      res as any,
    );

    expect(mocks.searchPathways).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'summer',
        page: 1000,
        pageSize: 100,
      }),
    );
    expect(res.statusCode).toBe(200);
  });

  it('rejects oversized pathway search queries before search work', async () => {
    const res = response();

    await searchPathwaysHandler(
      {
        body: {
          q: 'x'.repeat(513),
          page: 1,
          pageSize: 24,
        },
      } as any,
      res as any,
    );

    expect(mocks.searchPathways).not.toHaveBeenCalled();
    expect(mocks.searchPathwaysViaMeili).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid pathway search request' });
  });

  it('rejects oversized pathway filter arrays before search work', async () => {
    const res = response();

    await searchPathwaysHandler(
      {
        body: {
          q: '',
          filters: {
            departments: Array.from({ length: 51 }, (_, index) => `Department ${index}`),
          },
        },
      } as any,
      res as any,
    );

    expect(mocks.searchPathways).not.toHaveBeenCalled();
    expect(mocks.searchPathwaysViaMeili).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid pathway search request' });
  });

  it('rejects non-string pathway filter values before coercion', async () => {
    const res = response();
    const badFilter = { toString: vi.fn(() => 'Department') };

    await searchPathwaysHandler(
      {
        body: {
          q: '',
          filters: {
            departments: [badFilter],
          },
        },
      } as any,
      res as any,
    );

    expect(badFilter.toString).not.toHaveBeenCalled();
    expect(mocks.searchPathways).not.toHaveBeenCalled();
    expect(mocks.searchPathwaysViaMeili).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid pathway search request' });
  });

  it('uses Meili only when PATHWAY_SEARCH_BACKEND is meili', async () => {
    process.env.PATHWAY_SEARCH_BACKEND = 'meili';
    const res = response();

    await searchPathwaysHandler({ body: { q: 'summer' } } as any, res as any);

    expect(mocks.searchPathways).not.toHaveBeenCalled();
    expect(mocks.searchPathwaysViaMeili).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'summer', page: 1, pageSize: 24 }),
    );
    expect(res.statusCode).toBe(200);
  });
});
