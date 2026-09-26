import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  recordSiteSearch: vi.fn(async () => true),
}));

vi.mock('../../services/siteSearchAnalytics', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recordSiteSearch: mocks.recordSiteSearch,
}));

import router from '../programs';

const middlewareNames = () =>
  (router as any).stack
    .filter((layer: any) => !layer.route)
    .map((layer: any) => layer.handle?.name)
    .filter(Boolean);

const invokeMiddleware = async (name: string) => {
  const layer = (router as any).stack.find(
    (candidate: any) => !candidate.route && candidate.handle?.name === name,
  );
  expect(layer).toBeTruthy();

  const res = {
    setHeader: vi.fn(),
  } as any;
  const next = vi.fn();

  await layer.handle({} as any, res, next);
  return { res, next };
};

const routeByPath = (path: string) =>
  (router as any).stack.map((layer: any) => layer.route).find((route: any) => route?.path === path);

const routeHandlerNames = (path: string): string[] =>
  routeByPath(path)
    ?.stack.map((layer: any) => layer.handle?.name)
    .filter(Boolean) || [];

describe('program routes', () => {
  it('uses canonical program handlers instead of exporting the fellowship router', () => {
    expect(routeHandlerNames('/search')).toContain('searchProgramsController');
    expect(routeHandlerNames('/filters')).toContain('getProgramFilterOptions');
    expect(routeHandlerNames('/:id')).toContain('getProgramById');
  });

  it('marks authenticated program responses as private no-store payloads', async () => {
    expect(middlewareNames()).toContain('setPrivateProgramCacheHeaders');

    const { res, next } = await invokeMiddleware('setPrivateProgramCacheHeaders');

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, private, max-age=0');
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(next).toHaveBeenCalledOnce();
  });
});

const invokeSearchLogging = async (
  req: Record<string, any>,
  responseBody: Record<string, any>,
): Promise<void> => {
  const layer = routeByPath('/search')?.stack.find(
    (candidate: any) => candidate.handle?.name === 'logProgramSearchEvent',
  );
  expect(layer).toBeTruthy();

  const res = { statusCode: 200, json: vi.fn((body: any) => body) } as any;
  await layer.handle(req as any, res, vi.fn());
  res.json(responseBody);
  await Promise.resolve();
};

describe('program search telemetry', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reports the query, the selected filters, and the page that was served', async () => {
    await invokeSearchLogging(
      {
        user: { netId: 'teststud1', userType: 'undergraduate' },
        query: { query: 'econ', yearOfStudy: 'Senior' },
      },
      { total: 43, page: 1, pageSize: 24, totalPages: 2, results: [] },
    );

    expect(mocks.recordSiteSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        netid: 'teststud1',
        surface: 'program',
        searchQuery: 'econ',
        resultCount: 43,
        page: 1,
        filters: expect.objectContaining({ yearOfStudy: ['Senior'] }),
      }),
    );
  });

  it('reports the requested page when the response does not echo one', async () => {
    await invokeSearchLogging(
      {
        user: { netId: 'teststud1', userType: 'undergraduate' },
        query: { query: 'econ', page: '3' },
      },
      { total: 43, results: [] },
    );

    expect(mocks.recordSiteSearch).toHaveBeenCalledWith(expect.objectContaining({ page: 3 }));
  });

  it('reports nothing for a failed search response', async () => {
    const layer = routeByPath('/search')?.stack.find(
      (candidate: any) => candidate.handle?.name === 'logProgramSearchEvent',
    );
    const res = { statusCode: 500, json: vi.fn((body: any) => body) } as any;
    await layer.handle(
      { user: { netId: 'teststud1' }, query: { query: 'econ' } } as any,
      res,
      vi.fn(),
    );
    res.json({ error: 'nope' });

    expect(mocks.recordSiteSearch).not.toHaveBeenCalled();
  });
});
