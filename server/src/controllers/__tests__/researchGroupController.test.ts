import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getResearchGroupDetail: vi.fn(),
  searchResearchGroupsViaMeili: vi.fn(),
}));

vi.mock('../../services/researchGroupService', () => ({
  getResearchGroupDetail: mocks.getResearchGroupDetail,
  searchResearchGroupsViaMeili: mocks.searchResearchGroupsViaMeili,
}));

import { getResearchGroupBySlug, searchResearchGroups } from '../researchGroupController';

describe('researchGroupController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
