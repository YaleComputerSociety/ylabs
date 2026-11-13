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

import { searchResearchGroupsViaMeili } from '../researchGroupService';
import { invalidateResearchEntitySearchEmbedderCache } from '../researchEntitySearchIndexService';
import {
  resetSearchRerankCacheMemo,
  SEARCH_FEW_CLOSE_MATCHES_MAX_COUNT,
  SEARCH_RERANK_CLOSE_MATCH_SCORE,
} from '../searchRerankCache';
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

const HEAD_ROW_INDEXES = Array.from({ length: 10 }, (_value, index) => index);

const scoresFor = (closeRowIndexes: number[], weakRowIndexes: number[] = HEAD_ROW_INDEXES) => [
  ...closeRowIndexes.map((index) => ({ entityId: rowId(index), score: 3 })),
  ...weakRowIndexes
    .filter((index) => !closeRowIndexes.includes(index))
    .map((index) => ({ entityId: rowId(index), score: 1 })),
];

const seededEntry = (scores: unknown[]) => ({
  scores,
  source: 'offline-scoring',
  indexVersion: 'full-synthetic-2026-11-13',
});

const servedEntry = (scores: unknown[]) => ({
  scores,
  source: 'offline-scoring',
  indexVersion: 'synthetic-marker',
});

const serveCacheEntry = (entry: unknown) => {
  mocks.rerankFindOne.mockImplementation(() => queryResult(entry));
};

const servedSlugs = (result: { researchEntities: Array<{ slug?: unknown }> }) =>
  result.researchEntities.map((entity) => String(entity.slug));

const searchTopic = (page = 1, pageSize = ROW_COUNT, query = 'coastal ecology') =>
  searchResearchGroupsViaMeili(query, {}, page, pageSize);

const searchWithEntry = async (
  entry: unknown,
  { page = 1, pageSize = ROW_COUNT, query = 'coastal ecology' } = {},
) => {
  resetSearchRerankCacheMemo();
  serveCacheEntry(entry);
  return searchTopic(page, pageSize, query);
};

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('SEARCH_RERANK_CACHE_ENABLED', 'true');
  vi.stubEnv('SEARCH_RERANK_LIVE_MISS_ENABLED', '');
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
  serveCacheEntry(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the few close matches notice', () => {
  it('uses the measured thresholds', () => {
    expect(SEARCH_RERANK_CLOSE_MATCH_SCORE).toBe(2);
    expect(SEARCH_FEW_CLOSE_MATCHES_MAX_COUNT).toBe(3);
  });

  it('reports the count on every page when a seeded entry scores at most 3 pool rows 2 or more', async () => {
    const entry = seededEntry([
      { entityId: rowId(7), score: 3 },
      { entityId: rowId(21), score: 2 },
      { entityId: rowId(33), score: 2 },
      { entityId: rowId(0), score: 1.9 },
      { entityId: rowId(1), score: 0 },
      ...[2, 3, 4, 5, 6, 8, 9].map((index) => ({ entityId: rowId(index), score: 1 })),
    ]);
    serveCacheEntry(entry);

    for (const page of [1, 2, 3, 4]) {
      const result = await searchTopic(page, 10);
      expect(result.fewCloseMatches).toEqual({ closeMatchCount: 3 });
    }
  });

  it('reports a count of zero when a seeded entry scores no pool row 2 or more', async () => {
    const result = await searchWithEntry(seededEntry(scoresFor([])));

    expect(result.fewCloseMatches).toEqual({ closeMatchCount: 0 });
  });

  it('omits the field when a seeded entry scores 4 pool rows 2 or more', async () => {
    const result = await searchWithEntry(seededEntry(scoresFor([2, 9, 17, 26])));

    expect(result.fewCloseMatches).toBeUndefined();
    expect('fewCloseMatches' in result).toBe(false);
  });

  it('counts close rows across the whole served pool, not the page', async () => {
    const result = await searchWithEntry(seededEntry(scoresFor([3, 34, 36, 38])), {
      page: 1,
      pageSize: 10,
    });

    expect(result.fewCloseMatches).toBeUndefined();
  });

  it('never counts a scored row the served pool does not hold', async () => {
    const result = await searchWithEntry(
      seededEntry([...scoresFor([3, 4, 5]), { entityId: '67d8928150621bcef434ffff', score: 3 }]),
    );

    expect(result.fewCloseMatches).toEqual({ closeMatchCount: 3 });
  });

  it('omits the field when the seeded entry never scored the top of the served pool', async () => {
    const laterRows = Array.from({ length: ROW_COUNT - 5 }, (_value, index) => index + 5);
    const result = await searchWithEntry(seededEntry(scoresFor([12, 20], laterRows)));

    expect(result.fewCloseMatches).toBeUndefined();
  });

  it('still reports the count when the seeded entry leaves only 2 head rows unscored', async () => {
    const laterRows = Array.from({ length: ROW_COUNT - 2 }, (_value, index) => index + 2);
    const result = await searchWithEntry(seededEntry(scoresFor([12, 20], laterRows)));

    expect(result.fewCloseMatches).toEqual({ closeMatchCount: 2 });
  });

  it('omits the field for a served entry', async () => {
    const result = await searchWithEntry(servedEntry(scoresFor([3])));

    expect(result.fewCloseMatches).toBeUndefined();
  });

  it('omits the field for a shadow entry', async () => {
    const result = await searchWithEntry({ ...servedEntry(scoresFor([3])), source: 'shadow' });

    expect(result.fewCloseMatches).toBeUndefined();
  });

  it('omits the field for a live-miss entry whose scores are served', async () => {
    vi.stubEnv('SEARCH_RERANK_LIVE_MISS_ENABLED', 'true');
    const scores = scoresFor([3]);
    const withLiveMiss = await searchWithEntry({ ...servedEntry(scores), source: 'live-miss' });
    const withSeeded = await searchWithEntry(seededEntry(scores));

    expect(servedSlugs(withLiveMiss)).toEqual(servedSlugs(withSeeded));
    expect(withLiveMiss.fewCloseMatches).toBeUndefined();
    expect(withSeeded.fewCloseMatches).toEqual({ closeMatchCount: 1 });
  });

  it('omits the field with the cache flag off', async () => {
    vi.stubEnv('SEARCH_RERANK_CACHE_ENABLED', '');

    const result = await searchWithEntry(seededEntry(scoresFor([3])));

    expect(result.fewCloseMatches).toBeUndefined();
  });

  it('omits the field with the cache flag off while the live-miss job reads the entry', async () => {
    vi.stubEnv('SEARCH_RERANK_CACHE_ENABLED', '');
    vi.stubEnv('SEARCH_RERANK_LIVE_MISS_ENABLED', 'true');

    const result = await searchWithEntry(seededEntry(scoresFor([3])));

    expect(mocks.rerankFindOne).toHaveBeenCalled();
    expect(result.fewCloseMatches).toBeUndefined();
  });

  it('omits the field when the query has no entry', async () => {
    const result = await searchWithEntry(null);

    expect(result.fewCloseMatches).toBeUndefined();
  });

  it('omits the field for a name query that skips the rerank', async () => {
    nameQueryTopHit = true;

    const result = await searchWithEntry(seededEntry(scoresFor([3])), {
      query: SYNTHETIC_SURNAME.toLowerCase(),
    });

    expect(result.fewCloseMatches).toBeUndefined();
  });

  it('omits the field for a browse with no query', async () => {
    serveCacheEntry(seededEntry(scoresFor([3])));

    const result = await searchResearchGroupsViaMeili('', {}, 1, 24);

    expect(result.fewCloseMatches).toBeUndefined();
    expect(mocks.rerankFindOne).not.toHaveBeenCalled();
  });

  it('serves the same rows in the same order with and without the field', async () => {
    const scores = scoresFor([3, 22]);
    const withNotice = await searchWithEntry(seededEntry(scores));
    const withoutNotice = await searchWithEntry(servedEntry(scores));

    expect(withNotice.fewCloseMatches).toEqual({ closeMatchCount: 2 });
    expect(withoutNotice.fewCloseMatches).toBeUndefined();
    const { fewCloseMatches: _notice, ...withNoticeRest } = withNotice;
    expect(JSON.stringify(withNoticeRest)).toBe(JSON.stringify(withoutNotice));
    expect(servedSlugs(withNotice).slice(0, 2)).toEqual([slugOf(rowId(3)), slugOf(rowId(22))]);
  });
});
