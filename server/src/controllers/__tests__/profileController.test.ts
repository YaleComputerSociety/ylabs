import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listingFind: vi.fn(),
  getProfileByNetid: vi.fn(),
  userFindOne: vi.fn(),
}));

vi.mock('../../db/connections', () => ({
  getListingModel: () => ({
    find: mocks.listingFind,
  }),
}));

vi.mock('../../services/profileService', async () => {
  const actual = await vi.importActual<typeof import('../../services/profileService')>(
    '../../services/profileService',
  );
  return {
    ...actual,
    getProfileByNetid: mocks.getProfileByNetid,
  };
});

vi.mock('../../models/user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../models/user')>()),
  User: {
    findOne: mocks.userFindOne,
  },
}));

vi.mock('../../services/courseTableService', () => ({
  fetchCourseTableData: vi.fn(),
}));

import { fetchCourseTableData } from '../../services/courseTableService';
import { getProfile, getProfileCourses, getProfileListings } from '../profileController';

const mockTargetUser = (user: Record<string, unknown> | undefined) => {
  mocks.userFindOne.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(user ?? null),
  });
};

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
    mockTargetUser({ userType: 'professor' });

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

  it('404s listings for a non-faculty netid instead of leaking listing data', async () => {
    mockTargetUser({ userType: 'undergraduate' });

    const req = { params: { netid: 'student123' } } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await getProfileListings(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Profile not found' });
    expect(mocks.listingFind).not.toHaveBeenCalled();
  });

  it('404s listings for a nonexistent netid', async () => {
    mockTargetUser(undefined);

    const req = { params: { netid: 'ghost123' } } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await getProfileListings(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mocks.listingFind).not.toHaveBeenCalled();
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
      researchEntities: [
        { slug: 'owner-lab', name: 'Owner Lab', researchAreas: ['Adaptive Optics'] },
      ],
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
});

describe('getProfileCourses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns course-table data for a faculty netid', async () => {
    mockTargetUser({ fname: 'Owner', lname: 'Professor', userType: 'professor' });
    (fetchCourseTableData as any).mockResolvedValue([{ code: 'CPSC 100' }]);

    const req = { params: { netid: 'owner123' } } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await getProfileCourses(req, res);

    expect(fetchCourseTableData).toHaveBeenCalledWith('Owner Professor');
    expect(res.json).toHaveBeenCalledWith({ courses: [{ code: 'CPSC 100' }], available: true });
  });

  it('404s for a non-faculty netid instead of leaking course-table data', async () => {
    mockTargetUser({ fname: 'Student', lname: 'Victim', userType: 'undergraduate' });

    const req = { params: { netid: 'student123' } } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await getProfileCourses(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Profile not found' });
    expect(fetchCourseTableData).not.toHaveBeenCalled();
  });

  it('404s for a nonexistent netid', async () => {
    mockTargetUser(undefined);

    const req = { params: { netid: 'ghost123' } } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await getProfileCourses(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(fetchCourseTableData).not.toHaveBeenCalled();
  });
});
