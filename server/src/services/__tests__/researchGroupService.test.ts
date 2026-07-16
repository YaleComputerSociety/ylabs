import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  listingDistinct: vi.fn(),
  listingFind: vi.fn(),
  researchEntityFindOne: vi.fn(),
  researchEntityFind: vi.fn(),
  researchEntityRelationshipFind: vi.fn(),
  researchGroupMemberFind: vi.fn(),
  userFind: vi.fn(),
  facultyMemberFind: vi.fn(),
  paperFind: vi.fn(),
  researchScholarlyAttributionFind: vi.fn(),
  researchScholarlyLinkFind: vi.fn(),
  entryPathwayFind: vi.fn(),
  accessSignalFind: vi.fn(),
  contactRouteFind: vi.fn(),
  postedOpportunityFind: vi.fn(),
  getAccessSummaryForResearchEntity: vi.fn(),
  listAccessSummariesForResearchEntities: vi.fn(),
  listPlanningContextsForResearchEntities: vi.fn(),
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

vi.mock('../../models/facultyMember', () => ({
  FacultyMember: {
    find: mocks.facultyMemberFind,
  },
}));

vi.mock('../../models/paper', () => ({
  Paper: {
    find: mocks.paperFind,
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

vi.mock('../../models/entryPathway', () => ({
  EntryPathway: {
    find: mocks.entryPathwayFind,
  },
}));

vi.mock('../../models/accessSignal', () => ({
  AccessSignal: {
    find: mocks.accessSignalFind,
  },
}));

vi.mock('../../models/contactRoute', () => ({
  ContactRoute: {
    find: mocks.contactRouteFind,
  },
}));

vi.mock('../../models/postedOpportunity', () => ({
  PostedOpportunity: {
    find: mocks.postedOpportunityFind,
  },
}));

vi.mock('../accessSummaryService', () => ({
  getAccessSummaryForResearchEntity: mocks.getAccessSummaryForResearchEntity,
  listAccessSummariesForResearchEntities: mocks.listAccessSummariesForResearchEntities,
}));

vi.mock('../planningContextService', () => ({
  listPlanningContextsForResearchEntities: mocks.listPlanningContextsForResearchEntities,
}));

import {
  buildLeadPiOutreachContactRoute,
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

beforeEach(() => {
  mocks.search.mockReset();
  mocks.listingDistinct.mockReset();
  mocks.listingFind.mockReset();
  mocks.researchEntityFindOne.mockReset();
  mocks.researchEntityFind.mockReset();
  mocks.listAccessSummariesForResearchEntities.mockReset();
  mocks.listPlanningContextsForResearchEntities.mockReset();
  mocks.researchEntityRelationshipFind.mockReset();
  mocks.researchGroupMemberFind.mockReset();
  mocks.userFind.mockReset();
  mocks.facultyMemberFind.mockReset();
  mocks.paperFind.mockReset();
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
  mocks.researchGroupMemberFind.mockReturnValue(queryResult([]));
  mocks.userFind.mockReturnValue(leanResult([]));
  mocks.facultyMemberFind.mockReturnValue(selectLeanResult([]));
  mocks.paperFind.mockReturnValue(sortLimitLeanResult([]));
  mocks.researchScholarlyAttributionFind.mockReturnValue(selectSortLimitLeanResult([]));
  mocks.researchScholarlyLinkFind.mockReturnValue(sortLimitLeanResult([]));
  mocks.entryPathwayFind.mockReturnValue(queryResult([]));
  mocks.accessSignalFind.mockReturnValue(queryResult([]));
  mocks.contactRouteFind.mockReturnValue(queryResult([]));
  mocks.postedOpportunityFind.mockReturnValue(queryResult([]));
  mocks.getAccessSummaryForResearchEntity.mockResolvedValue(undefined);
  mocks.listAccessSummariesForResearchEntities.mockResolvedValue(new Map());
  mocks.listPlanningContextsForResearchEntities.mockResolvedValue(new Map());
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
      researchEntities: [{ _id: 'reilly-lab', slug: 'reilly-lab', name: 'Reilly Lab' }],
    });
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
        facets: ['school', 'departments'],
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
    mocks.researchGroupMemberFind.mockReturnValue(
      queryResult([{ researchEntityId: strongEntityId, role: 'pi', userId: 'user-1' }]),
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

  it('uses only current non-archived members for public detail pages', () => {
    expect(currentResearchEntityMemberFilter('entity-1')).toEqual({
      researchEntityId: 'entity-1',
      archived: { $ne: true },
      isCurrentMember: { $ne: false },
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

  it('removes private listing ownership and contact fields from public detail payloads', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    mocks.researchEntityFindOne.mockReturnValue(
      leanResult({
        _id: entityId,
        slug: 'privacy-lab',
        name: 'Privacy Lab',
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
    mocks.entryPathwayFind.mockReturnValue(
      leanResult([
        {
          _id: '67d8928150621bcef434a1d8',
          researchEntityId: entityId,
          pathwayType: 'EXPLORATORY_CONTACT',
          status: 'PLAUSIBLE',
          evidenceStrength: 'MODERATE',
          studentFacingLabel: 'Ask about undergraduate research routes',
          explanation: 'Official page says students can ask about joining.',
          bestNextStep: 'Email private-pathway@yale.edu after reading the source.',
          compensation: 'UNKNOWN',
          sourceEvidenceIds: ['67d8928150621bcef434a1d9'],
          sourceUrls: [
            'https://privacy-lab.example.test/undergrads',
            'javascript:alert(document.cookie)',
            'mailto:pathway@yale.edu',
            'not-a-url',
          ],
          confidence: 0.72,
          derivationKey: 'private-pathway-key',
          archived: false,
          lastObservedAt: new Date('2026-01-02T00:00:00.000Z'),
          lastMaterializedAt: new Date('2026-01-03T00:00:00.000Z'),
          review: { status: 'unreviewed' },
        },
      ]),
    );
    mocks.accessSignalFind.mockReturnValue(
      sortLeanResult([
        {
          _id: '67d8928150621bcef434a1da',
          researchEntityId: entityId,
          entryPathwayId: '67d8928150621bcef434a1d8',
          signalType: 'CONTACT_INSTRUCTIONS_EXIST',
          confidence: 'HIGH',
          confidenceScore: 0.91,
          sourceEvidenceId: '67d8928150621bcef434a1d9',
          observationId: '67d8928150621bcef434a1db',
          sourceName: 'Lab site',
          sourceUrl: 'javascript:alert(document.cookie)',
          observedAt: new Date('2026-01-02T00:00:00.000Z'),
          excerpt: 'Questions can go to private-signal@yale.edu or 203-432-1234.',
          originalConfidence: 0.98,
          derivationKey: 'private-signal-key',
          archived: false,
          lastMaterializedAt: new Date('2026-01-03T00:00:00.000Z'),
          review: { status: 'unreviewed' },
        },
      ]),
    );
    mocks.postedOpportunityFind.mockReturnValue(
      sortLeanResult([
        {
          _id: '67d8928150621bcef434a1dc',
          entryPathwayId: '67d8928150621bcef434a1d8',
          researchEntityId: entityId,
          listingId: '67d8928150621bcef434a1d6',
          title: 'Undergraduate RA role',
          term: 'Spring 2026',
          deadline: new Date('2026-02-01T00:00:00.000Z'),
          applicationUrl: 'javascript:alert(document.cookie)',
          status: 'OPEN',
          sourceEvidenceIds: ['67d8928150621bcef434a1d9'],
          sourceUrls: [
            'https://privacy-lab.example.test/apply',
            'data:text/html,<script>alert(1)</script>',
            'mailto:opportunity@yale.edu',
            'not-a-url',
          ],
          derivationKey: 'private-opportunity-key',
          archived: false,
          review: { status: 'unreviewed' },
        },
      ]),
    );

    const detail = await getResearchGroupDetail('privacy-lab');

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

    expect(detail?.entryPathways[0]).toEqual(
      expect.objectContaining({
        pathwayType: 'EXPLORATORY_CONTACT',
        bestNextStep: 'Email [email redacted] after reading the source.',
        sourceUrls: ['https://privacy-lab.example.test/undergrads'],
      }),
    );
    expect(detail?.entryPathways[0]).not.toHaveProperty('sourceEvidenceIds');
    expect(detail?.entryPathways[0]).not.toHaveProperty('derivationKey');
    expect(detail?.entryPathways[0]).not.toHaveProperty('archived');
    expect(detail?.entryPathways[0]).not.toHaveProperty('lastMaterializedAt');
    expect(detail?.entryPathways[0]).not.toHaveProperty('review');

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

    expect(detail?.postedOpportunities[0]).toEqual(
      expect.objectContaining({
        title: 'Undergraduate RA role',
        sourceUrls: ['https://privacy-lab.example.test/apply'],
      }),
    );
    expect(detail?.postedOpportunities[0].applicationUrl).toBeUndefined();
    expect(detail?.postedOpportunities[0]).not.toHaveProperty('sourceEvidenceIds');
    expect(detail?.postedOpportunities[0]).not.toHaveProperty('derivationKey');
    expect(detail?.postedOpportunities[0]).not.toHaveProperty('archived');
    expect(detail?.postedOpportunities[0]).not.toHaveProperty('review');
    expect(detail?.researchEntity).not.toHaveProperty('rosterEnrichment');
  });

  it('allowlists public member user fields in public detail payloads', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    mocks.researchEntityFindOne.mockReturnValue(
      leanResult({
        _id: entityId,
        slug: 'member-privacy-lab',
        name: 'Member Privacy Lab',
        departments: [],
        researchAreas: [],
        sourceUrls: [],
        studentVisibilityTier: 'student_ready',
      }),
    );
    mocks.researchGroupMemberFind.mockReturnValue(
      sortLimitLeanResult([
        {
          _id: 'member-1',
          researchEntityId: entityId,
          userId: 'user-1',
          role: 'affiliated',
          archived: false,
          isCurrentMember: true,
        },
      ]),
    );
    mocks.userFind.mockReturnValue(
      leanResult([
        {
          _id: 'user-1',
          netid: 'abc123',
          fname: 'Fixture',
          lname: 'Advisor',
          displayName: 'Fixture Advisor',
          email: 'fixture.advisor@example.edu',
          imageUrl: '',
          primaryDepartment: 'Computer Science',
          title: 'Professor of Computer Science',
          secondaryDepartments: ['Mathematics'],
          facultyMemberId: 'faculty-1',
          profileUrls: {
            official: 'https://cs.yale.edu/people/fixture-advisor',
            orcid: 'https://orcid.org/0000-0000-0000-0000',
          },
          googleScholarId: 'private-scholar-id',
          openAlexId: 'private-openalex-id',
          userConfirmed: true,
          userType: 'professor',
          raw: { scrapePayload: true },
        },
      ]),
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
      publicKey: 'fixture-advisor-affiliated',
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
    mocks.researchEntityFindOne.mockReturnValue(
      leanResult({
        _id: entityId,
        slug: 'member-internal-profile-lab',
        name: 'Member Internal Profile Lab',
        departments: [],
        researchAreas: [],
        sourceUrls: [],
        studentVisibilityTier: 'student_ready',
      }),
    );
    mocks.researchGroupMemberFind.mockReturnValue(
      sortLimitLeanResult([
        {
          _id: 'member-1',
          researchEntityId: entityId,
          userId: 'user-1',
          role: 'pi',
          archived: false,
          isCurrentMember: true,
        },
      ]),
    );
    mocks.userFind.mockReturnValue(
      leanResult([
        {
          _id: 'user-1',
          netid: 'fx1001',
          fname: 'Fixture',
          lname: 'Scholar',
          imageUrl: '',
          primaryDepartment: 'Example Studies',
          title: 'Professor',
        },
      ]),
    );

    const detail = await getResearchGroupDetail('member-internal-profile-lab');

    expect(detail?.members[0].user).toMatchObject({
      fname: 'Fixture',
      lname: 'Scholar',
      internalProfilePath: '/profile/fx1001',
      internal_profile_path: '/profile/fx1001',
      publicKey: 'fixture-scholar-pi',
    });
    expect(detail?.members[0].user).not.toHaveProperty('netid');
  });

  it('minimizes public research detail paper payloads', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    mocks.researchEntityFindOne.mockReturnValue(
      leanResult({
        _id: entityId,
        slug: 'paper-privacy-lab',
        name: 'Paper Privacy Lab',
        departments: [],
        researchAreas: [],
        sourceUrls: [],
        studentVisibilityTier: 'student_ready',
      }),
    );
    mocks.researchGroupMemberFind.mockReturnValue(
      sortLimitLeanResult([
        {
          _id: 'member-1',
          researchEntityId: entityId,
          userId: '67d8928150621bcef434a1d6',
          role: 'pi',
          archived: false,
          isCurrentMember: true,
        },
      ]),
    );
    mocks.userFind.mockReturnValue(
      leanResult([
        {
          _id: '67d8928150621bcef434a1d6',
          fname: 'Fixture',
          lname: 'Analyst',
          imageUrl: '',
          primaryDepartment: 'Computer Science',
          title: 'Professor',
        },
      ]),
    );
    mocks.paperFind
      .mockReturnValueOnce(
        sortLimitLeanResult([
          {
            _id: 'internal-paper-id',
            title: 'Email fixture.person@example.edu about this paper',
            authors: ['Fixture Analyst', 'Call 203-555-1212'],
            year: 2025,
            venue: 'Journal of Privacy',
            tldr: 'Questions to hidden@example.edu.',
            doi: '10.1000/privacy',
            url: 'javascript:alert(document.cookie)',
            openAccessUrl: 'https://example.edu/open',
            landingPageUrl: 'https://example.edu/landing',
            pdfUrl: 'https://example.edu/paper.pdf',
            citationCount: 12,
            publishedAt: new Date('2025-01-01T00:00:00.000Z'),
            publicationStage: 'PUBLISHED',
            yaleAuthorIds: ['67d8928150621bcef434a1d6'],
            yaleAuthorNetIds: ['abc123'],
            facultyMemberIds: ['faculty-1'],
            researchEntityIds: [entityId],
            sourceIds: ['source-1'],
            fieldProvenance: { title: { source: 'scraper' } },
            confidenceByField: { title: 0.9 },
            manuallyLockedFields: ['title'],
            externalIds: { secret: 'raw' },
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-02T00:00:00.000Z'),
          },
        ]),
      )
      .mockReturnValueOnce(
        sortLimitLeanResult([
          {
            _id: 'internal-preprint-id',
            title: 'Preprint',
            arxivId: '2501.12345',
            pdfUrl: 'https://arxiv.org/pdf/2501.12345',
            postedAt: new Date('2025-02-01T00:00:00.000Z'),
            publicationStage: 'PREPRINT',
            preprintServer: 'arxiv',
            yaleAuthorNetIds: ['abc123'],
          },
        ]),
      );

    const detail = await getResearchGroupDetail('paper-privacy-lab');

    expect(detail?.recentPapers[0]).toMatchObject({
      _id: '10-1000-privacy-2025',
      title: 'Email [email redacted] about this paper',
      authors: ['Fixture Analyst', 'Call [phone redacted]'],
      tldr: 'Questions to [email redacted].',
      doi: '10.1000/privacy',
      openAccessUrl: 'https://example.edu/open',
      landingPageUrl: 'https://example.edu/landing',
      pdfUrl: 'https://example.edu/paper.pdf',
      citationCount: 12,
      publishedAt: '2025-01-01T00:00:00.000Z',
      publicationStage: 'PUBLISHED',
    });
    expect(detail?.recentPapers[0]).not.toHaveProperty('url');
    expect(detail?.recentPapers[0]).not.toHaveProperty('yaleAuthorIds');
    expect(detail?.recentPapers[0]).not.toHaveProperty('yaleAuthorNetIds');
    expect(detail?.recentPapers[0]).not.toHaveProperty('facultyMemberIds');
    expect(detail?.recentPapers[0]).not.toHaveProperty('researchEntityIds');
    expect(detail?.recentPapers[0]).not.toHaveProperty('sourceIds');
    expect(detail?.recentPapers[0]).not.toHaveProperty('fieldProvenance');
    expect(detail?.recentPapers[0]).not.toHaveProperty('confidenceByField');
    expect(detail?.recentPapers[0]).not.toHaveProperty('manuallyLockedFields');
    expect(detail?.recentPapers[0]).not.toHaveProperty('externalIds');
    expect(detail?.recentPapers[0]).not.toHaveProperty('createdAt');
    expect(detail?.recentPapers[0]).not.toHaveProperty('updatedAt');
    expect(detail?.recentArxivPreprints[0]).toMatchObject({
      _id: '2501-12345',
      title: 'Preprint',
      arxivId: '2501.12345',
      pdfUrl: 'https://arxiv.org/pdf/2501.12345',
      postedAt: '2025-02-01T00:00:00.000Z',
      publicationStage: 'PREPRINT',
      preprintServer: 'arxiv',
    });
    expect(detail?.recentArxivPreprints[0]).not.toHaveProperty('yaleAuthorNetIds');
  });

  it('dedupes repeated stored public contact routes before returning detail payloads', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    mocks.researchEntityFindOne.mockReturnValue(
      leanResult({
        _id: entityId,
        slug: 'duplicate-route-lab',
        name: 'Duplicate Route Lab',
        departments: [],
        researchAreas: [],
        sourceUrls: [],
        studentVisibilityTier: 'student_ready',
      }),
    );
    mocks.contactRouteFind.mockReturnValue(
      sortLeanResult([
        {
          _id: 'route-1',
          routeType: 'FACULTY_PI',
          label: 'Meg Urry',
          url: 'https://astronomy.yale.edu/people/meg-urry',
          sourceUrl: 'https://astronomy.yale.edu/people/meg-urry',
          priority: 60,
          visibility: 'PUBLIC',
          contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
          rationale: 'Official Yale faculty profile for the PI; review it before outreach.',
        },
        {
          _id: 'route-2',
          routeType: 'FACULTY_PI',
          label: 'Meg Urry',
          url: 'https://astronomy.yale.edu/people/meg-urry/',
          sourceUrl: 'https://astronomy.yale.edu/people/meg-urry',
          priority: 60,
          visibility: 'PUBLIC',
          contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
          rationale: 'Official Yale faculty profile for the PI; review it before outreach.',
        },
        {
          _id: 'route-3',
          routeType: 'DEPARTMENT_CONTACT',
          label: 'Astronomy department',
          url: 'https://astronomy.yale.edu/contact',
          sourceUrl: 'https://astronomy.yale.edu/contact',
          priority: 40,
          visibility: 'PUBLIC',
          contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
        },
        {
          _id: 'route-unsafe',
          routeType: 'PROGRAM_CONTACT',
          label: 'Unsafe application route',
          url: 'javascript:alert(document.cookie)',
          sourceUrl: 'mailto:hidden@yale.edu',
          priority: 10,
          visibility: 'PUBLIC',
          contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
        },
      ]),
    );

    const detail = await getResearchGroupDetail('duplicate-route-lab');

    expect(detail?.contactRoutes).toEqual([
      expect.objectContaining({
        routeType: 'PROGRAM_CONTACT',
      }),
      expect.objectContaining({
        routeType: 'DEPARTMENT_CONTACT',
        url: 'https://astronomy.yale.edu/contact',
      }),
      expect.objectContaining({
        routeType: 'FACULTY_PI',
        url: 'https://astronomy.yale.edu/people/meg-urry',
      }),
    ]);
    const unsafeRoute = detail?.contactRoutes.find((route) => route._id === 'route-unsafe');
    expect(unsafeRoute?.url).toBeUndefined();
    expect(unsafeRoute?.sourceUrl).toBeUndefined();
  });

  it('corrects non-PI leading possessive names in public descriptions', async () => {
    const entityId = '67d8928150621bcef434a1d5';
    mocks.researchEntityFindOne.mockReturnValue(
      leanResult({
        _id: entityId,
        slug: 'glahn-lab-dcg32',
        name: 'Glahn Lab',
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
    mocks.researchGroupMemberFind.mockReturnValue(
      leanResult([
        {
          _id: 'member-1',
          researchEntityId: entityId,
          userId: 'fx1001',
          role: 'pi',
          archived: false,
          isCurrentMember: true,
        },
      ]),
    );
    mocks.userFind.mockReturnValue(
      leanResult([
        {
          _id: 'fx1001',
          fname: 'David',
          lname: 'Glahn',
          displayName: 'David Glahn',
          primaryDepartment: 'Psychiatry',
          imageUrl: '',
          netid: 'fx1001',
        },
      ]),
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
    mocks.researchGroupMemberFind.mockReturnValue(
      leanResult([
        {
          _id: 'member-1',
          researchEntityId: entityId,
          userId: 'fx1001',
          role: 'pi',
          archived: false,
          isCurrentMember: true,
        },
      ]),
    );
    mocks.userFind.mockReturnValue(
      leanResult([
        {
          _id: 'fx1001',
          fname: 'David',
          lname: 'Glahn',
          displayName: 'David Glahn',
          primaryDepartment: 'Psychiatry',
          imageUrl: '',
          netid: 'fx1001',
        },
      ]),
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

  it('separates explicit entity paper links from member-authored activity links', () => {
    const result = buildResearchActivityLinkPayload({
      researchEntityId: 'entity-1',
      entityLinkedPapers: [
        {
          _id: 'paper-entity',
          title: 'Entity linked paper',
          doi: '10.1000/entity',
          year: 2025,
          sources: ['openalex'],
        },
      ],
      memberPaperPairs: [
        {
          memberDisplayId: 'user-1',
          paper: {
            _id: 'paper-member',
            title: 'Member authored paper',
            doi: '10.1000/member',
            year: 2024,
            sources: ['orcid'],
          },
        },
      ],
    });

    expect(result.scholarlyLinks).toEqual([
      expect.objectContaining({
        relationshipBasis: 'explicit_entity_link',
        evidenceLabel: 'Linked to this research profile',
        title: 'Entity linked paper',
      }),
    ]);
    expect(result.memberScholarlyLinks).toEqual([
      expect.objectContaining({
        relationshipBasis: 'member_authorship',
        evidenceLabel: 'Authored by a listed professor',
        title: 'Member authored paper',
      }),
    ]);
    expect(result.researchActivityLinks).toHaveLength(2);
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
          lname: 'Researcher',
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
      lname: 'Researcher',
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

describe('buildLeadPiOutreachContactRoute', () => {
  it('derives a single PI outreach route from the attached lead member email', () => {
    const route = buildLeadPiOutreachContactRoute(
      [
        {
          role: 'pi',
          user: {
            _id: 'user-1',
            fname: 'Jordan',
            lname: 'Researcher',
            email: 'jordan.researcher@yale.edu',
          },
          row: { sourceUrl: 'https://medicine.yale.edu/profile/jordan-researcher' },
        },
      ],
      { websiteUrl: 'https://lab.example.test', contactEmail: '' },
    );

    expect(route).toMatchObject({
      routeType: 'FACULTY_PI',
      label: 'Jordan Researcher',
      name: 'Jordan Researcher',
      visibility: 'PUBLIC',
      contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
      sourceUrl: 'https://medicine.yale.edu/profile/jordan-researcher',
    });
    expect(route).not.toHaveProperty('email');
  });

  it('does not derive a public PI outreach route from an unsafe attached email', () => {
    const route = buildLeadPiOutreachContactRoute(
      [
        {
          role: 'pi',
          user: {
            _id: 'user-1',
            fname: 'Jordan',
            lname: 'Researcher',
            email: 'jordan.researcher@yale.edu?bcc=attacker@example.test',
          },
          row: { sourceUrl: 'https://physics.yale.edu/people/faculty' },
        },
      ],
      { websiteUrl: 'https://lab.example.test', contactEmail: '' },
    );

    expect(route).toBeNull();
  });

  it('uses the attached PI official profile URL as the public route URL', () => {
    const route = buildLeadPiOutreachContactRoute(
      [
        {
          role: 'pi',
          user: {
            _id: 'user-1',
            fname: 'Jordan',
            lname: 'Researcher',
            email: 'jordan.researcher@yale.edu',
            profileUrls: {
              official: 'https://medicine.yale.edu/profile/jordan-researcher/',
            },
          },
          row: { sourceUrl: 'https://profile.example.test/jordan-researcher' },
        },
      ],
      { websiteUrl: 'https://lab.example.test', contactEmail: '' },
    );

    expect(route).toMatchObject({
      routeType: 'FACULTY_PI',
      url: 'https://medicine.yale.edu/profile/jordan-researcher/',
      sourceUrl: 'https://medicine.yale.edu/profile/jordan-researcher/',
    });
  });

  it('does not use credential-bearing official profile URLs in public PI routes', () => {
    const route = buildLeadPiOutreachContactRoute(
      [
        {
          role: 'pi',
          user: {
            _id: 'user-1',
            fname: 'Jordan',
            lname: 'Researcher',
            profileUrls: {
              official: 'https://operator:secret@medicine.yale.edu/profile/jordan-researcher/',
            },
          },
          row: {
            sourceUrl: 'https://operator:secret@medicine.yale.edu/profile/jordan-researcher/',
          },
        },
      ],
      { websiteUrl: 'https://operator:secret@lab.example.test', contactEmail: '' },
    );

    expect(route).toBeNull();
  });

  it('uses an attached PI official profile URL even when the email is unavailable', () => {
    const route = buildLeadPiOutreachContactRoute(
      [
        {
          role: 'pi',
          user: {
            _id: 'user-1',
            fname: 'Jordan',
            lname: 'Researcher',
            profileUrls: {
              official: 'https://medicine.yale.edu/profile/jordan-researcher/',
            },
          },
        },
      ],
      { websiteUrl: 'https://lab.example.test', contactEmail: '' },
    );

    expect(route).toMatchObject({
      routeType: 'FACULTY_PI',
      label: 'Jordan Researcher',
      url: 'https://medicine.yale.edu/profile/jordan-researcher/',
      sourceUrl: 'https://medicine.yale.edu/profile/jordan-researcher/',
      contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
    });
    expect(route).not.toHaveProperty('email');
  });

  it('keeps the attached PI official profile URL when an explicit lab contact email exists', () => {
    const route = buildLeadPiOutreachContactRoute(
      [
        {
          role: 'pi',
          user: {
            _id: 'user-1',
            fname: 'Jordan',
            lname: 'Researcher',
            email: 'jordan.researcher@yale.edu',
            profileUrls: {
              official: 'https://medicine.yale.edu/profile/jordan-researcher/',
            },
          },
        },
      ],
      { contactEmail: 'lab-manager@yale.edu' },
    );

    expect(route).toMatchObject({
      routeType: 'FACULTY_PI',
      url: 'https://medicine.yale.edu/profile/jordan-researcher/',
      sourceUrl: 'https://medicine.yale.edu/profile/jordan-researcher/',
      contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
    });
  });

  it('does not promote a generic Yale faculty roster URL as the official profile action', () => {
    const route = buildLeadPiOutreachContactRoute(
      [
        {
          role: 'pi',
          user: {
            _id: 'user-1',
            fname: 'Jordan',
            lname: 'Researcher',
            email: 'jordan.researcher@yale.edu',
          },
          row: { sourceUrl: 'https://physics.yale.edu/people/faculty' },
        },
      ],
      { websiteUrl: 'https://lab.example.test', contactEmail: '' },
    );

    expect(route).toBeNull();
  });

  it('does not promote a generic Yale faculty category URL as the official profile action', () => {
    const route = buildLeadPiOutreachContactRoute(
      [
        {
          role: 'pi',
          user: {
            _id: 'user-1',
            fname: 'Jordan',
            lname: 'Researcher',
          },
          row: { sourceUrl: 'https://example.yale.edu/people/faculty/primary' },
        },
      ],
      { websiteUrl: 'https://lab.example.test', contactEmail: '' },
    );

    expect(route).toBeNull();
  });

  it('uses person-scoped Yale Engineering faculty-directory pages as official profile actions', () => {
    const route = buildLeadPiOutreachContactRoute(
      [
        {
          role: 'pi',
          user: {
            _id: 'user-1',
            fname: 'Jordan',
            lname: 'Researcher',
            email: 'jordan.researcher@yale.edu',
            profileUrls: {
              departmental:
                'https://engineering.yale.edu/research-and-faculty/faculty-directory/jordan-researcher',
            },
          },
        },
      ],
      { websiteUrl: 'https://lab.example.test', contactEmail: '' },
    );

    expect(route).toMatchObject({
      routeType: 'FACULTY_PI',
      url: 'https://engineering.yale.edu/research-and-faculty/faculty-directory/jordan-researcher',
      sourceUrl:
        'https://engineering.yale.edu/research-and-faculty/faculty-directory/jordan-researcher',
    });
  });

  it('does not derive a PI email route when an explicit group contact email exists and no official profile URL is known', () => {
    expect(
      buildLeadPiOutreachContactRoute(
        [
          {
            role: 'pi',
            user: {
              fname: 'Jordan',
              lname: 'Researcher',
              email: 'jordan.researcher@yale.edu',
            },
          },
        ],
        { contactEmail: 'lab-manager@yale.edu' },
      ),
    ).toBeNull();
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
