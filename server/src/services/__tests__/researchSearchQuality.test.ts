import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RESEARCH_SEARCH_QUALITY_CASES } from './researchSearchQualityCases';
import { searchResearchGroupsViaMeili } from '../researchGroupService';

const mocks = vi.hoisted(() => ({
  getMeiliIndex: vi.fn(),
  listAccessSummariesForResearchEntities: vi.fn(),
  listWaysInForResearchEntities: vi.fn(),
  researchEntityFind: vi.fn(),
  researchGroupMemberFind: vi.fn(),
  userFind: vi.fn(),
}));

vi.mock('../../utils/meiliClient', () => ({
  getMeiliIndex: mocks.getMeiliIndex,
}));

vi.mock('../accessSummaryService', () => ({
  getAccessSummaryForResearchEntity: vi.fn(),
  listAccessSummariesForResearchEntities: mocks.listAccessSummariesForResearchEntities,
}));

vi.mock('../pathwaySearchService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pathwaySearchService')>();
  return {
    ...actual,
    listWaysInForResearchEntities: mocks.listWaysInForResearchEntities,
  };
});

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: {
    find: mocks.researchEntityFind,
  },
}));

vi.mock('../../models/researchGroupMember', () => ({
  ResearchGroupMember: {
    find: mocks.researchGroupMemberFind,
  },
}));

vi.mock('../../models/user', () => ({
  User: {
    find: mocks.userFind,
  },
}));

beforeEach(() => {
  mocks.getMeiliIndex.mockReset();
  mocks.listAccessSummariesForResearchEntities.mockReset();
  mocks.listWaysInForResearchEntities.mockReset();
  mocks.researchEntityFind.mockReset();
  mocks.researchGroupMemberFind.mockReset();
  mocks.userFind.mockReset();
  mocks.listAccessSummariesForResearchEntities.mockResolvedValue(new Map());
  mocks.listWaysInForResearchEntities.mockResolvedValue(new Map());
  mocks.researchGroupMemberFind.mockReturnValue({
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue([]),
    }),
  });
  mocks.userFind.mockReturnValue({
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue([]),
    }),
  });
});

describe('research search quality guardrail', () => {
  it.each(RESEARCH_SEARCH_QUALITY_CASES)('does not give up on "$query"', async ({ query }) => {
    const activeEntity = {
      _id: '67d8928150621bcef434a1d5',
      id: '67d8928150621bcef434a1d5',
      name: `${query} Research Home`,
      description: `A profile connected to ${query}.`,
      researchAreas: [query],
      departments: ['Fixture Research'],
      sourceUrls: ['https://example.edu/research-home'],
    };
    const index = {
      search: vi.fn(async (searchQuery: string) => ({
        hits:
          searchQuery === query
            ? []
            : [activeEntity],
        estimatedTotalHits: 1,
      })),
    };

    mocks.getMeiliIndex.mockResolvedValue(index);
    mocks.researchEntityFind.mockReturnValue({
      lean: vi.fn().mockResolvedValue([activeEntity]),
    });

    const result = await searchResearchGroupsViaMeili(query, {}, 1, 5);

    const firstResult = result.researchEntities[0] as any;
    expect(result.researchEntities.length).toBeGreaterThan(0);
    expect(firstResult.searchMatch?.reason).toBeTruthy();
  });

  it('uses all-token matching for the original keyword query before broad fallbacks', async () => {
    const index = {
      search: vi.fn(async () => ({
        hits: [],
        estimatedTotalHits: 0,
      })),
    };

    mocks.getMeiliIndex.mockResolvedValue(index);
    mocks.researchEntityFind.mockReturnValue({
      lean: vi.fn().mockResolvedValue([]),
    });

    await searchResearchGroupsViaMeili('black scholes', {}, 1, 5);

    expect(index.search).toHaveBeenCalledWith(
      'black scholes',
      expect.objectContaining({
        matchingStrategy: 'all',
        showRankingScore: true,
        showRankingScoreDetails: true,
      }),
    );
  });
});
