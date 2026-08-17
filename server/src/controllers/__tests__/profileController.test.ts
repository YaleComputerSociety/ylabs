import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listingFind: vi.fn(),
  userFindOne: vi.fn(),
  userFindOneAndUpdate: vi.fn(),
  getProfileByNetid: vi.fn(),
  updateOwnProfile: vi.fn(),
  cascadeDepartmentsToListings: vi.fn(),
}));

vi.mock('../../db/connections', () => ({
  getListingModel: () => ({
    find: mocks.listingFind,
  }),
}));

vi.mock('../../models/user', () => ({
  User: {
    findOne: mocks.userFindOne,
    findOneAndUpdate: mocks.userFindOneAndUpdate,
  },
}));

vi.mock('../../services/profileService', async () => {
  const actual = await vi.importActual<typeof import('../../services/profileService')>(
    '../../services/profileService',
  );
  return {
    ...actual,
    getProfileByNetid: mocks.getProfileByNetid,
    updateOwnProfile: mocks.updateOwnProfile,
    cascadeDepartmentsToListings: mocks.cascadeDepartmentsToListings,
  };
});

vi.mock('../../services/courseTableService', () => ({
  fetchCourseTableData: vi.fn(),
}));

import {
  getProfile,
  getProfileListings,
  updateProfile,
  verifyProfile,
} from '../profileController';

describe('profileController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allowlists profile listing payloads for authenticated readers', async () => {
    const listing = {
      _id: 'listing-1',
      title: 'Research assistant',
      description: 'Help with a research project.',
      applicantDescription: 'Students will learn methods.',
      websites: [
        'https://example.yale.edu/apply',
        'https://user:pass@example.yale.edu/private',
        'javascript:alert(document.cookie)',
        'mailto:owner123@yale.edu',
      ],
      departments: ['Computer Science'],
      researchAreas: ['Systems'],
      keywords: ['systems'],
      type: 'Research Assistant',
      commitment: '5 hours/week',
      compensationType: 'Paid',
      expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      ownerId: 'owner123',
      ownerEmail: 'owner123@yale.edu',
      ownerFirstName: 'Owner',
      ownerLastName: 'Professor',
      professorIds: ['victim123'],
      professorNames: ['Victim Professor'],
      emails: ['victim123@yale.edu'],
      createdByUserId: '64a000000000000000000001',
      views: 42,
      favorites: ['student123'],
      archived: false,
      confirmed: true,
      audited: true,
      embedding: [0.1, 0.2],
    };
    mocks.listingFind.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([listing]),
    });

    const req = { params: { netid: 'owner123' } } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await getProfileListings(req, res);

    expect(res.json).toHaveBeenCalledWith({
      listings: [
        {
          _id: 'listing-1',
          title: 'Research assistant',
          description: 'Help with a research project.',
          applicantDescription: 'Students will learn methods.',
          websites: ['https://example.yale.edu/apply'],
          departments: ['Computer Science'],
          researchAreas: ['Systems'],
          keywords: ['systems'],
          type: 'Research Assistant',
          commitment: '5 hours/week',
          compensationType: 'Paid',
          expiresAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ],
    });
    const payload = res.json.mock.calls[0][0].listings[0];
    expect(payload).not.toHaveProperty('ownerId');
    expect(payload).not.toHaveProperty('ownerEmail');
    expect(payload).not.toHaveProperty('professorIds');
    expect(payload).not.toHaveProperty('professorNames');
    expect(payload).not.toHaveProperty('emails');
    expect(payload).not.toHaveProperty('createdByUserId');
    expect(payload).not.toHaveProperty('views');
    expect(payload).not.toHaveProperty('favorites');
    expect(payload).not.toHaveProperty('archived');
    expect(payload).not.toHaveProperty('confirmed');
    expect(payload).not.toHaveProperty('audited');
    expect(payload).not.toHaveProperty('embedding');
  });

  it('forwards the already-normalized profile (research homes + interest tags) without re-normalizing', async () => {
    // `getProfileByNetid` is the single normalization point and returns a
    // public-safe profile. Internal-field stripping is owned and tested by
    // `normalizePublicProfile` (see profileService.test.ts). The controller
    // must NOT re-normalize, which would drop the loaded research homes and
    // re-derive interest tags from nothing.
    const normalized = {
      _id: 'user-1',
      netid: 'owner123',
      fname: 'Owner',
      lname: 'Professor',
      email: 'owner123@yale.edu',
      userType: 'professor',
      profileVerified: true,
      bio: '',
      research_interest_summary:
        'The Owner group studies adaptive optics and wavefront control for ground-based telescopes.',
      research_interests: ['Adaptive Optics', 'Wavefront Control'],
      researchEntities: [{ slug: 'owner-lab', name: 'Owner Lab', researchAreas: ['Adaptive Optics'] }],
    };
    mocks.getProfileByNetid.mockResolvedValue(normalized);

    const req = { params: { netid: 'owner123' } } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await getProfile(req, res);

    const payload = res.json.mock.calls[0][0].profile;
    expect(payload).toBe(normalized);
    expect(payload.research_interest_summary).toBe(
      'The Owner group studies adaptive optics and wavefront control for ground-based telescopes.',
    );
    expect(payload.research_interests).toEqual(['Adaptive Optics', 'Wavefront Control']);
    expect(payload.researchEntities).toHaveLength(1);
  });

  it('does not expose internal user maintenance fields after profile updates', async () => {
    mocks.updateOwnProfile.mockResolvedValue({
      _id: 'user-1',
      netid: 'owner123',
      fname: 'Owner',
      lname: 'Professor',
      email: 'owner123@yale.edu',
      userType: 'professor',
      userConfirmed: true,
      profileVerified: true,
      bio: 'Updated public bio.',
      googleScholarId: 'private-scholar-id',
      savedPathwayPlans: { pathway: { note: 'private note' } },
      confidenceByField: { bio: 0.75 },
      manuallyLockedFields: ['email'],
      lastActive: new Date('2026-01-01T00:00:00.000Z'),
      archived: false,
    });

    const req = {
      user: { netId: 'owner123' },
      body: { bio: 'Updated public bio.' },
    } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await updateProfile(req, res);

    const payload = res.json.mock.calls[0][0].profile;
    expect(payload).toMatchObject({
      netid: 'owner123',
      fname: 'Owner',
      lname: 'Professor',
      bio: 'Updated public bio.',
    });
    expect(payload).not.toHaveProperty('googleScholarId');
    expect(payload).not.toHaveProperty('savedPathwayPlans');
    expect(payload).not.toHaveProperty('confidenceByField');
    expect(payload).not.toHaveProperty('manuallyLockedFields');
    expect(payload).not.toHaveProperty('lastActive');
    expect(payload).not.toHaveProperty('archived');
  });

  it('does not leak internal service errors from profile update failures', async () => {
    mocks.updateOwnProfile.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid profile update failed'),
    );

    const req = {
      user: { netId: 'owner123' },
      body: { bio: 'Updated public bio.' },
    } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await updateProfile(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to update profile' });
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('mongodb://user:pass');
  });

  it('does not leak internal service errors from profile verification failures', async () => {
    mocks.userFindOne.mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        netid: 'owner123',
        userType: 'professor',
        primaryDepartment: 'Computer Science',
        researchInterests: ['systems'],
        bio: 'Systems research.',
        imageUrl: 'https://faculty.yale.edu/profile.jpg',
      }),
    });
    mocks.userFindOneAndUpdate.mockReturnValue({
      lean: vi
        .fn()
        .mockRejectedValue(new Error('mongodb://user:pass@example.invalid verify failed')),
    });

    const req = { user: { netId: 'owner123' } } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await verifyProfile(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to verify profile' });
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('mongodb://user:pass');
  });
});
