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
  existingResearchEntityIds: vi.fn(),
  researchEntityExists: vi.fn(),
  getLaneBenchmarkDashboard: vi.fn(),
  hasActiveAdminGrant: vi.fn(),
}));

vi.mock('../../services/adminGrantService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/adminGrantService')>()),
  hasActiveAdminGrant: mocks.hasActiveAdminGrant,
}));

vi.mock('../../services/laneBenchmarkDashboardService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/laneBenchmarkDashboardService')>()),
  getLaneBenchmarkDashboard: mocks.getLaneBenchmarkDashboard,
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
  existingResearchEntityIds: mocks.existingResearchEntityIds,
  researchEntityExists: mocks.researchEntityExists,
}));

import router from '../analytics';
import { errorHandler } from '../../middleware/errorHandler';

const routeByPath = (path: string) =>
  (router as any).stack.map((layer: any) => layer.route).find((route: any) => route?.path === path);

const invokeRouteHandler = async (path: string, request: any = {}) => {
  const route = routeByPath(path);
  expect(route).toBeTruthy();
  const handler = route.stack[route.stack.length - 1].handle;
  const requestWithDefaults = { query: {}, params: {}, ...request };
  let settle: (forwarded: unknown) => void = () => undefined;
  const settled = new Promise<unknown>((resolve) => {
    settle = resolve;
  });
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status: vi.fn(function (this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function (this: any, body: unknown) {
      this.body = body;
      settle(undefined);
      return this;
    }),
  } as any;

  void handler(requestWithDefaults, response, settle);
  const forwarded = await settled;
  if (forwarded !== undefined) {
    errorHandler(forwarded as Error, requestWithDefaults, response, vi.fn());
  }
  return response;
};

const dispatchRoute = (path: string, request: any = {}) => {
  const route = routeByPath(path);
  expect(route).toBeTruthy();
  const requestWithDefaults = { query: {}, params: {}, ...request };
  return new Promise<any>((resolve) => {
    const response = {
      statusCode: 200,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this.body = body;
        resolve(this);
        return this;
      },
    } as any;
    const dispatch = (index: number) => {
      void route.stack[index].handle(requestWithDefaults, response, (error?: unknown) => {
        if (error !== undefined) {
          errorHandler(error as Error, requestWithDefaults, response, vi.fn());
          return;
        }
        dispatch(index + 1);
      });
    };
    dispatch(0);
  });
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

  it('refuses the lane benchmark panel to a signed-out request (#3591)', async () => {
    const res = await dispatchRoute('/lane-benchmarks');

    expect(res.statusCode).toBe(401);
    expect(mocks.getLaneBenchmarkDashboard).not.toHaveBeenCalled();
  });

  it('refuses the lane benchmark panel to a signed-in user without an admin grant', async () => {
    mocks.hasActiveAdminGrant.mockResolvedValue(false);

    const res = await dispatchRoute('/lane-benchmarks', { user: { netId: 'test123' } });

    expect(res.statusCode).toBe(403);
    expect(mocks.getLaneBenchmarkDashboard).not.toHaveBeenCalled();
  });

  it('serves the lane benchmark panel to an admin', async () => {
    mocks.hasActiveAdminGrant.mockResolvedValue(true);
    mocks.getLaneBenchmarkDashboard.mockResolvedValue({ benchmarks: [] });

    const res = await dispatchRoute('/lane-benchmarks', { user: { netId: 'test123' } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ benchmarks: [] });
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
    mocks.emitResearchEvent.mockResolvedValue('recorded');
    mocks.existingResearchEntityIds.mockResolvedValue(['lab-a', 'lab-b']);

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
            eventType: 'research_results_view',
            entityType: 'research_entity',
            entityIds: ['lab-a', 'lab-b'],
            payload: { surface: 'browse', pageBucket: '1' },
          },
        ],
      },
      user: { netId: 'test123', userType: 'undergraduate' },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({ accepted: 2, sent: 2 });
    expect(mocks.emitResearchEvent).toHaveBeenCalledTimes(2);
  });

  it('stores a result page as one event carrying only the entities that exist', async () => {
    mocks.emitResearchEvent.mockResolvedValue('recorded');
    mocks.existingResearchEntityIds.mockResolvedValue(['lab-a', 'lab-c']);

    const res = await invokeRouteHandler('/research/batch', {
      body: {
        events: [
          {
            eventType: 'research_results_view',
            entityType: 'research_entity',
            entityIds: ['lab-a', 'lab-gone', 'lab-c'],
            payload: { surface: 'search', pageBucket: '2' },
            dedupeKey: 'search:abc:results:2',
          },
        ],
      },
      user: { netId: 'test123', userType: 'undergraduate' },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(res.body).toEqual({ accepted: 1, sent: 1 });
    expect(mocks.existingResearchEntityIds).toHaveBeenCalledOnce();
    expect(mocks.researchEntityExists).not.toHaveBeenCalled();
    expect(mocks.emitResearchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'research_results_view',
        entityIds: ['lab-a', 'lab-c'],
        dedupeKey: 'search:abc:results:2',
      }),
    );
  });

  it('rejects a result page with no known entity and the retired per-entity impression', async () => {
    mocks.existingResearchEntityIds.mockResolvedValue([]);

    const res = await invokeRouteHandler('/research/batch', {
      body: {
        events: [
          {
            eventType: 'research_results_view',
            entityType: 'research_entity',
            entityIds: ['lab-gone'],
            payload: { surface: 'browse', pageBucket: '1' },
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

    expect(res.body).toEqual({ accepted: 0, sent: 2 });
    expect(mocks.emitResearchEvent).not.toHaveBeenCalled();
  });

  it('reports sent alongside accepted so a caller can tell delivery from acceptance', async () => {
    mocks.emitResearchEvent.mockResolvedValue('recorded');
    mocks.existingResearchEntityIds.mockResolvedValue(['lab-a']);

    const res = await invokeRouteHandler('/research/batch', {
      body: {
        events: [
          {
            eventType: 'research_results_view',
            entityType: 'research_entity',
            entityIds: ['lab-a'],
            payload: { surface: 'browse', pageBucket: '1' },
          },
          { eventType: 'not_a_research_event' },
        ],
      },
      user: { netId: 'test123', userType: 'undergraduate' },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({ accepted: 1, sent: 2 });
  });

  it('does not count an event the store failed to write as accepted, and warns about it', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.emitResearchEvent.mockResolvedValueOnce('recorded').mockResolvedValueOnce('failed');

    const searchEvent = {
      eventType: 'research_search',
      payload: {
        outcome: 'results',
        resultCountBucket: '6-20',
        searchKind: 'query',
        filterCountBucket: '0',
      },
    };
    const res = await invokeRouteHandler('/research/batch', {
      body: { events: [searchEvent, searchEvent] },
      user: { netId: 'test123', userType: 'undergraduate' },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({ accepted: 1, sent: 2 });
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(JSON.stringify(warnSpy.mock.calls[0])).toContain('unstored');
    warnSpy.mockRestore();
  });

  it('does not count a Beta-suppressed event as accepted and does not warn about it', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.emitResearchEvent.mockResolvedValue('suppressed');

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
        ],
      },
      user: { netId: 'test123', userType: 'undergraduate' },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(res.body).toEqual({ accepted: 0, sent: 1 });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
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
    expect(res.body).toEqual({ error: 'Internal server error' });
  });

  it('does not count a degraded search as a search with results', async () => {
    mocks.getSearchQualityAnalytics.mockResolvedValue({
      totalSearches: 10,
      degradedSearches: 3,
      zeroResultSearches: 2,
      zeroResultRate: 0.2857,
      uniqueSearchers: 4,
      byQueryAndEntityType: [],
      topZeroResultQueries: [],
      topQueries: [],
      engagedSearches: 0,
      returnedButIgnoredSearches: 0,
    });

    const res = await invokeRouteHandler('/search-quality');

    expect(res.statusCode).toBe(200);
    expect(res.body.searchesWithResults).toBe(5);
  });

  it('does not leak internal messages from user analytics route failures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.getUserAnalytics.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid analytics failed'),
    );

    const res = await invokeRouteHandler('/users');

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
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

  it('names every funnel stage on the server, and never names one Visitors', async () => {
    mocks.getFunnelAnalytics.mockResolvedValue({
      logins: 486,
      searches: 100,
      fellowshipViews: 50,
      qualifiedActions: 7,
      researchSearches: 91,
      researchProfileOpens: 40,
      researchSaves: 12,
      researchComparisons: 3,
      researchPlanUpdates: 2,
      sourceInspections: 9,
      officialRouteAttempts: 5,
      applicationOpens: 4,
      qualifiedActionEvents: 7,
    });

    const res = await invokeRouteHandler('/funnel');
    const body = res.body as any;

    expect(res.statusCode).toBe(200);
    expect(body.stages.map((stage: any) => stage.label)).toEqual([
      'Searched research',
      'Opened a profile',
      'Saved a research home',
      'Compared saved homes',
      'Updated a plan',
      'Used a qualified route',
    ]);
    expect(body.stages.some((stage: any) => /visitor/i.test(stage.label))).toBe(false);
  });

  it('reports the qualified-route numbers as unmeasured when none was recorded', async () => {
    mocks.getFunnelAnalytics.mockResolvedValue({
      logins: 40,
      searches: 30,
      fellowshipViews: 5,
      qualifiedActions: 0,
      researchSearches: 20,
      researchProfileOpens: 10,
      researchSaves: 3,
      researchComparisons: 1,
      researchPlanUpdates: 1,
      sourceInspections: 4,
      officialRouteAttempts: 0,
      applicationOpens: 0,
      qualifiedActionEvents: 0,
    });

    const body = (await invokeRouteHandler('/funnel')).body as any;

    expect(body.stages.map((stage: any) => stage.key)).not.toContain('qualified_actions');
    expect(body.journeyMetrics).toEqual({
      sourceInspections: 4,
      officialRouteAttempts: null,
      applicationOpens: null,
    });
    expect(body.overallConversionRate).toBeNull();
  });

  it('serves no visitor-shaped alias for the login count', async () => {
    mocks.getFunnelAnalytics.mockResolvedValue({
      logins: 486,
      searches: 100,
      fellowshipViews: 50,
      qualifiedActions: 7,
      researchSearches: 91,
      researchProfileOpens: 40,
      researchSaves: 12,
      researchComparisons: 3,
      researchPlanUpdates: 2,
      sourceInspections: 9,
      officialRouteAttempts: 5,
      applicationOpens: 4,
      qualifiedActionEvents: 7,
    });

    const res = await invokeRouteHandler('/funnel');

    expect(res.body).not.toHaveProperty('visitorCount');
    expect(res.body).not.toHaveProperty('searcherCount');
    expect(res.body).not.toHaveProperty('viewerCount');
    expect(res.body).not.toHaveProperty('applicantCount');
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
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});
