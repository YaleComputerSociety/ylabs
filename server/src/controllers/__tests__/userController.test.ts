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
    mocks.updateUser.mockRejectedValue(
      new Error(
        'mongodb://user:pass@example.invalid leaked for ada@example.edu with Bearer abc123 and 203-555-1212',
      ),
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
    const logged = consoleError.mock.calls.flat().join(' ');
    expect(logged).not.toContain('user:pass');
    expect(logged).not.toContain('ada@example.edu');
    expect(logged).not.toContain('abc123');
    expect(logged).not.toContain('203-555-1212');
  });

  it('does not expose internal account join fields after current-user profile updates', async () => {
    mocks.updateUser.mockResolvedValue({
      _id: '64a000000000000000000020',
      netid: 'student123',
      userType: 'undergraduate',
      userConfirmed: true,
      bio: 'I study public health.',
      facultyMemberId: 'faculty-join-123',
      studentProfileId: 'student-profile-123',
      savedPathwayPlans: { private: { note: 'private planning note' } },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      body: { data: { bio: 'I study public health.' } },
    } as any;
    const res = privateResponseDouble();
    const next = vi.fn();

    await updateCurrentUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.user).toMatchObject({
      netid: 'student123',
      bio: 'I study public health.',
    });
    expect(res.body.user).not.toHaveProperty('facultyMemberId');
    expect(res.body.user).not.toHaveProperty('studentProfileId');
    expect(res.body.user).not.toHaveProperty('savedPathwayPlans');
    expect(res.body.user).not.toHaveProperty('createdAt');
    expect(res.body.user).not.toHaveProperty('updatedAt');
  });

  it('ignores identity and userType fields on current-user profile updates', async () => {
    mocks.updateUser.mockResolvedValueOnce({
      netid: 'unknown123',
      userType: 'unknown',
      userConfirmed: false,
      bio: 'Researcher',
    });

    const req = {
      user: { netId: 'unknown123' },
      body: {
        data: {
          fname: 'Ada',
          lname: 'Lovelace',
          email: 'ada@example.edu',
          userType: 'professor',
          userConfirmed: true,
          profileVerified: true,
          bio: 'Researcher',
        },
      },
    } as any;
    const res = privateResponseDouble();
    const next = vi.fn();

    await updateCurrentUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mocks.updateUser).toHaveBeenLastCalledWith('unknown123', { bio: 'Researcher' });
    expect(res.statusCode).toBe(200);
  });

  it('sanitizes self-edit profile URLs before persisting the current user', async () => {
    const profileUrls = Object.create(null);
    Object.assign(profileUrls, {
      yale: 'https://example.yale.edu/profile/student123',
      ' research.profile ': 'https://example.yale.edu/research/student123',
      $source: 'https://example.yale.edu/source/student123',
      constructor: 'https://example.yale.edu/constructor',
      prototype: 'https://example.yale.edu/prototype',
      personal: 'mailto:student123@yale.edu',
      script: 'javascript:alert(document.cookie)',
    });
    Object.defineProperty(profileUrls, '__proto__', {
      value: 'https://example.yale.edu/proto',
      enumerable: true,
    });

    mocks.updateUser.mockResolvedValue({
      _id: '64a000000000000000000020',
      netid: 'student123',
      userType: 'undergraduate',
      userConfirmed: true,
      website: 'https://example.yale.edu/student123',
      imageUrl: 'javascript:alert(document.cookie)',
      profileUrls: {
        yale: 'https://example.yale.edu/profile/student123',
        'research.profile': 'https://example.yale.edu/research/student123',
        $source: 'https://example.yale.edu/source/student123',
        constructor: 'https://example.yale.edu/constructor',
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
          profileUrls,
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
    expect(Object.prototype.hasOwnProperty.call(res.body.user.profileUrls, 'constructor')).toBe(
      false,
    );
    expect(Object.prototype.hasOwnProperty.call(res.body.user.profileUrls, 'prototype')).toBe(
      false,
    );
  });

  it('bounds self-edit account text and array fields before persisting the current user', async () => {
    mocks.updateUser.mockResolvedValue({
      _id: '64a000000000000000000020',
      netid: 'student123',
      userType: 'undergraduate',
      userConfirmed: true,
      bio: 'a'.repeat(2000),
      major: ['Computer Science'],
      researchInterests: ['public health'],
    });

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      body: {
        data: {
          bio: `  ${'a'.repeat(2100)}  `,
          phone: 2035551212,
          college: '  Benjamin Franklin College  ',
          physicalLocation: `  ${'b'.repeat(600)}  `,
          major: [
            'Computer Science',
            '',
            123,
            ...Array.from({ length: 60 }, (_, index) => `Topic ${index}`),
          ],
          departments: 'not-an-array',
          researchInterests: [' public health ', 'x'.repeat(150)],
          topics: [{ nested: true }],
        },
      },
    } as any;
    const res = privateResponseDouble();
    const next = vi.fn();

    await updateCurrentUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const update = mocks.updateUser.mock.calls[0][1];
    expect(update.bio).toHaveLength(2000);
    expect(update.phone).toBeUndefined();
    expect(update.college).toBe('Benjamin Franklin College');
    expect(update.physicalLocation).toHaveLength(500);
    expect(update.major).toHaveLength(50);
    expect(update.major[0]).toBe('Computer Science');
    expect(update.major).not.toContain('');
    expect(update.departments).toBeUndefined();
    expect(update.researchInterests).toEqual(['public health', 'x'.repeat(120)]);
    expect(update.topics).toEqual([]);
  });

  it('derives account departments from sanitized primary and secondary department fields', async () => {
    mocks.readUser.mockResolvedValue({
      netid: 'student123',
      primaryDepartment: 'History',
      secondaryDepartments: ['Statistics'],
    });
    mocks.updateUser.mockResolvedValue({
      _id: '64a000000000000000000020',
      netid: 'student123',
      userType: 'undergraduate',
      userConfirmed: true,
      primaryDepartment: 'Public Health',
      secondaryDepartments: ['Statistics'],
      departments: ['Public Health', 'Statistics'],
    });

    const req = {
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
      body: {
        data: {
          primaryDepartment: '  Public Health  ',
          departments: ['Forged Department'],
        },
      },
    } as any;
    const res = privateResponseDouble();
    const next = vi.fn();

    await updateCurrentUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mocks.readUser).toHaveBeenCalledWith('student123');
    expect(mocks.updateUser).toHaveBeenCalledWith('student123', {
      primaryDepartment: 'Public Health',
      departments: ['Public Health', 'Statistics'],
    });
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
