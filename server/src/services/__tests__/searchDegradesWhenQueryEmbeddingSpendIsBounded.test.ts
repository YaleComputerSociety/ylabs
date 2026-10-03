import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What a search sends to Meilisearch once the query-embedding budget or the breaker
 * has refused a call.
 *
 * Omitting only `vector` would not decline the call: a `hybrid` block with no vector
 * makes Meilisearch embed the query itself against the same paid account. So the rule
 * under test is that a refusal takes the whole semantic leg off, serves the keyword
 * leg, and reports the response as degraded, and that nothing changes while the
 * request is inside the budget.
 */
const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  search: vi.fn(),
  searchSimilarDocuments: vi.fn(),
  getEmbedders: vi.fn(),
}));

vi.mock('axios', () => ({
  default: { post: mocks.post },
}));

vi.mock('../../utils/meiliClient', () => ({
  getMeiliSearchIndex: vi.fn(async () => ({
    search: mocks.search,
    searchSimilarDocuments: mocks.searchSimilarDocuments,
    getEmbedders: mocks.getEmbedders,
  })),
}));

import { searchResearchGroupsViaMeili } from '../researchGroupService';
import { invalidateResearchEntitySearchEmbedderCache } from '../researchEntitySearchIndexService';
import { clearResearchSearchQueryEmbeddingCache } from '../researchSearchQueryEmbedding';
import { resetResearchSearchQueryEmbeddingBudget } from '../researchSearchQueryEmbeddingBudget';

const QUERY_VECTOR = [0.1, 0.2, 0.3];

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

const searchParams = (): Array<Record<string, any>> =>
  mocks.search.mock.calls.map(([, params]) => (params ?? {}) as Record<string, any>);

const hybridSearches = (): Array<Record<string, any>> =>
  searchParams().filter((params) => Boolean(params.hybrid));

const CLIENT = '203.0.113.7';
const originalApiKey = process.env.OPENAI_API_KEY;

beforeEach(() => {
  mocks.search.mockReset();
  mocks.search.mockResolvedValue(searchResult());
  mocks.getEmbedders.mockReset();
  mocks.getEmbedders.mockResolvedValue({ default: { source: 'openAi' } });
  mocks.post.mockReset();
  mocks.post.mockResolvedValue({ data: { data: [{ embedding: QUERY_VECTOR }] } });
  invalidateResearchEntitySearchEmbedderCache();
  clearResearchSearchQueryEmbeddingCache();
  resetResearchSearchQueryEmbeddingBudget();
  process.env.OPENAI_API_KEY = 'test-openai-key';
});

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
  delete process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_CLIENT_PER_MINUTE;
  delete process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_MINUTE;
});

describe('a search inside the query-embedding budget', () => {
  it('runs the hybrid leg with the supplied vector and reports no degradation', async () => {
    const result = await searchResearchGroupsViaMeili(
      'machine learning',
      {},
      1,
      18,
      {},
      {
        embeddingSpendKey: CLIENT,
      },
    );

    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(hybridSearches().length).toBeGreaterThan(1);
    expect(hybridSearches().every((params) => params.vector === QUERY_VECTOR)).toBe(true);
    expect(hybridSearches().every((params) => params.hybrid.embedder === 'default')).toBe(true);
    expect(searchParams()[0].rankingScoreThreshold).toBe(0.15);
    expect(result.degraded).toBeFalsy();
  });

  it('sends Meilisearch exactly what it sends when no client address is supplied', async () => {
    await searchResearchGroupsViaMeili(
      'protein folding',
      { departments: ['Biology'] },
      1,
      18,
      {},
      {},
    );
    const withoutClient = searchParams();

    mocks.search.mockClear();
    clearResearchSearchQueryEmbeddingCache();
    resetResearchSearchQueryEmbeddingBudget();
    await searchResearchGroupsViaMeili(
      'protein folding',
      { departments: ['Biology'] },
      1,
      18,
      {},
      { embeddingSpendKey: CLIENT },
    );

    expect(searchParams()).toEqual(withoutClient);
  });
});

describe('a search past the query-embedding budget', () => {
  const spendTheClientCeiling = async () => {
    process.env.RESEARCH_SEARCH_EMBEDDING_MAX_PER_CLIENT_PER_MINUTE = '10';
    for (let index = 0; index < 10; index += 1) {
      await searchResearchGroupsViaMeili(
        `spend-${index}`,
        {},
        1,
        18,
        {},
        {
          embeddingSpendKey: CLIENT,
        },
      );
    }
    mocks.search.mockClear();
    mocks.post.mockClear();
  };

  it('makes no upstream call and takes the whole semantic leg off', async () => {
    await spendTheClientCeiling();

    const result = await searchResearchGroupsViaMeili(
      'over budget query',
      {},
      1,
      18,
      {},
      {
        embeddingSpendKey: CLIENT,
      },
    );

    expect(mocks.post).not.toHaveBeenCalled();
    expect(hybridSearches()).toHaveLength(0);
    expect(searchParams().every((params) => params.vector === undefined)).toBe(true);
    expect(searchParams().every((params) => params.rankingScoreThreshold === undefined)).toBe(true);
    expect(result.degraded).toBe(true);
  });

  it('still answers from the keyword leg rather than failing the request', async () => {
    await spendTheClientCeiling();

    const result = await searchResearchGroupsViaMeili(
      'over budget query',
      {},
      1,
      18,
      {},
      {
        embeddingSpendKey: CLIENT,
      },
    );

    expect(searchParams().length).toBeGreaterThan(0);
    expect(searchParams()[0].filter).toBeDefined();
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(18);
  });

  it('keeps serving the semantic leg to a client that is still inside its own ceiling', async () => {
    await spendTheClientCeiling();

    const result = await searchResearchGroupsViaMeili(
      'over budget query',
      {},
      1,
      18,
      {},
      {
        embeddingSpendKey: '198.51.100.4',
      },
    );

    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(hybridSearches().length).toBeGreaterThan(1);
    expect(result.degraded).toBeFalsy();
  });
});

describe('a search after the upstream rejects an embedding request', () => {
  it('skips the call and serves the keyword leg until the cooldown passes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T00:00:00Z'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.RESEARCH_SEARCH_EMBEDDING_COOLDOWN_MS = '30000';
    try {
      mocks.post.mockRejectedValueOnce(
        Object.assign(new Error('rejected'), { response: { status: 429 } }),
      );
      const duringRejection = await searchResearchGroupsViaMeili(
        'first query',
        {},
        1,
        18,
        {},
        { embeddingSpendKey: CLIENT },
      );
      expect(hybridSearches()).toHaveLength(0);
      expect(duringRejection.degraded).toBe(true);

      mocks.search.mockClear();
      mocks.post.mockClear();
      vi.setSystemTime(new Date('2026-09-30T00:00:10Z'));
      const insideCooldown = await searchResearchGroupsViaMeili(
        'second query',
        {},
        1,
        18,
        {},
        {
          embeddingSpendKey: CLIENT,
        },
      );

      expect(mocks.post).not.toHaveBeenCalled();
      expect(hybridSearches()).toHaveLength(0);
      expect(insideCooldown.degraded).toBe(true);

      mocks.search.mockClear();
      vi.setSystemTime(new Date('2026-09-30T00:00:31Z'));
      const afterCooldown = await searchResearchGroupsViaMeili(
        'third query',
        {},
        1,
        18,
        {},
        {
          embeddingSpendKey: CLIENT,
        },
      );

      expect(mocks.post).toHaveBeenCalledTimes(1);
      expect(hybridSearches().length).toBeGreaterThan(1);
      expect(afterCooldown.degraded).toBeFalsy();
    } finally {
      delete process.env.RESEARCH_SEARCH_EMBEDDING_COOLDOWN_MS;
      consoleError.mockRestore();
      consoleWarn.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe('a search with no embedding key configured', () => {
  it('leaves the hybrid leg for Meilisearch to embed, exactly as before', async () => {
    delete process.env.OPENAI_API_KEY;

    const result = await searchResearchGroupsViaMeili(
      'machine learning',
      {},
      1,
      18,
      {},
      {
        embeddingSpendKey: CLIENT,
      },
    );

    expect(mocks.post).not.toHaveBeenCalled();
    expect(hybridSearches().length).toBeGreaterThan(1);
    expect(hybridSearches().every((params) => params.vector === undefined)).toBe(true);
    expect(result.degraded).toBeFalsy();
  });
});
