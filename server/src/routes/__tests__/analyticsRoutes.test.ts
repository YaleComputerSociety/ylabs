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
  emitResearchEvent: vi.fn(),
  researchEntityExists: vi.fn(),
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

vi.mock('../../services/researchAnalytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/researchAnalytics')>()),
  emitResearchEvent: mocks.emitResearchEvent,
  researchEntityExists: mocks.researchEntityExists,
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

  it('marks analytics responses as private no-store payloads', async () => {
    expect(middlewareNames()).toContain('setPrivateAnalyticsCacheHeaders');

    const { res, next } = await invokeMiddleware('setPrivateAnalyticsCacheHeaders');

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, private, max-age=0');
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(next).toHaveBeenCalledOnce();
  });

  it('accepts a batch of research events and reports the accepted count', async () => {
    mocks.emitResearchEvent.mockResolvedValue(true);
    mocks.researchEntityExists.mockResolvedValue(true);

    const res = await invokeRouteHandler('/research/batch', {
      body: {
        events: [
          {
            eventType: 'research_search',
            payload: {
              outcome: 'results',
              resultCountBucket: '6-20',
              searchKind: 'query',
              filterCountBucket: '0',
            },
          },
          {
            eventType: 'research_entity_impression',
            entityType: 'research_entity',
            entityId: '507f1f77bcf86cd799439011',
            payload: { surface: 'browse', positionBucket: '1-3' },
          },
        ],
      },
      user: { netId: 'test123', userType: 'undergraduate' },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({ accepted: 2 });
    expect(mocks.emitResearchEvent).toHaveBeenCalledTimes(2);
  });

  it('rejects a batch that is not a non-empty array', async () => {
    const res = await invokeRouteHandler('/research/batch', {
      body: { events: [] },
      user: { netId: 'test123', userType: 'undergraduate' },
    });

    expect(res.statusCode).toBe(400);
    expect(mocks.emitResearchEvent).not.toHaveBeenCalled();
  });

  it('rejects an oversized research event batch before emitting', async () => {
    const res = await invokeRouteHandler('/research/batch', {
      body: {
        events: Array.from({ length: 51 }, () => ({
          eventType: 'research_search',
          payload: {
            outcome: 'results',
            resultCountBucket: '6-20',
            searchKind: 'query',
            filterCountBucket: '0',
          },
        })),
      },
      user: { netId: 'test123', userType: 'undergraduate' },
    });

    expect(res.statusCode).toBe(413);
    expect(mocks.emitResearchEvent).not.toHaveBeenCalled();
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

  it('rejects oversized user analytics search before dispatching aggregation', async () => {
    const res = await invokeRouteHandler('/users', {
      query: { search: 'a'.repeat(121) },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid analytics request' });
    expect(mocks.getUserAnalytics).not.toHaveBeenCalled();
  });

  it('forwards a valid numeric offset for user activity pagination', async () => {
    mocks.getUserAnalytics.mockResolvedValue({ users: [], total: 0, limit: 25, offset: 50 });

    const res = await invokeRouteHandler('/users', {
      query: { offset: '50', limit: '25' },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.getUserAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 50, limit: 25 }),
    );
  });

  it('rejects a negative offset before dispatching aggregation', async () => {
    const res = await invokeRouteHandler('/users', {
      query: { offset: '-5' },
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
});
