import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Behind `SEARCH_RERANK_CACHE_ENABLED`, a text search with a cached entry reorders its top
 * results by the cached scores before the pool is paged, and every other search is served
 * exactly as it is without the flag (#5448).
 */
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
  SearchRerankCache: { findOne: mocks.rerankFindOne },
}));
vi.mock('../researchSearchQueryEmbedding', () => ({
  getResearchSearchQueryVector: mocks.getResearchSearchQueryVector,
}));

import { searchRerankCacheQueryKey, searchResearchGroupsViaMeili } from '../researchGroupService';
import { invalidateResearchEntitySearchEmbedderCache } from '../researchEntitySearchIndexService';
import { applyCachedRerank, resetSearchRerankCacheMemo } from '../searchRerankCache';
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
const rowId = (index: number) => `67d8928150621bcef434${String(index).padStart(4, '0')}`;
const ROW_IDS = Array.from({ length: ROW_COUNT }, (_value, index) => rowId(index));
const slugOf = (id: string) => `synthetic-row-${id.slice(-4)}`;
const SYNTHETIC_SURNAME = 'Quillfeather';

let nameQueryTopHit = false;

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
    const hits = ROW_IDS.map(indexHit);
    if (params.limit === 0 && params.facets) return { hits: [], facetDistribution: {} };
    if (params.showMatchesPosition) {
      const top = hits[0];
      return {
        hits: [
          nameQueryTopHit
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

const CACHED_SCORES = [
  { entityId: rowId(25), score: 3 },
  { entityId: rowId(12), score: 3 },
  { entityId: rowId(0), score: 0 },
  { entityId: rowId(1), score: 0.5 },
  { entityId: rowId(35), score: 3 },
];
const cachedScoresById = new Map(CACHED_SCORES.map(({ entityId, score }) => [entityId, score]));

const serveCacheEntry = (entry: unknown) => {
  mocks.rerankFindOne.mockImplementation(() => queryResult(entry));
};

const servedSlugs = (result: { researchEntities: Array<{ slug?: unknown }> }) =>
  result.researchEntities.map((entity) => String(entity.slug));

const servedIdsOf = (result: { researchEntities: Array<{ slug?: unknown }> }) =>
  servedSlugs(result).map((slug) => ROW_IDS.find((id) => slugOf(id) === slug)!);

const searchTopic = (page = 1, pageSize = ROW_COUNT, query = 'coastal ecology') =>
  searchResearchGroupsViaMeili(query, {}, page, pageSize);

beforeEach(() => {
  vi.unstubAllEnvs();
  resetMeiliAvailability();
  invalidateResearchEntitySearchEmbedderCache();
  resetSearchRerankCacheMemo();
  nameQueryTopHit = false;
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
  mocks.researchEntityFind.mockImplementation((query: { _id?: { $in?: string[] } }) => {
    const ids = (query?._id?.$in ?? []).map(String);
    return queryResult(ids.filter((id) => ROW_IDS.includes(id)).map(entityFor));
  });
  mocks.rerankFindOne.mockReset();
  serveCacheEntry({ scores: CACHED_SCORES });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const todaysOrder = async (query?: string) => {
  vi.stubEnv('SEARCH_RERANK_CACHE_ENABLED', '');
  const result = await searchTopic(1, ROW_COUNT, query);
  vi.unstubAllEnvs();
  return result;
};

describe('a text search with the rerank cache flag unset', () => {
  it('serves the fused order and never reads the cache', async () => {
    const result = await todaysOrder();

    expect(servedIdsOf(result)).toHaveLength(ROW_COUNT);
    expect(servedIdsOf(result)[0]).toBe(rowId(0));
    expect(mocks.rerankFindOne).not.toHaveBeenCalled();
  });

  it('serves the same response whether or not an entry exists', async () => {
    const withoutEntry = await todaysOrder();
    serveCacheEntry(null);
    const withEntryMissing = await todaysOrder();

    expect(JSON.stringify(withEntryMissing)).toBe(JSON.stringify(withoutEntry));
  });
});

describe('a text search with the rerank cache flag on', () => {
  it('reorders the top 30 by cached score and leaves the rest in place', async () => {
    const today = servedIdsOf(await todaysOrder());
    vi.stubEnv('SEARCH_RERANK_CACHE_ENABLED', 'true');

    const result = await searchTopic();

    const expected = applyCachedRerank(
      today.map((id) => ({ id })),
      cachedScoresById,
      { window: 30, neutral: 1.5 },
    ).map(({ id }) => id);
    expect(servedIdsOf(result)).toEqual(expected);
    expect(servedIdsOf(result).slice(0, 2)).toEqual([rowId(12), rowId(25)]);
    expect(servedIdsOf(result).slice(28, 30)).toEqual([rowId(1), rowId(0)]);
    expect(servedIdsOf(result).slice(30)).toEqual(today.slice(30));
    expect(result.estimatedTotalHits).toBe(ROW_COUNT);
    expect(mocks.rerankFindOne).toHaveBeenCalledWith({
      queryKey: searchRerankCacheQueryKey('coastal ecology', {}),
    });
  });

  it('keeps pages consistent and reads the cache once across them', async () => {
    vi.stubEnv('SEARCH_RERANK_CACHE_ENABLED', 'true');
    const whole = servedIdsOf(await searchTopic(1, ROW_COUNT));

    const pages = [];
    for (const page of [1, 2, 3, 4]) pages.push(...servedIdsOf(await searchTopic(page, 10)));

    expect(pages).toEqual(whole);
    expect(mocks.rerankFindOne).toHaveBeenCalledTimes(1);
  });

  it('serves the fused order when the query has no entry', async () => {
    const today = await todaysOrder();
    serveCacheEntry(null);
    vi.stubEnv('SEARCH_RERANK_CACHE_ENABLED', 'true');

    expect(JSON.stringify(await searchTopic())).toBe(JSON.stringify(today));
  });

  it('serves the fused order when the cache read fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const today = await todaysOrder();
    mocks.rerankFindOne.mockImplementation(() => {
      throw new Error('cache unavailable');
    });
    vi.stubEnv('SEARCH_RERANK_CACHE_ENABLED', 'true');

    const result = await searchTopic();

    expect(JSON.stringify(result)).toBe(JSON.stringify(today));
    expect(result.degraded).toBeFalsy();
    consoleError.mockRestore();
  });

  it('leaves a name query in the keyword order it serves today', async () => {
    nameQueryTopHit = true;
    const today = await todaysOrder(SYNTHETIC_SURNAME.toLowerCase());
    vi.stubEnv('SEARCH_RERANK_CACHE_ENABLED', 'true');

    const result = await searchTopic(1, ROW_COUNT, SYNTHETIC_SURNAME.toLowerCase());

    expect(JSON.stringify(result)).toBe(JSON.stringify(today));
    expect(servedIdsOf(result)[0]).toBe(rowId(0));
  });

  it('leaves a browse with no query untouched', async () => {
    vi.stubEnv('SEARCH_RERANK_CACHE_ENABLED', 'true');

    await searchResearchGroupsViaMeili('', {}, 1, 24);

    expect(mocks.rerankFindOne).not.toHaveBeenCalled();
  });
});
