import { beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  getEmbedders: vi.fn(),
  listingDistinct: vi.fn(),
  listingFind: vi.fn(),
  researchEntityFindOne: vi.fn(),
  researchEntityFind: vi.fn(),
  researchEntityRelationshipFind: vi.fn(),
  roleAssignmentFind: vi.fn(),
  personFind: vi.fn(),
  accountFind: vi.fn(),
  userFind: vi.fn(),
  researchScholarlyAttributionFind: vi.fn(),
  researchScholarlyLinkFind: vi.fn(),
  entryPathwayFind: vi.fn(),
  accessSignalFind: vi.fn(),
  contactRouteFind: vi.fn(),
  postedOpportunityFind: vi.fn(),
  getAccessSummaryForResearchEntity: vi.fn(),
  listAccessSummariesForResearchEntities: vi.fn(),
  listPlanningContextsForResearchEntities: vi.fn(),
  getPublicUndergraduateLogistics: vi.fn(),
}));

vi.mock('../../utils/meiliClient', () => ({
  getMeiliIndex: vi.fn(async () => ({
    search: mocks.search,
    getEmbedders: mocks.getEmbedders,
  })),
}));

vi.mock('../../models/listing', () => ({
  Listing: {
    distinct: mocks.listingDistinct,
    find: mocks.listingFind,
  },
}));

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: {
    findOne: mocks.researchEntityFindOne,
    find: mocks.researchEntityFind,
  },
}));

vi.mock('../../models/researchEntityRelationship', () => ({
  ResearchEntityRelationship: {
    find: mocks.researchEntityRelationshipFind,
  },
}));

vi.mock('../../models/roleAssignment', () => ({
  RoleAssignment: {
    find: mocks.roleAssignmentFind,
  },
}));

vi.mock('../../models/researcher', () => ({
  Researcher: {
    find: mocks.personFind,
  },
}));

vi.mock('../../models/account', () => ({
  Account: {
    find: mocks.accountFind,
  },
}));

vi.mock('../../models/user', () => ({
  User: {
    find: mocks.userFind,
  },
}));

vi.mock('../../models/researchScholarlyAttribution', () => ({
  ResearchScholarlyAttribution: {
    find: mocks.researchScholarlyAttributionFind,
  },
}));

vi.mock('../../models/researchScholarlyLink', () => ({
  ResearchScholarlyLink: {
    find: mocks.researchScholarlyLinkFind,
  },
}));

vi.mock('../../models/signal', () => ({
  Signal: {
    find: mocks.accessSignalFind,
  },
}));

vi.mock('../accessSummaryService', () => ({
  getAccessSummaryForResearchEntity: mocks.getAccessSummaryForResearchEntity,
  listAccessSummariesForResearchEntities: mocks.listAccessSummariesForResearchEntities,
}));

vi.mock('../planningContextService', () => ({
  listPlanningContextsForResearchEntities: mocks.listPlanningContextsForResearchEntities,
}));

vi.mock('../undergraduateLogisticsService', () => ({
  getPublicUndergraduateLogistics: mocks.getPublicUndergraduateLogistics,
  unavailablePublicUndergraduateLogistics: () => ({ status: 'unavailable', claims: [] }),
}));

import {
  buildResearchActivityLinkPayload,
  currentResearchEntityMemberFilter,
  dedupeSameNameLeadMembers,
  dropCoincidentalTypoOnlyHits,
  dropUncorroboratedPhantomLeads,
  getResearchGroupDetail,
  listResearchEntityRelationshipPayload,
  normalizeResearchSearchQuery,
  promoteExactAliasFieldMatches,
  normalizeResearchGroupObjectId,
  isFreshVerifiedOfficialRosterRow,
  publicRosterDisclosure,
  researchDetailLeadIdentity,
  resolveArchivedResearchEntityCanonicalSlug,
  searchResearchGroupsViaMeili,
  HYBRID_CANDIDATE_POOL_SIZE,
} from '../researchGroupService';
import {
  invalidateResearchEntitySearchEmbedderCache,
  RESEARCH_ENTITY_SEARCH_MAX_TOTAL_HITS,
} from '../researchEntitySearchIndexService';

// One fully chainable query double: the service composes find().sort().limit()
// .select().lean() in different orders per call site, so every helper returns
// the same permissive chain to survive query-shape refactors.
const queryResult = <T>(value: T) => {
  const query: any = {
    lean: async () => value,
  };
  query.sort = () => query;
  query.limit = () => query;
  query.select = () => query;
  return query;
};

const leanResult = <T>(value: T) => queryResult(value);

const sortLeanResult = <T>(value: T) => queryResult(value);

const sortLimitLeanResult = <T>(value: T) => queryResult(value);

const selectSortLimitLeanResult = <T>(value: T) => queryResult(value);

const validPublicDescriptions = {
  shortDescription:
    'Studies molecular dynamics, protein folding, and cellular signaling in biological systems.',
  fullDescription:
    'This research studies molecular dynamics, protein folding, and cellular signaling across complex biological systems.',
};

beforeEach(() => {
  invalidateResearchEntitySearchEmbedderCache();
  mocks.search.mockReset();
  mocks.getEmbedders.mockReset();
  mocks.getEmbedders.mockResolvedValue({ default: { source: 'openAi' } });
  mocks.listingDistinct.mockReset();
  mocks.listingFind.mockReset();
  mocks.researchEntityFindOne.mockReset();
  mocks.researchEntityFind.mockReset();
  mocks.listAccessSummariesForResearchEntities.mockReset();
  mocks.listPlanningContextsForResearchEntities.mockReset();
  mocks.getPublicUndergraduateLogistics.mockReset();
  mocks.researchEntityRelationshipFind.mockReset();
  mocks.roleAssignmentFind.mockReset();
  mocks.personFind.mockReset();
  mocks.accountFind.mockReset();
  mocks.userFind.mockReset();
  mocks.researchScholarlyAttributionFind.mockReset();
  mocks.researchScholarlyLinkFind.mockReset();
  mocks.entryPathwayFind.mockReset();
  mocks.accessSignalFind.mockReset();
  mocks.contactRouteFind.mockReset();
  mocks.postedOpportunityFind.mockReset();
  mocks.getAccessSummaryForResearchEntity.mockReset();
  mocks.listingDistinct.mockResolvedValue([]);
  mocks.listingFind.mockReturnValue(queryResult([]));
  mocks.researchEntityFind.mockReturnValue(queryResult([]));
  mocks.researchEntityRelationshipFind.mockReturnValue(queryResult([]));
  mocks.roleAssignmentFind.mockReturnValue(queryResult([]));
  mocks.personFind.mockReturnValue(queryResult([]));
  mocks.accountFind.mockReturnValue(queryResult([]));
  mocks.userFind.mockReturnValue(leanResult([]));
  mocks.researchScholarlyAttributionFind.mockReturnValue(selectSortLimitLeanResult([]));
  mocks.researchScholarlyLinkFind.mockReturnValue(sortLimitLeanResult([]));
  mocks.entryPathwayFind.mockReturnValue(queryResult([]));
  mocks.accessSignalFind.mockReturnValue(queryResult([]));
  mocks.contactRouteFind.mockReturnValue(queryResult([]));
  mocks.postedOpportunityFind.mockReturnValue(queryResult([]));
  mocks.getAccessSummaryForResearchEntity.mockResolvedValue(undefined);
  mocks.listAccessSummariesForResearchEntities.mockResolvedValue(new Map());
  mocks.listPlanningContextsForResearchEntities.mockResolvedValue(new Map());
  mocks.getPublicUndergraduateLogistics.mockResolvedValue({ status: 'ready', claims: [] });
});

describe('searchResearchGroupsViaMeili', () => {
  it('normalizes noisy student research queries before Meili search', () => {
    expect(normalizeResearchSearchQuery(' Professor Zhong ')).toMatchObject({
      query: 'zhong',
      tokens: ['zhong'],
      isTopicAliasQuery: false,
    });
    expect(normalizeResearchSearchQuery('computer vision for medical imaging')).toMatchObject({
      query: 'computer vision medical imaging',
      tokens: ['computer', 'vision', 'medical', 'imaging'],
      isTopicAliasQuery: false,
    });
  });

  it('strips question and course-topic filler so the topical terms drive ranking', () => {
    expect(normalizeResearchSearchQuery('labs studying black holes')).toMatchObject({
      query: 'black holes',
      tokens: ['black', 'holes'],
      isTopicAliasQuery: false,
    });
    expect(
      normalizeResearchSearchQuery('where can I study machine learning for medicine'),
    ).toMatchObject({
      query: 'machine learning medicine',
      tokens: ['machine', 'learning', 'medicine'],
      isTopicAliasQuery: false,
    });
    expect(normalizeResearchSearchQuery('how do neurons communicate')).toMatchObject({
      query: 'neurons communicate',
      tokens: ['neurons', 'communicate'],
      isTopicAliasQuery: false,
    });
  });

  it('keeps field-name and topic tokens that collide with filler words', () => {
    expect(normalizeResearchSearchQuery('american studies')).toMatchObject({
      query: 'american studies',
      tokens: ['american', 'studies'],
      isTopicAliasQuery: false,
    });
    expect(normalizeResearchSearchQuery('environmental studies')).toMatchObject({
      query: 'environmental studies',
      tokens: ['environmental', 'studies'],
      isTopicAliasQuery: false,
    });
    expect(normalizeResearchSearchQuery('group theory')).toMatchObject({
      query: 'group theory',
      tokens: ['group', 'theory'],
      isTopicAliasQuery: false,
    });
  });

  it('keeps an all-filler query non-empty by preserving its original tokens', () => {
    expect(normalizeResearchSearchQuery('how do i')).toMatchObject({
      query: 'how do i',
      tokens: ['how', 'do', 'i'],
    });
  });

  it('resolves single-token department shorthand to its topic-scoped field name', () => {
    expect(normalizeResearchSearchQuery('CS')).toMatchObject({
      query: 'computer science',
      tokens: ['cs'],
      isTopicAliasQuery: true,
      aliasTerms: ['computer science'],
    });
    expect(normalizeResearchSearchQuery('econ')).toMatchObject({
      query: 'economics',
      tokens: ['econ'],
      isTopicAliasQuery: true,
    });
  });

  it('resolves multi-token department abbreviations to the full field name', () => {
    expect(normalizeResearchSearchQuery('comp sci')).toMatchObject({
      query: 'computer science',
      tokens: ['comp', 'sci'],
      isTopicAliasQuery: true,
    });
    expect(normalizeResearchSearchQuery('poli sci')).toMatchObject({
      query: 'political science',
      tokens: ['poli', 'sci'],
      isTopicAliasQuery: true,
    });
    expect(normalizeResearchSearchQuery('polisci')).toMatchObject({
      query: 'political science',
      tokens: ['polisci'],
      isTopicAliasQuery: true,
    });
  });

  it('resolves canonical Yale department abbreviations to their full department name (#928)', () => {
    expect(normalizeResearchSearchQuery('EEB')).toMatchObject({
      query: 'ecology and evolutionary biology',
      tokens: ['eeb'],
      isTopicAliasQuery: true,
      aliasTerms: ['ecology and evolutionary biology'],
    });
    expect(normalizeResearchSearchQuery('MCDB')).toMatchObject({
      query: 'molecular cellular and developmental biology',
      tokens: ['mcdb'],
      isTopicAliasQuery: true,
    });
    expect(normalizeResearchSearchQuery('mbb')).toMatchObject({
      query: 'molecular biophysics and biochemistry',
      tokens: ['mbb'],
      isTopicAliasQuery: true,
    });
    expect(normalizeResearchSearchQuery('eall')).toMatchObject({
      query: 'east asian languages and literatures',
      tokens: ['eall'],
      isTopicAliasQuery: true,
    });
    expect(normalizeResearchSearchQuery('nelc')).toMatchObject({
      query: 'near eastern languages and civilizations',
      tokens: ['nelc'],
      isTopicAliasQuery: true,
    });
    expect(normalizeResearchSearchQuery('wgss')).toMatchObject({
      query: 'women gender and sexuality studies',
      tokens: ['wgss'],
      isTopicAliasQuery: true,
    });
  });

  it('topic-scopes department shorthand even when paired with a filler word', () => {
    expect(normalizeResearchSearchQuery('cs labs')).toMatchObject({
      query: 'computer science',
      tokens: ['cs'],
      isTopicAliasQuery: true,
    });
  });

  it('preserves the AI short-alias expansion and marks it a topic-alias query', () => {
    expect(normalizeResearchSearchQuery('AI')).toMatchObject({
      query: 'artificial intelligence machine learning deep learning ai',
      tokens: ['ai'],
      isTopicAliasQuery: true,
    });
  });

  it('does not topic-scope a department shorthand buried in a longer phrase', () => {
    expect(normalizeResearchSearchQuery('cs for medicine')).toMatchObject({
      tokens: ['cs', 'medicine'],
      isTopicAliasQuery: false,
      aliasTerms: null,
    });
  });

  it('promoteExactAliasFieldMatches tiers exact department, then exact area, above the rest (#983)', () => {
    const hits = [
      { slug: 'fuzzy-only', departments: ['Computer Science'], researchAreas: ['behavioral research'] },
      { slug: 'area-match', departments: ['Economics'], researchAreas: ['Social Psychology', 'Psychology'] },
      { slug: 'dept-match', departments: ['Psychology'], researchAreas: ['Positive Psychology'] },
    ];
    expect(
      promoteExactAliasFieldMatches(hits, ['psychology', 'psychiatry', 'psych']).map((h) => h.slug),
    ).toEqual(['dept-match', 'area-match', 'fuzzy-only']);
  });

  it('promoteExactAliasFieldMatches is a stable no-op without alias terms or exact matches', () => {
    const hits = [
      { slug: 'a', departments: ['Sociology'], researchAreas: ['marketing'] },
      { slug: 'b', departments: ['History'], researchAreas: ['medieval studies'] },
    ];
    expect(promoteExactAliasFieldMatches(hits, null)).toBe(hits);
    expect(promoteExactAliasFieldMatches(hits, ['psychology']).map((h) => h.slug)).toEqual([
      'a',
      'b',
    ]);
    expect(promoteExactAliasFieldMatches([hits[0]], ['sociology'])).toEqual([hits[0]]);
  });

  it('normalizes research group ObjectIds without arbitrary object coercion', () => {
    const entityId = '67d8928150621bcef434a1d5';

    expect(normalizeResearchGroupObjectId(entityId)).toBe(entityId);
    expect(
      normalizeResearchGroupObjectId({
        toString: () => {
          throw new Error('research group service stringified arbitrary id');
        },
      }),
    ).toBeUndefined();
  });

  it('never requests hybrid search when no embedder is configured on the live index', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    mocks.getEmbedders.mockResolvedValue({});
    mocks.search.mockResolvedValueOnce({
      hits: [
        {
          id: entityId,
          slug: 'reilly-lab',
          name: 'Reilly Lab',
          kind: 'lab',
          departments: ['Chemistry'],
          researchAreas: [],
          sourceUrls: [],
        },
      ],
      estimatedTotalHits: 1,
    });
    mocks.researchEntityFind.mockReturnValue(
      queryResult([
        {
          _id: entityId,
          slug: 'reilly-lab',
          name: 'Reilly Lab',
          kind: 'lab',
          departments: ['Chemistry'],
          researchAreas: [],
          sourceUrls: [],
          ...validPublicDescriptions,
        },
      ]),
    );

    const result = await searchResearchGroupsViaMeili('reilly', {}, 1, 1);

    expect(mocks.search).toHaveBeenCalledTimes(1);
    expect(mocks.search).toHaveBeenCalledWith(
      'reilly',
      expect.not.objectContaining({ hybrid: expect.anything() }),
    );
    expect(result).toMatchObject({
      estimatedTotalHits: 1,
      page: 1,
      pageSize: 1,
      degraded: false,
      researchEntities: [{ _id: 'reilly-lab', slug: 'reilly-lab', name: 'Reilly Lab' }],
    });
  });

  it('requests hybrid search when the live index reports a configured embedder', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    mocks.getEmbedders.mockResolvedValue({ default: { source: 'openAi' } });
    mocks.search
      .mockResolvedValueOnce({
        hits: [
          {
            id: entityId,
            slug: 'reilly-lab',
            name: 'Reilly Lab',
            kind: 'lab',
            departments: ['Chemistry'],
            researchAreas: [],
            sourceUrls: [],
          },
        ],
        estimatedTotalHits: 1,
        totalHits: 1,
      })
      .mockResolvedValueOnce({ hits: [], totalHits: 1 });
    mocks.researchEntityFind.mockReturnValue(
      queryResult([
        {
          _id: entityId,
          slug: 'reilly-lab',
          name: 'Reilly Lab',
          kind: 'lab',
          departments: ['Chemistry'],
          researchAreas: [],
          sourceUrls: [],
          ...validPublicDescriptions,
        },
      ]),
    );

    const result = await searchResearchGroupsViaMeili('reilly', {}, 1, 1);

    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(mocks.search).toHaveBeenNthCalledWith(
      1,
      'reilly',
      expect.objectContaining({
        hybrid: { semanticRatio: 0.8, embedder: 'default' },
      }),
    );
    expect(mocks.search).toHaveBeenNthCalledWith(
      2,
      'reilly',
      expect.objectContaining({
        hybrid: { semanticRatio: 0.8, embedder: 'default' },
        page: 1,
        hitsPerPage: RESEARCH_ENTITY_SEARCH_MAX_TOTAL_HITS,
      }),
    );
    expect(result.degraded).toBe(false);
  });

  it('floors a weak semantic-only hit beneath a near-perfect keyword hit for a name query (#929)', async () => {
    const semanticOnlyId = '67d8928150621bcef434a1d5';
    const keywordExactId = '67d8928150621bcef434a1e6';
    mocks.getEmbedders.mockResolvedValue({ default: { source: 'openAi' } });
    mocks.search.mockResolvedValueOnce({
      hits: [
        {
          id: semanticOnlyId,
          slug: 'emily-erikson-research',
          name: 'Emily Erikson - Research',
          kind: 'lab',
          departments: ['Sociology'],
          researchAreas: [],
          sourceUrls: [],
          _rankingScoreDetails: { vectorSort: { similarity: 0.2715 } },
        },
        {
          id: keywordExactId,
          slug: 'erika-edwards-lab',
          name: 'Erika Edwards Lab',
          kind: 'lab',
          departments: ['Ecology & Evolutionary Biology'],
          researchAreas: [],
          sourceUrls: [],
          _rankingScoreDetails: {
            words: { matchingWords: 2, maxMatchingWords: 2, score: 1 },
            exactness: { score: 1 },
          },
        },
      ],
      estimatedTotalHits: 2,
    });
    mocks.researchEntityFind.mockReturnValue(
      queryResult([
        {
          _id: semanticOnlyId,
          slug: 'emily-erikson-research',
          name: 'Emily Erikson - Research',
          kind: 'lab',
          departments: ['Sociology'],
          researchAreas: [],
          sourceUrls: [],
          ...validPublicDescriptions,
        },
        {
          _id: keywordExactId,
          slug: 'erika-edwards-lab',
          name: 'Erika Edwards Lab',
          kind: 'lab',
          departments: ['Ecology & Evolutionary Biology'],
          researchAreas: [],
          sourceUrls: [],
          ...validPublicDescriptions,
        },
      ]),
    );

    const result = await searchResearchGroupsViaMeili('erika edwards', {}, 1, 24);

    expect(mocks.search).toHaveBeenCalledWith(
      'erika edwards',
      expect.objectContaining({
        hybrid: { semanticRatio: 0.8, embedder: 'default' },
        showRankingScoreDetails: true,
      }),
    );
    expect(result.researchEntities.map((entity: any) => entity.slug)).toEqual([
      'erika-edwards-lab',
      'emily-erikson-research',
    ]);
  });

  it('leaves pure-semantic hybrid ordering untouched when no keyword hit exists (#929)', async () => {
    const firstId = '67d8928150621bcef434a1f7';
    const secondId = '67d8928150621bcef434a208';
    mocks.getEmbedders.mockResolvedValue({ default: { source: 'openAi' } });
    mocks.search.mockResolvedValueOnce({
      hits: [
        {
          id: firstId,
          slug: 'weak-semantic-first',
          name: 'Weak Semantic First',
          kind: 'lab',
          departments: ['Sociology'],
          researchAreas: [],
          sourceUrls: [],
          _rankingScoreDetails: { vectorSort: { similarity: 0.31 } },
        },
        {
          id: secondId,
          slug: 'weaker-semantic-second',
          name: 'Weaker Semantic Second',
          kind: 'lab',
          departments: ['Sociology'],
          researchAreas: [],
          sourceUrls: [],
          _rankingScoreDetails: { vectorSort: { similarity: 0.22 } },
        },
      ],
      estimatedTotalHits: 2,
    });
    mocks.researchEntityFind.mockReturnValue(
      queryResult([
        {
          _id: firstId,
          slug: 'weak-semantic-first',
          name: 'Weak Semantic First',
          kind: 'lab',
          departments: ['Sociology'],
          researchAreas: [],
          sourceUrls: [],
          ...validPublicDescriptions,
        },
        {
          _id: secondId,
          slug: 'weaker-semantic-second',
          name: 'Weaker Semantic Second',
          kind: 'lab',
          departments: ['Sociology'],
          researchAreas: [],
          sourceUrls: [],
          ...validPublicDescriptions,
        },
      ]),
    );

    const result = await searchResearchGroupsViaMeili('some broad topic', {}, 1, 24);

    expect(result.researchEntities.map((entity: any) => entity.slug)).toEqual([
      'weak-semantic-first',
      'weaker-semantic-second',
    ]);
  });

  it('promotes the exact-department alias match above tangential fuzzy hits for `psych` (#983)', async () => {
    const adrianaId = '67d8928150621bcef434b001';
    const jamieId = '67d8928150621bcef434b002';
    const volkmarId = '67d8928150621bcef434b003';
    const laurieId = '67d8928150621bcef434b004';
    const sambanisId = '67d8928150621bcef434b005';
    const meiliOrder = [
      {
        id: adrianaId,
        slug: 'adriana-germano-research',
        name: 'Adriana Germano Faculty Research',
        kind: 'lab',
        departments: ['Economics'],
        researchAreas: ['Organizational Behavior', 'Economics', 'Social Psychology', 'Psychology'],
        sourceUrls: [],
      },
      {
        id: jamieId,
        slug: 'jamie-tucker-foltz-research',
        name: 'Jamie Tucker-Foltz Faculty Research',
        kind: 'lab',
        departments: ['Computer Science'],
        researchAreas: ['behavioral research', 'marketing', 'organizational behavior'],
        sourceUrls: [],
      },
      {
        id: volkmarId,
        slug: 'volkmar-lab',
        name: 'Volkmar Lab',
        kind: 'lab',
        departments: ['Child Study Center'],
        researchAreas: ['Autism Spectrum Disorder Research', 'Genetics and Neurodevelopmental Disorders'],
        sourceUrls: [],
      },
      {
        id: laurieId,
        slug: 'laurie-santos-research',
        name: 'Laurie Santos Faculty Research',
        kind: 'lab',
        departments: ['Psychology'],
        researchAreas: ['Positive Psychology', 'Subjective Well-Being', 'Psychology'],
        sourceUrls: [],
      },
      {
        id: sambanisId,
        slug: 'nicholas-sambanis-research',
        name: 'Nicholas Sambanis Faculty Research',
        kind: 'lab',
        departments: ['Political Science'],
        researchAreas: ['Political Science', 'Social Psychology', 'Psychology'],
        sourceUrls: [],
      },
    ];
    mocks.search.mockResolvedValueOnce({ hits: meiliOrder, estimatedTotalHits: meiliOrder.length });
    mocks.researchEntityFind.mockReturnValue(
      queryResult(
        meiliOrder.map((hit) => ({ ...hit, _id: hit.id, ...validPublicDescriptions })),
      ),
    );

    const result = await searchResearchGroupsViaMeili('psych', {}, 1, 24);

    expect(mocks.search).toHaveBeenCalledWith(
      'psychology psychiatry cognitive science behavioral science psych',
      expect.objectContaining({
        attributesToSearchOn: ['studentSearchTerms', 'researchAreas', 'departments'],
      }),
    );
    expect(result.researchEntities.map((entity: any) => entity.slug)).toEqual([
      'laurie-santos-research',
      'adriana-germano-research',
      'nicholas-sambanis-research',
      'jamie-tucker-foltz-research',
      'volkmar-lab',
    ]);
  });

  it('falls back to keyword search when Meili rejects hybrid despite a configured embedder (config-drift safety net)', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    mocks.getEmbedders.mockResolvedValue({ default: { source: 'openAi' } });
    mocks.search
      .mockRejectedValueOnce({
        cause: {
          code: 'invalid_search_embedder',
          message: 'Cannot find embedder with name `default`.',
        },
      })
      .mockResolvedValueOnce({
        hits: [
          {
            id: entityId,
            slug: 'reilly-lab',
            name: 'Reilly Lab',
            kind: 'lab',
            departments: ['Chemistry'],
            researchAreas: [],
            sourceUrls: [],
          },
        ],
        estimatedTotalHits: 1,
      });
    mocks.researchEntityFind.mockReturnValue(
      queryResult([
        {
          _id: entityId,
          slug: 'reilly-lab',
          name: 'Reilly Lab',
          kind: 'lab',
          departments: ['Chemistry'],
          researchAreas: [],
          sourceUrls: [],
          ...validPublicDescriptions,
        },
      ]),
    );

    const result = await searchResearchGroupsViaMeili('reilly', {}, 1, 1);

    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(mocks.search).toHaveBeenNthCalledWith(
      1,
      'reilly',
      expect.objectContaining({
        hybrid: { semanticRatio: 0.8, embedder: 'default' },
      }),
    );
    expect(mocks.search).toHaveBeenNthCalledWith(
      2,
      'reilly',
      expect.not.objectContaining({ hybrid: expect.anything() }),
    );
    expect(result).toMatchObject({
      estimatedTotalHits: 1,
      page: 1,
      pageSize: 1,
      degraded: true,
      researchEntities: [{ _id: 'reilly-lab', slug: 'reilly-lab', name: 'Reilly Lab' }],
    });
  });

  it('marks browse results degraded when Meili cannot sort by browse rank', async () => {
    mocks.search
      .mockRejectedValueOnce({
        code: 'invalid_search_sort',
        message: 'Attribute `browseRankScore` is not sortable.',
      })
      .mockResolvedValueOnce({ hits: [], estimatedTotalHits: 0 });

    const result = await searchResearchGroupsViaMeili('', {}, 1, 24);

    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(mocks.search.mock.calls[1][1]).toEqual(
      expect.objectContaining({ sort: ['lastObservedAt:desc'] }),
    );
    expect(result.degraded).toBe(true);
  });

  it('expands AI and restricts short alias searches to topic fields', async () => {
    mocks.search.mockResolvedValueOnce({
      hits: [],
      estimatedTotalHits: 0,
      facetDistribution: {
        school: { 'Yale College': 3 },
        departments: { 'Computer Science': 2 },
      },
    });

    const result = await searchResearchGroupsViaMeili('AI', {}, 1, 24);

    expect(mocks.search).toHaveBeenCalledWith(
      'artificial intelligence machine learning deep learning ai',
      expect.objectContaining({
        attributesToSearchOn: ['studentSearchTerms', 'researchAreas', 'departments'],
        facets: ['schools', 'departments', 'researchAreas'],
      }),
    );
    expect(mocks.search.mock.calls[0][1]).not.toHaveProperty('hybrid');
    expect(result.facetDistribution).toEqual({
      school: { 'Yale College': 3 },
      departments: { 'Computer Science': 2 },
    });
  });

  it('computes the school facet disjunctively so selecting a school does not collapse its own dropdown (#1080)', async () => {
    mocks.search.mockResolvedValueOnce({
      hits: [],
      estimatedTotalHits: 6,
      facetDistribution: {
        schools: { 'Law School': 6 },
        departments: {},
      },
    });
    mocks.search.mockResolvedValueOnce({
      hits: [],
      estimatedTotalHits: 42,
      facetDistribution: {
        schools: {
          'Law School': 6,
          'School of Medicine': 12,
          'Yale College': 24,
        },
      },
    });

    const result = await searchResearchGroupsViaMeili('', { school: ['Law School'] }, 1, 24);

    expect(mocks.search).toHaveBeenCalledTimes(2);
    const [conjunctiveFilter] = mocks.search.mock.calls[0];
    const disjunctiveCall = mocks.search.mock.calls[1];
    expect(mocks.search.mock.calls[0][1].filter).toMatch(/schools = "Law School"/);
    expect(disjunctiveCall[1]).toEqual(
      expect.objectContaining({ facets: ['schools'], limit: 0 }),
    );
    expect(disjunctiveCall[1].filter).not.toMatch(/schools = /);
    expect(conjunctiveFilter).toBe('');
    expect(result.facetDistribution?.school).toEqual({
      'Law School': 6,
      'School of Medicine': 12,
      'Yale College': 24,
    });
  });

  it('does not issue a disjunctive facet query for a field with no active filter', async () => {
    mocks.search.mockResolvedValueOnce({
      hits: [],
      estimatedTotalHits: 0,
      facetDistribution: {
        schools: { 'Yale College': 3 },
        departments: { 'Computer Science': 2 },
      },
    });

    await searchResearchGroupsViaMeili('', {}, 1, 24);

    expect(mocks.search).toHaveBeenCalledTimes(1);
  });

  it('strips glued "YSM Researcher" boilerplate from the researchAreas facet and merges counts (#742)', async () => {
    mocks.search.mockResolvedValueOnce({
      hits: [],
      estimatedTotalHits: 0,
      facetDistribution: {
        schools: { 'School of Medicine': 4 },
        departments: { Psychiatry: 2 },
        researchAreas: {
          'MedicareYSM Researcher': 1,
          Medicare: 3,
          'YSM Researcher': 2,
          Histones: 5,
        },
      },
    });

    const result = await searchResearchGroupsViaMeili('', {}, 1, 24);

    expect(result.facetDistribution).toEqual({
      school: { 'School of Medicine': 4 },
      departments: { Psychiatry: 2 },
      researchAreas: { Medicare: 4, Histones: 5 },
    });
  });

  it('recomputes an actively-filtered facet disjunctively so its dropdown keeps sibling options (#1080)', async () => {
    mocks.search
      .mockResolvedValueOnce({
        hits: [],
        estimatedTotalHits: 6,
        facetDistribution: {
          schools: { 'Law School': 6 },
          departments: {},
        },
      })
      .mockResolvedValueOnce({
        facetDistribution: {
          schools: {
            'Law School': 6,
            'School of Medicine': 762,
            'Faculty of Arts and Sciences': 625,
          },
        },
      });

    const result = await searchResearchGroupsViaMeili('', { school: ['Law School'] }, 1, 24);

    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(mocks.search.mock.calls[0][1].filter).toContain('schools = "Law School"');
    const disjunctiveCall = mocks.search.mock.calls[1][1];
    expect(disjunctiveCall).toEqual(
      expect.objectContaining({ facets: ['schools'], limit: 0 }),
    );
    expect(disjunctiveCall.filter).toContain('archived = false');
    expect(disjunctiveCall.filter).not.toContain('schools = "Law School"');
    expect(result.facetDistribution).toEqual({
      departments: {},
      school: {
        'Law School': 6,
        'School of Medicine': 762,
        'Faculty of Arts and Sciences': 625,
      },
    });
  });

  it('keeps the conjunctive facet counts when the disjunctive facet query fails (#1080)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.search
      .mockResolvedValueOnce({
        hits: [],
        estimatedTotalHits: 6,
        facetDistribution: {
          schools: { 'Law School': 6 },
          departments: {},
        },
      })
      .mockRejectedValueOnce(new Error('meili facet query failed'));

    const result = await searchResearchGroupsViaMeili('', { school: ['Law School'] }, 1, 24);

    expect(result.facetDistribution).toEqual({
      departments: {},
      school: { 'Law School': 6 },
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('issues no extra facet query when no facet is actively filtered (#1080)', async () => {
    mocks.search.mockResolvedValueOnce({
      hits: [],
      estimatedTotalHits: 0,
      facetDistribution: {
        schools: { 'School of Medicine': 4, 'Law School': 6 },
        departments: { Psychiatry: 2 },
      },
    });

    const result = await searchResearchGroupsViaMeili('', {}, 1, 24);

    expect(mocks.search).toHaveBeenCalledTimes(1);
    expect(result.facetDistribution).toEqual({
      school: { 'School of Medicine': 4, 'Law School': 6 },
      departments: { Psychiatry: 2 },
    });
  });

  it('recovers on Meili when attributesToSearchOn references a non-searchable attribute', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    mocks.search
      .mockRejectedValueOnce({
        code: 'invalid_search_attributes_to_search_on',
        message: 'Attribute `keywords` is not searchable.',
      })
      .mockResolvedValueOnce({
        hits: [{ id: entityId, slug: 'actual-ai-lab', name: 'Actual AI Lab' }],
        estimatedTotalHits: 1,
      });
    mocks.researchEntityFind.mockReturnValue(
      queryResult([
        {
          _id: entityId,
          slug: 'actual-ai-lab',
          name: 'Actual AI Lab',
          kind: 'lab',
          departments: [],
          researchAreas: ['Machine Learning'],
          sourceUrls: [],
          ...validPublicDescriptions,
        },
      ]),
    );

    const result = await searchResearchGroupsViaMeili('AI', {}, 1, 24);

    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(mocks.search.mock.calls[0][1]).toHaveProperty('attributesToSearchOn');
    expect(mocks.search.mock.calls[1][1]).not.toHaveProperty('attributesToSearchOn');
    expect(result.degraded).toBe(true);
    expect(result.researchEntities).toEqual([expect.objectContaining({ slug: 'actual-ai-lab' })]);
  });

  it('strips professor noise while preserving faculty surname searches', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    mocks.search.mockResolvedValueOnce({
      hits: [{ id: entityId, slug: 'zhong-lab', name: 'Zhong Lab' }],
      estimatedTotalHits: 1,
    });
    mocks.researchEntityFind.mockReturnValue(
      queryResult([
        {
          _id: entityId,
          slug: 'zhong-lab',
          name: 'Zhong Lab',
          leadProfessorNames: ['Professor Zhong'],
          kind: 'lab',
          departments: [],
          researchAreas: [],
          sourceUrls: [],
        },
      ]),
    );

    await searchResearchGroupsViaMeili('Professor Zhong', {}, 1, 24);

    expect(mocks.search).toHaveBeenCalledWith(
      'zhong',
      expect.objectContaining({
        hybrid: { semanticRatio: 0.8, embedder: 'default' },
      }),
    );
  });

  it('applies a ranking score threshold to hybrid text queries so noise queries return empty', async () => {
    mocks.search.mockResolvedValueOnce({ hits: [], estimatedTotalHits: 0 });

    const result = await searchResearchGroupsViaMeili('zzzxxxqqq123nonsense', {}, 1, 24);

    expect(mocks.search).toHaveBeenCalledWith(
      'zzzxxxqqq123nonsense',
      expect.objectContaining({
        hybrid: { semanticRatio: 0.8, embedder: 'default' },
        rankingScoreThreshold: 0.15,
      }),
    );
    expect(result.estimatedTotalHits).toBe(0);
    expect(result.degraded).toBe(false);
  });

  it('drops a lone coincidental single-typo keyword hit for a real zero-coverage query (#1015)', async () => {
    const historianId = '67d8928150621bcef434a1f7';
    mocks.search.mockResolvedValueOnce({
      hits: [
        {
          id: historianId,
          slug: 'keith-wrightson-research',
          name: 'Keith Wrightson - Research',
          kind: 'lab',
          departments: ['History'],
          researchAreas: ['British history 1500-1750'],
          sourceUrls: [],
          _rankingScoreDetails: {
            words: { matchingWords: 1, maxMatchingWords: 2, score: 0.5 },
            proximity: { score: 1 },
            attribute: { score: 0.37 },
            exactness: { matchType: 'noExactMatch', score: 0.167 },
            typo: { typoCount: 1, score: 0.5 },
          },
        },
      ],
      estimatedTotalHits: 1,
    });
    mocks.researchEntityFind.mockReturnValue(
      queryResult([
        {
          _id: historianId,
          slug: 'keith-wrightson-research',
          name: 'Keith Wrightson - Research',
          kind: 'lab',
          departments: ['History'],
          researchAreas: ['British history 1500-1750'],
          sourceUrls: [],
          ...validPublicDescriptions,
        },
      ]),
    );

    const result = await searchResearchGroupsViaMeili('coral reefs', {}, 1, 24);

    expect(result.researchEntities).toEqual([]);
    expect(result.estimatedTotalHits).toBe(0);
  });

  it('keeps a partial-coverage hit that still has an exact word match (#1015)', async () => {
    const realMatchId = '67d8928150621bcef434a1f8';
    mocks.search.mockResolvedValueOnce({
      hits: [
        {
          id: realMatchId,
          slug: 'machine-learning-lab',
          name: 'Machine Learning Lab',
          kind: 'lab',
          departments: ['Computer Science'],
          researchAreas: [],
          sourceUrls: [],
          _rankingScoreDetails: {
            words: { matchingWords: 1, maxMatchingWords: 2, score: 0.5 },
            exactness: { matchType: 'exactMatch', score: 1 },
            typo: { typoCount: 0, score: 1 },
          },
        },
      ],
      estimatedTotalHits: 1,
    });
    mocks.researchEntityFind.mockReturnValue(
      queryResult([
        {
          _id: realMatchId,
          slug: 'machine-learning-lab',
          name: 'Machine Learning Lab',
          kind: 'lab',
          departments: ['Computer Science'],
          researchAreas: [],
          sourceUrls: [],
          ...validPublicDescriptions,
        },
      ]),
    );

    const result = await searchResearchGroupsViaMeili('machine metabolism', {}, 1, 24);

    expect(result.researchEntities.map((entity: any) => entity.slug)).toEqual([
      'machine-learning-lab',
    ]);
    expect(result.estimatedTotalHits).toBe(1);
  });

  describe('dropCoincidentalTypoOnlyHits', () => {
    const coincidentalTypoHit = {
      id: 'a',
      _rankingScoreDetails: {
        words: { matchingWords: 1, maxMatchingWords: 2 },
        exactness: { matchType: 'noExactMatch' },
        typo: { typoCount: 1 },
      },
    };

    it('drops a partial-coverage, no-exact-match, typo-driven keyword hit', () => {
      const { hits, dropped } = dropCoincidentalTypoOnlyHits([coincidentalTypoHit]);
      expect(hits).toEqual([]);
      expect(dropped).toBe(1);
    });

    it('keeps a hit that matched every query word', () => {
      const fullCoverage = {
        id: 'b',
        _rankingScoreDetails: {
          words: { matchingWords: 2, maxMatchingWords: 2 },
          exactness: { matchType: 'noExactMatch' },
          typo: { typoCount: 1 },
        },
      };
      const { hits, dropped } = dropCoincidentalTypoOnlyHits([fullCoverage]);
      expect(hits).toEqual([fullCoverage]);
      expect(dropped).toBe(0);
    });

    it('keeps a hit with a genuine exact match despite partial coverage', () => {
      const exactMatch = {
        id: 'c',
        _rankingScoreDetails: {
          words: { matchingWords: 1, maxMatchingWords: 2 },
          exactness: { matchType: 'exactMatch' },
          typo: { typoCount: 0 },
        },
      };
      const { hits, dropped } = dropCoincidentalTypoOnlyHits([exactMatch]);
      expect(hits).toEqual([exactMatch]);
      expect(dropped).toBe(0);
    });

    it('keeps a purely semantic hit carrying only vectorSort details', () => {
      const semanticOnly = {
        id: 'd',
        _rankingScoreDetails: { vectorSort: { similarity: 0.18 } },
      };
      const { hits, dropped } = dropCoincidentalTypoOnlyHits([semanticOnly]);
      expect(hits).toEqual([semanticOnly]);
      expect(dropped).toBe(0);
    });
  });

  it('normalizes non-Latin-script input to an empty ASCII query while preserving the raw text (#958)', () => {
    expect(normalizeResearchSearchQuery('东亚研究')).toMatchObject({
      raw: '东亚研究',
      query: '',
      tokens: [],
    });
    expect(normalizeResearchSearchQuery('генетика')).toMatchObject({
      raw: 'генетика',
      query: '',
      tokens: [],
    });
    expect(normalizeResearchSearchQuery('!!!')).toMatchObject({
      raw: '!!!',
      query: '',
      tokens: [],
    });
  });

  it('passes a non-Latin-script query through to Meili instead of degrading to browse-all (#958)', async () => {
    mocks.search.mockResolvedValue({ hits: [], estimatedTotalHits: 0, totalHits: 0 });

    const result = await searchResearchGroupsViaMeili('东亚研究', {}, 1, 24);

    expect(mocks.search).toHaveBeenCalled();
    expect(mocks.search.mock.calls[0][0]).toBe('东亚研究');
    expect(mocks.search.mock.calls[0][1]).toMatchObject({
      hybrid: { semanticRatio: 0.8, embedder: 'default' },
      rankingScoreThreshold: 0.15,
    });
    expect(result.estimatedTotalHits).toBe(0);
  });

  it('returns an empty result set for punctuation-only input without touching Meili (#958)', async () => {
    const result = await searchResearchGroupsViaMeili('??? $$$ ///', {}, 1, 24);

    expect(mocks.search).not.toHaveBeenCalled();
    expect(result.estimatedTotalHits).toBe(0);
    expect(result.researchEntities).toEqual([]);
    expect(result.degraded).toBe(false);
  });

  it('still browses the full corpus for a genuinely blank query (#958 regression guard)', async () => {
    mocks.search.mockResolvedValue({ hits: [], estimatedTotalHits: 1741 });

    const result = await searchResearchGroupsViaMeili('', {}, 1, 24);

    expect(mocks.search).toHaveBeenCalled();
    expect(mocks.search.mock.calls[0][0]).toBe('');
    expect(mocks.search.mock.calls[0][1]).not.toHaveProperty('hybrid');
    expect(mocks.search.mock.calls[0][1].sort).toContain('browseRankScore:desc');
    expect(result.estimatedTotalHits).toBe(1741);
  });

  it('reports the exhaustive threshold-aware totalHits for a thresholded hybrid query, not the inflated estimate', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    mocks.search
      .mockResolvedValueOnce({
        hits: [
          {
            id: entityId,
            slug: 'bruce-lab',
            name: 'Bruce Lab',
            kind: 'lab',
            departments: ['Neuroscience'],
            researchAreas: [],
            sourceUrls: [],
          },
        ],
        estimatedTotalHits: 1686,
        totalHits: 74,
      })
      .mockResolvedValueOnce({ hits: [], totalHits: 74 });
    mocks.researchEntityFind.mockReturnValue(
      queryResult([
        {
          _id: entityId,
          slug: 'bruce-lab',
          name: 'Bruce Lab',
          kind: 'lab',
          departments: ['Neuroscience'],
          researchAreas: [],
          sourceUrls: [],
        },
      ]),
    );

    const result = await searchResearchGroupsViaMeili('neuroscience', {}, 1, 24);

    expect(mocks.search.mock.calls[0][1]).toMatchObject({
      rankingScoreThreshold: 0.15,
      page: 1,
      hitsPerPage: HYBRID_CANDIDATE_POOL_SIZE,
    });
    expect(mocks.search.mock.calls[0][1]).not.toHaveProperty('limit');
    expect(mocks.search.mock.calls[0][1]).not.toHaveProperty('offset');
    expect(result.estimatedTotalHits).toBe(74);
  });

  it('reports the exhaustive threshold-aware facetDistribution for a thresholded hybrid query, not the candidate-pool distribution (#941)', async () => {
    mocks.search
      .mockResolvedValueOnce({
        hits: [],
        estimatedTotalHits: 1649,
        totalHits: 1649,
        facetDistribution: {
          schools: { 'School of Medicine': 768, 'Faculty of Arts and Sciences': 614 },
          departments: { 'Internal Medicine': 81 },
          researchAreas: { Oncology: 900 },
        },
      })
      .mockResolvedValueOnce({
        hits: [],
        totalHits: 313,
        facetDistribution: {
          schools: { 'School of Medicine': 210, 'Faculty of Arts and Sciences': 90 },
          departments: { Oncology: 120 },
          researchAreas: { Oncology: 300 },
        },
      });

    const result = await searchResearchGroupsViaMeili('cancer', {}, 1, 24);

    expect(mocks.search.mock.calls[1][1]).toMatchObject({
      rankingScoreThreshold: 0.15,
      page: 1,
      hitsPerPage: RESEARCH_ENTITY_SEARCH_MAX_TOTAL_HITS,
      facets: ['schools', 'departments', 'researchAreas'],
    });
    expect(result.estimatedTotalHits).toBe(313);
    expect(result.facetDistribution).toEqual({
      school: { 'School of Medicine': 210, 'Faculty of Arts and Sciences': 90 },
      departments: { Oncology: 120 },
      researchAreas: { Oncology: 300 },
    });
  });

  it('falls back to the candidate-pool facetDistribution when the exhaustive companion query returns none', async () => {
    mocks.search
      .mockResolvedValueOnce({
        hits: [],
        estimatedTotalHits: 1649,
        totalHits: 1649,
        facetDistribution: {
          schools: { 'School of Medicine': 768 },
        },
      })
      .mockResolvedValueOnce({ hits: [], totalHits: 313 });

    const result = await searchResearchGroupsViaMeili('cancer', {}, 1, 24);

    expect(result.estimatedTotalHits).toBe(313);
    expect(result.facetDistribution).toEqual({ school: { 'School of Medicine': 768 } });
  });

  it('does not let a shallow first page fall back to Meilisearch\'s pre-threshold estimate (#885)', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    mocks.search
      .mockResolvedValueOnce({
        hits: [
          {
            id: entityId,
            slug: 'bruce-lab',
            name: 'Bruce Lab',
            kind: 'lab',
            departments: ['Neuroscience'],
            researchAreas: [],
            sourceUrls: [],
          },
        ],
        estimatedTotalHits: 1746,
        totalHits: 1746,
      })
      .mockResolvedValueOnce({ hits: [], totalHits: 326 });
    mocks.researchEntityFind.mockReturnValue(
      queryResult([
        {
          _id: entityId,
          slug: 'bruce-lab',
          name: 'Bruce Lab',
          kind: 'lab',
          departments: ['Neuroscience'],
          researchAreas: [],
          sourceUrls: [],
        },
      ]),
    );

    const result = await searchResearchGroupsViaMeili('neuroscience', {}, 1, 50);

    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(mocks.search.mock.calls[1][1]).toMatchObject({
      rankingScoreThreshold: 0.15,
      hybrid: { semanticRatio: 0.8, embedder: 'default' },
      page: 1,
      hitsPerPage: RESEARCH_ENTITY_SEARCH_MAX_TOTAL_HITS,
    });
    expect(result.estimatedTotalHits).toBe(326);
  });

  it('fetches a fixed candidate pool at page 1 for a thresholded hybrid page, independent of page size (#1064)', async () => {
    mocks.search
      .mockResolvedValueOnce({ hits: [], estimatedTotalHits: 1686, totalHits: 74 })
      .mockResolvedValueOnce({ hits: [], totalHits: 74 });

    const result = await searchResearchGroupsViaMeili('neuroscience', {}, 3, 18);

    expect(mocks.search.mock.calls[0][1]).toMatchObject({
      page: 1,
      hitsPerPage: HYBRID_CANDIDATE_POOL_SIZE,
    });
    expect(mocks.search.mock.calls[0][1]).not.toHaveProperty('limit');
    expect(mocks.search.mock.calls[0][1]).not.toHaveProperty('offset');
    expect(mocks.search.mock.calls[1][1]).toMatchObject({
      page: 1,
      hitsPerPage: RESEARCH_ENTITY_SEARCH_MAX_TOTAL_HITS,
    });
    expect(result.estimatedTotalHits).toBe(74);
  });

  it('grows the candidate pool to cover a page window deeper than the fixed pool (#1064)', async () => {
    mocks.search
      .mockResolvedValueOnce({ hits: [], estimatedTotalHits: 1686, totalHits: 400 })
      .mockResolvedValueOnce({ hits: [], totalHits: 400 });

    await searchResearchGroupsViaMeili('neuroscience', {}, 12, 18);

    expect(mocks.search.mock.calls[0][1]).toMatchObject({
      page: 1,
      hitsPerPage: 12 * 18,
    });
  });

  it('requests an identical candidate pool for the same query at different page sizes (#1064)', async () => {
    mocks.getEmbedders.mockResolvedValue({ default: { source: 'openAi' } });
    mocks.search
      .mockResolvedValueOnce({ hits: [], estimatedTotalHits: 101, totalHits: 101 })
      .mockResolvedValueOnce({ hits: [], totalHits: 101 });
    await searchResearchGroupsViaMeili('machine learning fairness', {}, 1, 6);
    const smallPagePoolSize = mocks.search.mock.calls[0][1].hitsPerPage;

    mocks.search.mockReset();
    mocks.getEmbedders.mockResolvedValue({ default: { source: 'openAi' } });
    mocks.search
      .mockResolvedValueOnce({ hits: [], estimatedTotalHits: 101, totalHits: 101 })
      .mockResolvedValueOnce({ hits: [], totalHits: 101 });
    await searchResearchGroupsViaMeili('machine learning fairness', {}, 1, 24);
    const largePagePoolSize = mocks.search.mock.calls[0][1].hitsPerPage;

    expect(smallPagePoolSize).toBe(HYBRID_CANDIDATE_POOL_SIZE);
    expect(largePagePoolSize).toBe(HYBRID_CANDIDATE_POOL_SIZE);
    expect(smallPagePoolSize).toBe(largePagePoolSize);
  });

  it('paginates the thresholded hybrid candidate pool locally (#1064)', async () => {
    const idA = '67d8928150621bcef434a101';
    const idB = '67d8928150621bcef434a102';
    const idC = '67d8928150621bcef434a103';
    const poolHits = [idA, idB, idC].map((id, index) => ({
      id,
      slug: `lab-${index}`,
      name: `Lab ${index}`,
      kind: 'lab',
      departments: ['Computer Science'],
      researchAreas: [],
      sourceUrls: [],
      _rankingScoreDetails: { vectorSort: { similarity: 0.6 } },
    }));

    mocks.getEmbedders.mockResolvedValue({ default: { source: 'openAi' } });
    mocks.search
      .mockResolvedValueOnce({ hits: poolHits, estimatedTotalHits: 3, totalHits: 3 })
      .mockResolvedValueOnce({ hits: [], totalHits: 3 });
    mocks.researchEntityFind.mockReturnValue(
      queryResult(
        [idA, idB, idC].map((id, index) => ({
          _id: id,
          slug: `lab-${index}`,
          name: `Lab ${index}`,
          kind: 'lab',
          departments: ['Computer Science'],
          researchAreas: [],
          sourceUrls: [],
          ...validPublicDescriptions,
        })),
      ),
    );

    const secondPage = await searchResearchGroupsViaMeili('robotics', {}, 2, 2);

    expect(secondPage.researchEntities.map((entity: any) => entity.slug)).toEqual(['lab-2']);
    expect(secondPage.estimatedTotalHits).toBe(3);
  });

  it('keeps offset/limit pagination for keyword-only queries that carry no ranking threshold', async () => {
    mocks.getEmbedders.mockResolvedValue({});
    mocks.search.mockResolvedValueOnce({ hits: [], estimatedTotalHits: 5 });

    const result = await searchResearchGroupsViaMeili('reilly', {}, 2, 24);

    expect(mocks.search.mock.calls[0][1]).toMatchObject({ limit: 24, offset: 24 });
    expect(mocks.search.mock.calls[0][1]).not.toHaveProperty('page');
    expect(mocks.search.mock.calls[0][1]).not.toHaveProperty('hitsPerPage');
    expect(result.estimatedTotalHits).toBe(5);
  });

  it('does not apply a ranking score threshold to keyword-only topic alias queries', async () => {
    mocks.search.mockResolvedValueOnce({ hits: [], estimatedTotalHits: 0 });

    await searchResearchGroupsViaMeili('AI', {}, 1, 24);

    expect(mocks.search.mock.calls[0][1]).not.toHaveProperty('rankingScoreThreshold');
    expect(mocks.search.mock.calls[0][1]).not.toHaveProperty('hybrid');
  });

  it('drops the ranking score threshold alongside hybrid when the embedder is missing', async () => {
    mocks.search
      .mockRejectedValueOnce({
        cause: {
          code: 'invalid_search_embedder',
          message: 'Cannot find embedder with name `default`.',
        },
      })
      .mockResolvedValueOnce({ hits: [], estimatedTotalHits: 0 });

    const result = await searchResearchGroupsViaMeili('reilly', {}, 1, 24);

    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(mocks.search.mock.calls[0][1]).toHaveProperty('rankingScoreThreshold', 0.15);
    expect(mocks.search.mock.calls[1][1]).not.toHaveProperty('rankingScoreThreshold');
    expect(mocks.search.mock.calls[1][1]).not.toHaveProperty('hybrid');
    expect(result.degraded).toBe(true);
  });

  it('drops only the ranking score threshold when the running Meili version rejects it', async () => {
    mocks.search
      .mockRejectedValueOnce({
        code: 'bad_request',
        message: 'Unknown field `rankingScoreThreshold`.',
      })
      .mockResolvedValueOnce({ hits: [], estimatedTotalHits: 0 });

    const result = await searchResearchGroupsViaMeili('reilly', {}, 1, 24);

    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(mocks.search.mock.calls[0][1]).toHaveProperty('rankingScoreThreshold', 0.15);
    expect(mocks.search.mock.calls[1][1]).not.toHaveProperty('rankingScoreThreshold');
    expect(mocks.search.mock.calls[1][1]).toHaveProperty('hybrid');
    expect(result.degraded).toBe(true);
  });

  it('does not let short AI fallback matching resolve Ailong or airway substrings', async () => {
    mocks.search.mockRejectedValueOnce(new Error('meili unavailable'));
    mocks.researchEntityFind.mockReturnValue(
      queryResult([
        {
          _id: '67d8928150621bcef434a1d5',
          slug: 'ailong-lab',
          name: 'Ailong Lab',
          departments: [],
          researchAreas: [],
          keywords: [],
          sourceUrls: [],
          ...validPublicDescriptions,
        },
        {
          _id: '67d8928150621bcef434a1d6',
          slug: 'actual-ai-lab',
          name: 'Actual AI Lab',
          departments: [],
          researchAreas: ['Machine Learning'],
          keywords: [],
          sourceUrls: [],
          ...validPublicDescriptions,
        },
      ]),
    );

    const result = await searchResearchGroupsViaMeili('AI', {}, 1, 24);

    expect(result.researchEntities).toEqual([expect.objectContaining({ slug: 'actual-ai-lab' })]);
  });

  it('keeps base research results usable when optional planning context fails', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.search.mockResolvedValueOnce({ hits: [{ id: entityId }], estimatedTotalHits: 1 });
    mocks.researchEntityFind.mockReturnValue(
      queryResult([
        {
          _id: entityId,
          slug: 'reilly-lab',
          name: 'Reilly Lab',
          kind: 'lab',
          departments: ['Chemistry'],
          researchAreas: [],
          sourceUrls: [],
          ...validPublicDescriptions,
        },
      ]),
    );
    mocks.listPlanningContextsForResearchEntities.mockRejectedValueOnce(
      new Error('optional store unavailable'),
    );

    const result = await searchResearchGroupsViaMeili('reilly', {}, 1, 1);

    expect(result.researchEntities).toHaveLength(1);
    expect(result.researchEntities[0]).not.toHaveProperty('planningContext');
    expect(result.degraded).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(
      'Optional research planning-context enrichment failed:',
      expect.any(String),
    );
    consoleError.mockRestore();
  });

  it('drops object-shaped Meili hit ids before Mongo visibility filtering', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    mocks.search.mockResolvedValueOnce({
      hits: [
        {
          id: {
            toString: () => {
              throw new Error('research search stringified arbitrary hit id');
            },
          },
        },
        {
          id: entityId,
          slug: 'safe-lab',
          name: 'Safe Lab',
          kind: 'lab',
          departments: [],
          researchAreas: [],
          sourceUrls: [],
        },
      ],
      estimatedTotalHits: 2,
    });
    mocks.researchEntityFind.mockReturnValue(
      queryResult([
        {
          _id: entityId,
          slug: 'safe-lab',
          name: 'Safe Lab',
          kind: 'lab',
          departments: [],
          researchAreas: [],
          sourceUrls: [],
          studentVisibilityTier: 'student_ready',
        },
      ]),
    );

    await searchResearchGroupsViaMeili('', {}, 1, 24);

    expect(mocks.researchEntityFind).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: { $in: [entityId] },
      }),
    );
  });

  it('filters stale Meili hits that no longer resolve to public ResearchEntity documents', async () => {
    const staleEntityId = '67d8928150621bcef434a1d5';
    const currentEntityId = '67d8928150621bcef434a1d6';
    mocks.search.mockResolvedValueOnce({
      hits: [
        {
          id: staleEntityId,
          slug: 'deleted-lab',
          name: 'Deleted Lab',
        },
        {
          id: currentEntityId,
          slug: 'current-lab-stale-slug',
          name: 'Current Lab Stale Name',
        },
      ],
      estimatedTotalHits: 2,
    });
    mocks.researchEntityFind.mockReturnValue(
      queryResult([
        {
          _id: currentEntityId,
          slug: 'current-lab',
          name: 'Current Lab',
          kind: 'lab',
          departments: ['Chemistry'],
          researchAreas: [],
          sourceUrls: [],
          ...validPublicDescriptions,
        },
      ]),
    );

    const result = await searchResearchGroupsViaMeili('', {}, 1, 2);

    expect(mocks.researchEntityFind).toHaveBeenCalledWith({
      _id: { $in: [staleEntityId, currentEntityId] },
      archived: { $ne: true },
      studentVisibilityTier: { $in: ['student_ready'] },
    });
    expect(result.researchEntities).toEqual([
      expect.objectContaining({
        _id: 'current-lab',
        slug: 'current-lab',
        name: 'Current Lab',
      }),
    ]);
  });

  it('drops a stale student_ready hit whose live public-description invariant fails so browse never serves a card the detail page would 404', async () => {
    const deadCardId = '67d8928150621bcef434a1d5';
    const liveCardId = '67d8928150621bcef434a1d6';
    const hits = [
      { id: deadCardId, slug: 'yse-climate-change-communication', name: 'Dead Card' },
      { id: liveCardId, slug: 'live-lab', name: 'Live Lab' },
    ];
    mocks.search.mockResolvedValue({ hits, estimatedTotalHits: 2 });
    mocks.researchEntityFind.mockReturnValue(
      queryResult([
        {
          _id: deadCardId,
          slug: 'yse-climate-change-communication',
          name: 'Yale Program on Climate Change Communication',
          entityType: 'PROGRAM',
          kind: 'program',
          departments: [],
          researchAreas: [],
          sourceUrls: [],
          studentVisibilityTier: 'student_ready',
          fullDescription:
            'Anthony Leiserowitz, PhD is the JoshAni-TomKat Professor of Climate Communication and Director of the program.',
          shortDescription: '',
        },
        {
          _id: liveCardId,
          slug: 'live-lab',
          name: 'Live Lab',
          kind: 'lab',
          departments: ['Chemistry'],
          researchAreas: [],
          sourceUrls: [],
          studentVisibilityTier: 'student_ready',
          ...validPublicDescriptions,
        },
      ]),
    );

    const publicResult = await searchResearchGroupsViaMeili('', {}, 1, 24);
    expect(publicResult.researchEntities.map((entity: any) => entity.slug)).toEqual(['live-lab']);

    const operatorResult = await searchResearchGroupsViaMeili(
      '',
      {},
      1,
      24,
      {},
      {
        includeNonPublic: true,
      },
    );
    expect(operatorResult.researchEntities.map((entity: any) => entity.slug).sort()).toEqual(
      ['live-lab', 'yse-climate-change-communication'].sort(),
    );
  });

  it('caps search page before computing Meili offsets', async () => {
    mocks.search.mockResolvedValueOnce({
      hits: [],
      estimatedTotalHits: 0,
    });

    const result = await searchResearchGroupsViaMeili('', {}, 999_999_999, 500);

    expect(mocks.search).toHaveBeenCalledWith(
      '',
      expect.objectContaining({
        limit: 100,
        offset: 99_900,
      }),
    );
    expect(result).toMatchObject({
      estimatedTotalHits: 0,
      page: 1000,
      pageSize: 100,
      researchEntities: [],
    });
  });

  it('bounds direct Meili research search query and filter inputs before search', async () => {
    mocks.search.mockResolvedValueOnce({
      hits: [],
      estimatedTotalHits: 0,
    });
    const longResearchArea = 'x'.repeat(200);

    const result = await searchResearchGroupsViaMeili(
      ` ${'q'.repeat(700)} `,
      {
        departments: Array.from({ length: 60 }, (_, index) => `Department ${index}`),
        researchAreas: [longResearchArea],
      },
      1,
      24,
    );

    expect(mocks.search).toHaveBeenCalledWith(
      'q'.repeat(512),
      expect.objectContaining({
        filter: expect.stringContaining('departments = "Department 49"'),
      }),
    );
    const filter = String(mocks.search.mock.calls[0][1].filter);
    expect(filter).not.toContain('Department 50');
    expect(filter).toContain(`researchAreas = "${'x'.repeat(120)}"`);
    expect(filter).not.toContain(longResearchArea);
    expect(result).toMatchObject({
      estimatedTotalHits: 0,
      page: 1,
      pageSize: 24,
      researchEntities: [],
    });
  });

  it('drops non-string direct Meili research filter values before search', async () => {
    const badFilter = { toString: vi.fn(() => 'Injected') };
    mocks.search.mockResolvedValueOnce({
      hits: [],
      estimatedTotalHits: 0,
    });

    await searchResearchGroupsViaMeili(
      '',
      {
        departments: [badFilter as any, 'Computer Science'],
      },
      1,
      24,
    );

    expect(badFilter.toString).not.toHaveBeenCalled();
    const filter = String(mocks.search.mock.calls[0][1].filter);
    expect(filter).toContain('departments = "Computer Science"');
    expect(filter).not.toContain('Injected');
  });

  it('scopes the Meili count to public tiers for non-admin readers so totals reconcile', async () => {
    mocks.search.mockResolvedValueOnce({
      hits: [],
      estimatedTotalHits: 0,
    });

    await searchResearchGroupsViaMeili('cancer', {}, 1, 24);

    const filter = String(mocks.search.mock.calls[0][1].filter);
    expect(filter).toContain('studentVisibilityTier = "student_ready"');
    expect(filter).not.toContain('operator_review');
    expect(filter).not.toContain('suppressed');
  });

  it('does not restrict the Meili count when the reader may see non-public entities', async () => {
    mocks.search.mockResolvedValueOnce({
      hits: [],
      estimatedTotalHits: 0,
    });

    await searchResearchGroupsViaMeili('cancer', {}, 1, 24, {}, { includeNonPublic: true });

    const filter = String(mocks.search.mock.calls[0][1].filter);
    expect(filter).not.toContain('studentVisibilityTier');
  });

  it('allows admin searches to resolve explicitly requested non-public visibility tiers', async () => {
    const reviewEntityId = '67d8928150621bcef434a1d7';
    mocks.search.mockResolvedValueOnce({
      hits: [{ id: reviewEntityId, slug: 'review-lab', name: 'Review Lab' }],
      estimatedTotalHits: 1,
    });
    mocks.researchEntityFind.mockReturnValue(
      queryResult([
        {
          _id: reviewEntityId,
          slug: 'review-lab',
          name: 'Review Lab',
          kind: 'lab',
          departments: [],
          researchAreas: [],
          sourceUrls: [],
          studentVisibilityTier: 'operator_review',
        },
      ]),
    );

    const result = await searchResearchGroupsViaMeili(
      '',
      { studentVisibilityTier: ['operator_review'] },
      1,
      2,
      {},
      { includeNonPublic: true },
    );

    expect(mocks.researchEntityFind).toHaveBeenCalledWith({
      _id: { $in: [reviewEntityId] },
      archived: { $ne: true },
      studentVisibilityTier: { $in: ['operator_review'] },
    });
    expect(result.researchEntities).toEqual([
      expect.objectContaining({ _id: 'review-lab', studentVisibilityTier: 'operator_review' }),
    ]);
  });

  it('sorts and filters admin default browse by weakest quality first', async () => {
    const strongEntityId = '67d8928150621bcef434a1d8';
    const weakEntityId = '67d8928150621bcef434a1d9';
    mocks.researchEntityFind.mockReturnValue(
      queryResult([
        {
          _id: strongEntityId,
          slug: 'strong-lab',
          name: 'Strong Lab',
          shortDescription: 'Studies source-backed research with enough detail for students.',
          sourceUrls: ['https://example.edu/strong'],
          departments: [],
          researchAreas: [],
        },
        {
          _id: weakEntityId,
          slug: 'weak-lab',
          name: 'Weak Lab',
          shortDescription: '',
          sourceUrls: [],
          departments: [],
          researchAreas: [],
        },
      ]),
    );
    const strongPersonId = new mongoose.Types.ObjectId();
    mocks.roleAssignmentFind.mockReturnValue(
      queryResult([
        {
          _id: new mongoose.Types.ObjectId(),
          personId: strongPersonId,
          target: { kind: 'RESEARCH_ENTITY', id: strongEntityId },
          role: 'PI',
          state: 'CURRENT',
          confidence: 0.9,
          reviewStatus: 'APPROVED',
        },
      ]),
    );
    mocks.personFind.mockReturnValue(
      queryResult([{ _id: strongPersonId, displayName: 'Strong Lead' }]),
    );

    const result = await searchResearchGroupsViaMeili(
      '',
      {},
      1,
      10,
      {},
      { includeNonPublic: true, lowQualityFirst: true, qualityFilters: ['missing-lead'] },
    );

    expect(mocks.search).not.toHaveBeenCalled();
    expect(result.researchEntities).toEqual([
      expect.objectContaining({
        _id: 'weak-lab',
        qualitySummary: expect.objectContaining({
          repairFlags: expect.arrayContaining(['missing_lead']),
        }),
      }),
    ]);
  });
});

describe('getResearchGroupDetail', () => {
  it('rejects malformed public detail slugs before querying research entities', async () => {
    const result = await getResearchGroupDetail('../hidden-lab');

    expect(result).toBeNull();
    expect(mocks.researchEntityFindOne).not.toHaveBeenCalled();
  });

  it('requires public student visibility when resolving a public research detail slug', async () => {
    mocks.researchEntityFindOne.mockReturnValue({
      lean: async () => null,
    });

    const result = await getResearchGroupDetail('hidden-lab');

    expect(result).toBeNull();
    expect(mocks.researchEntityFindOne).toHaveBeenCalledWith({
      slug: 'hidden-lab',
      archived: { $ne: true },
      studentVisibilityTier: { $in: ['student_ready'] },
    });
  });

  it('fails closed when a student-ready record becomes description-empty at the public boundary', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    mocks.researchEntityFindOne.mockReturnValue(
      leanResult({
        _id: entityId,
        slug: 'correct-person-research',
        name: 'Correct Person Faculty Research',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        descriptionSource: 'PI_PROFILE_SYNTHESIS',
        shortDescription:
          "Wrong Person's expertise lies in molecular dynamics, protein folding, and cellular signaling.",
        fullDescription:
          "Wrong Person's expertise lies in molecular dynamics, protein folding, and cellular signaling across complex biological systems.",
        sourceUrls: ['https://example.yale.edu/profile/correct-person'],
        departments: [],
        researchAreas: [],
        studentVisibilityTier: 'student_ready',
      }),
    );

    const detail = await getResearchGroupDetail('correct-person-research');

    expect(detail).toBeNull();
    expect(mocks.entryPathwayFind).not.toHaveBeenCalled();
  });

  it('uses only current non-archived members for public detail pages', () => {
    expect(currentResearchEntityMemberFilter('entity-1')).toEqual({
      researchEntityId: 'entity-1',
      archived: { $ne: true },
      isCurrentMember: { $ne: false },
    });
  });

  it('keeps only member rows whose normalized research entity id matches the detail entity', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    const entityObjectId = new mongoose.Types.ObjectId(entityId);
    const personId = new mongoose.Types.ObjectId();
    const accountId = new mongoose.Types.ObjectId();
    mocks.researchEntityFindOne.mockReturnValue(
      leanResult({
        _id: entityObjectId,
        slug: 'entity-isolation-lab',
        name: 'Entity Isolation Lab',
        ...validPublicDescriptions,
        departments: [],
        researchAreas: [],
        sourceUrls: [],
        studentVisibilityTier: 'student_ready',
      }),
    );
    mocks.roleAssignmentFind.mockReturnValue(
      queryResult([
        {
          _id: new mongoose.Types.ObjectId(),
          personId,
          target: { kind: 'RESEARCH_ENTITY', id: entityObjectId },
          role: 'AFFILIATED',
          state: 'CURRENT',
          confidence: 0.9,
          reviewStatus: 'APPROVED',
          archived: false,
        },
      ]),
    );
    mocks.personFind.mockReturnValue(
      queryResult([
        {
          _id: personId,
          displayName: 'Matching Scholar',
          accountId,
          profile: { title: 'Research Scholar' },
        },
      ]),
    );
    mocks.accountFind.mockReturnValue(
      queryResult([{ _id: accountId, netid: 'ms1001', email: 'matching.scholar@example.edu' }]),
    );

    const detail = await getResearchGroupDetail('entity-isolation-lab');

    expect(detail?.members).toHaveLength(1);
    expect(detail?.members[0].user).toMatchObject({
      fname: 'Matching',
      lname: 'Scholar',
    });
  });

  const seedSingleMemberDetail = (profileTitle: string) => {
    const entityId = '67d8928150621bcef434a1d5';
    const entityObjectId = new mongoose.Types.ObjectId(entityId);
    const personId = new mongoose.Types.ObjectId();
    const accountId = new mongoose.Types.ObjectId();
    mocks.researchEntityFindOne.mockReturnValue(
      leanResult({
        _id: entityObjectId,
        slug: 'title-hygiene-lab',
        name: 'Title Hygiene Lab',
        ...validPublicDescriptions,
        departments: [],
        researchAreas: [],
        sourceUrls: [],
        studentVisibilityTier: 'student_ready',
      }),
    );
    mocks.roleAssignmentFind.mockReturnValue(
      queryResult([
        {
          _id: new mongoose.Types.ObjectId(),
          personId,
          target: { kind: 'RESEARCH_ENTITY', id: entityObjectId },
          role: 'PI',
          state: 'CURRENT',
          confidence: 0.95,
          reviewStatus: 'APPROVED',
          archived: false,
        },
      ]),
    );
    mocks.personFind.mockReturnValue(
      queryResult([
        {
          _id: personId,
          displayName: 'Victor Batista',
          accountId,
          profile: { title: profileTitle },
        },
      ]),
    );
    mocks.accountFind.mockReturnValue(
      queryResult([{ _id: accountId, netid: 'vb1001', email: 'victor.batista@example.edu' }]),
    );
  };

  it('renders a member card title stripped of the issue #708 nav-menu chrome', async () => {
    seedSingleMemberDetail(
      'About the InstituteMission & HistoryCommunity ValuesOur membersAnnual ReportsJoin the InstituteYQI in the MediaLocation & ContactsPrograms & EventsUpcoming Events',
    );

    const detail = await getResearchGroupDetail('title-hygiene-lab');

    expect(detail?.members).toHaveLength(1);
    expect(detail?.members[0].user.displayName).toBe('Victor Batista');
    expect(detail?.members[0].user.title).toBeUndefined();
  });

  it('renders a member card title stripped of a street-address fragment', async () => {
    seedSingleMemberDetail(
      'Professor of Ecology & Evolutionary BiologyAddress: 21 Sachem St. New Haven, CT 06511',
    );

    const detail = await getResearchGroupDetail('title-hygiene-lab');

    expect(detail?.members[0].user.title).toBeUndefined();
  });

  it('renders a member card title stripped of a leaked raw email address', async () => {
    seedSingleMemberDetail('Professor of Immunobiology fixture.researcher@yale.edu');

    const detail = await getResearchGroupDetail('title-hygiene-lab');

    expect(detail?.members[0].user.title).toBeUndefined();
  });

  it('renders a member card title stripped of the issue #740 email/office/phone contact block', async () => {
    seedSingleMemberDetail(
      'Professor of Historyfixture.researcher@example.eduOffice: 320 York StPhone: 203-432-0000',
    );

    const detail = await getResearchGroupDetail('title-hygiene-lab');

    expect(detail?.members[0].user.title).toBeUndefined();
  });

  it('renders a member card title stripped of a multi-sentence bio dump', async () => {
    seedSingleMemberDetail(
      'Her lab studies protein folding. She teaches biochemistry. She joined the faculty in 2004.',
    );

    const detail = await getResearchGroupDetail('title-hygiene-lab');

    expect(detail?.members[0].user.title).toBeUndefined();
  });

  it('keeps a legitimate endowed-chair title on the member card', async () => {
    seedSingleMemberDetail('The William K. Lanman, Jr. Professor of Molecular Biophysics');

    const detail = await getResearchGroupDetail('title-hygiene-lab');

    expect(detail?.members[0].user.title).toBe(
      'The William K. Lanman, Jr. Professor of Molecular Biophysics',
    );
  });

  it('shows only fresh stable official roster evidence and reports bounded disclosure', () => {
    const latestSnapshot = {
      state: 'current',
      memberKeys: ['official-profile:fixture|staff'],
      sourceUrl: 'https://medicine.yale.edu/lab/fixture/members/',
      observedAt: '2026-07-14T00:00:00Z',
    };
    const latestRow = {
      sourceName: 'official-research-home-roster',
      sourceUrl: latestSnapshot.sourceUrl,
      evidenceStatus: 'verified',
      identityKey: 'official-profile:fixture',
      membershipKey: 'official-profile:fixture|staff',
      name: 'Fixture Scholar',
      lastObservedAt: '2026-07-14T00:00:00Z',
      freshnessExpiresAt: '2026-08-04T00:00:00Z',
    };
    expect(
      isFreshVerifiedOfficialRosterRow(latestRow, new Date('2026-07-14T00:00:00Z'), latestSnapshot),
    ).toBe(true);
    expect(
      isFreshVerifiedOfficialRosterRow(
        {
          ...latestRow,
          freshnessExpiresAt: '2026-01-01T00:00:00Z',
        },
        new Date('2026-07-14T00:00:00Z'),
        latestSnapshot,
      ),
    ).toBe(false);
    expect(
      isFreshVerifiedOfficialRosterRow(
        {
          ...latestRow,
        },
        new Date('2026-07-14T00:00:00Z'),
        { state: 'stale' },
      ),
    ).toBe(false);
    expect(
      isFreshVerifiedOfficialRosterRow(
        {
          ...latestRow,
        },
        new Date('2026-07-14T00:00:00Z'),
        { state: 'failed' },
      ),
    ).toBe(false);
    const failedAfterPartial = {
      state: 'failed',
      lastSuccessfulSnapshot: { ...latestSnapshot, state: 'partial' },
    };
    expect(
      isFreshVerifiedOfficialRosterRow(
        latestRow,
        new Date('2026-07-14T00:00:00Z'),
        failedAfterPartial,
      ),
    ).toBe(true);
    expect(
      isFreshVerifiedOfficialRosterRow(
        { ...latestRow, membershipKey: 'official-profile:excluded|staff' },
        new Date('2026-07-14T00:00:00Z'),
        failedAfterPartial,
      ),
    ).toBe(false);
    for (const state of ['empty', 'withheld', 'stale', undefined]) {
      expect(
        isFreshVerifiedOfficialRosterRow(
          {
            ...latestRow,
          },
          new Date('2026-07-14T00:00:00Z'),
          state ? { state } : undefined,
        ),
      ).toBe(false);
    }
    expect(
      publicRosterDisclosure(
        {
          state: 'partial',
          withheldCount: 2,
          sourceUrl: 'https://medicine.yale.edu/lab/fixture/members/',
        },
        24,
        27,
      ),
    ).toMatchObject({ status: 'partial', returned: 24, truncated: true, withheldCount: 2 });
    expect(publicRosterDisclosure({ state: 'failed' }, 0, 0).status).toBe(
      'optional-source-failure',
    );
    expect(
      publicRosterDisclosure(
        {
          state: 'failed',
          sourceUrl: latestSnapshot.sourceUrl,
          observedAt: '2026-07-15T00:00:00Z',
          freshnessExpiresAt: '2026-08-05T00:00:00Z',
          lastSuccessfulSnapshot: {
            ...latestSnapshot,
            state: 'partial',
            freshnessExpiresAt: latestRow.freshnessExpiresAt,
          },
        },
        1,
        1,
        [latestRow],
      ),
    ).toMatchObject({
      status: 'optional-source-failure',
      sourceUrl: latestRow.sourceUrl,
      observedAt: latestRow.lastObservedAt,
      freshnessExpiresAt: latestRow.freshnessExpiresAt,
    });
    for (const obsoleteRow of [
      { ...latestRow, membershipKey: 'official-profile:old|staff' },
      { ...latestRow, sourceUrl: 'https://medicine.yale.edu/lab/old/members/' },
      { ...latestRow, lastObservedAt: '2026-07-13T00:00:00Z' },
    ]) {
      expect(
        isFreshVerifiedOfficialRosterRow(
          obsoleteRow,
          new Date('2026-07-14T00:00:00Z'),
          latestSnapshot,
        ),
      ).toBe(false);
    }
  });

  it('retains fresh official-roster canonical members with roster evidence and drops stale ones', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    const entityObjectId = new mongoose.Types.ObjectId(entityId);
    const freshPersonId = new mongoose.Types.ObjectId();
    const stalePersonId = new mongoose.Types.ObjectId();
    const freshAccountId = new mongoose.Types.ObjectId();
    const staleAccountId = new mongoose.Types.ObjectId();
    const sourceUrl = 'https://medicine.yale.edu/lab/fixture/members/';
    const freshMembershipKey = 'official-profile:fresh|affiliated';
    const staleMembershipKey = 'official-profile:stale|affiliated';
    const observedAt = new Date('2026-08-14T00:00:00Z');
    const rosterProvenanceBase = {
      sourceName: 'official-research-home-roster',
      sourceUrl,
      profileUrl: 'https://medicine.yale.edu/profile/fixture/',
      evidenceStatus: 'verified',
      observedAt,
    };
    mocks.researchEntityFindOne.mockReturnValue(
      leanResult({
        _id: entityObjectId,
        slug: 'official-roster-lab',
        name: 'Official Roster Lab',
        ...validPublicDescriptions,
        departments: [],
        researchAreas: [],
        sourceUrls: [],
        studentVisibilityTier: 'student_ready',
        rosterEnrichment: {
          state: 'current',
          memberKeys: [freshMembershipKey],
          sourceUrl,
          observedAt: '2026-08-14T00:00:00Z',
        },
      }),
    );
    mocks.roleAssignmentFind.mockReturnValue(
      queryResult([
        {
          _id: new mongoose.Types.ObjectId(),
          personId: freshPersonId,
          target: { kind: 'RESEARCH_ENTITY', id: entityObjectId },
          role: 'AFFILIATED',
          state: 'CURRENT',
          confidence: 0.9,
          reviewStatus: 'APPROVED',
          archived: false,
          rosterProvenance: {
            ...rosterProvenanceBase,
            membershipKey: freshMembershipKey,
            freshnessExpiresAt: new Date('2999-01-01T00:00:00Z'),
          },
        },
        {
          _id: new mongoose.Types.ObjectId(),
          personId: stalePersonId,
          target: { kind: 'RESEARCH_ENTITY', id: entityObjectId },
          role: 'AFFILIATED',
          state: 'CURRENT',
          confidence: 0.9,
          reviewStatus: 'APPROVED',
          archived: false,
          rosterProvenance: {
            ...rosterProvenanceBase,
            membershipKey: staleMembershipKey,
            freshnessExpiresAt: new Date('2000-01-01T00:00:00Z'),
          },
        },
      ]),
    );
    mocks.personFind.mockReturnValue(
      queryResult([
        {
          _id: freshPersonId,
          displayName: 'Fresh Scholar',
          accountId: freshAccountId,
          profile: { title: 'Research Scientist' },
          profileLinks: [],
        },
        {
          _id: stalePersonId,
          displayName: 'Stale Scholar',
          accountId: staleAccountId,
          profile: { title: 'Research Scientist' },
          profileLinks: [],
        },
      ]),
    );
    mocks.accountFind.mockReturnValue(
      queryResult([
        { _id: freshAccountId, netid: 'fresh1', email: 'fresh.scholar@example.edu' },
        { _id: staleAccountId, netid: 'stale1', email: 'stale.scholar@example.edu' },
      ]),
    );

    const detail = await getResearchGroupDetail('official-roster-lab');

    expect(detail?.members).toHaveLength(1);
    expect(detail?.members[0].user).toMatchObject({ fname: 'Fresh', lname: 'Scholar' });
    expect(detail?.members[0]).toHaveProperty('rosterEvidence');
    expect(
      (detail?.members[0] as { rosterEvidence?: { sourceUrl?: string } }).rosterEvidence,
    ).toMatchObject({
      sourceUrl,
    });
  });

  it('removes private listing ownership and contact fields from public detail payloads', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    mocks.researchEntityFindOne.mockReturnValue(
      leanResult({
        _id: entityId,
        slug: 'privacy-lab',
        name: 'Privacy Lab',
        ...validPublicDescriptions,
        departments: [],
        researchAreas: [],
        sourceUrls: [],
        studentVisibilityTier: 'student_ready',
        rosterEnrichment: {
          state: 'current',
          memberKeys: ['official-profile:private|staff'],
          sourceUrl: 'https://medicine.yale.edu/lab/private/members/',
          observedAt: '2026-07-14T00:00:00Z',
        },
      }),
    );
    mocks.listingFind.mockReturnValue(
      leanResult([
        {
          _id: '67d8928150621bcef434a1d6',
          ownerId: 'owner123',
          createdByUserId: '67d8928150621bcef434a1d7',
          ownerFirstName: 'Owner',
          ownerLastName: 'Professor',
          ownerEmail: 'owner@yale.edu',
          ownerTitle: 'Professor',
          ownerPrimaryDepartment: 'Computer Science',
          professorIds: ['owner123', 'collab123'],
          professorNames: ['Owner Professor', 'Private Collaborator'],
          emails: ['private-list@yale.edu'],
          title: 'Undergraduate research assistant',
          description: 'Help with public research tasks.',
          websites: [
            'https://privacy-lab.example.test/apply',
            'javascript:alert(document.cookie)',
            'mailto:owner@yale.edu',
            'not-a-url',
          ],
          departments: ['Computer Science'],
          researchAreas: ['Privacy'],
          archived: false,
          confirmed: true,
          audited: true,
          archivedAt: new Date('2026-01-01T00:00:00.000Z'),
          embedding: [0.1, 0.2, 0.3],
          views: 20,
          favorites: 3,
        },
      ]),
    );
    mocks.accessSignalFind.mockReturnValue(
      sortLeanResult([
        {
          _id: '67d8928150621bcef434a1da',
          researchEntityId: entityId,
          entryPathwayId: '67d8928150621bcef434a1d8',
          type: 'CONTACT_INSTRUCTIONS_EXIST',
          confidence: 'HIGH',
          confidenceScore: 0.91,
          source: {
            evidenceIds: ['67d8928150621bcef434a1d9'],
            name: 'Lab site',
            url: 'javascript:alert(document.cookie)',
            excerpt: 'Questions can go to private-signal@yale.edu or 203-432-1234.',
          },
          observedAt: new Date('2026-01-02T00:00:00.000Z'),
          originalConfidence: 0.98,
          derivationKey: 'private-signal-key',
          archived: false,
          lastMaterializedAt: new Date('2026-01-03T00:00:00.000Z'),
          review: { status: 'unreviewed' },
        },
      ]),
    );

    const detail = await getResearchGroupDetail('privacy-lab');

    expect(detail?.undergraduateLogistics).toEqual({ status: 'ready', claims: [] });
    expect(detail?.activeListings).toEqual([
      expect.objectContaining({
        id: '67d8928150621bcef434a1d6',
        title: 'Undergraduate research assistant',
        description: 'Help with public research tasks.',
        websites: ['https://privacy-lab.example.test/apply'],
      }),
    ]);
    expect(detail?.activeListings[0]).not.toHaveProperty('ownerId');
    expect(detail?.activeListings[0]).not.toHaveProperty('createdByUserId');
    expect(detail?.activeListings[0]).not.toHaveProperty('ownerFirstName');
    expect(detail?.activeListings[0]).not.toHaveProperty('ownerLastName');
    expect(detail?.activeListings[0]).not.toHaveProperty('ownerEmail');
    expect(detail?.activeListings[0]).not.toHaveProperty('ownerTitle');
    expect(detail?.activeListings[0]).not.toHaveProperty('ownerPrimaryDepartment');
    expect(detail?.activeListings[0]).not.toHaveProperty('professorIds');
    expect(detail?.activeListings[0]).not.toHaveProperty('professorNames');
    expect(detail?.activeListings[0]).not.toHaveProperty('emails');
    expect(detail?.activeListings[0]).not.toHaveProperty('views');
    expect(detail?.activeListings[0]).not.toHaveProperty('favorites');
    expect(detail?.activeListings[0]).not.toHaveProperty('archived');
    expect(detail?.activeListings[0]).not.toHaveProperty('confirmed');
    expect(detail?.activeListings[0]).not.toHaveProperty('audited');
    expect(detail?.activeListings[0]).not.toHaveProperty('archivedAt');
    expect(detail?.activeListings[0]).not.toHaveProperty('embedding');

    expect(detail?.accessSignals[0]).toEqual(
      expect.objectContaining({
        signalType: 'CONTACT_INSTRUCTIONS_EXIST',
        excerpt: 'Questions can go to [email redacted] or [phone redacted].',
      }),
    );
    expect(detail?.accessSignals[0].sourceUrl).toBeUndefined();
    expect(detail?.accessSignals[0]).not.toHaveProperty('sourceEvidenceId');
    expect(detail?.accessSignals[0]).not.toHaveProperty('observationId');
    expect(detail?.accessSignals[0]).not.toHaveProperty('originalConfidence');
    expect(detail?.accessSignals[0]).not.toHaveProperty('derivationKey');
    expect(detail?.accessSignals[0]).not.toHaveProperty('archived');
    expect(detail?.accessSignals[0]).not.toHaveProperty('lastMaterializedAt');
    expect(detail?.accessSignals[0]).not.toHaveProperty('review');

    expect(detail?.researchEntity).not.toHaveProperty('rosterEnrichment');
  });

  it('filters our own site and index-page URLs out of the public detail sources', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    mocks.researchEntityFindOne.mockReturnValue(
      leanResult({
        _id: entityId,
        slug: 'qin-yan',
        name: 'Qin Yan Lab',
        ...validPublicDescriptions,
        departments: [],
        researchAreas: [],
        websiteUrl: 'https://medicine.yale.edu/lab/yan/',
        sourceUrls: [
          'https://medicine.yale.edu/about/a-to-z-index/lab-websites/',
          'https://medicine.yale.edu/lab/yan/',
          'https://yalelabs.io/api/research',
          'https://medicine.yale.edu/profile/qin-yan/',
        ],
        studentVisibilityTier: 'student_ready',
      }),
    );
    mocks.accessSignalFind.mockReturnValue(
      sortLeanResult([
        {
          _id: '67d8928150621bcef434a1da',
          researchEntityId: entityId,
          type: 'REACH_OUT_PLAUSIBLE',
          confidence: 'MEDIUM',
          confidenceScore: 0.6,
          source: {
            name: 'YSM A-to-Z',
            url: 'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/',
            excerpt: 'Reach out to the lab.',
          },
          observedAt: new Date('2026-01-02T00:00:00.000Z'),
          archived: false,
          review: { status: 'unreviewed' },
        },
      ]),
    );

    const detail = await getResearchGroupDetail('qin-yan');

    expect(detail?.researchEntity.sourceUrls).toEqual([
      'https://medicine.yale.edu/lab/yan/',
      'https://medicine.yale.edu/profile/qin-yan/',
    ]);
    expect(detail?.accessSignals[0].signalType).toBe('REACH_OUT_PLAUSIBLE');
    expect(detail?.accessSignals[0].sourceUrl).toBeUndefined();
  });

  it('allowlists public member user fields in public detail payloads', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    const entityObjectId = new mongoose.Types.ObjectId(entityId);
    const personId = new mongoose.Types.ObjectId();
    const accountId = new mongoose.Types.ObjectId();
    mocks.researchEntityFindOne.mockReturnValue(
      leanResult({
        _id: entityObjectId,
        slug: 'member-privacy-lab',
        name: 'Member Privacy Lab',
        ...validPublicDescriptions,
        departments: [],
        researchAreas: [],
        sourceUrls: [],
        studentVisibilityTier: 'student_ready',
      }),
    );
    mocks.roleAssignmentFind.mockReturnValue(
      queryResult([
        {
          _id: new mongoose.Types.ObjectId(),
          personId,
          target: { kind: 'RESEARCH_ENTITY', id: entityObjectId },
          role: 'AFFILIATED',
          state: 'CURRENT',
          confidence: 0.9,
          reviewStatus: 'APPROVED',
          archived: false,
        },
      ]),
    );
    mocks.personFind.mockReturnValue(
      queryResult([
        {
          _id: personId,
          displayName: 'Fixture Advisor',
          accountId,
          profile: {
            title: 'Professor of Computer Science',
            primaryDepartment: 'Computer Science',
            imageUrl: '',
          },
          profileLinks: [
            {
              kind: 'YALE_OFFICIAL',
              purpose: 'PRIMARY_IDENTITY',
              url: 'https://cs.yale.edu/people/fixture-advisor',
              verifiedAt: new Date(),
              healthStatus: 'HEALTHY',
            },
          ],
        },
      ]),
    );
    mocks.accountFind.mockReturnValue(
      queryResult([{ _id: accountId, netid: 'abc123', email: 'fixture.advisor@example.edu' }]),
    );

    const detail = await getResearchGroupDetail('member-privacy-lab');

    expect(detail?.members).toHaveLength(1);
    expect(detail?.members[0].user).toEqual({
      fname: 'Fixture',
      lname: 'Advisor',
      displayName: 'Fixture Advisor',
      imageUrl: '',
      image_url: '',
      primaryDepartment: 'Computer Science',
      primary_department: 'Computer Science',
      title: 'Professor of Computer Science',
      profileUrls: {
        official: 'https://cs.yale.edu/people/fixture-advisor',
      },
      profile_urls: {
        official: 'https://cs.yale.edu/people/fixture-advisor',
      },
      publicKey: `${personId.toString()}-affiliated`,
    });
    expect(detail?.members[0].user).not.toHaveProperty('_id');
    expect(detail?.members[0].user).not.toHaveProperty('netid');
    expect(detail?.members[0].user).not.toHaveProperty('email');
    expect(detail?.members[0].user).not.toHaveProperty('secondaryDepartments');
    expect(detail?.members[0].user).not.toHaveProperty('facultyMemberId');
    expect(detail?.members[0].user.profileUrls).not.toHaveProperty('orcid');
    expect(detail?.members[0].user).not.toHaveProperty('googleScholarId');
    expect(detail?.members[0].user).not.toHaveProperty('openAlexId');
    expect(detail?.members[0].user).not.toHaveProperty('userConfirmed');
    expect(detail?.members[0].user).not.toHaveProperty('userType');
    expect(detail?.members[0].user).not.toHaveProperty('raw');
  });

  it('preserves internal profile path fallbacks through public detail member shaping', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    const entityObjectId = new mongoose.Types.ObjectId(entityId);
    const personId = new mongoose.Types.ObjectId();
    const accountId = new mongoose.Types.ObjectId();
    mocks.researchEntityFindOne.mockReturnValue(
      leanResult({
        _id: entityObjectId,
        slug: 'member-internal-profile-lab',
        name: 'Member Internal Profile Lab',
        ...validPublicDescriptions,
        departments: [],
        researchAreas: [],
        sourceUrls: [],
        studentVisibilityTier: 'student_ready',
      }),
    );
    mocks.roleAssignmentFind.mockReturnValue(
      queryResult([
        {
          _id: new mongoose.Types.ObjectId(),
          personId,
          target: { kind: 'RESEARCH_ENTITY', id: entityObjectId },
          role: 'PI',
          state: 'CURRENT',
          confidence: 0.9,
          reviewStatus: 'APPROVED',
          archived: false,
        },
      ]),
    );
    mocks.personFind.mockReturnValue(
      queryResult([
        {
          _id: personId,
          displayName: 'Fixture Scholar',
          accountId,
          profile: {
            title: 'Professor',
            primaryDepartment: 'Example Studies',
            imageUrl: '',
          },
          profileLinks: [],
        },
      ]),
    );
    mocks.accountFind.mockReturnValue(
      queryResult([{ _id: accountId, netid: 'fx1001', email: 'fixture.scholar@example.edu' }]),
    );

    const detail = await getResearchGroupDetail('member-internal-profile-lab');

    expect(detail?.members[0].user).toMatchObject({
      fname: 'Fixture',
      lname: 'Scholar',
      internalProfilePath: '/profile/fx1001',
      internal_profile_path: '/profile/fx1001',
      publicKey: `${personId.toString()}-pi`,
    });
    expect(detail?.members[0].user).not.toHaveProperty('netid');
  });

  it('suppresses a surname-colliding uncorroborated phantom co-PI when a corroborated PI exists', async () => {
    const entityObjectId = new mongoose.Types.ObjectId('67d8928150621bcef434a1d5');
    const corroboratedPersonId = new mongoose.Types.ObjectId();
    const phantomPersonId = new mongoose.Types.ObjectId();
    const corroboratedAccountId = new mongoose.Types.ObjectId();
    const phantomAccountId = new mongoose.Types.ObjectId();
    mocks.researchEntityFindOne.mockReturnValue(
      leanResult({
        _id: entityObjectId,
        slug: 'ysm-schwartz',
        name: 'Schwartz Lab',
        ...validPublicDescriptions,
        departments: [],
        researchAreas: [],
        sourceUrls: ['https://medicine.yale.edu/profile/martin-schwartz/'],
        studentVisibilityTier: 'student_ready',
      }),
    );
    mocks.roleAssignmentFind.mockReturnValue(
      queryResult([
        {
          _id: new mongoose.Types.ObjectId(),
          personId: corroboratedPersonId,
          target: { kind: 'RESEARCH_ENTITY', id: entityObjectId },
          role: 'PI',
          state: 'CURRENT',
          confidence: 0.86,
          reviewStatus: 'UNREVIEWED',
          archived: false,
        },
        {
          _id: new mongoose.Types.ObjectId(),
          personId: phantomPersonId,
          target: { kind: 'RESEARCH_ENTITY', id: entityObjectId },
          role: 'PI',
          state: 'CURRENT',
          confidence: 0,
          reviewStatus: 'UNREVIEWED',
          archived: false,
        },
      ]),
    );
    mocks.personFind.mockReturnValue(
      queryResult([
        {
          _id: corroboratedPersonId,
          displayName: 'Martin Schwartz',
          accountId: corroboratedAccountId,
          profileLinks: [
            {
              kind: 'YALE_OFFICIAL',
              purpose: 'PRIMARY_IDENTITY',
              url: 'https://medicine.yale.edu/profile/martin-schwartz/',
              verifiedAt: new Date(),
              healthStatus: 'HEALTHY',
            },
          ],
        },
        {
          _id: phantomPersonId,
          displayName: 'Michael Schwartz',
          accountId: phantomAccountId,
          profileLinks: [],
        },
      ]),
    );
    mocks.accountFind.mockReturnValue(
      queryResult([
        { _id: corroboratedAccountId, netid: 'ms3001', email: 'martin.schwartz@example.edu' },
        { _id: phantomAccountId, netid: 'ms3002', email: 'michael.schwartz@example.edu' },
      ]),
    );

    const detail = await getResearchGroupDetail('ysm-schwartz');

    const leadNames = (detail?.members ?? [])
      .filter((member) => member.role === 'pi')
      .map((member) => `${member.user.fname} ${member.user.lname}`);
    expect(leadNames).toEqual(['Martin Schwartz']);
    expect(leadNames).not.toContain('Michael Schwartz');
  });

  it('derives PI identity review from raw records before public member replacement', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    const entityObjectId = new mongoose.Types.ObjectId(entityId);
    const personId = new mongoose.Types.ObjectId();
    const accountId = new mongoose.Types.ObjectId();
    mocks.researchEntityFindOne.mockReturnValue(
      leanResult({
        _id: entityObjectId,
        slug: 'disputed-pi-lab',
        name: 'Disputed PI Lab',
        ...validPublicDescriptions,
        departments: [],
        researchAreas: [],
        sourceUrls: ['https://medicine.yale.edu/profile/correct-scholar/'],
        studentVisibilityTier: 'student_ready',
      }),
    );
    mocks.roleAssignmentFind.mockReturnValue(
      queryResult([
        {
          _id: new mongoose.Types.ObjectId(),
          personId,
          target: { kind: 'RESEARCH_ENTITY', id: entityObjectId },
          role: 'PI',
          state: 'CURRENT',
          confidence: 0.9,
          reviewStatus: 'DISPUTED',
          archived: false,
        },
      ]),
    );
    mocks.personFind.mockReturnValue(
      queryResult([
        {
          _id: personId,
          displayName: 'Correct Scholar',
          accountId,
          profileLinks: [
            {
              kind: 'YALE_OFFICIAL',
              purpose: 'PRIMARY_IDENTITY',
              url: 'https://medicine.yale.edu/profile/correct-scholar/',
              verifiedAt: new Date(),
              healthStatus: 'HEALTHY',
            },
          ],
        },
      ]),
    );
    mocks.accountFind.mockReturnValue(
      queryResult([{ _id: accountId, netid: 'cs2001', email: 'correct.scholar@example.edu' }]),
    );

    const detail = await getResearchGroupDetail('disputed-pi-lab');

    expect(detail?.researchEntity).toMatchObject({ leadIdentityStatus: 'under_review' });
    expect(detail?.researchEntity).not.toHaveProperty('leadProfessorPublicKey');
    expect(detail?.members[0].user).toMatchObject({
      fname: 'Correct',
      lname: 'Scholar',
    });
    expect(detail?.members[0].user).not.toHaveProperty('facultyMemberId');
    expect(detail?.members[0].user).not.toHaveProperty('userId');
  });

  it('corrects non-PI leading possessive names in public descriptions', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    const entityObjectId = new mongoose.Types.ObjectId(entityId);
    const personId = new mongoose.Types.ObjectId();
    const accountId = new mongoose.Types.ObjectId();
    mocks.researchEntityFindOne.mockReturnValue(
      leanResult({
        _id: entityObjectId,
        slug: 'glahn-lab-dcg32',
        name: 'Glahn Lab',
        ...validPublicDescriptions,
        kind: 'lab',
        entityType: 'LAB',
        departments: [],
        researchAreas: [],
        sourceUrls: ['https://music.yale.edu/people/david-lang'],
        description: '',
        profileSynthesisDescription:
          "David Lang's lab studies how humans process complex sound patterns.",
        descriptionSource: 'PI_PROFILE_SYNTHESIS',
        studentVisibilityTier: 'student_ready',
      }),
    );
    mocks.roleAssignmentFind.mockReturnValue(
      queryResult([
        {
          _id: new mongoose.Types.ObjectId(),
          personId,
          target: { kind: 'RESEARCH_ENTITY', id: entityObjectId },
          role: 'PI',
          state: 'CURRENT',
          confidence: 0.9,
          reviewStatus: 'APPROVED',
          archived: false,
        },
      ]),
    );
    mocks.personFind.mockReturnValue(
      queryResult([
        {
          _id: personId,
          displayName: 'David Glahn',
          accountId,
          profile: { primaryDepartment: 'Psychiatry', imageUrl: '' },
          profileLinks: [],
        },
      ]),
    );
    mocks.accountFind.mockReturnValue(
      queryResult([{ _id: accountId, netid: 'fx1001', email: 'david.glahn@example.edu' }]),
    );

    const detail = await getResearchGroupDetail('glahn-lab-dcg32');

    expect(detail?.researchEntity.profileSynthesisDescription).toContain(
      'This lab studies how humans process complex sound patterns.',
    );
    expect(detail?.researchEntity.profileSynthesisDescription).not.toContain("David Lang's");
  });

  it('removes non-research PI profile synthesis content that does not match lead PI names', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    mocks.researchEntityFindOne.mockReturnValue(
      leanResult({
        _id: entityId,
        slug: 'glahn-lab-dcg32',
        name: 'Glahn Lab',
        ...validPublicDescriptions,
        kind: 'lab',
        entityType: 'LAB',
        departments: [],
        researchAreas: [],
        sourceUrls: ['https://music.yale.edu/people/david-lang'],
        descriptionSource: 'PI_PROFILE_SYNTHESIS',
        profileSynthesisDescription:
          'This music has been performed by major music, dance, and theater organizations throughout the world, and in the most renowned concert halls and festivals in the United States and Europe.',
      }),
    );

    const detail = await getResearchGroupDetail('glahn-lab-dcg32');

    expect(detail?.researchEntity.profileSynthesisDescription).toBe('');
  });
});

describe('listResearchEntityRelationshipPayload', () => {
  it('returns an empty payload for object-shaped entity ids before relationship lookup', async () => {
    const result = await listResearchEntityRelationshipPayload({
      toString: () => {
        throw new Error('relationship payload stringified arbitrary entity id');
      },
    });

    expect(result).toEqual({
      entityRelationships: [],
      relatedResearchEntities: [],
      relatedResearchEntitiesMeta: { returned: 0, truncated: false },
      affiliatedRelationships: [],
      affiliatedResearchEntities: [],
      affiliatedResearchEntitiesMeta: { returned: 0, truncated: false },
    });
    expect(mocks.researchEntityRelationshipFind).not.toHaveBeenCalled();
  });

  it('returns only launch-public umbrella affiliations for public research detail payloads', async () => {
    const currentEntityId = '67d8928150621bcef434a1d5';
    const publicInstituteId = '67d8928150621bcef434a1d6';
    const reviewInstituteId = '67d8928150621bcef434a1d7';

    mocks.researchEntityRelationshipFind.mockReturnValueOnce(queryResult([])).mockReturnValueOnce(
      queryResult([
        {
          _id: 'rel-yqi',
          sourceResearchEntityId: publicInstituteId,
          targetResearchEntityId: currentEntityId,
          relationshipType: 'MEMBER_RESEARCH_AREA',
          label: 'Institute member',
          evidenceStrength: 'MODERATE',
          sourceUrl: 'javascript:alert(document.cookie)',
          evidenceQuote: 'Private operator note with hidden@example.edu',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          _id: 'rel-held',
          sourceResearchEntityId: reviewInstituteId,
          targetResearchEntityId: currentEntityId,
          relationshipType: 'MEMBER_RESEARCH_AREA',
          label: 'Held institute member',
          evidenceStrength: 'MODERATE',
          evidenceQuote: 'Held private operator note',
        },
      ]),
    );
    mocks.researchEntityFind.mockReturnValue(
      queryResult([
        {
          _id: publicInstituteId,
          slug: 'center-yale-quantum-institute',
          name: 'Yale Quantum Institute',
          kind: 'institute',
          entityType: 'INSTITUTE',
          studentVisibilityTier: 'student_ready',
          archived: false,
          ...validPublicDescriptions,
        },
        {
          _id: reviewInstituteId,
          slug: 'held-institute',
          name: 'Held Institute',
          kind: 'institute',
          entityType: 'INSTITUTE',
          studentVisibilityTier: 'operator_review',
          archived: false,
        },
      ]),
    );

    const result = await listResearchEntityRelationshipPayload(currentEntityId);

    expect(mocks.researchEntityRelationshipFind).toHaveBeenNthCalledWith(1, {
      archived: { $ne: true },
      sourceResearchEntityId: currentEntityId,
    });
    expect(mocks.researchEntityRelationshipFind).toHaveBeenNthCalledWith(2, {
      archived: { $ne: true },
      targetResearchEntityId: currentEntityId,
    });
    expect(mocks.researchEntityFind).toHaveBeenCalledWith({
      _id: { $in: [publicInstituteId, reviewInstituteId] },
      archived: { $ne: true },
      studentVisibilityTier: { $in: ['student_ready'] },
    });
    expect(result).toEqual({
      entityRelationships: [],
      relatedResearchEntities: [],
      relatedResearchEntitiesMeta: { returned: 0, truncated: false },
      affiliatedRelationships: [
        expect.objectContaining({
          relationshipType: 'MEMBER_RESEARCH_AREA',
          relatedResearchEntitySlug: 'center-yale-quantum-institute',
        }),
      ],
      affiliatedResearchEntities: [
        expect.objectContaining({
          id: 'center-yale-quantum-institute',
          slug: 'center-yale-quantum-institute',
          name: 'Yale Quantum Institute',
        }),
      ],
      affiliatedResearchEntitiesMeta: { returned: 1, truncated: false },
    });
    expect(result.affiliatedRelationships[0].sourceUrl).toBeUndefined();
    expect(result.affiliatedRelationships[0]).not.toHaveProperty('evidenceQuote');
    expect(result.affiliatedRelationships[0]).not.toHaveProperty('createdAt');
    expect(JSON.stringify(result)).not.toContain('hidden@example.edu');
  });

  it('projects an allowlisted card shape and bounds a 99-related hub payload', async () => {
    const currentEntityId = '67d8928150621bcef434a1d5';
    const select = vi.fn();
    const relatedIds = Array.from(
      { length: 99 },
      (_, index) => `67d8928150621bcef434${String(index).padStart(4, '0')}`,
    );
    mocks.researchEntityRelationshipFind
      .mockReturnValueOnce(
        queryResult(
          relatedIds.map((id) => ({
            sourceResearchEntityId: currentEntityId,
            targetResearchEntityId: id,
            relationshipType: 'MEMBER_RESEARCH_AREA',
            label: 'Related',
          })),
        ),
      )
      .mockReturnValueOnce(queryResult([]));
    const entityQuery = queryResult(
      relatedIds.slice(0, 50).map((id, index) => ({
        _id: id,
        slug: `entity-${index}`,
        name: `Entity ${index}`,
        kind: 'center',
        departments: ['Physics'],
        ...validPublicDescriptions,
        shortDescription: `Safe summary ${index} hidden${index}@example.edu describing the group's ongoing research program in depth.`,
        studentVisibilityTier: 'student_ready',
        privateNotes: 'operator only',
        sourceUrls: ['https://example.edu/private'],
      })),
    );
    entityQuery.select = (value: string) => {
      select(value);
      return entityQuery;
    };
    mocks.researchEntityFind.mockReturnValue(entityQuery);

    const result = await listResearchEntityRelationshipPayload(currentEntityId);

    expect(select).toHaveBeenCalledWith(
      '_id slug name displayName kind entityType departments shortDescription fullDescription studentVisibilityTier descriptionSource sourceUrls website websiteUrl',
    );
    expect(result.relatedResearchEntities).toHaveLength(50);
    expect(result.relatedResearchEntitiesMeta).toEqual({ returned: 50, truncated: true });
    expect(Object.keys(result.relatedResearchEntities[0]).sort()).toEqual(
      ['blurb', 'departments', 'entityType', 'id', 'kind', 'name', 'slug'].sort(),
    );
    const encoded = JSON.stringify(result);
    expect(encoded).not.toContain('operator only');
    expect(encoded).not.toContain('@example.edu');
    expect(Buffer.byteLength(encoded)).toBeLessThan(25_000);
  });

  it('dedupes a related entity reached by multiple relationships to a single card', async () => {
    const currentEntityId = '67d8928150621bcef434a1d5';
    const sharedTargetId = '67d8928150621bcef434a1e0';

    mocks.researchEntityRelationshipFind
      .mockReturnValueOnce(
        queryResult([
          {
            _id: 'rel-member',
            sourceResearchEntityId: currentEntityId,
            targetResearchEntityId: sharedTargetId,
            relationshipType: 'MEMBER_RESEARCH_AREA',
            label: 'Member lab',
          },
          {
            _id: 'rel-collab',
            sourceResearchEntityId: currentEntityId,
            targetResearchEntityId: sharedTargetId,
            relationshipType: 'COLLABORATES_WITH',
            label: 'Collaborating lab',
          },
        ]),
      )
      .mockReturnValueOnce(queryResult([]));
    mocks.researchEntityFind.mockReturnValue(
      queryResult([
        {
          _id: sharedTargetId,
          slug: 'lab-shared-target',
          name: 'Shared Target Lab',
          kind: 'lab',
          entityType: 'LAB',
          departments: ['Physics'],
          studentVisibilityTier: 'student_ready',
          archived: false,
          ...validPublicDescriptions,
        },
      ]),
    );

    const result = await listResearchEntityRelationshipPayload(currentEntityId);

    expect(result.relatedResearchEntities).toHaveLength(1);
    expect(result.relatedResearchEntities[0].slug).toBe('lab-shared-target');
    expect(result.relatedResearchEntitiesMeta).toEqual({ returned: 1, truncated: false });
    const relatedSlugs = result.relatedResearchEntities.map((entity) => entity.slug);
    expect(new Set(relatedSlugs).size).toBe(relatedSlugs.length);
  });
});

describe('buildResearchActivityLinkPayload', () => {
  it('keeps one canonical work when entity and member sources repeat the same DOI', () => {
    const result = buildResearchActivityLinkPayload({
      researchEntityId: 'entity-1',
      entityScholarlyLinks: [
        {
          _id: 'entity-link',
          title: 'Canonical paper',
          url: 'https://doi.org/10.1000/SAME',
          externalIds: { DOI: '10.1000/SAME' },
        },
      ],
      memberScholarlyLinkPairs: [
        {
          memberDisplayId: 'member-1',
          link: {
            _id: 'member-link',
            title: 'Canonical paper duplicate',
            url: 'https://doi.org/10.1000/same',
            externalIds: { doi: '10.1000/same' },
          },
        },
      ],
    });

    expect(result.researchActivityLinks).toHaveLength(1);
    expect(result.researchActivityLinks[0]).toEqual(
      expect.objectContaining({ relationshipBasis: 'explicit_entity_link' }),
    );
  });

  it('keeps earlier work separate and excludes an unsupported identity collision', () => {
    const result = buildResearchActivityLinkPayload({
      researchEntityId: 'entity-1',
      entityTopicEvidence: ['Immunology and T cell signaling'],
      memberScholarlyLinkPairs: [
        {
          memberDisplayId: 'member-1',
          appointmentStartedAt: '2020-01-01',
          link: {
            _id: 'earlier',
            title: 'Immune cell signaling',
            url: 'https://doi.org/10.1000/earlier',
            externalIds: { doi: '10.1000/earlier' },
            year: 2018,
          },
        },
        {
          memberDisplayId: 'member-1',
          link: {
            _id: 'collision',
            title: 'LGBT military personnel and veteran homelessness',
            url: 'https://doi.org/10.1000/collision',
            externalIds: { doi: '10.1000/collision' },
            year: 2025,
          },
        },
      ],
    });

    expect(result.researchActivityLinks).toEqual([]);
    expect(result.earlierResearchActivityLinks).toEqual([
      expect.objectContaining({
        title: 'Immune cell signaling',
        evidenceLabel:
          'Earlier work by a listed professor, before the documented current appointment',
      }),
    ]);
  });

  it('uses research scholarly links for entity and member research activity', () => {
    const result = buildResearchActivityLinkPayload({
      researchEntityId: 'entity-1',
      entityScholarlyLinks: [
        {
          _id: 'link-entity',
          title: 'Entity scholarly link',
          url: 'https://doi.org/10.1000/entity',
          destinationKind: 'DOI',
          displaySource: 'DOI',
          discoveredVia: 'OPENALEX',
          year: 2025,
        },
      ],
      memberScholarlyLinkPairs: [
        {
          memberDisplayId: 'user-1',
          relationshipBasis: 'identity_authorship',
          evidenceLabel: 'Authored by a verified Yale faculty identity',
          link: {
            _id: 'link-member',
            title: 'Member scholarly link',
            url: 'https://arxiv.org/pdf/2604.01023',
            destinationKind: 'ARXIV',
            displaySource: 'arXiv',
            discoveredVia: 'OPENALEX',
            year: 2026,
          },
        },
      ],
    });

    expect(result.scholarlyLinks).toEqual([
      expect.objectContaining({
        relationshipBasis: 'explicit_entity_link',
        evidenceLabel: 'Linked to this research profile',
        title: 'Entity scholarly link',
      }),
    ]);
    expect(result.memberScholarlyLinks).toEqual([
      expect.objectContaining({
        relationshipBasis: 'identity_authorship',
        evidenceLabel: 'Authored by a verified Yale faculty identity',
        title: 'Member scholarly link',
      }),
    ]);
  });
});

describe('researchDetailLeadIdentity', () => {
  const members = [
    {
      role: 'pi',
      user: {
        displayName: 'First Investigator',
        profileUrls: { official: 'https://medicine.yale.edu/profile/first-investigator/' },
      },
      row: { facultyMemberId: 'faculty-1' },
    },
    {
      role: 'co-pi',
      user: {
        displayName: 'Second Investigator',
        profileUrls: { official: 'https://medicine.yale.edu/profile/second-investigator/' },
      },
      row: { facultyMemberId: 'faculty-2', identityKey: 'faculty:second-investigator' },
    },
  ];

  it('identifies a unique lead only from entity-owned official profile evidence', () => {
    expect(
      researchDetailLeadIdentity(
        { sourceUrls: ['https://medicine.yale.edu/profile/second-investigator/'] },
        members,
      ),
    ).toEqual({
      leadIdentityStatus: 'verified',
      leadProfessorPublicKey: 'faculty-second-investigator-co-pi',
    });
  });

  it('omits the lead when entity evidence does not uniquely match a member', () => {
    expect(researchDetailLeadIdentity({ sourceUrls: [] }, members)).toEqual({
      leadIdentityStatus: 'verified',
    });
  });

  it('holds a review state when a lead name carries a birth-death lifespan (#982)', () => {
    expect(
      researchDetailLeadIdentity(
        { sourceUrls: ['https://astronomy.yale.edu/people/pierre-demarque-1932-2025'] },
        [
          {
            role: 'pi',
            user: {
              displayName: 'Pierre Demarque 1932-2025',
              profileUrls: {
                official: 'https://astronomy.yale.edu/people/pierre-demarque-1932-2025',
              },
            },
            row: { facultyMemberId: 'faculty-demarque' },
          },
        ],
      ),
    ).toEqual({ leadIdentityStatus: 'under_review' });
  });

  it('derives the public review state from canonical PI identity conflicts', () => {
    expect(
      researchDetailLeadIdentity({}, [
        {
          role: 'pi',
          user: { displayName: 'Disputed Investigator', facultyMemberId: 'faculty-user' },
          row: { userId: 'user-1', facultyMemberId: 'faculty-row' },
        },
      ]),
    ).toEqual({ leadIdentityStatus: 'under_review' });
  });

  it('preserves a review state when entity profile evidence names a different person than the displayed lead', () => {
    expect(
      researchDetailLeadIdentity(
        { sourceUrls: ['https://medicine.yale.edu/profile/vishwa-dixit/'] },
        [
          {
            role: 'pi',
            user: {
              displayName: 'Purushottam Dixit',
              profileUrls: { official: 'https://medicine.yale.edu/profile/purushottam-dixit/' },
            },
            row: { facultyMemberId: 'faculty-purushottam' },
          },
        ],
      ),
    ).toEqual({ leadIdentityStatus: 'under_review' });
  });

  it('holds a review state when a profile-less lead shares only a surname with the entity profile home', () => {
    expect(
      researchDetailLeadIdentity(
        { sourceUrls: ['https://medicine.yale.edu/profile/vishwa-dixit/'] },
        [
          {
            role: 'pi',
            user: { displayName: 'Purushottam Dixit' },
            row: { facultyMemberId: 'faculty-purushottam' },
          },
        ],
      ),
    ).toEqual({ leadIdentityStatus: 'under_review' });
  });

  it('stays verified when a profile-less lead full name matches the entity profile home', () => {
    expect(
      researchDetailLeadIdentity(
        { sourceUrls: ['https://medicine.yale.edu/profile/vishwa-dixit/'] },
        [
          {
            role: 'pi',
            user: { displayName: 'Vishwa Dixit' },
            row: { facultyMemberId: 'faculty-vishwa' },
          },
        ],
      ),
    ).toEqual({ leadIdentityStatus: 'verified' });
  });
});

describe('dedupeSameNameLeadMembers', () => {
  it('keeps the same-name PI with contact and primary department evidence', () => {
    const members = [
      {
        role: 'pi',
        row: { confidence: 0.8, sourceUrl: '' },
        user: {
          _id: 'psych-user',
          netid: 'fx1004',
          email: 'dana.fixture@yale.edu',
          fname: 'David',
          lname: 'Moore',
          primaryDepartment: 'PSYT - Psychiatry',
          secondaryDepartments: ['PHYS - Physics'],
        },
      },
      {
        role: 'pi',
        row: { confidence: 0.7, sourceUrl: 'https://physics.yale.edu/people/faculty' },
        user: {
          _id: 'physics-user',
          netid: 'dana.c.fixture',
          email: 'dana.c.fixture@yale.edu',
          fname: 'David',
          lname: 'Moore',
          primaryDepartment: 'PHYS - Physics',
          secondaryDepartments: [],
        },
      },
    ];

    expect(
      dedupeSameNameLeadMembers(members, {
        contactEmail: 'dana.c.fixture@yale.edu',
        departments: ['Physics'],
        sourceUrls: ['https://physics.yale.edu/people/faculty'],
      }),
    ).toEqual([members[1]]);
  });

  it('does not collapse distinct roles or different names', () => {
    const members = [
      { role: 'pi', user: { _id: 'a', fname: 'Fixture', lname: 'Scholar' } },
      { role: 'co-pi', user: { _id: 'b', fname: 'Fixture', lname: 'Scholar' } },
      { role: 'pi', user: { _id: 'c', fname: 'Example', lname: 'Analyst' } },
    ];

    expect(dedupeSameNameLeadMembers(members, {})).toEqual(members);
  });

  it('collapses same-person PI and director rows while keeping the PI role', () => {
    const members = [
      {
        role: 'pi',
        user: {
          publicKey: 'ryan-b-jensen-pi',
          fname: 'Ryan B.',
          lname: 'Jensen',
          title: 'Associate Professor of Therapeutic Radiology and Pathology',
          primaryDepartment: 'TRAD - Therapeutic Radiology/Radiation Oncology',
          imageUrl: 'https://ysm-res.cloudinary.com/ryan-jensen',
        },
      },
      {
        role: 'director',
        user: {
          publicKey: 'ryan-b-jensen-director',
          fname: 'Ryan B.',
          lname: 'Jensen',
          title: 'Associate Professor of Therapeutic Radiology and Pathology',
          primaryDepartment: 'TRAD - Therapeutic Radiology/Radiation Oncology',
          imageUrl: 'https://ysm-res.cloudinary.com/ryan-jensen',
        },
      },
    ];

    expect(dedupeSameNameLeadMembers(members, {})).toEqual([members[0]]);
  });
});

describe('dropUncorroboratedPhantomLeads', () => {
  it('drops a zero-confidence unreviewed same-surname phantom PI when a corroborated PI exists', () => {
    const members = [
      {
        role: 'pi',
        row: { confidence: 0, reviewStatus: 'UNREVIEWED' },
        user: { _id: 'phantom', fname: 'Michael', lname: 'Schwartz' },
      },
      {
        role: 'pi',
        row: { confidence: 0.86, reviewStatus: 'UNREVIEWED' },
        user: { _id: 'real', fname: 'Martin', lname: 'Schwartz' },
      },
      {
        role: 'director',
        row: { confidence: 1, reviewStatus: 'UNREVIEWED' },
        user: { _id: 'real', fname: 'Martin', lname: 'Schwartz' },
      },
    ];

    expect(dropUncorroboratedPhantomLeads(members)).toEqual([members[1], members[2]]);
  });

  it('keeps a solo zero-confidence inferred PI when no corroborated lead exists', () => {
    const members = [
      {
        role: 'pi',
        row: { confidence: 0, reviewStatus: 'UNREVIEWED' },
        user: { _id: 'only', fname: 'Solo', lname: 'Lead' },
      },
    ];

    expect(dropUncorroboratedPhantomLeads(members)).toEqual(members);
  });

  it('keeps a zero-confidence lead that carries evidence', () => {
    const members = [
      {
        role: 'pi',
        row: { confidence: 0.9, reviewStatus: 'UNREVIEWED' },
        user: { _id: 'real', fname: 'Real', lname: 'Lead' },
      },
      {
        role: 'co-pi',
        row: { confidence: 0, reviewStatus: 'UNREVIEWED', evidenceStatus: 'SNAPSHOT_BACKED' },
        user: { _id: 'evidenced', fname: 'Evidenced', lname: 'CoLead' },
      },
    ];

    expect(dropUncorroboratedPhantomLeads(members)).toEqual(members);
  });

  it('does not touch non-lead members', () => {
    const members = [
      {
        role: 'pi',
        row: { confidence: 0.8, reviewStatus: 'UNREVIEWED' },
        user: { _id: 'real', fname: 'Real', lname: 'Lead' },
      },
      {
        role: 'core-faculty',
        row: { confidence: 0, reviewStatus: 'UNREVIEWED' },
        user: { _id: 'member', fname: 'Team', lname: 'Member' },
      },
    ];

    expect(dropUncorroboratedPhantomLeads(members)).toEqual(members);
  });
});

describe('resolveArchivedResearchEntityCanonicalSlug', () => {
  it('resolves an archived slug to the visible canonical entity slug', async () => {
    const canonicalGroupId = new mongoose.Types.ObjectId();
    mocks.researchEntityFindOne
      .mockReturnValueOnce(leanResult({ _id: new mongoose.Types.ObjectId(), canonicalGroupId }))
      .mockReturnValueOnce(
        leanResult({
          _id: canonicalGroupId,
          slug: 'named-lab',
          archived: false,
          studentVisibilityTier: 'student_ready',
        }),
      );

    await expect(resolveArchivedResearchEntityCanonicalSlug('nsf-pi-shell')).resolves.toBe(
      'named-lab',
    );
  });

  it('returns null when the slug has no archived tombstone', async () => {
    mocks.researchEntityFindOne.mockReturnValueOnce(leanResult(null));

    await expect(resolveArchivedResearchEntityCanonicalSlug('active-lab')).resolves.toBeNull();
  });

  it('returns null when the single-hop canonical target is not publicly visible', async () => {
    mocks.researchEntityFindOne
      .mockReturnValueOnce(
        leanResult({
          _id: new mongoose.Types.ObjectId(),
          canonicalGroupId: new mongoose.Types.ObjectId(),
        }),
      )
      .mockReturnValueOnce(
        leanResult({
          _id: new mongoose.Types.ObjectId(),
          slug: 'suppressed-shell',
          archived: true,
          studentVisibilityTier: 'suppressed',
        }),
      );

    await expect(resolveArchivedResearchEntityCanonicalSlug('nsf-pi-shell')).resolves.toBeNull();
  });

  it('chains A -> B(archived) -> C(live) and resolves to C', async () => {
    const bId = new mongoose.Types.ObjectId();
    const cId = new mongoose.Types.ObjectId();
    mocks.researchEntityFindOne
      .mockReturnValueOnce(
        leanResult({ _id: new mongoose.Types.ObjectId(), canonicalGroupId: bId }),
      )
      .mockReturnValueOnce(
        leanResult({
          _id: bId,
          slug: 'nsf-pi-shell-mid',
          archived: true,
          studentVisibilityTier: 'suppressed',
          canonicalGroupId: cId,
        }),
      )
      .mockReturnValueOnce(
        leanResult({
          _id: cId,
          slug: 'dept-cs-live-lab',
          archived: false,
          studentVisibilityTier: 'student_ready',
        }),
      );

    await expect(resolveArchivedResearchEntityCanonicalSlug('nsf-pi-shell')).resolves.toBe(
      'dept-cs-live-lab',
    );
  });

  it('returns null when the chain terminates at no live public target', async () => {
    const bId = new mongoose.Types.ObjectId();
    mocks.researchEntityFindOne
      .mockReturnValueOnce(
        leanResult({ _id: new mongoose.Types.ObjectId(), canonicalGroupId: bId }),
      )
      .mockReturnValueOnce(
        leanResult({
          _id: bId,
          slug: 'nsf-pi-shell-mid',
          archived: true,
          studentVisibilityTier: 'suppressed',
          canonicalGroupId: null,
        }),
      );

    await expect(resolveArchivedResearchEntityCanonicalSlug('nsf-pi-shell')).resolves.toBeNull();
  });

  it('terminates safely on a cycle A -> B -> A', async () => {
    const aId = new mongoose.Types.ObjectId();
    const bId = new mongoose.Types.ObjectId();
    mocks.researchEntityFindOne
      .mockReturnValueOnce(leanResult({ _id: aId, canonicalGroupId: bId }))
      .mockReturnValueOnce(
        leanResult({
          _id: bId,
          slug: 'nsf-pi-shell-mid',
          archived: true,
          studentVisibilityTier: 'suppressed',
          canonicalGroupId: aId,
        }),
      );

    await expect(resolveArchivedResearchEntityCanonicalSlug('nsf-pi-shell')).resolves.toBeNull();
  });
});
