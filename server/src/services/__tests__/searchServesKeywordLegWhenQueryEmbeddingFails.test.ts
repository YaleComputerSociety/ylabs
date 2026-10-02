import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  getMeiliIndex: vi.fn(async () => ({
    search: mocks.search,
    searchSimilarDocuments: mocks.searchSimilarDocuments,
    getEmbedders: mocks.getEmbedders,
  })),
}));

import { searchResearchGroupsViaMeili } from '../researchGroupService';
import { invalidateResearchEntitySearchEmbedderCache } from '../researchEntitySearchIndexService';
import { clearResearchSearchQueryEmbeddingCache } from '../researchSearchQueryEmbedding';
import { resetResearchSearchQueryEmbeddingBudget } from '../researchSearchQueryEmbeddingBudget';

const CLIENT = '203.0.113.9';
const HANGING_UPSTREAM_ANSWER_CEILING_MS = 3000;

const HIT = {
  id: 'synthetic-coastal-sediment-lab',
  slug: 'synthetic-coastal-sediment-lab',
  name: 'Synthetic Coastal Sediment Lab',
  departments: ['Earth and Planetary Sciences'],
  researchAreas: ['carbon cycling'],
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

const hybridSearches = () => searchParams().filter((params) => Boolean(params.hybrid));

const upstreamOutage = () =>
  Object.assign(new Error('Request failed with status code 500'), {
    response: { status: 500 },
  });

const hangUntilTheRequestTimeout = (_url: string, _body: unknown, config: { timeout: number }) =>
  new Promise((_resolve, reject) => {
    setTimeout(
      () =>
        reject(
          Object.assign(new Error(`timeout of ${config.timeout}ms exceeded`), {
            code: 'ECONNABORTED',
          }),
        ),
      config.timeout,
    );
  });

const search = (query: string) =>
  searchResearchGroupsViaMeili(query, {}, 1, 18, {}, { embeddingSpendKey: CLIENT });

const originalApiKey = process.env.OPENAI_API_KEY;

beforeEach(() => {
  mocks.search.mockReset();
  mocks.search.mockResolvedValue(searchResult());
  mocks.getEmbedders.mockReset();
  mocks.getEmbedders.mockResolvedValue({ default: { source: 'openAi' } });
  mocks.post.mockReset();
  invalidateResearchEntitySearchEmbedderCache();
  clearResearchSearchQueryEmbeddingCache();
  resetResearchSearchQueryEmbeddingBudget();
  process.env.OPENAI_API_KEY = 'test-openai-key';
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
});

describe('a text search whose query embedding fails', () => {
  it('sends Meilisearch no hybrid query, so it never retries the failing upstream itself', async () => {
    mocks.post.mockRejectedValue(upstreamOutage());

    const result = await search('coastal sediment');

    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(searchParams().length).toBeGreaterThan(0);
    expect(hybridSearches()).toHaveLength(0);
    expect(searchParams().every((params) => params.vector === undefined)).toBe(true);
    expect(result.degraded).toBe(true);
    expect(result.estimatedTotalHits).toBe(1);
  });

  it('keeps hybrid off for every concurrent search that joined the failed call', async () => {
    let failSharedCall: (error: Error) => void = () => undefined;
    mocks.post.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          failSharedCall = reject;
        }),
    );

    const first = search('tidal marsh carbon');
    const second = search('tidal marsh carbon');
    await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    failSharedCall(upstreamOutage());
    const results = await Promise.all([first, second]);

    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(hybridSearches()).toHaveLength(0);
    expect(results.every((result) => result.degraded === true)).toBe(true);
  });

  it('answers within the embedding bound when the upstream hangs', async () => {
    mocks.post.mockImplementation(hangUntilTheRequestTimeout);

    const startedAt = Date.now();
    const result = await search('estuary nutrient flux');

    expect(Date.now() - startedAt).toBeLessThan(HANGING_UPSTREAM_ANSWER_CEILING_MS);
    expect(hybridSearches()).toHaveLength(0);
    expect(result.degraded).toBe(true);
  }, 15000);
});

describe('a text search while the embedding breaker is open', () => {
  const openTheBreaker = async () => {
    mocks.post.mockRejectedValue(upstreamOutage());
    for (let index = 0; index < 5; index += 1) {
      await search(`breaker-opening-query-${index}`);
    }
    mocks.post.mockClear();
    mocks.search.mockClear();
  };

  it('makes no embedding call and sends exactly what a keyword-only search sends', async () => {
    await openTheBreaker();

    const whileOpen = await search('salt marsh restoration');
    const openParams = searchParams();

    expect(mocks.post).not.toHaveBeenCalled();
    expect(whileOpen.degraded).toBe(true);

    mocks.search.mockClear();
    resetResearchSearchQueryEmbeddingBudget();
    invalidateResearchEntitySearchEmbedderCache();
    mocks.getEmbedders.mockResolvedValue({});
    const keywordOnly = await search('salt marsh restoration');

    expect(openParams).toEqual(searchParams());
    expect(whileOpen.researchEntities).toEqual(keywordOnly.researchEntities);
    expect(whileOpen.estimatedTotalHits).toBe(keywordOnly.estimatedTotalHits);
  });

  it('reopens on the first failure after the cooldown instead of letting another run through', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T00:00:00Z'));
    process.env.RESEARCH_SEARCH_EMBEDDING_COOLDOWN_MS = '30000';
    try {
      await openTheBreaker();

      vi.setSystemTime(new Date('2026-10-02T00:00:31Z'));
      mocks.post.mockRejectedValue(upstreamOutage());
      await search('first query after the cooldown');
      expect(mocks.post).toHaveBeenCalledTimes(1);

      mocks.post.mockClear();
      const next = await search('second query after the cooldown');

      expect(mocks.post).not.toHaveBeenCalled();
      expect(next.degraded).toBe(true);
    } finally {
      delete process.env.RESEARCH_SEARCH_EMBEDDING_COOLDOWN_MS;
    }
  });
});
