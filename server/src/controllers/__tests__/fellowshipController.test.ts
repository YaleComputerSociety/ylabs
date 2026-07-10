import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readFellowship: vi.fn(),
  searchFellowships: vi.fn(),
  addView: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  hasAdminAuthorityForUser: vi.fn(),
}));

vi.mock('../../services/fellowshipService', () => ({
  readFellowship: mocks.readFellowship,
  searchFellowships: mocks.searchFellowships,
  getFilterOptions: vi.fn(),
  addView: mocks.addView,
  addFavorite: mocks.addFavorite,
  removeFavorite: mocks.removeFavorite,
}));

vi.mock('../../services/adminGrantService', () => ({
  hasAdminAuthorityForUser: mocks.hasAdminAuthorityForUser,
}));

import {
  addFavoriteToFellowship,
  addViewToFellowship,
  getFellowshipById,
  removeFavoriteFromFellowship,
  searchFellowshipsController,
} from '../fellowshipController';

const response = () => {
  const res = {
    json: vi.fn(),
    status: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
};

const privateFellowship = {
  _id: '64a000000000000000000010',
  title: 'Summer Research Program',
  programCategory: 'SUMMER_RESEARCH_PROGRAM',
  applicationLink: 'https://example.yale.edu/apply',
  deadline: new Date('2026-02-01T00:00:00.000Z'),
  contactEmail: 'program@yale.edu',
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
  studentVisibilityReviewedByUserId: '64a000000000000000000099',
  archived: false,
  audited: true,
  views: 99,
  favorites: 12,
  internalReviewNotes: 'private operator note',
};

const expectPublicFellowship = (payload: any) => {
  expect(payload).toMatchObject({
    _id: '64a000000000000000000010',
    title: 'Summer Research Program',
    programCategory: 'SUMMER_RESEARCH_PROGRAM',
    applicationLink: 'https://example.yale.edu/apply',
    deadline: new Date('2026-02-01T00:00:00.000Z'),
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
  expect(payload).not.toHaveProperty('studentVisibilityReviewedByUserId');
  expect(payload).not.toHaveProperty('archived');
  expect(payload).not.toHaveProperty('audited');
  expect(payload).not.toHaveProperty('views');
  expect(payload).not.toHaveProperty('favorites');
  expect(payload).not.toHaveProperty('internalReviewNotes');
};

describe('fellowshipController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchFellowships.mockResolvedValue({
      fellowships: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });
    mocks.readFellowship.mockReset();
    mocks.addView.mockReset();
    mocks.addFavorite.mockReset();
    mocks.removeFavorite.mockReset();
    mocks.hasAdminAuthorityForUser.mockResolvedValue(false);
  });

  it('allowlists public fellowship search results', async () => {
    const res = response();
    mocks.searchFellowships.mockResolvedValue({
      fellowships: [privateFellowship],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    await searchFellowshipsController({ query: {} } as any, res as any);

    expectPublicFellowship(res.json.mock.calls[0][0].results[0]);
  });

  it('normalizes unsafe fellowship search sort fields before querying', async () => {
    const res = response();

    await searchFellowshipsController(
      {
        query: {
          sortBy: 'studentVisibilitySuppressionReason',
          sortOrder: '1',
        },
      } as any,
      res as any,
    );

    expect(mocks.searchFellowships).toHaveBeenCalledWith(
      expect.objectContaining({
        sortBy: 'deadline',
        sortOrder: 1,
      }),
    );
  });

  it('caps public fellowship search page and page size before querying', async () => {
    const res = response();

    await searchFellowshipsController(
      {
        query: {
          query: 'summer',
          page: '999999999',
          pageSize: '500',
        },
      } as any,
      res as any,
    );

    expect(mocks.searchFellowships).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'summer',
        page: 1000,
        pageSize: 100,
      }),
    );
  });

  it('does not coerce object pagination or sort values for public fellowship search', async () => {
    const res = response();
    const page = { toString: vi.fn(() => '999999999') };
    const pageSize = { toString: vi.fn(() => '500') };
    const sortOrder = { valueOf: vi.fn(() => 1) };

    await searchFellowshipsController(
      {
        query: {
          query: 'summer',
          page,
          pageSize,
          sortOrder,
        },
      } as any,
      res as any,
    );

    expect(page.toString).not.toHaveBeenCalled();
    expect(pageSize.toString).not.toHaveBeenCalled();
    expect(sortOrder.valueOf).not.toHaveBeenCalled();
    expect(mocks.searchFellowships).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 20,
        sortOrder: -1,
      }),
    );
  });

  it('bounds public fellowship search query and filters before querying', async () => {
    const res = response();
    const longPurpose = 'x'.repeat(200);

    await searchFellowshipsController(
      {
        query: {
          query: [` ${'q'.repeat(700)} `],
          yearOfStudy: Array.from({ length: 60 }, (_, index) => `Year ${index}`).join('|'),
          purpose: longPurpose,
        },
      } as any,
      res as any,
    );

    const call = mocks.searchFellowships.mock.calls[0][0];
    expect(call.query).toBe('q'.repeat(512));
    expect(call.yearOfStudy).toContain('Year 49');
    expect(call.yearOfStudy).not.toContain('Year 50');
    expect(call.purpose).toEqual(['x'.repeat(120)]);
  });

  it('keeps allowed fellowship search sort fields', async () => {
    const res = response();

    await searchFellowshipsController(
      {
        query: {
          sortBy: 'deadline',
          sortOrder: '1',
        },
      } as any,
      res as any,
    );

    expect(mocks.searchFellowships).toHaveBeenCalledWith(
      expect.objectContaining({
        sortBy: 'deadline',
        sortOrder: 1,
      }),
    );
  });

  it('normalizes invalid fellowship search sort direction', async () => {
    const res = response();

    await searchFellowshipsController(
      {
        query: {
          sortBy: 'deadline',
          sortOrder: 'not-a-number',
        },
      } as any,
      res as any,
    );

    expect(mocks.searchFellowships).toHaveBeenCalledWith(
      expect.objectContaining({
        sortBy: 'deadline',
        sortOrder: -1,
      }),
    );
  });

  it('omits unsafe public fellowship contact email values', async () => {
    const res = response();
    mocks.searchFellowships.mockResolvedValue({
      fellowships: [
        {
          ...privateFellowship,
          contactEmail: 'program@yale.edu?bcc=attacker@example.test',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    await searchFellowshipsController({ query: {} } as any, res as any);

    const payload = res.json.mock.calls[0][0].results[0];
    expect(payload.contactEmail).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('program@yale.edu?bcc=attacker@example.test');
  });

  it('redacts direct contact details from public fellowship text fields', async () => {
    const res = response();
    mocks.searchFellowships.mockResolvedValue({
      fellowships: [
        {
          ...privateFellowship,
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

    await searchFellowshipsController({ query: {} } as any, res as any);

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

  it('allowlists public fellowship detail payloads for normal readers', async () => {
    const res = response();
    mocks.readFellowship.mockResolvedValue(privateFellowship);

    await getFellowshipById(
      {
        params: { id: '64a000000000000000000010' },
        user: { userType: 'student' },
      } as any,
      res as any,
    );

    expectPublicFellowship(res.json.mock.calls[0][0].fellowship);
  });

  it('does not treat legacy admin userType as nonpublic fellowship detail authority', async () => {
    const res = response();
    mocks.readFellowship.mockResolvedValue(privateFellowship);

    await getFellowshipById(
      {
        params: { id: '64a000000000000000000010' },
        user: { netId: 'legacy1', userType: 'admin' },
      } as any,
      res as any,
    );

    expect(mocks.readFellowship).toHaveBeenCalledWith(
      '64a000000000000000000010',
      expect.objectContaining({ includeNonPublic: false }),
    );
    expectPublicFellowship(res.json.mock.calls[0][0].fellowship);
  });

  it('does not leak internal service errors from fellowship detail failures', async () => {
    const res = response();
    mocks.readFellowship.mockRejectedValue(new Error('mongodb://user:pass@example.invalid leaked'));

    await getFellowshipById(
      {
        params: { id: '67d8928150621bcef434a1d5' },
        user: { userType: 'student' },
      } as any,
      res as any,
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to fetch fellowship' });
  });

  it('does not leak internal not-found messages from fellowship detail failures', async () => {
    const res = response();
    mocks.readFellowship.mockRejectedValue(
      Object.assign(new Error('mongodb://user:pass@example.invalid missing'), {
        name: 'NotFoundError',
        status: 404,
      }),
    );

    await getFellowshipById(
      {
        params: { id: '67d8928150621bcef434a1d5' },
        user: { userType: 'student' },
      } as any,
      res as any,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Fellowship not found' });
  });

  it('allowlists public fellowship view payloads', async () => {
    const res = response();
    mocks.addView.mockResolvedValue(privateFellowship);

    await addViewToFellowship(
      { params: { id: '64a000000000000000000010' } } as any,
      res as any,
    );

    expectPublicFellowship(res.json.mock.calls[0][0].fellowship);
  });

  it('allowlists public fellowship favorite payloads', async () => {
    const res = response();
    mocks.addFavorite.mockResolvedValue(privateFellowship);

    await addFavoriteToFellowship(
      { params: { id: '64a000000000000000000010' } } as any,
      res as any,
    );

    expectPublicFellowship(res.json.mock.calls[0][0].fellowship);
  });

  it('allowlists public fellowship unfavorite payloads', async () => {
    const res = response();
    mocks.removeFavorite.mockResolvedValue(privateFellowship);

    await removeFavoriteFromFellowship(
      { params: { id: '64a000000000000000000010' } } as any,
      res as any,
    );

    expectPublicFellowship(res.json.mock.calls[0][0].fellowship);
  });
});
