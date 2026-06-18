import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  searchPrograms: vi.fn(),
  readProgram: vi.fn(),
  addProgramView: vi.fn(),
  addProgramFavorite: vi.fn(),
  removeProgramFavorite: vi.fn(),
  hasAdminAuthorityForUser: vi.fn(),
}));

vi.mock('../../services/programService', () => ({
  searchPrograms: mocks.searchPrograms,
  getProgramFilterOptions: vi.fn(),
  readProgram: mocks.readProgram,
  addProgramView: mocks.addProgramView,
  addProgramFavorite: mocks.addProgramFavorite,
  removeProgramFavorite: mocks.removeProgramFavorite,
}));

vi.mock('../../services/adminGrantService', () => ({
  hasAdminAuthorityForUser: mocks.hasAdminAuthorityForUser,
}));

import {
  addFavoriteToProgram,
  addViewToProgram,
  getProgramById,
  removeFavoriteFromProgram,
  searchProgramsController,
} from '../programController';

const response = () => {
  const res = {
    json: vi.fn(),
    status: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
};

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
    applicationLink: 'https://example.yale.edu/apply',
    deadline: new Date('2026-02-01T00:00:00.000Z'),
    sourceName: 'Official program page',
    sourceUrl: 'https://example.yale.edu/program',
    studentVisibilityTier: 'student_ready',
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

describe('programController search visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchPrograms.mockResolvedValue({
      programs: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });
    mocks.readProgram.mockReset();
    mocks.addProgramView.mockReset();
    mocks.addProgramFavorite.mockReset();
    mocks.removeProgramFavorite.mockReset();
    mocks.hasAdminAuthorityForUser.mockResolvedValue(false);
  });

  it('does not pass nonpublic visibility filters for normal student searches', async () => {
    const res = response();

    await searchProgramsController(
      {
        query: {
          studentVisibilityTier: 'operator_review,suppressed',
          includeOperatorReview: 'true',
          includeSuppressed: 'true',
        },
        user: { userType: 'student' },
      } as any,
      res as any,
    );

    expect(mocks.searchPrograms).toHaveBeenCalledWith(
      expect.objectContaining({
        includeNonPublic: false,
        studentVisibilityTier: [],
        includeOperatorReview: false,
        includeSuppressed: false,
      }),
    );
  });

  it('caps public program search page and page size before querying', async () => {
    const res = response();

    await searchProgramsController(
      {
        query: {
          query: 'summer',
          page: '999999999',
          pageSize: '500',
        },
        user: { userType: 'student' },
      } as any,
      res as any,
    );

    expect(mocks.searchPrograms).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'summer',
        page: 1000,
        pageSize: 100,
      }),
    );
  });

  it('does not coerce object pagination or sort values for public program search', async () => {
    const res = response();
    const page = { toString: vi.fn(() => '999999999') };
    const pageSize = { toString: vi.fn(() => '500') };
    const sortOrder = { valueOf: vi.fn(() => 1) };

    await searchProgramsController(
      {
        query: {
          query: 'summer',
          page,
          pageSize,
          sortOrder,
        },
        user: { userType: 'student' },
      } as any,
      res as any,
    );

    expect(page.toString).not.toHaveBeenCalled();
    expect(pageSize.toString).not.toHaveBeenCalled();
    expect(sortOrder.valueOf).not.toHaveBeenCalled();
    expect(mocks.searchPrograms).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 20,
        sortOrder: -1,
      }),
    );
  });

  it('bounds public program search query and filters before querying', async () => {
    const res = response();
    const longPurpose = 'x'.repeat(200);

    await searchProgramsController(
      {
        query: {
          query: [` ${'q'.repeat(700)} `],
          yearOfStudy: Array.from({ length: 60 }, (_, index) => `Year ${index}`).join('|'),
          purpose: longPurpose,
        },
        user: { userType: 'student' },
      } as any,
      res as any,
    );

    const call = mocks.searchPrograms.mock.calls[0][0];
    expect(call.query).toBe('q'.repeat(512));
    expect(call.yearOfStudy).toContain('Year 49');
    expect(call.yearOfStudy).not.toContain('Year 50');
    expect(call.purpose).toEqual(['x'.repeat(120)]);
  });

  it('passes admin visibility filters for review and suppressed program inspection', async () => {
    const res = response();
    mocks.hasAdminAuthorityForUser.mockResolvedValue(true);

    await searchProgramsController(
      {
        query: {
          studentVisibilityTier: 'operator_review|suppressed',
          includeOperatorReview: 'true',
          includeSuppressed: 'true',
        },
        user: { userType: 'admin' },
      } as any,
      res as any,
    );

    expect(mocks.searchPrograms).toHaveBeenCalledWith(
      expect.objectContaining({
        includeNonPublic: true,
        studentVisibilityTier: ['operator_review', 'suppressed'],
        includeOperatorReview: true,
        includeSuppressed: true,
      }),
    );
  });

  it('does not treat legacy admin userType as nonpublic program search authority', async () => {
    const res = response();

    await searchProgramsController(
      {
        query: {
          studentVisibilityTier: 'operator_review|suppressed',
          includeOperatorReview: 'true',
          includeSuppressed: 'true',
        },
        user: { netId: 'legacy1', userType: 'admin' },
      } as any,
      res as any,
    );

    expect(mocks.searchPrograms).toHaveBeenCalledWith(
      expect.objectContaining({
        includeNonPublic: false,
        studentVisibilityTier: [],
        includeOperatorReview: false,
        includeSuppressed: false,
      }),
    );
  });

  it('normalizes unsafe public program search sort fields before querying', async () => {
    const res = response();

    await searchProgramsController(
      {
        query: {
          sortBy: 'studentVisibilitySuppressionReason',
          sortOrder: '1',
        },
        user: { userType: 'student' },
      } as any,
      res as any,
    );

    expect(mocks.searchPrograms).toHaveBeenCalledWith(
      expect.objectContaining({
        sortBy: 'updatedAt',
        sortOrder: 1,
      }),
    );
  });

  it('keeps allowed public program search sort fields', async () => {
    const res = response();

    await searchProgramsController(
      {
        query: {
          sortBy: 'deadline',
          sortOrder: '1',
        },
        user: { userType: 'student' },
      } as any,
      res as any,
    );

    expect(mocks.searchPrograms).toHaveBeenCalledWith(
      expect.objectContaining({
        sortBy: 'deadline',
        sortOrder: 1,
      }),
    );
  });

  it('normalizes invalid public program search sort direction', async () => {
    const res = response();

    await searchProgramsController(
      {
        query: {
          sortBy: 'deadline',
          sortOrder: 'not-a-number',
        },
        user: { userType: 'student' },
      } as any,
      res as any,
    );

    expect(mocks.searchPrograms).toHaveBeenCalledWith(
      expect.objectContaining({
        sortBy: 'deadline',
        sortOrder: -1,
      }),
    );
  });

  it('allowlists public program search results for normal readers', async () => {
    const res = response();
    mocks.searchPrograms.mockResolvedValue({
      programs: [privateProgram],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    await searchProgramsController(
      { query: {}, user: { userType: 'student' } } as any,
      res as any,
    );

    expectPublicProgram(res.json.mock.calls[0][0].results[0]);
  });

  it('filters unsafe public program URLs for normal readers', async () => {
    const res = response();
    mocks.searchPrograms.mockResolvedValue({
      programs: [
        {
          ...privateProgram,
          links: [
            {
              label: 'Program page. Questions: program@yale.edu or 203-555-1212.',
              url: 'https://example.yale.edu/program',
              sourceKey: 'private-link-source',
            },
            { label: 'Unsafe link', url: 'javascript:alert(document.cookie)' },
            { label: 'Credentialed link', url: 'https://user:pass@example.yale.edu/private' },
            { label: 'Email link', url: 'mailto:program@yale.edu' },
          ],
          applicationLink: 'https://user:pass@example.yale.edu/apply',
          sourceUrl: 'https://user:pass@example.yale.edu/program',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    await searchProgramsController(
      { query: {}, user: { userType: 'student' } } as any,
      res as any,
    );

    const payload = res.json.mock.calls[0][0].results[0];
    expect(payload.links).toEqual([
      {
        label: 'Program page. Questions: [email redacted] or [phone redacted].',
        url: 'https://example.yale.edu/program',
      },
    ]);
    expect(payload.applicationLink).toBeUndefined();
    expect(payload.sourceUrl).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('user:pass');
  });

  it('omits unsafe public program contact email values for normal readers', async () => {
    const res = response();
    mocks.searchPrograms.mockResolvedValue({
      programs: [
        {
          ...privateProgram,
          contactEmail: 'program@yale.edu?bcc=attacker@example.test',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    await searchProgramsController(
      { query: {}, user: { userType: 'student' } } as any,
      res as any,
    );

    const payload = res.json.mock.calls[0][0].results[0];
    expect(payload.contactEmail).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('program@yale.edu?bcc=attacker@example.test');
  });

  it('redacts direct contact details from public program text fields', async () => {
    const res = response();
    mocks.searchPrograms.mockResolvedValue({
      programs: [
        {
          ...privateProgram,
          summary: 'Email prose-contact@yale.edu or call 203-555-1212 before applying.',
          description: 'Questions: office@example.edu.',
          applicationInformation: 'Call 203.555.3434 for the form.',
          eligibility: 'Ask hidden@yale.edu about eligibility.',
          prepSteps: ['Email prep-contact@yale.edu or call 203-555-7777.'],
          contactPhone: '203-555-9999',
          contactOffice: 'Office contact: office@example.edu or 203-555-0000.',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    await searchProgramsController(
      { query: {}, user: { userType: 'student' } } as any,
      res as any,
    );

    const payload = res.json.mock.calls[0][0].results[0];
    expect(payload.summary).toBe('Email [email redacted] or call [phone redacted] before applying.');
    expect(payload.description).toBe('Questions: [email redacted].');
    expect(payload.applicationInformation).toBe('Call [phone redacted] for the form.');
    expect(payload.eligibility).toBe('Ask [email redacted] about eligibility.');
    expect(payload.prepSteps).toEqual(['Email [email redacted] or call [phone redacted].']);
    expect(payload.contactPhone).toBeUndefined();
    expect(payload.contactOffice).toBe('Office contact: [email redacted] or [phone redacted].');
    expect(JSON.stringify(payload)).not.toContain('prose-contact@yale.edu');
    expect(JSON.stringify(payload)).not.toContain('prep-contact@yale.edu');
    expect(JSON.stringify(payload)).not.toContain('office@example.edu');
    expect(JSON.stringify(payload)).not.toContain('203-555');
  });

  it('allowlists public program detail payloads for normal readers', async () => {
    const res = response();
    mocks.readProgram.mockResolvedValue(privateProgram);

    await getProgramById(
      {
        params: { id: '64a000000000000000000010' },
        user: { userType: 'student' },
      } as any,
      res as any,
    );

    const body = res.json.mock.calls[0][0];
    expectPublicProgram(body.program);
    expectPublicProgram(body.fellowship);
  });

  it('does not treat legacy admin userType as nonpublic program detail authority', async () => {
    const res = response();
    mocks.readProgram.mockResolvedValue(privateProgram);

    await getProgramById(
      {
        params: { id: '64a000000000000000000010' },
        user: { netId: 'legacy1', userType: 'admin' },
      } as any,
      res as any,
    );

    expect(mocks.readProgram).toHaveBeenCalledWith(
      '64a000000000000000000010',
      expect.objectContaining({ includeNonPublic: false }),
    );
    const body = res.json.mock.calls[0][0];
    expectPublicProgram(body.program);
    expectPublicProgram(body.fellowship);
  });

  it('does not leak internal service errors from program detail failures', async () => {
    const res = response();
    mocks.readProgram.mockRejectedValue(new Error('mongodb://user:pass@example.invalid leaked'));

    await getProgramById(
      {
        params: { id: '67d8928150621bcef434a1d5' },
        user: { userType: 'student' },
      } as any,
      res as any,
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to fetch program' });
  });

  it('does not leak internal not-found messages from program detail failures', async () => {
    const res = response();
    mocks.readProgram.mockRejectedValue(
      Object.assign(new Error('mongodb://user:pass@example.invalid missing'), {
        name: 'NotFoundError',
        status: 404,
      }),
    );

    await getProgramById(
      {
        params: { id: '67d8928150621bcef434a1d5' },
        user: { userType: 'student' },
      } as any,
      res as any,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Program not found' });
  });

  it('allowlists public program view payloads for normal readers', async () => {
    const res = response();
    mocks.addProgramView.mockResolvedValue(privateProgram);

    await addViewToProgram(
      { params: { id: '64a000000000000000000010' } } as any,
      res as any,
    );

    const body = res.json.mock.calls[0][0];
    expectPublicProgram(body.program);
    expectPublicProgram(body.fellowship);
  });

  it('allowlists public program favorite payloads for normal readers', async () => {
    const res = response();
    mocks.addProgramFavorite.mockResolvedValue(privateProgram);

    await addFavoriteToProgram(
      { params: { id: '64a000000000000000000010' } } as any,
      res as any,
    );

    const body = res.json.mock.calls[0][0];
    expectPublicProgram(body.program);
    expectPublicProgram(body.fellowship);
  });

  it('allowlists public program unfavorite payloads for normal readers', async () => {
    const res = response();
    mocks.removeProgramFavorite.mockResolvedValue(privateProgram);

    await removeFavoriteFromProgram(
      { params: { id: '64a000000000000000000010' } } as any,
      res as any,
    );

    const body = res.json.mock.calls[0][0];
    expectPublicProgram(body.program);
    expectPublicProgram(body.fellowship);
  });
});
