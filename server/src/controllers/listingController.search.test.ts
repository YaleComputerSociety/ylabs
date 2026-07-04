import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildPublicResearchSearchInputs,
  getPublicResearchSortBy,
  searchListingsWithDegradation,
} from './listingController';

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

    assert.equal(result.degraded, true);
    assert.equal(result.totalCount, 1);
    assert.deepEqual(result.results, [
      { id: 'listing-1', _id: 'listing-1', title: 'Cell signaling lab' },
    ]);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].hybrid, { semanticRatio: 0.8, embedder: 'default' });
    assert.equal(calls[1].hybrid, undefined);
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

    assert.deepEqual(result, {
      results: [{ _id: 'mongo-listing-1', title: 'Immunology lab' }],
      totalCount: 1,
      degraded: true,
    });
  });
});

void describe('public research search inputs', () => {
  void it('removes private fields from public search and sort inputs', async () => {
    const result = await buildPublicResearchSearchInputs({
      query: 'private@example.edu',
      sortBy: 'ownerEmail',
      sortOrder: '1',
      page: '2',
      pageSize: '10',
    });

    assert.equal(result.page, 2);
    assert.equal(result.pageSize, 10);
    assert.equal(result.searchParams.sort, undefined);
    assert.equal(result.mongoParams.sortBy, undefined);
    assert.deepEqual(result.searchParams.attributesToSearchOn, result.mongoParams.searchableFields);
    assert.equal(result.searchParams.attributesToSearchOn.includes('ownerEmail'), false);
    assert.equal(result.searchParams.attributesToSearchOn.includes('emails'), false);
    assert.equal(result.searchParams.attributesToSearchOn.includes('ownerId'), false);
    assert.equal(result.searchParams.attributesToSearchOn.includes('professorIds'), false);
    assert.equal(result.searchParams.attributesToSearchOn.includes('views'), false);
    assert.equal(result.searchParams.attributesToSearchOn.includes('favorites'), false);
  });

  void it('allows only public-safe sort fields', () => {
    assert.equal(getPublicResearchSortBy('createdAt'), 'createdAt');
    assert.equal(getPublicResearchSortBy('title'), 'title');
    assert.equal(getPublicResearchSortBy('ownerEmail'), undefined);
    assert.equal(getPublicResearchSortBy('views'), undefined);
  });
});
