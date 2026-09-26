import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  recordSiteSearch: vi.fn(async () => true),
}));

vi.mock('../../services/siteSearchAnalytics', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recordSiteSearch: mocks.recordSiteSearch,
}));

import router from '../researchGroups';

const routesByPath = (path: string) =>
  (router as any).stack
    .map((layer: any) => layer.route)
    .filter((route: any) => route?.path === path);

const routeMethods = (path: string) =>
  routesByPath(path).flatMap((route: any) =>
    Object.keys(route.methods).filter((m) => route.methods[m]),
  );

const routeHandlerNames = (path: string, method: string): string[] =>
  routesByPath(path)
    .filter((route: any) => route.methods[method])
    .flatMap((route: any) => route.stack)
    .map((layer: any) => layer.handle?.name)
    .filter(Boolean);

describe('research group routes', () => {
  it('serves the read paths without requiring authentication', () => {
    expect(routeMethods('/search')).toContain('post');
    expect(routeHandlerNames('/search', 'post')).not.toContain('isAuthenticated');

    expect(routeMethods('/:slug')).toContain('get');
    expect(routeHandlerNames('/:slug', 'get')).not.toContain('isAuthenticated');
  });

  it('keeps correction reports and personal report reads behind authentication', () => {
    expect(routeHandlerNames('/:slug/report', 'post')).toContain('isAuthenticated');
    expect(routeHandlerNames('/:slug/reports/mine', 'get')).toContain('isAuthenticated');
  });
});

const invokeSearchLogging = async (
  req: Record<string, any>,
  responseBody: Record<string, any>,
): Promise<void> => {
  const layer = routesByPath('/search')
    .flatMap((route: any) => route.stack)
    .find((candidate: any) => candidate.handle?.name === 'logResearchSearchEvent');
  expect(layer).toBeTruthy();

  const res = { statusCode: 200, json: vi.fn((body: any) => body) } as any;
  await layer.handle(req as any, res, vi.fn());
  res.json(responseBody);
  await Promise.resolve();
};

describe('research search telemetry', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reports the query, the student-chosen filters, and the result-set size', async () => {
    await invokeSearchLogging(
      {
        user: { netId: 'teststud1', userType: 'undergraduate' },
        body: { q: 'quantum materials', filters: { departments: ['Physics'], school: [] } },
      },
      { researchEntities: [], estimatedTotalHits: 12, page: 1, pageSize: 24 },
    );

    expect(mocks.recordSiteSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        netid: 'teststud1',
        surface: 'research_entity',
        searchQuery: 'quantum materials',
        resultCount: 12,
        page: 1,
        filters: expect.objectContaining({ departments: ['Physics'], school: [] }),
      }),
    );
  });

  it('never counts the operator visibility controls as a student filter', async () => {
    await invokeSearchLogging(
      {
        user: { netId: 'testadmin', userType: 'admin' },
        body: {
          q: '',
          filters: { studentVisibilityTier: ['suppressed'], qualityFilters: ['missing-summary'] },
        },
      },
      { researchEntities: [], estimatedTotalHits: 2572, page: 1, pageSize: 24 },
    );

    expect(mocks.recordSiteSearch).toHaveBeenCalledOnce();
    const recorded = mocks.recordSiteSearch.mock.lastCall as unknown as [{ filters: unknown }];
    expect(recorded[0].filters).not.toHaveProperty('studentVisibilityTier');
    expect(recorded[0].filters).not.toHaveProperty('qualityFilters');
  });

  it('marks a client-issued suggestion probe so it is not reported as a student search', async () => {
    await invokeSearchLogging(
      {
        user: { netId: 'teststud1', userType: 'undergraduate' },
        body: { q: 'quantum computing', page: 1, pageSize: 1, suggestionProbe: true },
      },
      { researchEntities: [], estimatedTotalHits: 5, page: 1, pageSize: 1 },
    );

    expect(mocks.recordSiteSearch).toHaveBeenCalledWith(
      expect.objectContaining({ searchQuery: 'quantum computing', suggestionProbe: true }),
    );
  });

  it('reports a student search as not a probe, timed from when the request arrived', async () => {
    const beforeRequest = new Date();
    await invokeSearchLogging(
      {
        user: { netId: 'teststud1', userType: 'undergraduate' },
        body: { q: 'quantum computing photonics', page: 1 },
      },
      { researchEntities: [], estimatedTotalHits: 0, page: 1, pageSize: 24 },
    );

    expect(mocks.recordSiteSearch).toHaveBeenCalledWith(
      expect.objectContaining({ suggestionProbe: false }),
    );

    const [recorded] = mocks.recordSiteSearch.mock.lastCall as unknown as [
      { requestArrivedAt?: Date },
    ];
    expect(recorded.requestArrivedAt).toBeInstanceOf(Date);
    expect(recorded.requestArrivedAt!.getTime()).toBeGreaterThanOrEqual(beforeRequest.getTime());
    expect(recorded.requestArrivedAt!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('reports nothing for a depth-limited page that ran no search', async () => {
    await invokeSearchLogging(
      { user: { netId: 'teststud1', userType: 'undergraduate' }, body: { q: 'econ', page: 200 } },
      { researchEntities: [], page: 200, pageSize: 24, depthLimited: true },
    );

    expect(mocks.recordSiteSearch).not.toHaveBeenCalled();
  });
});
