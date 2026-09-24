import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * How many times one student search embeds its query text.
 *
 * Every Meilisearch search that carries `hybrid` and no precomputed `vector` makes
 * Meilisearch embed the query itself, which is one synchronous OpenAI round trip.
 * Meilisearch 1.13 has no query-embedding cache, so the count of such searches IS the
 * count of round trips, and this suite counts them on the real service call rather
 * than inferring the number from the call sites (#3149).
 */
const QUERY_VECTOR = [0.1, 0.2, 0.3];

const mocks = vi.hoisted(() => ({
  getResearchSearchQueryVector: vi.fn(),
  search: vi.fn(),
  searchSimilarDocuments: vi.fn(),
  getEmbedders: vi.fn(),
  listingDistinct: vi.fn(),
  researchEntityFind: vi.fn(),
  rosterFind: vi.fn(),
}));

vi.mock('../researchSearchQueryEmbedding', () => ({
  getResearchSearchQueryVector: mocks.getResearchSearchQueryVector,
}));

vi.mock('../../utils/meiliClient', () => ({
  getMeiliIndex: vi.fn(async () => ({
    search: mocks.search,
    searchSimilarDocuments: mocks.searchSimilarDocuments,
    getEmbedders: mocks.getEmbedders,
  })),
}));

import { searchResearchGroupsViaMeili } from '../researchGroupService';
import { invalidateResearchEntitySearchEmbedderCache } from '../researchEntitySearchIndexService';

const HIT = {
  id: 'example-lab',
  slug: 'example-lab',
  name: 'Example Lab',
  departments: ['Biology'],
  researchAreas: ['Immunology'],
  _rankingScoreDetails: { vectorSort: { similarity: 0.9 } },
};

const searchResult = () => ({
  hits: [HIT],
  estimatedTotalHits: 1,
  totalHits: 1,
  facetDistribution: {},
  processingTimeMs: 1,
});

/** A search that makes Meilisearch embed the query: hybrid, with no vector supplied. */
const hybridSearches = (): Array<Record<string, any>> =>
  mocks.search.mock.calls
    .map(([, params]) => (params ?? {}) as Record<string, any>)
    .filter((params) => Boolean(params.hybrid));

const embeddingSearches = (): Array<Record<string, any>> =>
  hybridSearches().filter((params) => params.vector === undefined);

describe('one student search embeds its query once (#3149)', () => {
  beforeEach(() => {
    mocks.search.mockReset();
    mocks.search.mockResolvedValue(searchResult());
    mocks.getEmbedders.mockReset();
    mocks.getEmbedders.mockResolvedValue({ default: { source: 'openAi' } });
    mocks.getResearchSearchQueryVector.mockReset();
    mocks.getResearchSearchQueryVector.mockResolvedValue(QUERY_VECTOR);
    invalidateResearchEntitySearchEmbedderCache();
  });

  // Measured on this call before the fix: 2 hybrid searches for a bare query (the page
  // query and the companion exhaustive count) and 4 when two facets are filtered, since
  // each active filter adds its own disjunctive facet query. Each was one OpenAI round
  // trip for the same string.
  it('embeds once for a bare query, and leaves no hybrid search to embed for itself', async () => {
    await searchResearchGroupsViaMeili('machine learning', {}, 1, 18);

    expect(mocks.search.mock.calls.length).toBeGreaterThan(1);
    expect(mocks.getResearchSearchQueryVector).toHaveBeenCalledTimes(1);
    expect(embeddingSearches()).toHaveLength(0);
  });

  it('still embeds once when two facets are filtered, which used to cost four', async () => {
    await searchResearchGroupsViaMeili(
      'protein folding',
      { departments: ['Biology'], school: ['Yale College'] },
      1,
      18,
    );

    expect(hybridSearches().length).toBeGreaterThanOrEqual(4);
    expect(mocks.getResearchSearchQueryVector).toHaveBeenCalledTimes(1);
    expect(embeddingSearches()).toHaveLength(0);
  });

  // The fail-open path is the safety argument: when the embedding is unavailable the
  // request behaves exactly as it did before, paying Meilisearch's embeddings rather
  // than losing a result.
  it('falls back to letting Meilisearch embed when no vector is available', async () => {
    mocks.getResearchSearchQueryVector.mockResolvedValue(null);

    await searchResearchGroupsViaMeili('machine learning', {}, 1, 18);

    // Every hybrid search embeds for itself again, which is exactly the pre-fix
    // behaviour, so an unavailable embedding costs latency and never a result.
    expect(hybridSearches().length).toBeGreaterThan(1);
    expect(embeddingSearches().length).toBe(hybridSearches().length);
  });

  it('supplies the same vector to every hybrid search in the request', async () => {
    await searchResearchGroupsViaMeili('protein folding', { departments: ['Biology'] }, 1, 18);

    const vectors = hybridSearches().map((params) => params.vector);

    expect(vectors.length).toBeGreaterThan(1);
    expect(vectors.every((vector) => Array.isArray(vector))).toBe(true);
    expect(new Set(vectors.map((vector) => JSON.stringify(vector))).size).toBe(1);
  });

  it('makes no embedding call at all when no query text is searched', async () => {
    await searchResearchGroupsViaMeili('', { departments: ['Biology'] }, 1, 18);

    expect(mocks.getResearchSearchQueryVector).not.toHaveBeenCalled();
    expect(hybridSearches()).toHaveLength(0);
  });
});
