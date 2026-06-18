import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  analyticsEventFind: vi.fn(),
  getActionNeededAnalytics: vi.fn(),
  getAnalytics: vi.fn(),
  getFunnelAnalytics: vi.fn(),
  getSearchQueryAnalytics: vi.fn(),
  getSearchQualityAnalytics: vi.fn(),
  getUserAnalytics: vi.fn(),
  getUserAnalyticsDrilldown: vi.fn(),
}));

vi.mock('../../models/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../models/analytics')>()),
  AnalyticsEvent: {
    find: mocks.analyticsEventFind,
  },
}));

vi.mock('../../services/analyticsService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/analyticsService')>()),
  getActionNeededAnalytics: mocks.getActionNeededAnalytics,
  getAnalytics: mocks.getAnalytics,
  getFunnelAnalytics: mocks.getFunnelAnalytics,
  getSearchQueryAnalytics: mocks.getSearchQueryAnalytics,
  getSearchQualityAnalytics: mocks.getSearchQualityAnalytics,
  getUserAnalytics: mocks.getUserAnalytics,
  getUserAnalyticsDrilldown: mocks.getUserAnalyticsDrilldown,
}));

import router from '../analytics';

const routeByPath = (path: string) =>
  (router as any).stack.map((layer: any) => layer.route).find((route: any) => route?.path === path);

const invokeRouteHandler = async (path: string, request: any = {}) => {
  const route = routeByPath(path);
  expect(route).toBeTruthy();
  const handler = route.stack[route.stack.length - 1].handle;
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status: vi.fn(function (this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function (this: any, body: unknown) {
      this.body = body;
      return this;
    }),
  } as any;

  await handler(
    {
      query: {},
      params: {},
      ...request,
    },
    response,
  );
  return response;
};

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

describe('analytics routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes the search-query analytics endpoint used by the analytics dashboard', () => {
    expect(routeByPath('/search-queries')).toBeTruthy();
  });

  it('keeps the analytics debug endpoint behind the admin router guards', () => {
    const route = routeByPath('/debug');
    expect(route).toBeTruthy();
    const handlerNames = route.stack.map((layer: any) => layer.handle?.name);
    expect(handlerNames).toEqual(expect.arrayContaining(['isAuthenticated', 'isAdmin']));
  });

  it('marks analytics responses as private no-store payloads', async () => {
    expect(middlewareNames()).toContain('setPrivateAnalyticsCacheHeaders');

    const { res, next } = await invokeMiddleware('setPrivateAnalyticsCacheHeaders');

    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store, private, max-age=0',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(next).toHaveBeenCalledOnce();
  });

  it('does not leak internal messages from analytics helper-backed route failures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.getSearchQualityAnalytics.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid analytics failed'),
    );

    const res = await invokeRouteHandler('/search-quality');

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch search quality analytics' });
  });

  it('does not leak internal messages from user analytics route failures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.getUserAnalytics.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid analytics failed'),
    );

    const res = await invokeRouteHandler('/users');

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch user analytics' });
  });

  it('does not leak raw validation text from user analytics route failures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.getUserAnalytics.mockRejectedValue(
      new Error('Invalid sort field: mongodb://user:pass@example.invalid leaked'),
    );

    const res = await invokeRouteHandler('/users');

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid analytics request' });
  });

  it('rejects oversized user analytics search before dispatching aggregation', async () => {
    const res = await invokeRouteHandler('/users', {
      query: { search: 'a'.repeat(121) },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid analytics request' });
    expect(mocks.getUserAnalytics).not.toHaveBeenCalled();
  });

  it('does not leak internal messages from user analytics drilldown failures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.getUserAnalyticsDrilldown.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid analytics failed'),
    );

    const res = await invokeRouteHandler('/users/:netid', {
      params: { netid: 'student123' },
    });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch user analytics' });
  });

  it('does not expose raw netids or metadata from analytics debug events', async () => {
    const chain = {
      select: vi.fn(),
      sort: vi.fn(),
      limit: vi.fn(),
      lean: vi.fn(),
    };
    chain.select.mockReturnValue(chain);
    chain.sort.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    chain.lean.mockResolvedValue([
      {
        _id: '64a000000000000000000001',
        eventType: 'login',
        netid: 'student123',
        userType: 'undergraduate',
        metadata: {
          loginMethod: 'CAS',
          privateNote: 'ada@example.edu',
        },
        timestamp: new Date('2026-06-11T00:00:00.000Z'),
      },
    ]);
    mocks.analyticsEventFind.mockReturnValue(chain);

    const res = await invokeRouteHandler('/debug');

    expect(mocks.analyticsEventFind).toHaveBeenCalledWith({
      eventType: { $in: ['login', 'visitor'] },
    });
    expect(chain.select).toHaveBeenCalledWith('eventType userType timestamp');
    expect(chain.limit).toHaveBeenCalledWith(50);
    expect(res.statusCode).toBe(200);
    expect(res.body.events).toEqual([
      {
        eventType: 'login',
        userType: 'undergraduate',
        timestamp: new Date('2026-06-11T00:00:00.000Z'),
      },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('student123');
    expect(JSON.stringify(res.body)).not.toContain('metadata');
    expect(JSON.stringify(res.body)).not.toContain('ada@example.edu');
  });
});
