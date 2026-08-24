import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getResearchGroupDetail: vi.fn(),
  hasAdminAuthorityForUser: vi.fn(),
  searchResearchGroupsViaMeili: vi.fn(),
  resolveArchivedResearchEntityCanonicalSlug: vi.fn(),
  recordResearchEntityOutreach: vi.fn(),
  getStudentResearchInterests: vi.fn(),
  getResearcherProfileByPublicKey: vi.fn(),
}));

vi.mock('../../services/researchGroupService', () => ({
  getResearchGroupDetail: mocks.getResearchGroupDetail,
  normalizeResearchDetailSlug: (value: unknown) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return /^[a-z0-9][a-z0-9_-]{0,159}$/i.test(trimmed) ? trimmed : undefined;
  },
  searchResearchGroupsViaMeili: mocks.searchResearchGroupsViaMeili,
  resolveArchivedResearchEntityCanonicalSlug: mocks.resolveArchivedResearchEntityCanonicalSlug,
  recordResearchEntityOutreach: mocks.recordResearchEntityOutreach,
}));

vi.mock('../../services/researcherProfileService', () => ({
  getResearcherProfileByPublicKey: mocks.getResearcherProfileByPublicKey,
}));

vi.mock('../../services/adminGrantService', () => ({
  hasAdminAuthorityForUser: mocks.hasAdminAuthorityForUser,
}));

vi.mock('../../services/studentInterestProfileService', () => ({
  getStudentResearchInterests: mocks.getStudentResearchInterests,
}));

import {
  getResearchGroupBySlug,
  getResearcherProfile,
  recordResearchOutreach,
  searchRelatedPrograms,
  searchResearchGroups,
} from '../researchGroupController';

describe('researchGroupController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasAdminAuthorityForUser.mockResolvedValue(false);
    mocks.resolveArchivedResearchEntityCanonicalSlug.mockResolvedValue(null);
    mocks.getStudentResearchInterests.mockResolvedValue({
      researchInterests: [],
      graduationYear: null,
    });
  });

  it('does not leak internal service errors from public research detail failures', async () => {
    mocks.getResearchGroupDetail.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid research detail failed'),
    );

    const req = { params: { slug: 'example-lab' } } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await getResearchGroupBySlug(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to fetch research entity' });
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('mongodb://user:pass');
  });

  it('does not echo slugs or internal text from missing public research details', async () => {
    mocks.getResearchGroupDetail.mockResolvedValue(null);

    const req = { params: { slug: 'private-internal-slug' } } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await getResearchGroupBySlug(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Research entity not found' });
  });

  it('rejects malformed public research detail slugs before service work', async () => {
    const req = { params: { slug: '../private-internal-slug' } } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await getResearchGroupBySlug(req, res);

    expect(mocks.getResearchGroupDetail).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid slug' });
  });

  it('rejects oversized public research detail slugs before service work', async () => {
    const req = { params: { slug: 'a'.repeat(4096) } } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await getResearchGroupBySlug(req, res);

    expect(mocks.getResearchGroupDetail).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid slug' });
  });

  it('rejects oversized public research search queries before search work', async () => {
    const req = {
      body: {
        q: 'x'.repeat(513),
        page: 1,
        pageSize: 24,
        filters: {},
      },
    } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await searchResearchGroups(req, res);

    expect(mocks.searchResearchGroupsViaMeili).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid search request' });
  });

  it('rejects oversized public research filter arrays before search work', async () => {
    const req = {
      body: {
        q: '',
        page: 1,
        pageSize: 24,
        filters: {
          departments: Array.from({ length: 51 }, (_, index) => `Department ${index}`),
        },
      },
    } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await searchResearchGroups(req, res);

    expect(mocks.searchResearchGroupsViaMeili).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid search request' });
  });

  it('rejects non-string public research filter values before coercion', async () => {
    const badFilter = { toString: vi.fn(() => 'Department') };
    const req = {
      body: {
        q: '',
        filters: {
          departments: [badFilter],
        },
      },
    } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await searchResearchGroups(req, res);

    expect(badFilter.toString).not.toHaveBeenCalled();
    expect(mocks.searchResearchGroupsViaMeili).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid search request' });
  });

  it('caps public research search page before dispatching search work', async () => {
    mocks.searchResearchGroupsViaMeili.mockResolvedValue({
      researchEntities: [],
      estimatedTotalHits: 0,
      page: 1000,
      pageSize: 100,
    });
    const req = {
      body: {
        q: '',
        page: 999_999_999,
        pageSize: 500,
        filters: {},
      },
    } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await searchResearchGroups(req, res);

    expect(mocks.searchResearchGroupsViaMeili).toHaveBeenCalledWith(
      '',
      expect.any(Object),
      1000,
      100,
      expect.any(Object),
      expect.any(Object),
    );
    expect(res.json).toHaveBeenCalledWith({
      researchEntities: [],
      estimatedTotalHits: 0,
      page: 1000,
      pageSize: 100,
    });
  });

  it('does not expose nonpublic research results to legacy admin sessions without active authority', async () => {
    mocks.hasAdminAuthorityForUser.mockResolvedValue(false);
    mocks.searchResearchGroupsViaMeili.mockResolvedValue({
      researchEntities: [],
      estimatedTotalHits: 0,
      page: 1,
      pageSize: 24,
    });
    const req = {
      user: { netId: 'legacy123', userType: 'admin' },
      body: {
        q: '',
        studentVisibilityTier: ['operator_review'],
        includeSuppressed: true,
        browseQuality: 'low-first',
        qualityFilters: ['missing-lead'],
      },
    } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await searchResearchGroups(req, res);

    expect(mocks.hasAdminAuthorityForUser).toHaveBeenCalledWith(req.user);
    expect(mocks.searchResearchGroupsViaMeili).toHaveBeenCalledWith(
      '',
      { studentVisibilityTier: ['student_ready'] },
      1,
      24,
      {},
      {
        includeNonPublic: false,
        lowQualityFirst: false,
        qualityFilters: [],
      },
    );
  });

  it('allows active admin authority to request nonpublic research review filters', async () => {
    mocks.hasAdminAuthorityForUser.mockResolvedValue(true);
    mocks.searchResearchGroupsViaMeili.mockResolvedValue({
      researchEntities: [],
      estimatedTotalHits: 0,
      page: 1,
      pageSize: 24,
    });
    const req = {
      user: { netId: 'admin123', userType: 'admin' },
      body: {
        q: '',
        studentVisibilityTier: ['operator_review'],
        browseQuality: 'low-first',
        qualityFilters: ['missing-lead'],
      },
    } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await searchResearchGroups(req, res);

    expect(mocks.searchResearchGroupsViaMeili).toHaveBeenCalledWith(
      '',
      { studentVisibilityTier: ['operator_review'] },
      1,
      24,
      {},
      {
        includeNonPublic: true,
        lowQualityFirst: true,
        qualityFilters: ['missing-lead'],
      },
    );
  });

  it('returns an empty related-programs module for a blank query without search work', async () => {
    const req = { body: { q: '   ' } } as any;
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;

    await searchRelatedPrograms(req, res);

    expect(mocks.searchResearchGroupsViaMeili).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ researchEntities: [], degraded: false });
  });

  it('searches only public program and fellowship entity types for a topical query', async () => {
    mocks.searchResearchGroupsViaMeili.mockResolvedValue({
      researchEntities: [{ _id: 'a' }, { _id: 'b' }],
      estimatedTotalHits: 2,
      page: 1,
      pageSize: 5,
      degraded: false,
    });
    const req = {
      body: { q: '  climate  ', filters: { researchAreas: ['Climate Science'], school: ['FAS'] } },
    } as any;
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;

    await searchRelatedPrograms(req, res);

    expect(mocks.searchResearchGroupsViaMeili).toHaveBeenCalledWith(
      'climate',
      {
        entityType: ['PROGRAM', 'RA_PROGRAM', 'FELLOWSHIP_PROGRAM'],
        studentVisibilityTier: ['student_ready'],
        school: ['FAS'],
        researchAreas: ['Climate Science'],
      },
      1,
      5,
      {},
      { includeNonPublic: false },
    );
    expect(res.json).toHaveBeenCalledWith({
      researchEntities: [{ _id: 'a' }, { _id: 'b' }],
      degraded: false,
    });
  });

  it('caps the related-programs module to five entities', async () => {
    mocks.searchResearchGroupsViaMeili.mockResolvedValue({
      researchEntities: Array.from({ length: 8 }, (_, index) => ({ _id: `p${index}` })),
      estimatedTotalHits: 8,
      page: 1,
      pageSize: 5,
    });
    const req = { body: { q: 'immunology' } } as any;
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;

    await searchRelatedPrograms(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.researchEntities).toHaveLength(5);
    expect(payload.degraded).toBe(false);
  });

  it('rejects an oversized related-programs query before search work', async () => {
    const req = { body: { q: 'x'.repeat(513) } } as any;
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;

    await searchRelatedPrograms(req, res);

    expect(mocks.searchResearchGroupsViaMeili).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid search request' });
  });

  it('does not leak internal errors when the related-programs search fails', async () => {
    mocks.searchResearchGroupsViaMeili.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid related search failed'),
    );
    const req = { body: { q: 'genetics' } } as any;
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;

    await searchRelatedPrograms(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Search failed' });
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('mongodb://user:pass');
  });

  it('rejects an outreach record from a session with no student profile', async () => {
    const req = { params: { slug: 'a-lab' }, body: {}, user: {} } as any;
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;

    await recordResearchOutreach(req, res);

    expect(mocks.recordResearchEntityOutreach).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'A student profile is required' });
  });

  it('forwards a sanitized mailto delivery context to the outreach service', async () => {
    mocks.recordResearchEntityOutreach.mockResolvedValue({ recorded: true });
    const req = {
      params: { slug: 'a-lab' },
      user: { studentProfileId: 'profile-1' },
      body: {
        deliveryMethod: 'mailto',
        emailGeneratedByPlatform: true,
        templateVersion: 'student-intro-v1',
      },
    } as any;
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() } as any;

    await recordResearchOutreach(req, res);

    expect(mocks.recordResearchEntityOutreach).toHaveBeenCalledWith('a-lab', 'profile-1', {
      deliveryMethod: 'mailto',
      emailGeneratedByPlatform: true,
      templateVersion: 'student-intro-v1',
    });
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('drops an unsafe templateVersion instead of forwarding it to the outreach service', async () => {
    mocks.recordResearchEntityOutreach.mockResolvedValue({ recorded: true });
    const req = {
      params: { slug: 'a-lab' },
      user: { studentProfileId: 'profile-1' },
      body: {
        deliveryMethod: 'mailto',
        emailGeneratedByPlatform: true,
        templateVersion: '<script>alert(1)</script>',
      },
    } as any;
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() } as any;

    await recordResearchOutreach(req, res);

    expect(mocks.recordResearchEntityOutreach).toHaveBeenCalledWith('a-lab', 'profile-1', {
      deliveryMethod: 'mailto',
      emailGeneratedByPlatform: true,
      templateVersion: undefined,
    });
  });

  it('ignores a client-supplied deliveryMethod outside the mailto scaffold', async () => {
    mocks.recordResearchEntityOutreach.mockResolvedValue({ recorded: true, routeUrl: 'https://a.example' });
    const req = {
      params: { slug: 'a-lab' },
      user: { studentProfileId: 'profile-1' },
      body: { deliveryMethod: 'official-route', emailGeneratedByPlatform: true },
    } as any;
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() } as any;

    await recordResearchOutreach(req, res);

    expect(mocks.recordResearchEntityOutreach).toHaveBeenCalledWith('a-lab', 'profile-1', {
      deliveryMethod: 'official-route',
      emailGeneratedByPlatform: false,
      templateVersion: undefined,
    });
  });

  it('translates a missing outreach route into a 409 without leaking internals', async () => {
    mocks.recordResearchEntityOutreach.mockRejectedValue(new Error('NO_APPROVED_OUTREACH_ROUTE'));
    const req = {
      params: { slug: 'a-lab' },
      user: { studentProfileId: 'profile-1' },
      body: {},
    } as any;
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() } as any;

    await recordResearchOutreach(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'No approved outreach route is available' });
  });

  describe('getResearcherProfile', () => {
    it('rejects malformed researcher keys before service work', async () => {
      const req = { params: { publicKey: '../secret' } } as any;
      const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;

      await getResearcherProfile(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mocks.getResearcherProfileByPublicKey).not.toHaveBeenCalled();
    });

    it('returns 404 when the key resolves to no student-visible homes', async () => {
      mocks.getResearcherProfileByPublicKey.mockResolvedValue(null);
      const req = { params: { publicKey: 'a1b2c3d4e5f6a1b2c3d4e5f6-pi' } } as any;
      const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;

      await getResearcherProfile(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Researcher not found' });
    });

    it('serves the aggregated researcher profile', async () => {
      const profile = { publicKey: 'a1b2c3d4e5f6a1b2c3d4e5f6-pi', displayName: 'Dr X', homes: [] };
      mocks.getResearcherProfileByPublicKey.mockResolvedValue(profile);
      const req = { params: { publicKey: 'a1b2c3d4e5f6a1b2c3d4e5f6-pi' } } as any;
      const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;

      await getResearcherProfile(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(profile);
    });

    it('does not leak internal service errors', async () => {
      mocks.getResearcherProfileByPublicKey.mockRejectedValue(
        new Error('mongodb://user:pass@example.invalid researcher lookup failed'),
      );
      const req = { params: { publicKey: 'a1b2c3d4e5f6a1b2c3d4e5f6-pi' } } as any;
      const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;

      await getResearcherProfile(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('mongodb://user:pass');
    });
  });
});
