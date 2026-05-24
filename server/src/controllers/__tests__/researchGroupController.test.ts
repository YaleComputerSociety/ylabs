import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  searchResearchGroupsViaMeili: vi.fn(),
}));

vi.mock('../../services/researchGroupService', () => ({
  searchResearchGroupsViaMeili: mocks.searchResearchGroupsViaMeili,
  listResearchSearchSuggestions: vi.fn(),
  getResearchGroupDetail: vi.fn(),
}));

import { searchResearchGroups } from '../researchGroupController';

const response = () => {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
};

beforeEach(() => {
  mocks.searchResearchGroupsViaMeili.mockReset();
  mocks.searchResearchGroupsViaMeili.mockResolvedValue({
    researchEntities: [],
    estimatedTotalHits: 0,
    page: 1,
    pageSize: 24,
  });
});

describe('searchResearchGroups controller', () => {
  it('passes low-quality browse sorting only for admin default-browse requests', async () => {
    const res = response();

    await searchResearchGroups(
      {
        body: {
          q: '',
          page: 1,
          pageSize: 24,
          filters: {},
          browseQuality: 'low-first',
        },
        user: { userType: 'admin' },
      } as any,
      res as any,
    );

    expect(mocks.searchResearchGroupsViaMeili).toHaveBeenCalledWith(
      '',
      {},
      1,
      24,
      {},
      { lowQualityFirst: true },
    );
  });

  it('ignores low-quality browse sorting for non-admins and submitted searches', async () => {
    const nonAdminResponse = response();
    await searchResearchGroups(
      {
        body: {
          q: '',
          page: 1,
          pageSize: 24,
          filters: {},
          browseQuality: 'low-first',
        },
        user: { userType: 'student' },
      } as any,
      nonAdminResponse as any,
    );

    const searchResponse = response();
    await searchResearchGroups(
      {
        body: {
          q: 'machine learning',
          page: 1,
          pageSize: 24,
          filters: {},
          browseQuality: 'low-first',
        },
        user: { userType: 'admin' },
      } as any,
      searchResponse as any,
    );

    expect(mocks.searchResearchGroupsViaMeili).toHaveBeenNthCalledWith(
      1,
      '',
      {},
      1,
      24,
      {},
      { lowQualityFirst: false },
    );
    expect(mocks.searchResearchGroupsViaMeili).toHaveBeenNthCalledWith(
      2,
      'machine learning',
      {},
      1,
      24,
      {},
      { lowQualityFirst: false },
    );
  });
});
