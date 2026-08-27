import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readUser: vi.fn(),
  updateUser: vi.fn(),
  accountFindOneAndUpdate: vi.fn(),
  researcherFindOneAndUpdate: vi.fn(),
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
  deleteSavedResearchEntityPlan: vi.fn(),
  exportSavedResearchEntities: vi.fn(),
  getWatchedPrograms: vi.fn(),
  getWatchedProgramIds: vi.fn(),
  getWatchedProgramPlans: vi.fn(),
  addWatchedPrograms: vi.fn(),
  removeWatchedPrograms: vi.fn(),
  updateWatchedProgramPlan: vi.fn(),
  deleteWatchedProgramPlan: vi.fn(),
}));

vi.mock('../../services/userService', () => ({
  readUser: mocks.readUser,
  updateUser: mocks.updateUser,
  normalizeObjectIdsForUserMutation: mocks.normalizeObjectIdsForUserMutation,
}));

vi.mock('../../models/account', () => ({
  Account: { findOneAndUpdate: mocks.accountFindOneAndUpdate },
}));

vi.mock('../../models/researcher', () => ({
  Researcher: { findOneAndUpdate: mocks.researcherFindOneAndUpdate },
}));

vi.mock('../../services/researchPlanService', () => ({
  getSavedResearchEntities: mocks.getSavedResearchEntities,
  getSavedResearchEntitySlugs: mocks.getSavedResearchEntitySlugs,
  getSavedResearchEntityPlans: mocks.getSavedResearchEntityPlans,
  addSavedResearchEntities: mocks.addSavedResearchEntities,
  removeSavedResearchEntities: mocks.removeSavedResearchEntities,
  updateSavedResearchEntityPlan: mocks.updateSavedResearchEntityPlan,
  deleteSavedResearchEntityPlan: mocks.deleteSavedResearchEntityPlan,
  exportSavedResearchEntities: mocks.exportSavedResearchEntities,
  getWatchedPrograms: mocks.getWatchedPrograms,
  getWatchedProgramIds: mocks.getWatchedProgramIds,
  getWatchedProgramPlans: mocks.getWatchedProgramPlans,
  addWatchedPrograms: mocks.addWatchedPrograms,
  removeWatchedPrograms: mocks.removeWatchedPrograms,
  updateWatchedProgramPlan: mocks.updateWatchedProgramPlan,
  deleteWatchedProgramPlan: mocks.deleteWatchedProgramPlan,
}));

import {
  addSavedResearchEntities,
  deleteSavedResearchEntityPlan,
  exportSavedResearchEntities,
  getSavedResearchEntities,
  getSavedResearchEntityPlans,
  removeSavedResearchEntities,
  updateCurrentUser,
  updateSavedResearchEntityPlan,
  getWatchedPrograms,
  addWatchedPrograms,
  removeWatchedPrograms,
  deleteWatchedProgramPlan,
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
  expect(payload).not.toHaveProperty('studentVisibilityReviewedByUserId');
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

  it('does not leak internal service errors when updating the current user fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.accountFindOneAndUpdate.mockReturnValue({
      lean: vi
        .fn()
        .mockRejectedValue(
          new Error(
            'mongodb://user:pass@example.invalid leaked for ada@example.edu with Bearer abc123 and 203-555-1212',
          ),
        ),
    });

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      body: { data: { fname: 'Ada', lname: 'Lovelace' } },
    } as any;
    const res = privateResponseDouble();
    const next = vi.fn();

    await updateCurrentUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to update account profile' });
    const logged = consoleError.mock.calls.flat().join(' ');
    expect(logged).not.toContain('user:pass');
    expect(logged).not.toContain('ada@example.edu');
    expect(logged).not.toContain('abc123');
    expect(logged).not.toContain('203-555-1212');
  });

  it('returns only thin identity fields after current-user profile updates', async () => {
    mocks.accountFindOneAndUpdate.mockReturnValue({
      lean: vi.fn().mockResolvedValue({ _id: '64a000000000000000000020', netid: 'student123' }),
    });
    mocks.researcherFindOneAndUpdate.mockReturnValue({
      lean: vi.fn().mockResolvedValue({ displayName: 'Ada Lovelace' }),
    });

    const req = {
      user: { netId: 'student123', userConfirmed: true },
      body: { data: { fname: 'Ada', lname: 'Lovelace', bio: 'I study public health.' } },
    } as any;
    const res = privateResponseDouble();
    const next = vi.fn();

    await updateCurrentUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.user).toEqual({
      netid: 'student123',
      displayName: 'Ada Lovelace',
      userConfirmed: true,
    });
    expect(res.body.user).not.toHaveProperty('userType');
    expect(res.body.user).not.toHaveProperty('bio');
    expect(res.body.user).not.toHaveProperty('facultyMemberId');
    expect(res.body.user).not.toHaveProperty('studentProfileId');
  });

  it('upserts an Account and thin Researcher from the bootstrap form, echoing thin identity', async () => {
    mocks.accountFindOneAndUpdate.mockReturnValue({
      lean: vi.fn().mockResolvedValue({ _id: 'acct-unknown', netid: 'unknown123' }),
    });
    mocks.researcherFindOneAndUpdate.mockReturnValue({
      lean: vi.fn().mockResolvedValue({ displayName: 'Ada Lovelace' }),
    });

    const req = {
      user: { netId: 'unknown123', userConfirmed: false },
      body: {
        data: { fname: 'Ada', lname: 'Lovelace', email: 'ada@example.edu', userType: 'faculty' },
      },
    } as any;
    const res = privateResponseDouble();
    const next = vi.fn();

    await updateCurrentUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mocks.researcherFindOneAndUpdate.mock.calls.at(-1)![1]).toMatchObject({
      $set: { displayName: 'Ada Lovelace' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.user).toEqual({
      netid: 'unknown123',
      displayName: 'Ada Lovelace',
      userConfirmed: false,
    });
    expect(res.body.user).not.toHaveProperty('userType');
    expect(res.body.user).not.toHaveProperty('profileVerified');
  });

  it('scopes saved-entity reads and private exports to the authenticated owner', async () => {
    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      method: 'POST',
      body: { accountOwner: 'other-student', includePrivateNotes: true },
    } as any;
    mocks.getSavedResearchEntities.mockResolvedValue([]);
    mocks.getSavedResearchEntityPlans.mockResolvedValue({});
    mocks.exportSavedResearchEntities.mockResolvedValue({ items: [] });

    await getSavedResearchEntities(req, privateResponseDouble());
    const plansResponse = privateResponseDouble();
    await getSavedResearchEntityPlans(req, plansResponse);
    const exportResponse = privateResponseDouble();
    await exportSavedResearchEntities(req, exportResponse);

    expect(mocks.getSavedResearchEntities).toHaveBeenCalledWith('student123');
    expect(mocks.getSavedResearchEntityPlans).toHaveBeenCalledWith('student123');
    expect(mocks.exportSavedResearchEntities).toHaveBeenCalledWith('student123', {
      includePrivateNotes: true,
    });
    expectPrivateNoStore(plansResponse);
    expectPrivateNoStore(exportResponse);
  });

  it('scopes saved-entity writes and deletes to the authenticated owner', async () => {
    const entityId = '64a000000000000000000030';
    const owner = { netId: 'student123', userType: 'undergraduate', userConfirmed: true };
    mocks.addSavedResearchEntities.mockResolvedValue([entityId]);
    mocks.removeSavedResearchEntities.mockResolvedValue([]);
    mocks.updateSavedResearchEntityPlan.mockResolvedValue({});
    mocks.deleteSavedResearchEntityPlan.mockResolvedValue({});

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
    await deleteSavedResearchEntityPlan(
      {
        user: owner,
        params: { entityId },
        body: { accountOwner: 'other-student' },
      } as any,
      privateResponseDouble(),
    );

    expect(mocks.addSavedResearchEntities).toHaveBeenCalledWith('student123', [entityId]);
    expect(mocks.removeSavedResearchEntities).toHaveBeenCalledWith('student123', [entityId]);
    expect(mocks.updateSavedResearchEntityPlan).toHaveBeenCalledWith('student123', entityId, {
      note: 'Private note',
    });
    expect(mocks.deleteSavedResearchEntityPlan).toHaveBeenCalledWith('student123', entityId);
  });

  it('scopes watched-program plan deletes to the authenticated owner and marks the response private', async () => {
    const programId = '64a000000000000000000031';
    const owner = { netId: 'student123', userType: 'undergraduate', userConfirmed: true };
    mocks.deleteWatchedProgramPlan.mockResolvedValue({});
    const res = privateResponseDouble();

    await deleteWatchedProgramPlan(
      {
        user: owner,
        params: { programId },
        body: { accountOwner: 'other-student' },
      } as any,
      res,
    );

    expect(mocks.deleteWatchedProgramPlan).toHaveBeenCalledWith('student123', programId);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ watchedProgramPlans: {} });
    expectPrivateNoStore(res);
  });
});
