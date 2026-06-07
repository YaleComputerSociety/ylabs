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
  getPublications,
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

  it('allowlists embedded profile publication payloads for authenticated readers', async () => {
    const publication = {
      title: 'A Useful Paper',
      doi: '10.1234/example',
      year: 2026,
      venue: 'Journal of Examples',
      citedByCount: 17,
      openAccessUrl: 'https://example.yale.edu/paper.pdf',
      source: 'official-profile',
      sourceUrl: 'https://profile.yale.edu/person',
      sourceEvidenceId: 'observation-1',
      ownerId: 'owner123',
      ownerEmail: 'owner123@yale.edu',
      confidence: 0.95,
      archived: false,
      raw: { private: true },
    };
    mocks.userFindOne.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({ netid: 'owner123', publications: [publication] }),
    });

    const req = {
      params: { netid: 'owner123' },
      query: { page: '1', pageSize: '20', sortBy: 'year', sortOrder: 'desc' },
    } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await getPublications(req, res);

    expect(res.json).toHaveBeenCalledWith({
      publications: [
        {
          title: 'A Useful Paper',
          doi: '10.1234/example',
          year: 2026,
          venue: 'Journal of Examples',
          cited_by_count: 17,
          open_access_url: 'https://example.yale.edu/paper.pdf',
          source: 'official-profile',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    const payload = res.json.mock.calls[0][0].publications[0];
    expect(payload).not.toHaveProperty('sourceUrl');
    expect(payload).not.toHaveProperty('sourceEvidenceId');
    expect(payload).not.toHaveProperty('ownerId');
    expect(payload).not.toHaveProperty('ownerEmail');
    expect(payload).not.toHaveProperty('confidence');
    expect(payload).not.toHaveProperty('archived');
    expect(payload).not.toHaveProperty('raw');
  });

  it('omits unsafe embedded profile publication URLs for authenticated readers', async () => {
    const publication = {
      title: 'A Useful Paper',
      year: 2026,
      openAccessUrl: 'https://user:pass@example.yale.edu/paper.pdf',
      source: 'official-profile',
    };
    mocks.userFindOne.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({ netid: 'owner123', publications: [publication] }),
    });

    const req = {
      params: { netid: 'owner123' },
      query: { page: '1', pageSize: '20', sortBy: 'year', sortOrder: 'desc' },
    } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await getPublications(req, res);

    expect(res.json).toHaveBeenCalledWith({
      publications: [
        {
          title: 'A Useful Paper',
          year: 2026,
          source: 'official-profile',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    expect(res.json.mock.calls[0][0].publications[0]).not.toHaveProperty('open_access_url');
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('user:pass');
  });

  it('normalizes unsafe profile publication sort fields before ordering raw rows', async () => {
    mocks.userFindOne.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({
        netid: 'owner123',
        publications: [
          {
            title: 'New public paper',
            year: 2026,
            sourceEvidenceId: 'z-private',
          },
          {
            title: 'Old public paper',
            year: 2020,
            sourceEvidenceId: 'a-private',
          },
        ],
      }),
    });

    const req = {
      params: { netid: 'owner123' },
      query: { page: '1', pageSize: '20', sortBy: 'sourceEvidenceId', sortOrder: 'asc' },
    } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await getPublications(req, res);

    expect(res.json.mock.calls[0][0].publications.map((publication: any) => publication.title)).toEqual([
      'New public paper',
      'Old public paper',
    ]);
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('sourceEvidenceId');
  });

  it('caps profile publication page before slicing publication rows', async () => {
    mocks.userFindOne.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({
        netid: 'owner123',
        publications: [],
      }),
    });

    const req = {
      params: { netid: 'owner123' },
      query: { page: '999999999', pageSize: '500', sortBy: 'year', sortOrder: 'desc' },
    } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await getPublications(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1000,
        pageSize: 100,
        publications: [],
      }),
    );
  });

  it('does not expose internal user maintenance fields on public profile reads', async () => {
    mocks.getProfileByNetid.mockResolvedValue({
      _id: 'user-1',
      netid: 'owner123',
      fname: 'Owner',
      lname: 'Professor',
      email: 'owner123@yale.edu',
      userType: 'professor',
      userConfirmed: true,
      profileVerified: true,
      googleScholarId: 'private-scholar-id',
      savedPathwayPlans: { pathway: { note: 'private note' } },
      confidenceByField: { email: 0.99 },
      manuallyLockedFields: ['email'],
      lastLoginAt: new Date('2026-01-01T00:00:00.000Z'),
      archived: false,
      dedupedIntoUserId: 'user-2',
    });

    const req = { params: { netid: 'owner123' } } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await getProfile(req, res);

    const payload = res.json.mock.calls[0][0].profile;
    expect(payload).toMatchObject({
      _id: 'user-1',
      netid: 'owner123',
      fname: 'Owner',
      lname: 'Professor',
      email: 'owner123@yale.edu',
      userType: 'professor',
      profileVerified: true,
    });
    expect(payload).not.toHaveProperty('googleScholarId');
    expect(payload).not.toHaveProperty('savedPathwayPlans');
    expect(payload).not.toHaveProperty('confidenceByField');
    expect(payload).not.toHaveProperty('manuallyLockedFields');
    expect(payload).not.toHaveProperty('lastLoginAt');
    expect(payload).not.toHaveProperty('archived');
    expect(payload).not.toHaveProperty('dedupedIntoUserId');
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
      _id: 'user-1',
      netid: 'owner123',
      fname: 'Owner',
      lname: 'Professor',
      email: 'owner123@yale.edu',
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
