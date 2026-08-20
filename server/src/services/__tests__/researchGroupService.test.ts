import { beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  listingDistinct: vi.fn(),
  listingFind: vi.fn(),
  researchEntityFindOne: vi.fn(),
  researchEntityFind: vi.fn(),
  researchEntityRelationshipFind: vi.fn(),
  roleAssignmentFind: vi.fn(),
  personFind: vi.fn(),
  accountFind: vi.fn(),
  userFind: vi.fn(),
  facultyMemberFind: vi.fn(),
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

vi.mock('../../models/facultyMember', () => ({
  FacultyMember: {
    find: mocks.facultyMemberFind,
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
  getResearchGroupDetail,
  listResearchEntityRelationshipPayload,
  normalizeResearchSearchQuery,
  normalizeResearchGroupObjectId,
  publicMemberUserForRow,
  isFreshVerifiedOfficialRosterRow,
  publicRosterDisclosure,
  researchDetailLeadIdentity,
  searchResearchGroupsViaMeili,
} from '../researchGroupService';

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

const selectLeanResult = <T>(value: T) => queryResult(value);

const validPublicDescriptions = {
  shortDescription:
    'Studies molecular dynamics, protein folding, and cellular signaling in biological systems.',
  fullDescription:
    'This research studies molecular dynamics, protein folding, and cellular signaling across complex biological systems.',
};

beforeEach(() => {
  mocks.search.mockReset();
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
  mocks.facultyMemberFind.mockReset();
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
  mocks.facultyMemberFind.mockReturnValue(selectLeanResult([]));
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
      isShortAliasQuery: false,
    });
    expect(normalizeResearchSearchQuery('computer vision for medical imaging')).toMatchObject({
      query: 'computer vision medical imaging',
      tokens: ['computer', 'vision', 'medical', 'imaging'],
      isShortAliasQuery: false,
    });
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

  it('falls back to keyword search when a local Meili index lacks the hybrid embedder', async () => {
    const entityId = '67d8928150621bcef434a1d5';
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
        attributesToSearchOn: ['studentSearchTerms', 'researchAreas', 'keywords', 'departments'],
        facets: ['schools', 'departments'],
      }),
    );
    expect(mocks.search.mock.calls[0][1]).not.toHaveProperty('hybrid');
    expect(result.facetDistribution).toEqual({
      school: { 'Yale College': 3 },
      departments: { 'Computer Science': 2 },
    });
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

  it('does not let short AI fallback matching resolve Ailong or airway substrings', async () => {
    mocks.search.mockRejectedValueOnce(new Error('meili unavailable'));
    mocks.researchEntityFind.mockReturnValue(
      queryResult([
        {
          _id: '67d8928150621bcef434a1d5',
          slug: 'ailong-lab',
          name: 'Ailong Lab',
          shortDescription: 'Studies airway inflammation.',
          departments: [],
          researchAreas: [],
          keywords: [],
          sourceUrls: [],
        },
        {
          _id: '67d8928150621bcef434a1d6',
          slug: 'actual-ai-lab',
          name: 'Actual AI Lab',
          shortDescription: 'Builds artificial intelligence systems.',
          departments: [],
          researchAreas: ['Machine Learning'],
          keywords: [],
          sourceUrls: [],
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
        shortDescription: `Safe summary ${index} hidden${index}@example.edu`,
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
      '_id slug name displayName kind entityType departments shortDescription description fullDescription studentVisibilityTier',
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

describe('publicMemberUserForRow', () => {
  it('preserves a verified roster-only member after entity-level validation', () => {
    const publicUser = publicMemberUserForRow(
      {
        sourceName: 'official-research-home-roster',
        evidenceStatus: 'verified',
        identityKey: 'official-profile:fixture',
        membershipKey: 'official-profile:fixture|staff',
        name: 'Fixture Scholar',
        freshnessExpiresAt: '2026-08-04T00:00:00Z',
      },
      new Map(),
      new Map(),
      new Date('2026-07-14T00:00:00Z'),
    );

    expect(publicUser).toMatchObject({ fname: 'Fixture', lname: 'Scholar' });
  });

  it('preserves official profile URLs without exposing user netids', () => {
    const row = {
      userId: 'internal-user',
    };
    const usersById = new Map([
      [
        'internal-user',
        {
          _id: 'internal-user',
          netid: 'fx1001',
          fname: 'Jordan',
          lname: 'Person',
          title: 'Professor of Example Studies',
          profileUrls: {
            official: 'https://medicine.yale.edu/profile/jordan-researcher-fixture/',
          },
        },
      ],
    ]);

    const publicUser = publicMemberUserForRow(row, usersById, new Map());
    expect(publicUser).toMatchObject({
      fname: 'Jordan',
      lname: 'Person',
      profileUrls: {
        official: 'https://medicine.yale.edu/profile/jordan-researcher-fixture/',
      },
    });
    expect(publicUser).not.toHaveProperty('netid');
  });

  it('exposes an internal profile path fallback without exposing user netids', () => {
    const row = {
      userId: 'internal-user',
    };
    const usersById = new Map([
      [
        'internal-user',
        {
          _id: 'internal-user',
          netid: 'fx1001',
          fname: 'Fixture',
          lname: 'Scholar',
          title: 'Professor of Example Studies',
        },
      ],
    ]);

    const publicUser = publicMemberUserForRow(row, usersById, new Map());

    expect(publicUser).toMatchObject({
      fname: 'Fixture',
      lname: 'Scholar',
      internalProfilePath: '/profile/fx1001',
      internal_profile_path: '/profile/fx1001',
    });
    expect(publicUser).not.toHaveProperty('netid');
  });

  it('uses an internal profile path before generic website fallbacks', () => {
    const row = {
      userId: 'internal-user',
    };
    const usersById = new Map([
      [
        'internal-user',
        {
          _id: 'internal-user',
          netid: 'fx1002',
          fname: 'Fixture',
          lname: 'Website',
          title: 'Professor of Example Studies',
          website: 'https://fixture-website.example.test/',
        },
      ],
    ]);

    const publicUser = publicMemberUserForRow(row, usersById, new Map());

    expect(publicUser).toMatchObject({
      fname: 'Fixture',
      lname: 'Website',
      internalProfilePath: '/profile/fx1002',
      internal_profile_path: '/profile/fx1002',
    });
    expect(publicUser).not.toHaveProperty('website');
    expect(publicUser).not.toHaveProperty('websiteUrl');
    expect(publicUser).not.toHaveProperty('netid');
  });

  it('prefers official profile URLs over website fallbacks', () => {
    const row = {
      userId: 'internal-user',
    };
    const usersById = new Map([
      [
        'internal-user',
        {
          _id: 'internal-user',
          netid: 'fx1003',
          fname: 'Fixture',
          lname: 'Official',
          title: 'Professor of Example Studies',
          website: 'https://fixture-official.example.test/',
          profileUrls: {
            official: 'https://medicine.yale.edu/profile/fixture-official/',
          },
        },
      ],
    ]);

    const publicUser = publicMemberUserForRow(row, usersById, new Map());

    expect(publicUser).toMatchObject({
      fname: 'Fixture',
      lname: 'Official',
      profileUrls: {
        official: 'https://medicine.yale.edu/profile/fixture-official/',
      },
    });
    expect(publicUser).not.toHaveProperty('website');
    expect(publicUser).not.toHaveProperty('internalProfilePath');
    expect(publicUser).not.toHaveProperty('netid');
  });

  it('uses faculty identity and official profile URLs when a member row points at a mismatched user account', () => {
    const row = {
      userId: 'wrong-user',
      facultyMemberId: 'correct-faculty',
    };
    const usersById = new Map([
      [
        'wrong-user',
        {
          _id: 'wrong-user',
          netid: 'fx1002',
          fname: 'Wrong',
          lname: 'Person',
          title: 'Assistant Professor of Neurology',
          facultyMemberId: 'wrong-faculty',
        },
      ],
    ]);
    const facultyMembersById = new Map([
      [
        'correct-faculty',
        {
          _id: 'correct-faculty',
          netid: 'fx1003',
          firstName: 'Correct',
          lastName: 'Scholar',
          title: 'Professor of Example Studies',
          profileUrls: {
            official: 'https://medicine.yale.edu/profile/correct-scholar-fixture/',
          },
        },
      ],
    ]);

    const publicUser = publicMemberUserForRow(row, usersById, facultyMembersById);
    expect(publicUser).toMatchObject({
      title: 'Professor of Example Studies',
      profileUrls: {
        official: 'https://medicine.yale.edu/profile/correct-scholar-fixture/',
      },
    });
    expect(publicUser).not.toHaveProperty('netid');
  });

  it('applies the public email policy to faculty fallback member identities', () => {
    const row = {
      facultyMemberId: 'faculty-with-unsafe-email',
    };
    const facultyMembersById = new Map([
      [
        'faculty-with-unsafe-email',
        {
          _id: 'faculty-with-unsafe-email',
          name: 'External Collaborator',
          email: 'external.collaborator@example.com',
        },
      ],
    ]);

    const publicUser = publicMemberUserForRow(row, new Map(), facultyMembersById);
    expect(publicUser).toMatchObject({
      fname: 'External',
      lname: 'Collaborator',
    });
    expect(publicUser).not.toHaveProperty('email');
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

  it('stays verified when the sole lead has no official profile of its own to conflict', () => {
    expect(
      researchDetailLeadIdentity({ sourceUrls: ['https://medicine.yale.edu/profile/vishwa-dixit/'] }, [
        { role: 'pi', user: { displayName: 'Purushottam Dixit' }, row: { facultyMemberId: 'faculty-purushottam' } },
      ]),
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
