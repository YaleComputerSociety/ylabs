import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A search whose optional companion query fails is served as degraded, which may
 * lower recall but must never serve a row the student's filters exclude, and its
 * total must count the filtered pool rather than the unfiltered one.
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
vi.mock('../researchSearchQueryEmbedding', () => ({
  getResearchSearchQueryVector: mocks.getResearchSearchQueryVector,
}));

import { searchResearchGroupsViaMeili } from '../researchGroupService';
import { invalidateResearchEntitySearchEmbedderCache } from '../researchEntitySearchIndexService';
import { resetMeiliAvailability } from '../../utils/meiliAvailability';

const queryResult = <T>(value: T) => {
  const query: any = { lean: async () => value };
  query.sort = () => query;
  query.limit = () => query;
  query.select = () => query;
  return query;
};

type Row = { id: string; departments: string[]; hosted: boolean };

const ROWS: Row[] = [
  { id: '67d8928150621bcef434a101', departments: ['Public Health'], hosted: true },
  { id: '67d8928150621bcef434a102', departments: ['Computer Science'], hosted: true },
  { id: '67d8928150621bcef434a103', departments: ['Marketing'], hosted: false },
  { id: '67d8928150621bcef434a104', departments: ['Computer Science'], hosted: false },
  { id: '67d8928150621bcef434a105', departments: ['Radiology'], hosted: true },
  { id: '67d8928150621bcef434a106', departments: ['Computer Science'], hosted: true },
];
const slugOf = (id: string) => `synthetic-row-${id.slice(-3)}`;
const MATCHING_SLUGS = ['67d8928150621bcef434a102', '67d8928150621bcef434a106'].map(slugOf);
const FILTERS = { departments: ['Computer Science'], hostsUndergrads: true };

const indexHit = (row: Row, position: number) => ({
  id: row.id,
  kind: 'lab',
  entityType: 'lab',
  schools: ['Yale College'],
  departments: row.departments,
  researchAreas: ['Machine Learning'],
  hasUndergradHostingEvidence: row.hosted,
  _rankingScore: 0.9 - position * 0.01,
  _rankingScoreDetails: {
    words: { order: 0, matchingWords: 2, maxMatchingWords: 2, score: 1 },
    typo: { order: 1, typoCount: 0, maxTypoCount: 0, score: 1 },
    vectorSort: { similarity: 0.9 - position * 0.01 },
  },
});

const rowsAdmittedBy = (filter: unknown): Row[] => {
  const text = String(filter ?? '');
  return ROWS.filter((row) => {
    const departmentClause = text.match(/departments = "([^"]+)"/);
    if (departmentClause && !row.departments.includes(departmentClause[1])) return false;
    if (text.includes('hasUndergradHostingEvidence = true') && !row.hosted) return false;
    return true;
  });
};

type Leg = 'semantic' | 'keyword' | 'keywordTopHit' | 'disjunctiveFacet';

const legOf = (params: Record<string, any>): Leg | 'primary' => {
  if (params.hybrid?.semanticRatio === 1) return 'semantic';
  if (params.showMatchesPosition) return 'keywordTopHit';
  if (params.limit === 0 && params.facets) return 'disjunctiveFacet';
  if (!params.hybrid && params.showRankingScoreDetails && params.attributesToRetrieve) {
    return 'keyword';
  }
  return 'primary';
};

const unreachable = () =>
  Object.assign(new Error('Request to the search index has failed'), {
    name: 'MeilisearchRequestError',
  });

const serveIndexFailing = (failingLeg: Leg | null) => {
  mocks.search.mockImplementation(async (_query: string, params: Record<string, any> = {}) => {
    const leg = legOf(params);
    if (leg === failingLeg) throw unreachable();
    const admitted = rowsAdmittedBy(params.filter);
    const hits = admitted.map(indexHit);
    if (leg === 'disjunctiveFacet') {
      return { hits: [], facetDistribution: { departments: { 'Computer Science': 3 } } };
    }
    return {
      hits: params.hitsPerPage === 1 ? hits.slice(0, 1) : hits,
      estimatedTotalHits: hits.length,
      totalHits: hits.length,
      facetDistribution: {},
    };
  });
};

const entityFor = (row: Row) => ({
  _id: row.id,
  slug: slugOf(row.id),
  name: `Synthetic Row ${row.id.slice(-3)}`,
  kind: 'lab',
  departments: row.departments,
  researchAreas: ['Machine Learning'],
  sourceUrls: [],
  shortDescription:
    'Studies molecular dynamics, protein folding, and cellular signaling in biological systems.',
  fullDescription:
    'This research studies molecular dynamics, protein folding, and cellular signaling across complex biological systems.',
});

beforeEach(() => {
  resetMeiliAvailability();
  invalidateResearchEntitySearchEmbedderCache();
  mocks.search.mockReset();
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
    const ids = new Set((query?._id?.$in ?? []).map(String));
    return queryResult(ROWS.filter((row) => ids.has(row.id)).map(entityFor));
  });
});

const servedSlugs = (result: { researchEntities: Array<{ slug?: unknown }> }) =>
  result.researchEntities.map((entity) => String(entity.slug));

describe('a filtered topic search', () => {
  it('serves only the filtered rows when every leg answers', async () => {
    serveIndexFailing(null);

    const result = await searchResearchGroupsViaMeili('machine learning', FILTERS, 1, 24);

    expect(servedSlugs(result).sort()).toEqual(MATCHING_SLUGS);
    expect(result.estimatedTotalHits).toBe(MATCHING_SLUGS.length);
    expect(result.degraded).toBeFalsy();
  });

  it.each(['semantic', 'keyword', 'keywordTopHit'] as const)(
    'keeps every served row inside the filters when the %s leg fails',
    async (failingLeg) => {
      serveIndexFailing(failingLeg);

      const result = await searchResearchGroupsViaMeili('machine learning', FILTERS, 1, 24);

      expect(mocks.search.mock.calls.some(([, params]) => legOf(params) === failingLeg)).toBe(true);
      expect(servedSlugs(result).length).toBeGreaterThan(0);
      servedSlugs(result).forEach((id) => expect(MATCHING_SLUGS).toContain(id));
      expect(result.estimatedTotalHits).toBeLessThanOrEqual(MATCHING_SLUGS.length);
      expect(result.degraded).toBe(true);
    },
  );
});

describe('a filtered browse', () => {
  it('keeps every served row inside the filters when the disjunctive facet query fails', async () => {
    serveIndexFailing('disjunctiveFacet');

    const result = await searchResearchGroupsViaMeili('', FILTERS, 1, 24);

    expect(mocks.search.mock.calls.some(([, params]) => legOf(params) === 'disjunctiveFacet')).toBe(
      true,
    );
    expect(servedSlugs(result).sort()).toEqual(MATCHING_SLUGS);
    expect(result.estimatedTotalHits).toBe(MATCHING_SLUGS.length);
    expect(result.degraded).toBe(true);
  });
});
