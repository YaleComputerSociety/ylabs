import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readUser: vi.fn(),
  updateUser: vi.fn(),
  normalizeObjectIdsForUserMutation: vi.fn((values: unknown[], fieldName: string) => {
    if (values.length > 100) {
      const error: any = new Error(`Too many ${fieldName} ids`);
      error.status = 400;
      throw error;
    }

    return values.map((value) => {
      const id = String(value || '').trim();
      if (!/^[a-f0-9]{24}$/i.test(id)) {
        const error: any = new Error(`Invalid ${fieldName} id`);
        error.status = 400;
        throw error;
      }
      return { toString: () => id };
    });
  }),
  getSavedResearchEntities: vi.fn(),
  getSavedResearchEntitySlugs: vi.fn(),
  getSavedResearchEntityPlans: vi.fn(),
  addSavedResearchEntities: vi.fn(),
  removeSavedResearchEntities: vi.fn(),
  updateSavedResearchEntityPlan: vi.fn(),
  getWatchedPrograms: vi.fn(),
  getWatchedProgramIds: vi.fn(),
  getWatchedProgramPlans: vi.fn(),
  addWatchedPrograms: vi.fn(),
  removeWatchedPrograms: vi.fn(),
  updateWatchedProgramPlan: vi.fn(),
}));

vi.mock('../../services/userService', () => ({
  readUser: mocks.readUser,
  updateUser: mocks.updateUser,
  normalizeObjectIdsForUserMutation: mocks.normalizeObjectIdsForUserMutation,
}));

vi.mock('../../services/researchPlanService', () => ({
  getSavedResearchEntities: mocks.getSavedResearchEntities,
  getSavedResearchEntitySlugs: mocks.getSavedResearchEntitySlugs,
  getSavedResearchEntityPlans: mocks.getSavedResearchEntityPlans,
  addSavedResearchEntities: mocks.addSavedResearchEntities,
  removeSavedResearchEntities: mocks.removeSavedResearchEntities,
  updateSavedResearchEntityPlan: mocks.updateSavedResearchEntityPlan,
  getWatchedPrograms: mocks.getWatchedPrograms,
  getWatchedProgramIds: mocks.getWatchedProgramIds,
  getWatchedProgramPlans: mocks.getWatchedProgramPlans,
  addWatchedPrograms: mocks.addWatchedPrograms,
  removeWatchedPrograms: mocks.removeWatchedPrograms,
  updateWatchedProgramPlan: mocks.updateWatchedProgramPlan,
}));

import {
  addSavedResearchEntities,
  getSavedResearchEntities,
  getSavedResearchEntityPlans,
  removeSavedResearchEntities,
  updateSavedResearchEntityPlan,
  getWatchedPrograms,
  addWatchedPrograms,
  removeWatchedPrograms,
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
  applicationLink: 'https://example.yale.edu/program/apply',
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
  studentVisibilityReviewedByAccountId: '64a000000000000000000099',
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
    applicationLink: 'https://example.yale.edu/program/apply',
    awardAmount: '$5,000',
    isAcceptingApplications: true,
    applicationOpenDate: new Date('2026-01-01T00:00:00.000Z'),
    deadline: new Date('2026-02-01T00:00:00.000Z'),
    contactOffice: 'Office of Research',
    yearOfStudy: ['First-year'],
    termOfAward: ['Summer'],
    purpose: ['Research'],
    globalRegions: ['United States'],
    citizenshipStatus: ['Any'],
    sourceName: 'Official program page',
    sourceUrl: 'https://example.yale.edu/program',
  });
  expect(payload).not.toHaveProperty('contactEmail');
  expect(payload).not.toHaveProperty('contactPhone');
  expect(payload).not.toHaveProperty('sourceKey');
  expect(payload).not.toHaveProperty('sourceFingerprint');
  expect(payload).not.toHaveProperty('sourceLastVerifiedAt');
  expect(payload).not.toHaveProperty('sourceLastChangedAt');
  expect(payload).not.toHaveProperty('studentVisibilityComputedTier');
  expect(payload).not.toHaveProperty('studentVisibilityReasons');
  expect(payload).not.toHaveProperty('studentVisibilityOverrideTier');
  expect(payload).not.toHaveProperty('studentVisibilitySuppressionReason');
  expect(payload).not.toHaveProperty('studentVisibilityComputedAt');
  expect(payload).not.toHaveProperty('studentVisibilityReviewedAt');
  expect(payload).not.toHaveProperty('studentVisibilityReviewedByAccountId');
  expect(payload).not.toHaveProperty('archived');
  expect(payload).not.toHaveProperty('audited');
  expect(payload).not.toHaveProperty('views');
  expect(payload).not.toHaveProperty('favorites');
  expect(payload).not.toHaveProperty('internalReviewNotes');
  expect(payload).not.toHaveProperty('createdAt');
  expect(payload).not.toHaveProperty('updatedAt');
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
  expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, private, max-age=0');
  expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
};

describe('userController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allowlists watched program payloads for authenticated account readers', async () => {
    mocks.getWatchedPrograms.mockResolvedValue([privateProgram]);

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;

    await getWatchedPrograms(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expectPublicProgram(body.watchedPrograms[0]);
  });

  it('returns canonical watched program ids when watching a program', async () => {
    mocks.addWatchedPrograms.mockResolvedValue(['64a000000000000000000010']);

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      body: { data: { watchedPrograms: ['64a000000000000000000010'] } },
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;

    await addWatchedPrograms(req, res);

    expect(mocks.addWatchedPrograms).toHaveBeenCalledWith('student123', [
      '64a000000000000000000010',
    ]);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toEqual({
      watchedProgramIds: ['64a000000000000000000010'],
    });
  });

  it('returns canonical watched program ids when unwatching a program', async () => {
    mocks.removeWatchedPrograms.mockResolvedValue([]);

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      body: { watchedPrograms: ['64a000000000000000000010'] },
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;

    await removeWatchedPrograms(req, res);

    expect(mocks.removeWatchedPrograms).toHaveBeenCalledWith('student123', [
      '64a000000000000000000010',
    ]);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toEqual({ watchedProgramIds: [] });
  });

  it('does not leak internal service errors when fetching watched programs fails', async () => {
    mocks.getWatchedPrograms.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid leaked'),
    );

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
    } as any;
    const res = privateResponseDouble();

    await getWatchedPrograms(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch watched programs' });
  });

  it('scopes saved-entity reads to the authenticated owner', async () => {
    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      body: { accountOwner: 'other-student' },
    } as any;
    mocks.getSavedResearchEntities.mockResolvedValue([]);
    mocks.getSavedResearchEntityPlans.mockResolvedValue({});

    await getSavedResearchEntities(req, privateResponseDouble());
    const plansResponse = privateResponseDouble();
    await getSavedResearchEntityPlans(req, plansResponse);

    expect(mocks.getSavedResearchEntities).toHaveBeenCalledWith('student123');
    expect(mocks.getSavedResearchEntityPlans).toHaveBeenCalledWith('student123');
    expectPrivateNoStore(plansResponse);
  });

  it('scopes saved-entity writes to the authenticated owner', async () => {
    const entityId = '64a000000000000000000030';
    const owner = { netId: 'student123', userType: 'undergraduate', userConfirmed: true };
    mocks.addSavedResearchEntities.mockResolvedValue([entityId]);
    mocks.removeSavedResearchEntities.mockResolvedValue([]);
    mocks.updateSavedResearchEntityPlan.mockResolvedValue({});

    await addSavedResearchEntities(
      {
        user: owner,
        body: {
          accountOwner: 'other-student',
          data: { savedResearchEntities: [entityId] },
        },
      } as any,
      privateResponseDouble(),
    );
    await removeSavedResearchEntities(
      {
        user: owner,
        body: { accountOwner: 'other-student', savedResearchEntities: [entityId] },
      } as any,
      privateResponseDouble(),
    );
    await updateSavedResearchEntityPlan(
      {
        user: owner,
        params: { entityId },
        body: { accountOwner: 'other-student', data: { plan: { note: 'Private note' } } },
      } as any,
      privateResponseDouble(),
    );

    expect(mocks.addSavedResearchEntities).toHaveBeenCalledWith('student123', [entityId]);
    expect(mocks.removeSavedResearchEntities).toHaveBeenCalledWith('student123', [entityId]);
    expect(mocks.updateSavedResearchEntityPlan).toHaveBeenCalledWith('student123', entityId, {
      note: 'Private note',
    });
  });
});
