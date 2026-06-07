import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readFellowship: vi.fn(),
  searchFellowships: vi.fn(),
  addView: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
}));

vi.mock('../../services/fellowshipService', () => ({
  readFellowship: mocks.readFellowship,
  searchFellowships: mocks.searchFellowships,
  getFilterOptions: vi.fn(),
  addView: mocks.addView,
  addFavorite: mocks.addFavorite,
  removeFavorite: mocks.removeFavorite,
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
    contactEmail: 'program@yale.edu',
    sourceName: 'Official program page',
    sourceUrl: 'https://example.yale.edu/program',
    studentVisibilityTier: 'student_ready',
    studentVisibilityComputedTier: 'student_ready',
    studentVisibilityReasons: ['public reason'],
  });
  expect(payload).not.toHaveProperty('sourceKey');
  expect(payload).not.toHaveProperty('sourceFingerprint');
  expect(payload).not.toHaveProperty('sourceLastVerifiedAt');
  expect(payload).not.toHaveProperty('sourceLastChangedAt');
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
        sortBy: 'updatedAt',
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
