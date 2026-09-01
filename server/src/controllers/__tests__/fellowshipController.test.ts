import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addView: vi.fn(),
}));

vi.mock('../../services/fellowshipService', () => ({
  addView: mocks.addView,
}));

import { addViewToFellowship } from '../fellowshipController';

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
  applicationLink: 'https://example.yale.edu/program/apply',
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
  studentVisibilityReviewedByAccountId: '64a000000000000000000099',
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
    applicationLink: 'https://example.yale.edu/program/apply',
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
  expect(payload).not.toHaveProperty('studentVisibilityReviewedByAccountId');
  expect(payload).not.toHaveProperty('archived');
  expect(payload).not.toHaveProperty('audited');
  expect(payload).not.toHaveProperty('views');
  expect(payload).not.toHaveProperty('favorites');
  expect(payload).not.toHaveProperty('internalReviewNotes');
};

describe('fellowshipController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addView.mockReset();
  });

  it('allowlists public fellowship view payloads', async () => {
    const res = response();
    mocks.addView.mockResolvedValue(privateFellowship);

    await addViewToFellowship({ params: { id: '64a000000000000000000010' } } as any, res as any);

    expectPublicFellowship(res.json.mock.calls[0][0].fellowship);
  });
});
