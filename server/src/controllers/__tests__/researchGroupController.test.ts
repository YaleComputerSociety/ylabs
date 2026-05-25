import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  searchResearchGroupsViaMeili: vi.fn(),
  getResearchGroupDetail: vi.fn(),
}));

vi.mock('../../services/researchGroupService', () => ({
  searchResearchGroupsViaMeili: mocks.searchResearchGroupsViaMeili,
  listResearchSearchSuggestions: vi.fn(),
  getResearchGroupDetail: mocks.getResearchGroupDetail,
}));

import { getResearchGroupBySlug, searchResearchGroups } from '../researchGroupController';

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
  mocks.getResearchGroupDetail.mockReset();
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
      {
        lowQualityFirst: true,
        includeQualitySummary: true,
        qualityFilters: [],
        studentVisibilityTiers: [],
        includeSuppressed: false,
      },
    );
  });

  it('passes quality filters only for admin default-browse requests', async () => {
    const res = response();

    await searchResearchGroups(
      {
        body: {
          q: '',
          page: 1,
          pageSize: 24,
          filters: {},
          browseQuality: 'low-first',
          qualityFilters: ['description-issue', 'missing-lead', 'unsupported-filter'],
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
      {
        lowQualityFirst: true,
        includeQualitySummary: true,
        qualityFilters: ['description-issue', 'missing-lead'],
        studentVisibilityTiers: [],
        includeSuppressed: false,
      },
    );
  });

  it('passes trust tier filters only for admins', async () => {
    const res = response();

    await searchResearchGroups(
      {
        body: {
          q: '',
          page: 1,
          pageSize: 24,
          filters: {},
          studentVisibilityTier: ['operator_review', 'suppressed', 'unknown'],
          includeSuppressed: true,
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
      {
        lowQualityFirst: false,
        includeQualitySummary: false,
        qualityFilters: [],
        studentVisibilityTiers: ['operator_review', 'suppressed'],
        includeSuppressed: true,
      },
    );
  });

  it('accepts query as an alias for q', async () => {
    const res = response();

    await searchResearchGroups(
      {
        body: { query: 'archival research', page: 1, pageSize: 20 },
        user: undefined,
      } as any,
      res as any,
    );

    expect(mocks.searchResearchGroupsViaMeili).toHaveBeenCalledWith(
      'archival research',
      {},
      1,
      20,
      {},
      {
        lowQualityFirst: false,
        includeQualitySummary: false,
        qualityFilters: [],
        studentVisibilityTiers: [],
        includeSuppressed: false,
      },
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
      {
        lowQualityFirst: false,
        includeQualitySummary: false,
        qualityFilters: [],
        studentVisibilityTiers: [],
        includeSuppressed: false,
      },
    );
    expect(mocks.searchResearchGroupsViaMeili).toHaveBeenNthCalledWith(
      2,
      'machine learning',
      {},
      1,
      24,
      {},
      {
        lowQualityFirst: false,
        includeQualitySummary: false,
        qualityFilters: [],
        studentVisibilityTiers: [],
        includeSuppressed: false,
      },
    );
  });
});

describe('getResearchGroupBySlug controller', () => {
  it('requests quality summary details only for admins', async () => {
    mocks.getResearchGroupDetail.mockResolvedValue({ researchEntity: { slug: 'fixture-lab' } });

    const adminResponse = response();
    await getResearchGroupBySlug(
      {
        params: { slug: 'fixture-lab' },
        user: { userType: 'admin' },
      } as any,
      adminResponse as any,
    );

    const studentResponse = response();
    await getResearchGroupBySlug(
      {
        params: { slug: 'fixture-lab' },
        user: { userType: 'student' },
      } as any,
      studentResponse as any,
    );

    expect(mocks.getResearchGroupDetail).toHaveBeenNthCalledWith(1, 'fixture-lab', {
      includeQualitySummary: true,
    });
    expect(mocks.getResearchGroupDetail).toHaveBeenNthCalledWith(2, 'fixture-lab', {
      includeQualitySummary: false,
    });
  });
});
