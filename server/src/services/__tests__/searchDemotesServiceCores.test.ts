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

import {
  searchResearchGroupsForRerankCandidates,
  searchResearchGroupsViaMeili,
} from '../researchGroupService';
import { invalidateResearchEntitySearchEmbedderCache } from '../researchEntitySearchIndexService';
import { resetSearchRerankCacheMemo } from '../searchRerankCache';
import { SERVICE_CORE_DEMOTION_WINDOW } from '../serviceCoreDemotion';
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

const CORE_ROW = rowId(0);
const SECOND_CORE_ROW = rowId(3);
const SERVICE_TEXT_ROW = rowId(5);
const CORE_PAST_WINDOW = rowId(SERVICE_CORE_DEMOTION_WINDOW + 2);
const CORE_ROWS = new Set([CORE_ROW, SECOND_CORE_ROW, CORE_PAST_WINDOW]);

const entityTypeOf = (id: string) =>
  CORE_ROWS.has(id) ? 'CORE_FACILITY' : id === SERVICE_TEXT_ROW ? 'FACULTY_RESEARCH_AREA' : 'LAB';
const nameOf = (id: string) =>
  id === CORE_ROW
    ? 'Synthetic Tidal Analysis Core (STAC)'
    : CORE_ROWS.has(id)
      ? `Synthetic Instrument Facility ${id.slice(-4)}`
      : `Synthetic Row ${id.slice(-4)}`;
const shortDescriptionOf = (id: string) =>
  id === SERVICE_TEXT_ROW
    ? 'Provides marsh sediment imaging services and training for trained users.'
    : 'Studies coastal ecology, tidal marsh dynamics, and shoreline restoration in field sites.';

let nameQueryTopHit = false;

const indexHit = (id: string, position: number) => ({
  id,
  kind: 'lab',
  entityType: entityTypeOf(id),
  researchType: entityTypeOf(id),
  schools: ['Synthetic School'],
  departments: ['Synthetic Department'],
  researchAreas: ['Coastal Ecology'],
  name: nameOf(id),
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
  name: nameOf(id),
  kind: 'lab',
  entityType: storedTypesAreCores ? entityTypeOf(id) : 'LAB',
  departments: ['Synthetic Department'],
  researchAreas: ['Coastal Ecology'],
  sourceUrls: [],
  shortDescription: shortDescriptionOf(id),
  fullDescription:
    'This research studies coastal ecology, tidal marsh dynamics, and shoreline restoration across many field sites.',
});

const servedIdsOf = (result: { researchEntities: Array<{ slug?: unknown }> }) =>
  result.researchEntities.map((entity) =>
    ROW_IDS.find((id) => slugOf(id) === String(entity.slug))!,
  );

const searchTopic = (
  query = 'coastal ecology',
  filters: Record<string, unknown> = {},
  page = 1,
  pageSize = ROW_COUNT,
) =>
  searchResearchGroupsViaMeili(
    query,
    filters as never,
    page,
    pageSize,
    {},
    { includeFacets: true },
  );

let storedTypesAreCores = true;
const withoutDemotionReads = () => {
  storedTypesAreCores = false;
};

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
  mocks.rerankFindOne.mockImplementation(() => queryResult(null));
  storedTypesAreCores = true;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const DEMOTED_IN_WINDOW = [CORE_ROW, SECOND_CORE_ROW, SERVICE_TEXT_ROW];
const researchInWindow = ROW_IDS.slice(0, SERVICE_CORE_DEMOTION_WINDOW).filter(
  (id) => !DEMOTED_IN_WINDOW.includes(id),
);

describe('a topic search over a pool holding service cores (#5748)', () => {
  it('places the cores and the service-text faculty row below the research rows of the window', async () => {
    const served = servedIdsOf(await searchTopic());

    expect(served.slice(0, researchInWindow.length)).toEqual(researchInWindow);
    expect(served.slice(researchInWindow.length, SERVICE_CORE_DEMOTION_WINDOW)).toEqual(
      DEMOTED_IN_WINDOW,
    );
    expect(served.slice(SERVICE_CORE_DEMOTION_WINDOW)).toEqual(
      ROW_IDS.slice(SERVICE_CORE_DEMOTION_WINDOW),
    );
    expect(mocks.researchEntityFind).toHaveBeenCalledTimes(1);
  });

  it('reorders only: the total and the facet counts are the undemoted search', async () => {
    const demoted = await searchTopic();
    withoutDemotionReads();
    const undemoted = await searchTopic();

    expect(servedIdsOf(undemoted)).toEqual(ROW_IDS);
    expect(new Set(servedIdsOf(demoted))).toEqual(new Set(servedIdsOf(undemoted)));
    expect(demoted.estimatedTotalHits).toBe(undemoted.estimatedTotalHits);
    expect(demoted.facetDistribution).toEqual(undemoted.facetDistribution);
    expect(demoted.facetDistribution?.entityType).toMatchObject({ CORE_FACILITY: 3 });
  });

  it('loads the window and the requested page in one read and serves only the page', async () => {
    const result = await searchTopic('coastal ecology', {}, 4, 10);

    expect(mocks.researchEntityFind).toHaveBeenCalledTimes(1);
    const loaded = mocks.researchEntityFind.mock.calls[0][0]._id.$in;
    expect(new Set(loaded)).toEqual(
      new Set([...ROW_IDS.slice(0, SERVICE_CORE_DEMOTION_WINDOW), ...ROW_IDS.slice(30, 40)]),
    );
    expect(servedIdsOf(result)).toEqual(ROW_IDS.slice(30, 40));
    const rosterReadIds = JSON.stringify(mocks.emptyFind.mock.calls);
    expect(rosterReadIds).toContain(ROW_IDS[30]);
    expect(ROW_IDS.slice(0, 30).filter((id) => rosterReadIds.includes(id))).toEqual([]);
  });

  it('serves the same order page by page', async () => {
    const whole = servedIdsOf(await searchTopic());
    const pages = [];
    for (const page of [1, 2, 3, 4]) {
      pages.push(...servedIdsOf(await searchTopic('coastal ecology', {}, page, 10)));
    }
    expect(pages).toEqual(whole);
  });

  it('keeps a core whose title the query names', async () => {
    const served = servedIdsOf(await searchTopic('stac'));
    expect(served[0]).toBe(CORE_ROW);
    expect(served.indexOf(SECOND_CORE_ROW)).toBe(SERVICE_CORE_DEMOTION_WINDOW - 2);
  });

  it('leaves a name search in the keyword order', async () => {
    nameQueryTopHit = true;
    const served = servedIdsOf(await searchTopic(SYNTHETIC_SURNAME.toLowerCase()));
    expect(served).toEqual(ROW_IDS);
  });

  it('leaves the order alone when the Type filter selects cores', async () => {
    const served = servedIdsOf(
      await searchTopic('coastal ecology', { entityType: ['CORE_FACILITY', 'LAB'] }),
    );
    expect(served.slice(0, 4)).toEqual(ROW_IDS.slice(0, 4));
  });

  it('still demotes under a Type filter that does not select cores', async () => {
    const served = servedIdsOf(
      await searchTopic('coastal ecology', { entityType: ['LAB', 'FACULTY_RESEARCH_AREA'] }),
    );
    expect(served).not.toContain(CORE_ROW);
    expect(served.indexOf(SERVICE_TEXT_ROW)).toBe(SERVICE_CORE_DEMOTION_WINDOW - 1);
  });

  it('cannot be undone by a cached rerank score that lifts a core', async () => {
    mocks.rerankFindOne.mockImplementation(() =>
      queryResult({
        scores: [
          { entityId: SECOND_CORE_ROW, score: 3 },
          { entityId: rowId(12), score: 3 },
        ],
      }),
    );
    vi.stubEnv('SEARCH_RERANK_CACHE_ENABLED', 'true');

    const served = servedIdsOf(await searchTopic());

    expect(served[0]).toBe(rowId(12));
    expect(served.indexOf(SECOND_CORE_ROW)).toBeGreaterThanOrEqual(researchInWindow.length);
    expect(mocks.rerankFindOne).toHaveBeenCalled();
  });

  it('serves the rerank-candidate read in the undemoted order the cache reorders', async () => {
    const candidates = await searchResearchGroupsForRerankCandidates('coastal ecology', {}, 30);
    expect(candidates.researchEntities.slice(0, 4).map((entity) => entity.slug)).toEqual(
      ROW_IDS.slice(0, 4).map(slugOf),
    );
  });

  it('demotes by the stored type, not the indexed one', async () => {
    withoutDemotionReads();
    expect(servedIdsOf(await searchTopic())).toEqual(ROW_IDS);
  });
});
