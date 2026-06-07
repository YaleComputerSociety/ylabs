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

import {
  buildLeadPiOutreachContactRoute,
  buildResearchActivityLinkPayload,
  currentResearchEntityMemberFilter,
  dedupeSameNameLeadMembers,
  getResearchGroupDetail,
  listResearchEntityRelationshipPayload,
  publicMemberUserForRow,
  searchResearchGroupsViaMeili,
} from '../researchGroupService';

const leanResult = <T,>(value: T) => ({
  lean: async () => value,
});

const sortLeanResult = <T,>(value: T) => ({
  sort: () => leanResult(value),
});

const sortLimitLeanResult = <T,>(value: T) => ({
  sort: () => ({
    limit: () => leanResult(value),
  }),
});

const selectSortLimitLeanResult = <T,>(value: T) => ({
  select: () => sortLimitLeanResult(value),
});

const selectLeanResult = <T,>(value: T) => ({
  select: () => leanResult(value),
});

beforeEach(() => {
  mocks.search.mockReset();
  mocks.listingDistinct.mockReset();
  mocks.listingFind.mockReset();
  mocks.researchEntityFindOne.mockReset();
  mocks.researchEntityFind.mockReset();
  mocks.listAccessSummariesForResearchEntities.mockReset();
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
  mocks.listingFind.mockReturnValue(leanResult([]));
  mocks.researchEntityFind.mockReturnValue({
    lean: async () => [],
  });
  mocks.researchEntityRelationshipFind.mockReturnValue(leanResult([]));
  mocks.researchGroupMemberFind.mockReturnValue(leanResult([]));
  mocks.userFind.mockReturnValue(leanResult([]));
  mocks.facultyMemberFind.mockReturnValue(selectLeanResult([]));
  mocks.paperFind.mockReturnValue(sortLimitLeanResult([]));
  mocks.researchScholarlyAttributionFind.mockReturnValue(selectSortLimitLeanResult([]));
  mocks.researchScholarlyLinkFind.mockReturnValue(sortLimitLeanResult([]));
  mocks.entryPathwayFind.mockReturnValue(leanResult([]));
  mocks.accessSignalFind.mockReturnValue(sortLeanResult([]));
  mocks.contactRouteFind.mockReturnValue(sortLeanResult([]));
  mocks.postedOpportunityFind.mockReturnValue(sortLeanResult([]));
  mocks.getAccessSummaryForResearchEntity.mockResolvedValue(undefined);
  mocks.listAccessSummariesForResearchEntities.mockResolvedValue(new Map());
});

describe('searchResearchGroupsViaMeili', () => {
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
    mocks.researchEntityFind.mockReturnValue({
      lean: async () => [
        {
          _id: entityId,
          slug: 'reilly-lab',
          name: 'Reilly Lab',
          kind: 'lab',
          departments: ['Chemistry'],
          researchAreas: [],
          sourceUrls: [],
        },
      ],
    });

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
      researchEntities: [{ _id: entityId, slug: 'reilly-lab', name: 'Reilly Lab' }],
    });
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
    mocks.researchEntityFind.mockReturnValue({
      lean: async () => [
        {
          _id: currentEntityId,
          slug: 'current-lab',
          name: 'Current Lab',
          kind: 'lab',
          departments: ['Chemistry'],
          researchAreas: [],
          sourceUrls: [],
        },
      ],
    });

    const result = await searchResearchGroupsViaMeili('', {}, 1, 2);

    expect(mocks.researchEntityFind).toHaveBeenCalledWith({
      _id: { $in: [staleEntityId, currentEntityId] },
      archived: { $ne: true },
      studentVisibilityTier: { $in: ['student_ready'] },
    });
    expect(result.researchEntities).toEqual([
      expect.objectContaining({
        _id: currentEntityId,
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

  it('allows admin searches to resolve explicitly requested non-public visibility tiers', async () => {
    const reviewEntityId = '67d8928150621bcef434a1d7';
    mocks.search.mockResolvedValueOnce({
      hits: [{ id: reviewEntityId, slug: 'review-lab', name: 'Review Lab' }],
      estimatedTotalHits: 1,
    });
    mocks.researchEntityFind.mockReturnValue({
      lean: async () => [
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
      ],
    });

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
      expect.objectContaining({ _id: reviewEntityId, studentVisibilityTier: 'operator_review' }),
    ]);
  });

  it('sorts and filters admin default browse by weakest quality first', async () => {
    const strongEntityId = '67d8928150621bcef434a1d8';
    const weakEntityId = '67d8928150621bcef434a1d9';
    mocks.researchEntityFind.mockReturnValue({
      lean: async () => [
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
      ],
    });
    mocks.researchGroupMemberFind.mockReturnValue({
      lean: async () => [{ researchEntityId: strongEntityId, role: 'pi', userId: 'user-1' }],
    });

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
        _id: weakEntityId,
        qualitySummary: expect.objectContaining({
          repairFlags: expect.arrayContaining(['missing_lead']),
        }),
      }),
    ]);
  });
});

describe('getResearchGroupDetail', () => {
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
        _id: '67d8928150621bcef434a1d8',
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
        _id: '67d8928150621bcef434a1da',
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
        _id: '67d8928150621bcef434a1dc',
        title: 'Undergraduate RA role',
        sourceUrls: ['https://privacy-lab.example.test/apply'],
      }),
    );
    expect(detail?.postedOpportunities[0].applicationUrl).toBeUndefined();
    expect(detail?.postedOpportunities[0]).not.toHaveProperty('sourceEvidenceIds');
    expect(detail?.postedOpportunities[0]).not.toHaveProperty('derivationKey');
    expect(detail?.postedOpportunities[0]).not.toHaveProperty('archived');
    expect(detail?.postedOpportunities[0]).not.toHaveProperty('review');
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
      leanResult([
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
          fname: 'Ada',
          lname: 'Lovelace',
          displayName: 'Ada Lovelace',
          email: 'ada.lovelace@yale.edu',
          imageUrl: '',
          primaryDepartment: 'Computer Science',
          title: 'Professor of Computer Science',
          secondaryDepartments: ['Mathematics'],
          facultyMemberId: 'faculty-1',
          profileUrls: {
            official: 'https://cs.yale.edu/people/ada-lovelace',
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
      _id: 'user-1',
      netid: 'abc123',
      fname: 'Ada',
      lname: 'Lovelace',
      displayName: 'Ada Lovelace',
      imageUrl: '',
      image_url: '',
      primaryDepartment: 'Computer Science',
      primary_department: 'Computer Science',
      title: 'Professor of Computer Science',
    });
    expect(detail?.members[0].user).not.toHaveProperty('email');
    expect(detail?.members[0].user).not.toHaveProperty('secondaryDepartments');
    expect(detail?.members[0].user).not.toHaveProperty('facultyMemberId');
    expect(detail?.members[0].user).not.toHaveProperty('profileUrls');
    expect(detail?.members[0].user).not.toHaveProperty('googleScholarId');
    expect(detail?.members[0].user).not.toHaveProperty('openAlexId');
    expect(detail?.members[0].user).not.toHaveProperty('userConfirmed');
    expect(detail?.members[0].user).not.toHaveProperty('userType');
    expect(detail?.members[0].user).not.toHaveProperty('raw');
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
        _id: 'route-unsafe',
        routeType: 'PROGRAM_CONTACT',
      }),
      expect.objectContaining({
        _id: 'route-3',
        routeType: 'DEPARTMENT_CONTACT',
        url: 'https://astronomy.yale.edu/contact',
      }),
      expect.objectContaining({
        _id: 'route-1',
        routeType: 'FACULTY_PI',
        url: 'https://astronomy.yale.edu/people/meg-urry',
      }),
    ]);
    const unsafeRoute = detail?.contactRoutes.find((route) => route._id === 'route-unsafe');
    expect(unsafeRoute?.url).toBeUndefined();
    expect(unsafeRoute?.sourceUrl).toBeUndefined();
  });
});

describe('listResearchEntityRelationshipPayload', () => {
  it('returns only launch-public umbrella affiliations for public research detail payloads', async () => {
    const currentEntityId = '67d8928150621bcef434a1d5';
    const publicInstituteId = '67d8928150621bcef434a1d6';
    const reviewInstituteId = '67d8928150621bcef434a1d7';

    mocks.researchEntityRelationshipFind.mockReturnValue({
      lean: async () => [
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
      ],
    });
    mocks.researchEntityFind.mockReturnValue({
      lean: async () => [
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
      ],
    });

    const result = await listResearchEntityRelationshipPayload(currentEntityId);

    expect(mocks.researchEntityRelationshipFind).toHaveBeenCalledWith({
      archived: { $ne: true },
      $or: [
        { sourceResearchEntityId: currentEntityId },
        { targetResearchEntityId: currentEntityId },
      ],
    });
    expect(mocks.researchEntityFind).toHaveBeenCalledWith({
      _id: { $in: [publicInstituteId, reviewInstituteId] },
      archived: { $ne: true },
      studentVisibilityTier: { $in: ['student_ready'] },
    });
    expect(result).toEqual({
      entityRelationships: [],
      relatedResearchEntities: [],
      affiliatedRelationships: [
        expect.objectContaining({
          _id: 'rel-yqi',
          sourceResearchEntityId: publicInstituteId,
          targetResearchEntityId: currentEntityId,
        }),
      ],
      affiliatedResearchEntities: [
        expect.objectContaining({
          _id: publicInstituteId,
          slug: 'center-yale-quantum-institute',
          name: 'Yale Quantum Institute',
        }),
      ],
    });
    expect(result.affiliatedRelationships[0].sourceUrl).toBeUndefined();
    expect(result.affiliatedRelationships[0]).not.toHaveProperty('evidenceQuote');
    expect(result.affiliatedRelationships[0]).not.toHaveProperty('createdAt');
    expect(JSON.stringify(result)).not.toContain('hidden@example.edu');
  });
});

describe('buildResearchActivityLinkPayload', () => {
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
        _id: 'link-entity',
        researchEntityId: 'entity-1',
        relationshipBasis: 'explicit_entity_link',
        evidenceLabel: 'Linked to this research profile',
        title: 'Entity scholarly link',
      }),
    ]);
    expect(result.memberScholarlyLinks).toEqual([
      expect.objectContaining({
        _id: 'link-member',
        userId: 'user-1',
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
        _id: 'paper-entity',
        researchEntityId: 'entity-1',
        relationshipBasis: 'explicit_entity_link',
        evidenceLabel: 'Linked to this research profile',
        title: 'Entity linked paper',
      }),
    ]);
    expect(result.memberScholarlyLinks).toEqual([
      expect.objectContaining({
        _id: 'paper-member',
        userId: 'user-1',
        relationshipBasis: 'member_authorship',
        evidenceLabel: 'Authored by a listed professor',
        title: 'Member authored paper',
      }),
    ]);
    expect(result.researchActivityLinks.map((link) => link._id)).toEqual([
      'paper-entity',
      'paper-member',
    ]);
  });
});

describe('publicMemberUserForRow', () => {
  it('uses faculty identity when a member row points at a mismatched user account', () => {
    const row = {
      userId: 'wrong-user',
      facultyMemberId: 'correct-faculty',
    };
    const usersById = new Map([
      [
        'wrong-user',
        {
          _id: 'wrong-user',
          netid: 'jp2492',
          fname: 'John',
          lname: 'Peters',
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
          netid: 'jdp52',
          firstName: 'John',
          lastName: 'Peters',
          title: 'Maria Rosa Menocal Professor of English and of Film and Media Studies',
        },
      ],
    ]);

    expect(publicMemberUserForRow(row, usersById, facultyMembersById)).toMatchObject({
      netid: 'jdp52',
      title: 'Maria Rosa Menocal Professor of English and of Film and Media Studies',
    });
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
          row: { sourceUrl: 'https://profile.example.test/jordan-researcher' },
        },
      ],
      { websiteUrl: 'https://lab.example.test', contactEmail: '' },
    );

    expect(route).toMatchObject({
      routeType: 'FACULTY_PI',
      label: 'Jordan Researcher',
      name: 'Jordan Researcher',
      email: 'jordan.researcher@yale.edu',
      visibility: 'PUBLIC',
      contactPolicy: 'DIRECT_CONTACT_OK',
      sourceUrl: 'https://profile.example.test/jordan-researcher',
    });
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

    expect(route).toMatchObject({
      routeType: 'FACULTY_PI',
      email: 'jordan.researcher@yale.edu',
      sourceUrl: 'https://physics.yale.edu/people/faculty',
    });
    expect(route).not.toHaveProperty('url');
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
          netid: 'dtm27',
          email: 'david.moore@yale.edu',
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
          netid: 'david.c.moore',
          email: 'david.c.moore@yale.edu',
          fname: 'David',
          lname: 'Moore',
          primaryDepartment: 'PHYS - Physics',
          secondaryDepartments: [],
        },
      },
    ];

    expect(
      dedupeSameNameLeadMembers(members, {
        contactEmail: 'david.c.moore@yale.edu',
        departments: ['Physics'],
        sourceUrls: ['https://physics.yale.edu/people/faculty'],
      }),
    ).toEqual([members[1]]);
  });

  it('does not collapse distinct roles or different names', () => {
    const members = [
      { role: 'pi', user: { _id: 'a', fname: 'Ada', lname: 'Lovelace' } },
      { role: 'co-pi', user: { _id: 'b', fname: 'Ada', lname: 'Lovelace' } },
      { role: 'pi', user: { _id: 'c', fname: 'Grace', lname: 'Hopper' } },
    ];

    expect(dedupeSameNameLeadMembers(members, {})).toEqual(members);
  });
});
