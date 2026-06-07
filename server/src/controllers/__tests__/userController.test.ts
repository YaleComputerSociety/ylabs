import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readFellowships: vi.fn(),
  readListings: vi.fn(),
  readPrograms: vi.fn(),
  readUser: vi.fn(),
  updateUser: vi.fn(),
  addFavListings: vi.fn(),
  deleteFavListings: vi.fn(),
  addFavFellowships: vi.fn(),
  deleteFavFellowships: vi.fn(),
  addFavPathways: vi.fn(),
  deleteFavPathways: vi.fn(),
  matchFellowshipsForPathways: vi.fn(),
  getSavedPathwayPlans: vi.fn(),
  exportSavedPathwayPlans: vi.fn(),
  updateSavedPathwayPlan: vi.fn(),
  deleteSavedPathwayPlan: vi.fn(),
}));

vi.mock('../../services/listingService', () => ({
  readListings: mocks.readListings,
}));

vi.mock('../../services/fellowshipService', () => ({
  readFellowships: mocks.readFellowships,
}));

vi.mock('../../services/programService', () => ({
  readPrograms: mocks.readPrograms,
}));

vi.mock('../../services/fellowshipMatchingService', () => ({
  matchFellowshipsForPathways: mocks.matchFellowshipsForPathways,
}));

vi.mock('../../services/pathwaySearchService', () => ({
  getPathwaysByIds: vi.fn(),
}));

vi.mock('../../services/userService', () => ({
  readUser: mocks.readUser,
  updateUser: mocks.updateUser,
  addFavListings: mocks.addFavListings,
  deleteFavListings: mocks.deleteFavListings,
  addFavFellowships: mocks.addFavFellowships,
  deleteFavFellowships: mocks.deleteFavFellowships,
  addFavPathways: mocks.addFavPathways,
  deleteFavPathways: mocks.deleteFavPathways,
  getSavedPathwayPlans: mocks.getSavedPathwayPlans,
  exportSavedPathwayPlans: mocks.exportSavedPathwayPlans,
  pruneSavedPathwayPlansForExistingPathways: vi.fn((plans) => plans),
  updateSavedPathwayPlan: mocks.updateSavedPathwayPlan,
  deleteSavedPathwayPlan: mocks.deleteSavedPathwayPlan,
}));

import {
  addFavFellowships,
  addFavListings,
  addFavPathways,
  addSavedPrograms,
  addSavedResearchPlans,
  deleteSavedResearchPlanDetail,
  exportSavedResearchPlanDetails,
  getFavFellowshipIds,
  getFavFellowships,
  getFavListingsIds,
  getFavPathwayIds,
  getFavPathwayFundingMatches,
  getFavPathways,
  getSavedProgramIds,
  getSavedResearchPlanDetails,
  getSavedResearchPlanIds,
  getSavedResearchPlans,
  getSavedPrograms,
  getUserListings,
  removeFavFellowships,
  removeFavListings,
  removeFavPathways,
  removeSavedPrograms,
  removeSavedResearchPlans,
  updateCurrentUser,
  updateSavedResearchPlanDetail,
} from '../userController';

const privateProgram = {
  _id: '64a000000000000000000010',
  title: 'Summer Research Program',
  programCategory: 'SUMMER_RESEARCH_PROGRAM',
  programKind: 'STRUCTURED_PROGRAM',
  entryMode: 'APPLY_TO_PROGRAM',
  studentFacingCategory: 'Structured research program',
  requiresMentorBeforeApply: false,
  mentorMatching: true,
  undergraduateOnly: true,
  yaleCollegeOnly: true,
  compensationSummary: 'Stipend available',
  hoursPerWeek: 30,
  programDates: 'Summer 2026',
  bestNextStep: 'Apply through the official form.',
  prepSteps: ['Review eligibility'],
  competitionType: 'Competitive',
  summary: 'A public summary.',
  description: 'A public description.',
  applicationInformation: 'Submit the official form.',
  eligibility: 'Yale undergraduates.',
  restrictionsToUseOfAward: 'Research expenses only.',
  additionalInformation: 'Public additional info.',
  links: [{ label: 'Program page', url: 'https://example.yale.edu/program' }],
  applicationLink: 'https://example.yale.edu/apply',
  awardAmount: '$5,000',
  isAcceptingApplications: true,
  applicationOpenDate: new Date('2026-01-01T00:00:00.000Z'),
  deadline: new Date('2026-02-01T00:00:00.000Z'),
  contactName: 'Program Office',
  contactEmail: 'program@yale.edu',
  contactPhone: '203-555-1212',
  contactOffice: 'Office of Research',
  yearOfStudy: ['First-year'],
  termOfAward: ['Summer'],
  purpose: ['Research'],
  globalRegions: ['United States'],
  citizenshipStatus: ['Any'],
  sourceName: 'Official program page',
  sourceUrl: 'https://example.yale.edu/program',
  sourceKey: 'program-source-key',
  sourceFingerprint: 'private-fingerprint',
  sourceLastVerifiedAt: new Date('2026-01-02T00:00:00.000Z'),
  sourceLastChangedAt: new Date('2026-01-03T00:00:00.000Z'),
  studentVisibilityTier: 'student_ready',
  studentVisibilityComputedTier: 'student_ready',
  studentVisibilityOverrideTier: 'operator_review',
  studentVisibilityReasons: ['public reason'],
  studentVisibilitySuppressionReason: 'private suppression note',
  studentVisibilityComputedAt: new Date('2026-01-04T00:00:00.000Z'),
  studentVisibilityReviewedAt: new Date('2026-01-05T00:00:00.000Z'),
  studentVisibilityReviewedByUserId: '64a000000000000000000099',
  archived: false,
  audited: true,
  views: 99,
  favorites: 12,
  internalReviewNotes: 'private operator note',
  createdAt: new Date('2026-01-06T00:00:00.000Z'),
  updatedAt: new Date('2026-01-07T00:00:00.000Z'),
};

const expectPublicProgram = (payload: any) => {
  expect(payload).toMatchObject({
    _id: '64a000000000000000000010',
    title: 'Summer Research Program',
    programCategory: 'SUMMER_RESEARCH_PROGRAM',
    programKind: 'STRUCTURED_PROGRAM',
    entryMode: 'APPLY_TO_PROGRAM',
    studentFacingCategory: 'Structured research program',
    requiresMentorBeforeApply: false,
    mentorMatching: true,
    undergraduateOnly: true,
    yaleCollegeOnly: true,
    compensationSummary: 'Stipend available',
    hoursPerWeek: 30,
    programDates: 'Summer 2026',
    bestNextStep: 'Apply through the official form.',
    prepSteps: ['Review eligibility'],
    competitionType: 'Competitive',
    summary: 'A public summary.',
    description: 'A public description.',
    applicationInformation: 'Submit the official form.',
    eligibility: 'Yale undergraduates.',
    restrictionsToUseOfAward: 'Research expenses only.',
    additionalInformation: 'Public additional info.',
    links: [{ label: 'Program page', url: 'https://example.yale.edu/program' }],
    applicationLink: 'https://example.yale.edu/apply',
    awardAmount: '$5,000',
    isAcceptingApplications: true,
    applicationOpenDate: new Date('2026-01-01T00:00:00.000Z'),
    deadline: new Date('2026-02-01T00:00:00.000Z'),
    contactName: 'Program Office',
    contactEmail: 'program@yale.edu',
    contactPhone: '203-555-1212',
    contactOffice: 'Office of Research',
    yearOfStudy: ['First-year'],
    termOfAward: ['Summer'],
    purpose: ['Research'],
    globalRegions: ['United States'],
    citizenshipStatus: ['Any'],
    sourceName: 'Official program page',
    sourceUrl: 'https://example.yale.edu/program',
    studentVisibilityTier: 'student_ready',
    studentVisibilityComputedTier: 'student_ready',
    studentVisibilityReasons: ['public reason'],
    createdAt: new Date('2026-01-06T00:00:00.000Z'),
    updatedAt: new Date('2026-01-07T00:00:00.000Z'),
  });
  expect(payload).not.toHaveProperty('sourceKey');
  expect(payload).not.toHaveProperty('sourceFingerprint');
  expect(payload).not.toHaveProperty('sourceLastVerifiedAt');
  expect(payload).not.toHaveProperty('sourceLastChangedAt');
  expect(payload).not.toHaveProperty('studentVisibilityOverrideTier');
  expect(payload).not.toHaveProperty('studentVisibilitySuppressionReason');
  expect(payload).not.toHaveProperty('studentVisibilityComputedAt');
  expect(payload).not.toHaveProperty('studentVisibilityReviewedAt');
  expect(payload).not.toHaveProperty('studentVisibilityReviewedByUserId');
  expect(payload).not.toHaveProperty('archived');
  expect(payload).not.toHaveProperty('audited');
  expect(payload).not.toHaveProperty('views');
  expect(payload).not.toHaveProperty('favorites');
  expect(payload).not.toHaveProperty('internalReviewNotes');
};

const privateResponseDouble = () =>
  ({
    statusCode: 200,
    body: undefined as unknown,
    setHeader: vi.fn(),
    status: vi.fn(function (this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function (this: any, body: unknown) {
      this.body = body;
      return this;
    }),
  }) as any;

const expectPrivateNoStore = (res: any) => {
  expect(res.setHeader).toHaveBeenCalledWith(
    'Cache-Control',
    'no-store, private, max-age=0',
  );
  expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
};

describe('userController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allowlists account listing payloads for both owned and favorited listings', async () => {
    const ownListing = {
      _id: '64a000000000000000000001',
      id: '64a000000000000000000001',
      ownerId: 'owner123',
      ownerEmail: 'owner123@yale.edu',
      title: 'Own listing',
      description: 'Private owner draft details.',
      applicantDescription: 'Students will help with experiments.',
      websites: [
        'https://owner.example.yale.edu/apply',
        'https://user:pass@owner.example.yale.edu/private',
        'javascript:alert(document.cookie)',
      ],
      departments: ['Molecular Biology'],
      researchAreas: ['Genetics'],
      keywords: ['genetics'],
      type: 'Research Assistant',
      commitment: '8 hours/week',
      compensationType: 'Paid',
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      professorIds: ['collab123'],
      professorNames: ['Collaborator Professor'],
      emails: ['collab123@yale.edu'],
      createdByUserId: '64a000000000000000000004',
      views: 12,
      favorites: ['student456'],
      archived: false,
      confirmed: true,
      audited: true,
      embedding: [0.5, 0.7],
    };
    const favListing = {
      _id: '64a000000000000000000002',
      id: '64a000000000000000000002',
      title: 'Favorited listing',
      description: 'Help with a project.',
      applicantDescription: 'Students will learn methods.',
      websites: [
        'https://example.yale.edu/apply',
        'https://user:pass@example.yale.edu/private',
        'javascript:alert(document.cookie)',
        'mailto:otherprof@yale.edu',
      ],
      departments: ['Computer Science'],
      researchAreas: ['Systems'],
      keywords: ['systems'],
      type: 'Research Assistant',
      commitment: '5 hours/week',
      compensationType: 'Paid',
      expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      ownerId: 'otherprof',
      ownerEmail: 'otherprof@yale.edu',
      ownerFirstName: 'Other',
      ownerLastName: 'Professor',
      professorIds: ['victim123'],
      professorNames: ['Victim Professor'],
      emails: ['victim123@yale.edu'],
      createdByUserId: '64a000000000000000000003',
      views: 42,
      favorites: ['student123'],
      archived: false,
      confirmed: true,
      audited: true,
      embedding: [0.1, 0.2],
    };
    mocks.readUser.mockResolvedValue({
      ownListings: ['64a000000000000000000001'],
      favListings: ['64a000000000000000000002'],
    });
    mocks.readListings
      .mockResolvedValueOnce([ownListing])
      .mockResolvedValueOnce([favListing]);
    mocks.updateUser.mockResolvedValue({});

    const req = {
      user: { netId: 'owner123', userType: 'professor', userConfirmed: true },
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;

    await getUserListings(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.ownListings[0]).toMatchObject({
      _id: '64a000000000000000000001',
      id: '64a000000000000000000001',
      title: 'Own listing',
      description: 'Private owner draft details.',
      applicantDescription: 'Students will help with experiments.',
      websites: ['https://owner.example.yale.edu/apply'],
      departments: ['Molecular Biology'],
      researchAreas: ['Genetics'],
      keywords: ['genetics'],
      type: 'Research Assistant',
      commitment: '8 hours/week',
      compensationType: 'Paid',
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    expect(body.ownListings[0]).not.toHaveProperty('ownerId');
    expect(body.ownListings[0]).not.toHaveProperty('ownerEmail');
    expect(body.ownListings[0]).not.toHaveProperty('professorIds');
    expect(body.ownListings[0]).not.toHaveProperty('professorNames');
    expect(body.ownListings[0]).not.toHaveProperty('emails');
    expect(body.ownListings[0]).not.toHaveProperty('createdByUserId');
    expect(body.ownListings[0]).not.toHaveProperty('views');
    expect(body.ownListings[0]).not.toHaveProperty('favorites');
    expect(body.ownListings[0]).not.toHaveProperty('archived');
    expect(body.ownListings[0]).not.toHaveProperty('confirmed');
    expect(body.ownListings[0]).not.toHaveProperty('audited');
    expect(body.ownListings[0]).not.toHaveProperty('embedding');
    expect(body.favListings[0]).toMatchObject({
      _id: '64a000000000000000000002',
      id: '64a000000000000000000002',
      title: 'Favorited listing',
      description: 'Help with a project.',
      applicantDescription: 'Students will learn methods.',
      websites: ['https://example.yale.edu/apply'],
      departments: ['Computer Science'],
      researchAreas: ['Systems'],
      keywords: ['systems'],
      type: 'Research Assistant',
      commitment: '5 hours/week',
      compensationType: 'Paid',
      expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    expect(body.favListings[0]).not.toHaveProperty('ownerId');
    expect(body.favListings[0]).not.toHaveProperty('ownerEmail');
    expect(body.favListings[0]).not.toHaveProperty('professorIds');
    expect(body.favListings[0]).not.toHaveProperty('professorNames');
    expect(body.favListings[0]).not.toHaveProperty('emails');
    expect(body.favListings[0]).not.toHaveProperty('createdByUserId');
    expect(body.favListings[0]).not.toHaveProperty('views');
    expect(body.favListings[0]).not.toHaveProperty('favorites');
    expect(body.favListings[0]).not.toHaveProperty('archived');
    expect(body.favListings[0]).not.toHaveProperty('confirmed');
    expect(body.favListings[0]).not.toHaveProperty('audited');
    expect(body.favListings[0]).not.toHaveProperty('embedding');
  });

  it('does not leak internal service errors from account listing readers', async () => {
    mocks.readUser.mockResolvedValue({
      ownListings: ['64a000000000000000000001'],
      favListings: ['64a000000000000000000002'],
    });
    mocks.readListings.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid leaked'),
    );

    const req = {
      user: { netId: 'owner123', userType: 'professor', userConfirmed: true },
    } as any;
    const res = privateResponseDouble();

    await getUserListings(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch account listings' });
  });

  it('does not leak internal service errors when adding favorited listings fails', async () => {
    mocks.addFavListings.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid leaked'),
    );

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      body: { data: { favListings: ['64a000000000000000000002'] } },
    } as any;
    const res = privateResponseDouble();

    await addFavListings(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to update favorite listings' });
  });

  it('does not leak private ids from account mutation not-found failures', async () => {
    mocks.addFavListings.mockRejectedValue(
      Object.assign(new Error('Listing not found with ObjectId: private-listing-id'), {
        name: 'NotFoundError',
        status: 404,
      }),
    );

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      body: { data: { favListings: ['private-listing-id'] } },
    } as any;
    const res = privateResponseDouble();

    await addFavListings(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('does not leak internal service errors when removing favorited listings fails', async () => {
    mocks.deleteFavListings.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid leaked'),
    );

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      body: { favListings: ['64a000000000000000000002'] },
    } as any;
    const res = privateResponseDouble();

    await removeFavListings(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to update favorite listings' });
  });

  it('allowlists saved program payloads for authenticated account readers', async () => {
    mocks.readUser.mockResolvedValue({
      favFellowships: ['64a000000000000000000010'],
    });
    mocks.readPrograms.mockResolvedValue([privateProgram]);
    mocks.updateUser.mockResolvedValue({});

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;

    await getSavedPrograms(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expectPublicProgram(body.savedPrograms[0]);
  });

  it('allowlists saved fellowship payloads for legacy authenticated account readers', async () => {
    mocks.readUser.mockResolvedValue({
      favFellowships: ['64a000000000000000000010'],
    });
    mocks.readFellowships.mockResolvedValue([privateProgram]);
    mocks.updateUser.mockResolvedValue({});

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;

    await getFavFellowships(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expectPublicProgram(body.favFellowships[0]);
  });

  it('does not echo private account fields when saving programs', async () => {
    mocks.addFavFellowships.mockResolvedValue({
      _id: '64a000000000000000000020',
      netid: 'student123',
      email: 'student123@yale.edu',
      userType: 'undergraduate',
      userConfirmed: true,
      website: 'javascript:alert(document.cookie)',
      profileUrls: {
        yale: 'https://example.yale.edu/student123',
        personal: 'mailto:student123@yale.edu',
      },
      favFellowships: ['64a000000000000000000010'],
      savedPathwayPlans: {
        '64a000000000000000000030': {
          note: 'private advising note',
          checklist: { emailed: true },
        },
      },
      googleScholarId: 'private-scholar-id',
      confidenceByField: { email: 0.99 },
      manuallyLockedFields: ['email'],
      lastLoginAt: new Date('2026-01-01T00:00:00.000Z'),
      archived: false,
      dedupedIntoUserId: '64a000000000000000000099',
    });

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      body: { data: { savedPrograms: ['64a000000000000000000010'] } },
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;

    await addSavedPrograms(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.user).toMatchObject({
      _id: '64a000000000000000000020',
      netid: 'student123',
      userType: 'undergraduate',
      userConfirmed: true,
      profileUrls: {
        yale: 'https://example.yale.edu/student123',
      },
      favFellowships: ['64a000000000000000000010'],
    });
    expect(body.user).not.toHaveProperty('website');
    expect(body.user).not.toHaveProperty('email');
    expect(body.user).not.toHaveProperty('savedPathwayPlans');
    expect(body.user).not.toHaveProperty('googleScholarId');
    expect(body.user).not.toHaveProperty('confidenceByField');
    expect(body.user).not.toHaveProperty('manuallyLockedFields');
    expect(body.user).not.toHaveProperty('lastLoginAt');
    expect(body.user).not.toHaveProperty('archived');
    expect(body.user).not.toHaveProperty('dedupedIntoUserId');
  });

  it('does not leak internal service errors when saving programs fails', async () => {
    mocks.addFavFellowships.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid leaked'),
    );

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      body: { data: { savedPrograms: ['64a000000000000000000010'] } },
    } as any;
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      status: vi.fn(function (this: any, code: number) {
        this.statusCode = code;
        return this;
      }),
      json: vi.fn(function (this: any, body: unknown) {
        this.body = body;
        return this;
      }),
    } as any;

    await addSavedPrograms(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to save programs' });
  });

  it('does not leak internal service errors when adding favorite programs fails', async () => {
    mocks.addFavFellowships.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid leaked'),
    );

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      body: { data: { favFellowships: ['64a000000000000000000010'] } },
    } as any;
    const res = privateResponseDouble();

    await addFavFellowships(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to update favorite programs' });
  });

  it('does not leak internal service errors when removing saved programs fails', async () => {
    mocks.deleteFavFellowships.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid leaked'),
    );

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      body: { savedPrograms: ['64a000000000000000000010'] },
    } as any;
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      status: vi.fn(function (this: any, code: number) {
        this.statusCode = code;
        return this;
      }),
      json: vi.fn(function (this: any, body: unknown) {
        this.body = body;
        return this;
      }),
    } as any;

    await removeSavedPrograms(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to remove saved programs' });
  });

  it('does not leak internal service errors when removing favorite programs fails', async () => {
    mocks.deleteFavFellowships.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid leaked'),
    );

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      body: { favFellowships: ['64a000000000000000000010'] },
    } as any;
    const res = privateResponseDouble();

    await removeFavFellowships(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to update favorite programs' });
  });

  it('does not echo private planning notes when saving research plans', async () => {
    mocks.addFavPathways.mockResolvedValue({
      _id: '64a000000000000000000020',
      netid: 'student123',
      userType: 'undergraduate',
      userConfirmed: true,
      favPathways: ['64a000000000000000000030'],
      savedPathwayPlans: {
        '64a000000000000000000030': {
          note: 'private advising note',
          checklist: { emailed: true },
        },
      },
      email: 'student123@yale.edu',
      lastActive: new Date('2026-01-01T00:00:00.000Z'),
    });

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      body: { data: { savedResearchPlans: ['64a000000000000000000030'] } },
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;

    await addSavedResearchPlans(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.user).toMatchObject({
      _id: '64a000000000000000000020',
      netid: 'student123',
      userType: 'undergraduate',
      userConfirmed: true,
      favPathways: ['64a000000000000000000030'],
    });
    expect(body.user).not.toHaveProperty('savedPathwayPlans');
    expect(body.user).not.toHaveProperty('email');
    expect(body.user).not.toHaveProperty('lastActive');
  });

  it('does not leak internal service errors when saving research plans fails', async () => {
    mocks.addFavPathways.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid leaked'),
    );

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      body: { data: { savedResearchPlans: ['64a000000000000000000030'] } },
    } as any;
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      status: vi.fn(function (this: any, code: number) {
        this.statusCode = code;
        return this;
      }),
      json: vi.fn(function (this: any, body: unknown) {
        this.body = body;
        return this;
      }),
    } as any;

    await addSavedResearchPlans(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to save research plans' });
  });

  it('does not leak internal service errors when adding favorite pathways fails', async () => {
    mocks.addFavPathways.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid leaked'),
    );

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      body: { data: { favPathways: ['64a000000000000000000030'] } },
    } as any;
    const res = privateResponseDouble();

    await addFavPathways(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to update favorite pathways' });
  });

  it('returns a sanitized client error for oversized favorite pathway batches', async () => {
    mocks.addFavPathways.mockRejectedValue(
      Object.assign(new Error('Too many favPathways ids'), { status: 400 }),
    );

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      body: {
        data: {
          favPathways: Array.from({ length: 101 }, (_, index) =>
            index.toString(16).padStart(24, '0'),
          ),
        },
      },
    } as any;
    const res = privateResponseDouble();

    await addFavPathways(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Bad request' });
  });

  it('does not leak internal service errors when removing saved research plans fails', async () => {
    mocks.deleteFavPathways.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid leaked'),
    );

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      body: { savedResearchPlans: ['64a000000000000000000030'] },
    } as any;
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      status: vi.fn(function (this: any, code: number) {
        this.statusCode = code;
        return this;
      }),
      json: vi.fn(function (this: any, body: unknown) {
        this.body = body;
        return this;
      }),
    } as any;

    await removeSavedResearchPlans(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to remove saved research plans' });
  });

  it('does not leak internal service errors when removing favorite pathways fails', async () => {
    mocks.deleteFavPathways.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid leaked'),
    );

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      body: { favPathways: ['64a000000000000000000030'] },
    } as any;
    const res = privateResponseDouble();

    await removeFavPathways(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to update favorite pathways' });
  });

  it('does not leak internal service errors when updating the current user fails', async () => {
    mocks.updateUser.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid leaked'),
    );

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      body: { data: { bio: 'I study public health.' } },
    } as any;
    const res = privateResponseDouble();
    const next = vi.fn();

    await updateCurrentUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to update account profile' });
  });

  it('sanitizes self-edit profile URLs before persisting the current user', async () => {
    mocks.updateUser.mockResolvedValue({
      _id: '64a000000000000000000020',
      netid: 'student123',
      userType: 'undergraduate',
      userConfirmed: true,
      website: 'https://example.yale.edu/student123',
      imageUrl: 'javascript:alert(document.cookie)',
      profileUrls: {
        yale: 'https://example.yale.edu/profile/student123',
      },
      bio: 'I study public health.',
    });

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      body: {
        data: {
          bio: 'I study public health.',
          website: 'javascript:alert(document.cookie)',
          imageUrl: 'javascript:alert(document.cookie)',
          profileUrls: {
            yale: 'https://example.yale.edu/profile/student123',
            personal: 'mailto:student123@yale.edu',
            script: 'javascript:alert(document.cookie)',
          },
        },
      },
    } as any;
    const res = privateResponseDouble();
    const next = vi.fn();

    await updateCurrentUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mocks.updateUser).toHaveBeenCalledWith('student123', {
      bio: 'I study public health.',
      profileUrls: {
        yale: 'https://example.yale.edu/profile/student123',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.user).toMatchObject({
      website: 'https://example.yale.edu/student123',
      profileUrls: {
        yale: 'https://example.yale.edu/profile/student123',
      },
    });
    expect(res.body.user).not.toHaveProperty('imageUrl');
  });

  it('marks private saved research-plan detail responses as no-store', async () => {
    mocks.getSavedPathwayPlans.mockResolvedValue({
      '64a000000000000000000030': {
        note: 'private advising note',
        checklist: { emailed: true },
      },
    });

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
    } as any;
    const res = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;

    await getSavedResearchPlanDetails(req, res);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store, private, max-age=0',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toEqual({
      savedResearchPlanDetails: {
        '64a000000000000000000030': {
          note: 'private advising note',
          checklist: { emailed: true },
        },
      },
    });
  });

  it('does not leak internal service errors from saved research-plan detail failures', async () => {
    mocks.getSavedPathwayPlans.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid leaked'),
    );

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
    } as any;
    const res = privateResponseDouble();

    await getSavedResearchPlanDetails(req, res);

    expectPrivateNoStore(res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch saved research-plan details' });
  });

  it('marks saved research-plan exports that include private notes as no-store', async () => {
    mocks.exportSavedPathwayPlans.mockResolvedValue({
      privacy: { includesPrivateNotes: true },
      items: [{ note: 'private advising note' }],
    });

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      query: { includePrivateNotes: 'true' },
    } as any;
    const res = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;

    await exportSavedResearchPlanDetails(req, res);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store, private, max-age=0',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="saved-pathway-plans.json"',
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('does not leak internal service errors from saved research-plan export failures', async () => {
    mocks.exportSavedPathwayPlans.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid leaked'),
    );

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      query: { includePrivateNotes: 'true' },
    } as any;
    const res = privateResponseDouble();

    await exportSavedResearchPlanDetails(req, res);

    expectPrivateNoStore(res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to export saved research-plan details' });
  });

  it('does not leak internal service errors from saved research-plan detail update failures', async () => {
    mocks.updateSavedPathwayPlan.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid leaked'),
    );

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      params: { pathwayId: '64a000000000000000000030' },
      body: { data: { plan: { note: 'private note' } } },
    } as any;
    const res = privateResponseDouble();

    await updateSavedResearchPlanDetail(req, res);

    expectPrivateNoStore(res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to update saved research-plan detail' });
  });

  it('maps malformed saved research-plan ids to a private bad request response', async () => {
    mocks.updateSavedPathwayPlan.mockRejectedValue(
      Object.assign(new Error('Invalid pathway id: not-an-object-id'), { status: 400 }),
    );

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      params: { pathwayId: 'not-an-object-id' },
      body: { data: { plan: { note: 'private note' } } },
    } as any;
    const res = privateResponseDouble();

    await updateSavedResearchPlanDetail(req, res);

    expectPrivateNoStore(res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Bad request' });
  });

  it('does not leak internal service errors from saved research-plan detail delete failures', async () => {
    mocks.deleteSavedPathwayPlan.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid leaked'),
    );

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      params: { pathwayId: '64a000000000000000000030' },
    } as any;
    const res = privateResponseDouble();

    await deleteSavedResearchPlanDetail(req, res);

    expectPrivateNoStore(res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to delete saved research-plan detail' });
  });

  it.each([
    [getFavListingsIds, 'Failed to fetch favorite listing ids'],
    [getFavFellowshipIds, 'Failed to fetch favorite program ids'],
    [getSavedProgramIds, 'Failed to fetch saved program ids'],
    [getFavPathwayIds, 'Failed to fetch favorite pathway ids'],
    [getSavedResearchPlanIds, 'Failed to fetch saved research plan ids'],
  ])('does not leak internal read errors from account id readers', async (handler, message) => {
    mocks.readUser.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid leaked'),
    );

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
    } as any;
    const res = privateResponseDouble();

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: message });
  });

  it.each([
    [getFavFellowships, 'Failed to fetch favorite programs'],
    [getSavedPrograms, 'Failed to fetch saved programs'],
    [getFavPathways, 'Failed to fetch favorite pathways'],
    [getSavedResearchPlans, 'Failed to fetch saved research plans'],
  ])('does not leak internal read errors from hydrated account readers', async (handler, message) => {
    mocks.readUser.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid leaked'),
    );

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
    } as any;
    const res = privateResponseDouble();

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: message });
  });

  it('does not leak internal service errors from pathway funding-match readers', async () => {
    mocks.readUser.mockResolvedValue({
      favPathways: ['64a000000000000000000030'],
    });
    mocks.matchFellowshipsForPathways.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid leaked'),
    );

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
    } as any;
    const res = privateResponseDouble();

    await getFavPathwayFundingMatches(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch pathway funding matches' });
  });
});
