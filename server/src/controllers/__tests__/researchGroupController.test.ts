import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getResearchGroupDetail: vi.fn(),
  hasAdminAuthorityForUser: vi.fn(),
  searchResearchGroupsViaMeili: vi.fn(),
}));

vi.mock('../../services/researchGroupService', () => ({
  getResearchGroupDetail: mocks.getResearchGroupDetail,
  normalizeResearchDetailSlug: (value: unknown) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return /^[a-z0-9][a-z0-9_-]{0,159}$/i.test(trimmed) ? trimmed : undefined;
  },
  searchResearchGroupsViaMeili: mocks.searchResearchGroupsViaMeili,
}));

vi.mock('../../services/adminGrantService', () => ({
  hasAdminAuthorityForUser: mocks.hasAdminAuthorityForUser,
}));

import { getResearchGroupBySlug, searchResearchGroups } from '../researchGroupController';

describe('researchGroupController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasAdminAuthorityForUser.mockResolvedValue(false);
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
});
