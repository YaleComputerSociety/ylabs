import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getProfileByNetid: vi.fn(),
  userFindOne: vi.fn(),
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
import { getProfile, getProfileCourses } from '../profileController';

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
