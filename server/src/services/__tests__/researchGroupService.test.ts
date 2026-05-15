import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  listingDistinct: vi.fn(),
  listAccessSummariesForResearchEntities: vi.fn(),
}));

vi.mock('../../utils/meiliClient', () => ({
  getMeiliIndex: vi.fn(async () => ({
    search: mocks.search,
  })),
}));

vi.mock('../../models/listing', () => ({
  Listing: {
    distinct: mocks.listingDistinct,
  },
}));

vi.mock('../accessSummaryService', () => ({
  getAccessSummaryForResearchEntity: vi.fn(),
  listAccessSummariesForResearchEntities: mocks.listAccessSummariesForResearchEntities,
}));

import { searchResearchGroupsViaMeili } from '../researchGroupService';

beforeEach(() => {
  mocks.search.mockReset();
  mocks.listingDistinct.mockReset();
  mocks.listAccessSummariesForResearchEntities.mockReset();
  mocks.listingDistinct.mockResolvedValue([]);
  mocks.listAccessSummariesForResearchEntities.mockResolvedValue(new Map());
});

describe('searchResearchGroupsViaMeili', () => {
  it('falls back to keyword search when a local Meili index lacks the hybrid embedder', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    mocks.search
      .mockRejectedValueOnce({
        cause: {
          code: 'invalid_search_embedder',
          message: 'Cannot find embedder with name `default`.',
        },
      })
      .mockResolvedValueOnce({
        hits: [
          {
            id: entityId,
            slug: 'reilly-lab',
            name: 'Reilly Lab',
            kind: 'lab',
            departments: ['Chemistry'],
            researchAreas: [],
            sourceUrls: [],
          },
        ],
        estimatedTotalHits: 1,
      });

    const result = await searchResearchGroupsViaMeili('reilly', {}, 1, 1);

    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(mocks.search).toHaveBeenNthCalledWith(
      1,
      'reilly',
      expect.objectContaining({
        hybrid: { semanticRatio: 0.8, embedder: 'default' },
      }),
    );
    expect(mocks.search).toHaveBeenNthCalledWith(
      2,
      'reilly',
      expect.not.objectContaining({ hybrid: expect.anything() }),
    );
    expect(result).toMatchObject({
      estimatedTotalHits: 1,
      page: 1,
      pageSize: 1,
      researchEntities: [{ _id: entityId, slug: 'reilly-lab', name: 'Reilly Lab' }],
    });
  });
});
