import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getResearchGroupDetail: vi.fn(),
  hasAdminAuthorityForUser: vi.fn(),
  searchResearchGroupsViaMeili: vi.fn(),
  resolveArchivedResearchEntityCanonicalSlug: vi.fn(),
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
}));

vi.mock('../../services/adminGrantService', () => ({
  hasAdminAuthorityForUser: mocks.hasAdminAuthorityForUser,
}));

import { getResearchGroupBySlug, searchResearchGroups } from '../researchGroupController';
import { RESEARCH_SEARCH_MAX_REACHABLE_RECORDS } from '../../services/researchSearchPagination';

describe('researchGroupController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasAdminAuthorityForUser.mockResolvedValue(false);
    mocks.resolveArchivedResearchEntityCanonicalSlug.mockResolvedValue(null);
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

  it('sends facets on page 1 and omits them past it', async () => {
    // Facets describe the result set rather than the page and dominate the
    // payload: a 100-record page measured 568,858 characters, with 805 distinct
    // department values in one facet. They change on scrape cadence, not per
    // keystroke, so one copy per result set is enough.
    const facetDistribution = { departments: { Chemistry: 12, Physics: 8 } };
    for (const [page, shouldInclude] of [
      [1, true],
      [2, false],
      [7, false],
    ] as Array<[number, boolean]>) {
      mocks.searchResearchGroupsViaMeili.mockResolvedValue({
        researchEntities: [],
        estimatedTotalHits: 0,
        page,
        pageSize: 24,
        facetDistribution,
      });
      const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;
      await searchResearchGroups({ body: { q: '', page, pageSize: 24, filters: {} } } as any, res);
      const payload = res.json.mock.calls[0][0];
      expect('facetDistribution' in payload).toBe(shouldInclude);
    }
  });

  it('omits facets rather than emptying them, so a client can tell "unchanged" from "none"', async () => {
    // An empty object is indistinguishable from "this result set has no facet
    // values", which would clear a populated filter panel.
    mocks.searchResearchGroupsViaMeili.mockResolvedValue({
      researchEntities: [],
      estimatedTotalHits: 0,
      page: 3,
      pageSize: 24,
      facetDistribution: { departments: { Chemistry: 4 } },
    });
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;
    await searchResearchGroups({ body: { q: '', page: 3, pageSize: 24, filters: {} } } as any, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.facetDistribution).toBeUndefined();
    expect('facetDistribution' in payload).toBe(false);
  });

  it('returns facets past page 1 when a caller explicitly asks', async () => {
    // A fresh deep link or a non-browser client has no retained copy.
    const facetDistribution = { departments: { Chemistry: 4 } };
    mocks.searchResearchGroupsViaMeili.mockResolvedValue({
      researchEntities: [],
      estimatedTotalHits: 0,
      page: 4,
      pageSize: 24,
      facetDistribution,
    });
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;
    await searchResearchGroups(
      { body: { q: '', page: 4, pageSize: 24, filters: {}, includeFacets: true } } as any,
      res,
    );
    expect(res.json.mock.calls[0][0].facetDistribution).toEqual(facetDistribution);
  });

  it('keeps the whole served corpus reachable at the client default page size', async () => {
    // A page-number cap of ~10 would wall browsing off after 240 records at the
    // client default of 24. The records cap must not do that.
    mocks.searchResearchGroupsViaMeili.mockResolvedValue({
      researchEntities: [],
      estimatedTotalHits: 0,
      page: 120,
      pageSize: 24,
    });
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;
    await searchResearchGroups(
      { body: { q: '', page: 120, pageSize: 24, filters: {} } } as any,
      res,
    );
    const [, , dispatchedPage, dispatchedPageSize] =
      mocks.searchResearchGroupsViaMeili.mock.calls[0];
    expect(dispatchedPage * dispatchedPageSize).toBeGreaterThan(2800);
  });

  it('caps reachable pagination depth in records, not page number', async () => {
    // MAX_PAGE 1000 with MAX_PAGE_SIZE 100 made 100,000 records addressable
    // against a served corpus of roughly 2,700. Depth is now bounded in records,
    // so the reachable page falls out of the requested page size instead of being
    // a second client-controlled dimension.
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

    expect(mocks.searchResearchGroupsViaMeili).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      researchEntities: [],
      page: 999_999_999,
      pageSize: 100,
      depthLimited: true,
    });
  });

  it('ends a paging walk past the depth bound instead of re-serving the last reachable page', async () => {
    // A clamped response is indistinguishable from a full page of new rows to a
    // client that advances its own page counter, so it appends the same entities
    // forever. The response must instead end the walk explicitly, and without
    // inventing a result-set size for a search that never ran: a fabricated total
    // would replace the real one the client is already displaying.
    const pageSize = 24;
    const lastReachablePage = Math.floor(RESEARCH_SEARCH_MAX_REACHABLE_RECORDS / pageSize);
    mocks.searchResearchGroupsViaMeili.mockResolvedValue({
      researchEntities: Array.from({ length: pageSize }, (_unused, index) => ({
        _id: `entity-${index}`,
      })),
      estimatedTotalHits: 6000,
      page: lastReachablePage,
      pageSize,
    });
    const reachableRes = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;
    await searchResearchGroups(
      { body: { q: '', page: lastReachablePage, pageSize, filters: {} } } as any,
      reachableRes,
    );
    expect(reachableRes.json.mock.calls[0][0].researchEntities).toHaveLength(pageSize);

    const beyondRes = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;
    await searchResearchGroups(
      { body: { q: '', page: lastReachablePage + 1, pageSize, filters: {} } } as any,
      beyondRes,
    );
    const payload = beyondRes.json.mock.calls[0][0];
    expect(payload.researchEntities).toEqual([]);
    expect(payload.page).toBe(lastReachablePage + 1);
    expect(payload.depthLimited).toBe(true);
    expect('estimatedTotalHits' in payload).toBe(false);
    expect(mocks.searchResearchGroupsViaMeili).toHaveBeenCalledTimes(1);
  });

  it('skips facet computation in the search layer when the page omits facets', async () => {
    mocks.searchResearchGroupsViaMeili.mockResolvedValue({
      researchEntities: [],
      estimatedTotalHits: 0,
      page: 2,
      pageSize: 24,
    });
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;
    await searchResearchGroups({ body: { q: '', page: 2, pageSize: 24, filters: {} } } as any, res);
    expect(mocks.searchResearchGroupsViaMeili.mock.calls[0][5]).toMatchObject({
      includeFacets: false,
    });

    const firstPageRes = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;
    await searchResearchGroups(
      { body: { q: '', page: 1, pageSize: 24, filters: {} } } as any,
      firstPageRes,
    );
    expect(mocks.searchResearchGroupsViaMeili.mock.calls[1][5]).toMatchObject({
      includeFacets: true,
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
        includeFacets: true,
      },
    );
  });

  it('serves an unauthenticated visitor only public tiers', async () => {
    mocks.searchResearchGroupsViaMeili.mockResolvedValue({
      researchEntities: [],
      estimatedTotalHits: 0,
      page: 1,
      pageSize: 24,
    });
    const req = {
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

    expect(mocks.hasAdminAuthorityForUser).toHaveBeenCalledWith(undefined);
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
        includeFacets: true,
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
        includeFacets: true,
      },
    );
  });
});
