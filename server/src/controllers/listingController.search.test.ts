import { describe, expect, it } from 'vitest';
import { searchListingsWithDegradation } from './listingController';

const baseMongoParams = {
  query: 'cell signaling',
  departmentsMode: 'union',
  academicDisciplinesMode: 'union',
  researchAreasMode: 'union',
  limit: 20,
  offset: 0,
};

void describe('searchListingsWithDegradation', () => {
  void it('retries hybrid Meilisearch failures as keyword-only search', async () => {
    const calls: Array<Record<string, any>> = [];
    const index = {
      search: async (_query: string, params: Record<string, any>) => {
        calls.push(params);
        if (params.hybrid) {
          throw new Error('hybrid unavailable');
        }
        return {
          hits: [{ id: 'listing-1', title: 'Cell signaling lab' }],
          estimatedTotalHits: 1,
        };
      },
    };

    const result = await searchListingsWithDegradation({
      query: 'cell signaling',
      searchParams: {
        limit: 20,
        offset: 0,
        hybrid: { semanticRatio: 0.8, embedder: 'default' },
      },
      mongoParams: baseMongoParams,
      getIndex: async () => index,
      mongoSearch: async () => {
        throw new Error('mongo fallback should not be used');
      },
    });

    expect(result.degraded).toBe(true);
    expect(result.totalCount).toBe(1);
    expect(result.results).toEqual([
      expect.objectContaining({
        id: 'listing-1',
        _id: 'listing-1',
        title: 'Cell signaling lab',
      }),
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0].hybrid).toEqual({ semanticRatio: 0.8, embedder: 'default' });
    expect(calls[1].hybrid).toBeUndefined();
  });

  void it('falls back to Mongo when Meilisearch is unavailable', async () => {
    const result = await searchListingsWithDegradation({
      query: 'immunology',
      searchParams: { limit: 20, offset: 0 },
      mongoParams: { ...baseMongoParams, query: 'immunology' },
      getIndex: async () => ({
        search: async () => {
          throw new Error('meili down');
        },
      }),
      mongoSearch: async () => ({
        hits: [{ _id: 'mongo-listing-1', title: 'Immunology lab' }],
        totalCount: 1,
      }),
    });

    expect(result).toEqual({
      results: [{ _id: 'mongo-listing-1', title: 'Immunology lab' }],
      totalCount: 1,
      degraded: true,
    });
  });
});
