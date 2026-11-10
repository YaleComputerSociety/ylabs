import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  searchSimilarDocuments: vi.fn(),
  getDocument: vi.fn(),
  getEmbedders: vi.fn(),
  researchEntityFind: vi.fn(),
  researchEntityFindOne: vi.fn(),
  emptyFind: vi.fn(),
  getResearchSearchQueryVector: vi.fn(),
  rerankFindOne: vi.fn(),
  rerankUpdateOne: vi.fn(),
}));

vi.mock('../../utils/meiliClient', () => ({
  getMeiliSearchIndex: vi.fn(async () => ({
    search: mocks.search,
    searchSimilarDocuments: mocks.searchSimilarDocuments,
    getDocument: mocks.getDocument,
    getEmbedders: mocks.getEmbedders,
  })),
}));
vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: { find: mocks.researchEntityFind, findOne: mocks.researchEntityFindOne },
}));
vi.mock('../../models/researchEntityRelationship', () => ({
  ResearchEntityRelationship: { find: mocks.emptyFind },
}));
vi.mock('../../models/roleAssignment', () => ({ RoleAssignment: { find: mocks.emptyFind } }));
vi.mock('../../models/researcher', () => ({ Researcher: { find: mocks.emptyFind } }));
vi.mock('../../models/account', () => ({ Account: { find: mocks.emptyFind } }));
vi.mock('../../models/signal', () => ({ Signal: { find: mocks.emptyFind } }));
vi.mock('../../models/searchRerankCache', () => ({
  SEARCH_RERANK_MIN_SCORE: 0,
  SEARCH_RERANK_MAX_SCORE: 3,
  SearchRerankCache: { findOne: mocks.rerankFindOne, updateOne: mocks.rerankUpdateOne },
}));
vi.mock('../researchSearchQueryEmbedding', () => ({
  getResearchSearchQueryVector: mocks.getResearchSearchQueryVector,
}));

import { searchRerankCacheQueryKey, searchResearchGroupsViaMeili } from '../researchGroupService';
import { invalidateResearchEntitySearchEmbedderCache } from '../researchEntitySearchIndexService';
import { resetSearchRerankCacheMemo } from '../searchRerankCache';
import {
  resetSearchRerankLiveMissQueue,
  searchRerankLiveMissIdle,
  setSearchRerankLiveMissRunner,
  type SearchRerankLiveMissJobRequest,
} from '../searchRerankLiveMiss';
import { runSearchRerankLiveMissJob } from '../searchRerankLiveMissJob';
import { resetMeiliAvailability } from '../../utils/meiliAvailability';

const queryResult = <T>(value: T) => {
  const query: any = { lean: async () => value };
  query.sort = () => query;
  query.limit = () => query;
  query.select = () => query;
  query.maxTimeMS = () => query;
  return query;
};

const ROW_COUNT = 40;
const rowId = (index: number) => `67d8928150621bcef436${String(index).padStart(4, '0')}`;
const ALL_ROW_IDS = Array.from({ length: ROW_COUNT }, (_value, index) => rowId(index));
const slugOf = (id: string) => `synthetic-row-${id.slice(-4)}`;
const SYNTHETIC_SURNAME = 'Quillfeather';
const QUERY = 'coastal ecology';
const CLIENT = { ipKey: 'ip:198.51.100.23', sessionKey: 'anonymous:synthetic-session' };

let rowIds = ALL_ROW_IDS;
let nameQueryTopHit = false;
let keywordLegEmpty = false;
let topHitMatches: Record<string, unknown> | null = null;
let matchPositionReadFails = false;

const indexHit = (id: string, position: number) => ({
  id,
  kind: 'lab',
  entityType: 'lab',
  schools: ['Synthetic School'],
  departments: ['Synthetic Department'],
  researchAreas: ['Coastal Ecology'],
  name: `Synthetic Row ${id.slice(-4)}`,
  leadProfessorNames: [`Avery ${SYNTHETIC_SURNAME}`],
  _rankingScore: 0.9 - position * 0.001,
  _rankingScoreDetails: {
    words: { order: 0, matchingWords: 2, maxMatchingWords: 2, score: 1 },
    typo: { order: 1, typoCount: 0, maxTypoCount: 0, score: 1 },
    vectorSort: { similarity: 0.9 - position * 0.001 },
  },
});

const serveIndex = () => {
  mocks.search.mockImplementation(async (_query: string, params: Record<string, any> = {}) => {
    const hits = rowIds.map(indexHit);
    if (params.limit === 0 && params.facets) return { hits: [], facetDistribution: {} };
    if (keywordLegEmpty && !params.hybrid) return { hits: [], estimatedTotalHits: 0 };
    if (params.showMatchesPosition) {
      if (matchPositionReadFails) throw new Error('synthetic match-position outage');
      const top = hits[0];
      return {
        hits: [
          topHitMatches
            ? { ...top, _matchesPosition: topHitMatches }
            : nameQueryTopHit
              ? {
                  ...top,
                  _matchesPosition: {
                    leadProfessorNames: [
                      { start: 6, length: SYNTHETIC_SURNAME.length, indices: [0] },
                    ],
                  },
                }
              : top,
        ],
      };
    }
    return {
      hits: params.hitsPerPage === 1 ? hits.slice(0, 1) : hits,
      estimatedTotalHits: hits.length,
      totalHits: hits.length,
      facetDistribution: {},
    };
  });
};

const entityFor = (id: string) => ({
  _id: id,
  slug: slugOf(id),
  name: `Synthetic Row ${id.slice(-4)}`,
  kind: 'lab',
  departments: ['Synthetic Department'],
  researchAreas: ['Coastal Ecology'],
  sourceUrls: [],
  shortDescription:
    'Studies coastal ecology, tidal marsh dynamics, and shoreline restoration in field sites.',
  fullDescription:
    'This research studies coastal ecology, tidal marsh dynamics, and shoreline restoration across many field sites.',
});

const servedIdsOf = (result: { researchEntities: Array<{ slug?: unknown }> }) =>
  result.researchEntities.map((entity) =>
    ALL_ROW_IDS.find((id) => slugOf(id) === String(entity.slug))!,
  );

const runner = vi.fn(async (_request: SearchRerankLiveMissJobRequest) => ({
  status: 'written' as const,
}));

const search = (
  query = QUERY,
  options: Parameters<typeof searchResearchGroupsViaMeili>[5] = { rerankLiveMissClient: CLIENT },
  filters: Parameters<typeof searchResearchGroupsViaMeili>[1] = {},
  sort: Parameters<typeof searchResearchGroupsViaMeili>[4] = {},
) => searchResearchGroupsViaMeili(query, filters, 1, ROW_COUNT, sort, options);

const flagsOff = () => {
  vi.stubEnv('SEARCH_RERANK_CACHE_ENABLED', '');
  vi.stubEnv('SEARCH_RERANK_LIVE_MISS_ENABLED', '');
};

const liveMissOn = (mode: 'shadow' | 'serve' = 'shadow') => {
  vi.stubEnv('SEARCH_RERANK_LIVE_MISS_ENABLED', 'true');
  vi.stubEnv('SEARCH_RERANK_LIVE_MISS_MODE', mode);
};

const todaysResponse = async (query = QUERY) => {
  flagsOff();
  const result = await search(query);
  vi.unstubAllEnvs();
  resetSearchRerankCacheMemo();
  mocks.rerankFindOne.mockClear();
  return JSON.stringify(result);
};

const enqueuedKeys = async () => {
  await searchRerankLiveMissIdle();
  return runner.mock.calls.map(([request]) => request.queryKey);
};

beforeEach(() => {
  vi.unstubAllEnvs();
  resetMeiliAvailability();
  invalidateResearchEntitySearchEmbedderCache();
  resetSearchRerankCacheMemo();
  resetSearchRerankLiveMissQueue();
  runner.mockClear();
  setSearchRerankLiveMissRunner(runner);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  rowIds = ALL_ROW_IDS;
  nameQueryTopHit = false;
  keywordLegEmpty = false;
  topHitMatches = null;
  matchPositionReadFails = false;
  mocks.search.mockReset();
  serveIndex();
  mocks.searchSimilarDocuments.mockReset();
  mocks.searchSimilarDocuments.mockResolvedValue({ hits: [] });
  mocks.getDocument.mockReset();
  mocks.getDocument.mockResolvedValue({});
  mocks.getEmbedders.mockReset();
  mocks.getEmbedders.mockResolvedValue({ default: { source: 'openAi' } });
  mocks.getResearchSearchQueryVector.mockReset();
  mocks.getResearchSearchQueryVector.mockResolvedValue({
    vector: [0.1, 0.2, 0.3],
    semanticLegAffordable: true,
  });
  mocks.emptyFind.mockReset();
  mocks.emptyFind.mockReturnValue(queryResult([]));
  mocks.researchEntityFindOne.mockReset();
  mocks.researchEntityFindOne.mockReturnValue(queryResult(null));
  mocks.researchEntityFind.mockReset();
  mocks.researchEntityFind.mockImplementation(
    (query: { _id?: { $in?: string[] }; slug?: { $in?: string[] } }) => {
      const ids = (query?._id?.$in ?? []).map(String);
      const slugs = new Set((query?.slug?.$in ?? []).map(String));
      return queryResult(
        ALL_ROW_IDS.filter((id) => ids.includes(id) || slugs.has(slugOf(id))).map(entityFor),
      );
    },
  );
  mocks.rerankFindOne.mockReset();
  mocks.rerankFindOne.mockImplementation(() => queryResult(null));
  mocks.rerankUpdateOne.mockReset();
  mocks.rerankUpdateOne.mockResolvedValue({ acknowledged: true });
});

afterEach(async () => {
  await searchRerankLiveMissIdle();
  setSearchRerankLiveMissRunner(null);
  resetSearchRerankLiveMissQueue();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('with SEARCH_RERANK_LIVE_MISS_ENABLED unset', () => {
  it('serves the same response, never reads the cache and enqueues nothing', async () => {
    const today = await todaysResponse();
    vi.stubEnv('SEARCH_RERANK_LIVE_MISS_MODE', 'serve');

    expect(JSON.stringify(await search())).toBe(today);
    expect(mocks.rerankFindOne).not.toHaveBeenCalled();
    expect(await enqueuedKeys()).toEqual([]);
  });

  it('reads the cache exactly as the serve flag alone does, and enqueues nothing', async () => {
    vi.stubEnv('SEARCH_RERANK_CACHE_ENABLED', 'true');

    await search();
    await search();

    expect(mocks.rerankFindOne).toHaveBeenCalledTimes(1);
    expect(mocks.rerankFindOne).toHaveBeenCalledWith({
      queryKey: searchRerankCacheQueryKey(QUERY, {}),
    });
    expect(await enqueuedKeys()).toEqual([]);
  });
});

describe('with the live-miss job switched off after serving', () => {
  it('stops serving its entries while still serving a seeded one', async () => {
    const today = await todaysResponse();
    vi.stubEnv('SEARCH_RERANK_CACHE_ENABLED', 'true');
    mocks.rerankFindOne.mockImplementation(() =>
      queryResult({
        source: 'live-miss',
        indexVersion: 'async-gpt-5-mini-2026-11-01',
        scoredAt: new Date('2026-11-01T00:00:00Z'),
        scores: [{ entityId: rowId(25), score: 3 }],
      }),
    );

    expect(JSON.stringify(await search())).toBe(today);

    resetSearchRerankCacheMemo();
    mocks.rerankFindOne.mockImplementation(() =>
      queryResult({
        source: 'offline-scoring',
        indexVersion: 'full-v2-2026-11-10',
        scoredAt: new Date('2026-11-10T00:00:00Z'),
        scores: [{ entityId: rowId(25), score: 3 }],
      }),
    );

    expect(servedIdsOf(await search())[0]).toBe(rowId(25));
  });
});

describe('with the live-miss job on', () => {
  it("serves today's order on a miss and enqueues one job for the key", async () => {
    const today = await todaysResponse();
    liveMissOn();

    expect(JSON.stringify(await search())).toBe(today);
    expect(await enqueuedKeys()).toEqual([searchRerankCacheQueryKey(QUERY, {})]);
    expect(runner.mock.calls[0][0]).toEqual({
      queryKey: searchRerankCacheQueryKey(QUERY, {}),
      query: QUERY,
      filters: {},
    });
  });

  it('answers before the job has even started, so search never waits on the model', async () => {
    let releaseJob: () => void = () => undefined;
    const started = vi.fn();
    setSearchRerankLiveMissRunner(async () => {
      started();
      await new Promise<void>((resolve) => {
        releaseJob = resolve;
      });
      return { status: 'written' };
    });
    liveMissOn();

    const result = await search();

    expect(result.researchEntities).toHaveLength(ROW_COUNT);
    expect(started).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(1));
    releaseJob();
  });

  it('still enqueues a topic query whose title match is shared by a topic field', async () => {
    liveMissOn();
    topHitMatches = {
      name: [{ start: 0, length: 9, indices: [0] }],
      researchAreas: [{ start: 0, length: 7, indices: [0] }],
    };

    await search();

    expect(await enqueuedKeys()).toEqual([searchRerankCacheQueryKey(QUERY, {})]);
  });

  it('enqueues once for many searches of the same new query', async () => {
    liveMissOn();

    await Promise.all(Array.from({ length: 5 }, () => search()));

    expect(await enqueuedKeys()).toHaveLength(1);
  });

  it('keys the job by the student filters, never the visibility tier', async () => {
    liveMissOn();

    await search(
      QUERY,
      { rerankLiveMissClient: CLIENT },
      {
        departments: ['Synthetic Department'],
        studentVisibilityTier: ['student_ready'],
      },
    );

    await searchRerankLiveMissIdle();
    const [request] = runner.mock.calls[0];
    expect(request.filters).toEqual({ departments: ['Synthetic Department'] });
    expect(request.queryKey).toBe(
      searchRerankCacheQueryKey(QUERY, { departments: ['Synthetic Department'] }),
    );
  });

  it('never serves a shadow entry, even with the serve flag on', async () => {
    const today = await todaysResponse();
    vi.stubEnv('SEARCH_RERANK_CACHE_ENABLED', 'true');
    liveMissOn('shadow');
    mocks.rerankFindOne.mockImplementation(() =>
      queryResult({
        source: 'shadow',
        indexVersion: 'async-gpt-5-mini-2026-11-10',
        scoredAt: new Date(),
        scores: [{ entityId: rowId(25), score: 3 }],
      }),
    );

    const result = await search();

    expect(JSON.stringify(result)).toBe(today);
    expect(servedIdsOf(result)[0]).toBe(rowId(0));
    expect(await enqueuedKeys()).toEqual([]);
  });

  it('never enqueues over a seeded full- entry', async () => {
    vi.stubEnv('SEARCH_RERANK_CACHE_ENABLED', 'true');
    liveMissOn('serve');
    mocks.rerankFindOne.mockImplementation(() =>
      queryResult({
        source: 'offline-scoring',
        indexVersion: 'full-v2-2026-11-10',
        scoredAt: new Date('2026-11-10T00:00:00Z'),
        scores: [{ entityId: rowId(25), score: 3 }],
      }),
    );

    const result = await search();

    expect(servedIdsOf(result)[0]).toBe(rowId(25));
    expect(await enqueuedKeys()).toEqual([]);
  });

  it('serves a live-miss entry and never enqueues over it', async () => {
    vi.stubEnv('SEARCH_RERANK_CACHE_ENABLED', 'true');
    liveMissOn('serve');
    mocks.rerankFindOne.mockImplementation(() =>
      queryResult({
        source: 'live-miss',
        indexVersion: 'async-gpt-5-mini-2026-11-01',
        scoredAt: new Date('2026-11-01T00:00:00Z'),
        scores: [{ entityId: rowId(25), score: 3 }],
      }),
    );

    const result = await search();

    expect(servedIdsOf(result)[0]).toBe(rowId(25));
    expect(await enqueuedKeys()).toEqual([]);
  });

  describe('never enqueues', () => {
    beforeEach(() => liveMissOn('serve'));

    it('a filter-only browse', async () => {
      await search('', { rerankLiveMissClient: CLIENT }, { departments: ['Synthetic Department'] });
      expect(await enqueuedKeys()).toEqual([]);
    });

    it('a query that tokenizes to no search words', async () => {
      await search('海洋生態');
      expect(await enqueuedKeys()).toEqual([]);
    });

    it('a name query', async () => {
      nameQueryTopHit = true;
      await search(SYNTHETIC_SURNAME.toLowerCase());
      expect(await enqueuedKeys()).toEqual([]);
    });

    it('a name-shaped query the name guard does not take, such as a misspelled surname', async () => {
      topHitMatches = { leadProfessorNames: [{ start: 6, length: 12, indices: [0] }] };
      await search('quilfeather');
      expect(await enqueuedKeys()).toEqual([]);
    });

    it('a query matched only as a prefix of a row title and in no topic field', async () => {
      topHitMatches = { name: [{ start: 0, length: 9, indices: [0] }] };
      await search('synthet');
      expect(await enqueuedKeys()).toEqual([]);
    });

    it('a query whose best keyword hit could not be checked for a name match', async () => {
      matchPositionReadFails = true;
      await search();
      expect(await enqueuedKeys()).toEqual([]);
    });

    it('a query shorter than four letters, such as a two-letter acronym', async () => {
      await search('un');
      expect(await enqueuedKeys()).toEqual([]);
    });

    it('a search with an explicit sort', async () => {
      await search(QUERY, { rerankLiveMissClient: CLIENT }, {}, {
        sortBy: 'name',
        sortOrder: 'asc',
      } as any);
      expect(await enqueuedKeys()).toEqual([]);
    });

    it('a search Meilisearch pages itself because no embedder is configured', async () => {
      mocks.getEmbedders.mockResolvedValue({});
      await search();
      expect(await enqueuedKeys()).toEqual([]);
    });

    it('a search whose semantic leg the embedding budget refused', async () => {
      mocks.getResearchSearchQueryVector.mockResolvedValue({
        vector: null,
        semanticLegAffordable: false,
      });
      await search();
      expect(await enqueuedKeys()).toEqual([]);
    });

    it('a query whose keyword leg served no row', async () => {
      keywordLegEmpty = true;
      await search('zzqx vrrtn');
      expect(await enqueuedKeys()).toEqual([]);
    });

    it('a query with fewer than two candidates', async () => {
      rowIds = ALL_ROW_IDS.slice(0, 1);
      await search();
      expect(await enqueuedKeys()).toEqual([]);
    });

    it('a query over 10 words', async () => {
      await search('coastal ecology marsh tide reef kelp sand salt wave dune bay');
      expect(await enqueuedKeys()).toEqual([]);
    });

    it('a query over 100 characters', async () => {
      await search(`coastal ecology ${'x'.repeat(100)}`);
      expect(await enqueuedKeys()).toEqual([]);
    });

    it('an in-process search that carries no request client', async () => {
      await search(QUERY, {});
      expect(await enqueuedKeys()).toEqual([]);
    });
  });
});

describe('search, then the job, then search again', () => {
  it("serves the job's scores on the next search for the key", async () => {
    vi.stubEnv('SEARCH_RERANK_CACHE_ENABLED', 'true');
    liveMissOn('serve');
    let stored: Record<string, unknown> | null = null;
    mocks.rerankFindOne.mockImplementation(() => queryResult(stored));
    mocks.rerankUpdateOne.mockImplementation(async (_filter: unknown, update: { $set: any }) => {
      stored = update.$set;
      return { acknowledged: true };
    });
    const model = vi.fn(async ({ candidates }: { candidates: readonly unknown[] }) =>
      JSON.stringify({
        scores: Object.fromEntries(
          candidates.map((_candidate, index) => [String(index), index === 7 ? 3 : 1]),
        ),
      }),
    );
    setSearchRerankLiveMissRunner((request) =>
      runSearchRerankLiveMissJob(request, { model, readSpendTodayUsd: async () => 0 }),
    );

    const first = await search();
    await searchRerankLiveMissIdle();
    const second = await search();

    expect(servedIdsOf(first)[0]).toBe(rowId(0));
    expect(model).toHaveBeenCalledTimes(1);
    expect(stored).toMatchObject({ source: 'live-miss', queryText: QUERY });
    expect(servedIdsOf(second)[0]).toBe(rowId(7));
    expect(servedIdsOf(second).slice(30)).toEqual(servedIdsOf(first).slice(30));
  });
});
