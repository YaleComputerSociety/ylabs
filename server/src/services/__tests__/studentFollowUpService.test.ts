import { beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

const mocks = vi.hoisted(() => ({
  studentProfileFindOne: vi.fn(),
  studentOutreachFind: vi.fn(),
  studentTrackingFind: vi.fn(),
  studentTrackingUpdateOne: vi.fn(),
  getSavedResearchEntities: vi.fn(),
  getResearchGroupDetail: vi.fn(),
}));

vi.mock('../../models/index', () => ({
  StudentProfile: { findOne: mocks.studentProfileFindOne },
  StudentOutreach: { find: mocks.studentOutreachFind },
  StudentTracking: { find: mocks.studentTrackingFind, updateOne: mocks.studentTrackingUpdateOne },
}));

vi.mock('../researchPlanService', () => ({
  getSavedResearchEntities: mocks.getSavedResearchEntities,
}));

vi.mock('../researchGroupService', () => ({
  getResearchGroupDetail: mocks.getResearchGroupDetail,
}));

import {
  dismissSavedResearchFollowUp,
  getSavedResearchFollowUps,
} from '../studentFollowUpService';
import { STUDENT_FOLLOW_UP_TEMPLATE_VERSION } from '../studentFollowUpEligibility';

const profileId = new mongoose.Types.ObjectId();
const staleEntityId = new mongoose.Types.ObjectId().toHexString();
const freshEntityId = new mongoose.Types.ObjectId().toHexString();

const NETID = 'testnet';
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

const asLean = (value: unknown) => ({ select: () => ({ lean: async () => value }) });

describe('getSavedResearchFollowUps', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((fn) => fn.mockReset());
    mocks.studentProfileFindOne.mockReturnValue(asLean({ _id: profileId }));
    mocks.getResearchGroupDetail.mockResolvedValue({
      members: [
        { role: 'pi', user: { displayName: 'Dr Synthetic Lead', email: 'lead@example.edu' } },
      ],
    });
  });

  it('returns no follow-ups when the account has no student profile', async () => {
    mocks.studentProfileFindOne.mockReturnValue(asLean(null));
    expect(await getSavedResearchFollowUps(NETID)).toEqual({});
    expect(mocks.getSavedResearchEntities).not.toHaveBeenCalled();
  });

  it('offers a follow-up for a stale, unanswered outreach and resolves the served lead email', async () => {
    mocks.getSavedResearchEntities.mockResolvedValue([
      { _id: staleEntityId, slug: 'stale-lab', name: 'Stale Lab', displayName: 'Stale Lab' },
    ]);
    mocks.studentOutreachFind.mockReturnValue(
      asLean([
        {
          researchEntityId: staleEntityId,
          reachedOutAt: daysAgo(10),
          outcome: 'unknown',
          templateVersion: 'student-intro-v1',
        },
      ]),
    );
    mocks.studentTrackingFind.mockReturnValue(asLean([]));

    const result = await getSavedResearchFollowUps(NETID);

    expect(result[staleEntityId]).toMatchObject({
      entityName: 'Stale Lab',
      daysSinceOutreach: 10,
      followUpsSent: 0,
      recipientEmail: 'lead@example.edu',
      leadName: 'Dr Synthetic Lead',
    });
  });

  it('does not offer a follow-up for recent outreach', async () => {
    mocks.getSavedResearchEntities.mockResolvedValue([
      { _id: freshEntityId, slug: 'fresh-lab', name: 'Fresh Lab' },
    ]);
    mocks.studentOutreachFind.mockReturnValue(
      asLean([
        { researchEntityId: freshEntityId, reachedOutAt: daysAgo(1), outcome: 'unknown' },
      ]),
    );
    mocks.studentTrackingFind.mockReturnValue(asLean([]));

    expect(await getSavedResearchFollowUps(NETID)).toEqual({});
  });

  it('counts prior follow-ups and honors dismissal', async () => {
    mocks.getSavedResearchEntities.mockResolvedValue([
      { _id: staleEntityId, slug: 'stale-lab', name: 'Stale Lab' },
    ]);
    mocks.studentOutreachFind.mockReturnValue(
      asLean([
        {
          researchEntityId: staleEntityId,
          reachedOutAt: daysAgo(30),
          outcome: 'unknown',
          templateVersion: 'student-intro-v1',
        },
        {
          researchEntityId: staleEntityId,
          reachedOutAt: daysAgo(10),
          outcome: 'unknown',
          templateVersion: STUDENT_FOLLOW_UP_TEMPLATE_VERSION,
        },
      ]),
    );
    mocks.studentTrackingFind.mockReturnValue(
      asLean([{ researchEntityId: staleEntityId, followUpNudgeDismissedAt: daysAgo(1) }]),
    );

    expect(await getSavedResearchFollowUps(NETID)).toEqual({});
  });

  it('excludes an entity with no recorded outreach', async () => {
    mocks.getSavedResearchEntities.mockResolvedValue([
      { _id: staleEntityId, slug: 'stale-lab', name: 'Stale Lab' },
    ]);
    mocks.studentOutreachFind.mockReturnValue(asLean([]));
    mocks.studentTrackingFind.mockReturnValue(asLean([]));

    expect(await getSavedResearchFollowUps(NETID)).toEqual({});
  });
});

describe('dismissSavedResearchFollowUp', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((fn) => fn.mockReset());
    mocks.studentProfileFindOne.mockReturnValue(asLean({ _id: profileId }));
    mocks.studentTrackingUpdateOne.mockResolvedValue({});
  });

  it('stamps a dismissal on the tracking record', async () => {
    await dismissSavedResearchFollowUp(NETID, staleEntityId);
    expect(mocks.studentTrackingUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ studentProfileId: profileId }),
      expect.objectContaining({
        $set: expect.objectContaining({ followUpNudgeDismissedAt: expect.any(Date) }),
      }),
      expect.objectContaining({ upsert: true }),
    );
  });

  it('rejects an invalid entity id', async () => {
    await expect(dismissSavedResearchFollowUp(NETID, 'not-an-id')).rejects.toThrow();
    expect(mocks.studentTrackingUpdateOne).not.toHaveBeenCalled();
  });
});
