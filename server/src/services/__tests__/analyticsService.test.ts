import { afterEach, describe, expect, it, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';

const mocks = vi.hoisted(() => ({
  analyticsAggregate: vi.fn(),
  analyticsCreate: vi.fn(),
  analyticsFind: vi.fn(),
  analyticsUpdateOne: vi.fn(),
  userFindOneAndUpdate: vi.fn(),
  userAggregate: vi.fn(),
  userFind: vi.fn(),
  accountAggregate: vi.fn(),
  accountFind: vi.fn(),
  researcherFind: vi.fn(),
  researchEntityAggregate: vi.fn(),
  researchEntityFind: vi.fn(),
  fellowshipFind: vi.fn(),
  getListingModel: vi.fn(),
}));

vi.mock('../../models/analytics', () => ({
  AnalyticsEventType: {
    LOGIN: 'login',
    LOGOUT: 'logout',
    VISITOR: 'visitor',
    LISTING_VIEW: 'listing_view',
    LISTING_FAVORITE: 'listing_favorite',
    LISTING_UNFAVORITE: 'listing_unfavorite',
    FELLOWSHIP_VIEW: 'fellowship_view',
    FELLOWSHIP_FAVORITE: 'fellowship_favorite',
    FELLOWSHIP_UNFAVORITE: 'fellowship_unfavorite',
    SEARCH: 'search',
    OUTREACH_CLICK: 'outreach_click',
    OUTREACH_OUTCOME: 'outreach_outcome',
    LISTING_CREATE: 'listing_create',
    LISTING_UPDATE: 'listing_update',
    LISTING_ARCHIVE: 'listing_archive',
    LISTING_UNARCHIVE: 'listing_unarchive',
    PROFILE_UPDATE: 'profile_update',
    RESEARCH_VIEW: 'research_view',
    PATHWAY_SAVE: 'pathway_save',
    WAYS_IN_CLICK: 'ways_in_click',
    CONTACT_ROUTE_CLICK: 'contact_route_click',
    SOURCE_LINK_CLICK: 'source_link_click',
    RESEARCH_SEARCH: 'research_search',
    RESEARCH_ENTITY_IMPRESSION: 'research_entity_impression',
    RESEARCH_PROFILE_OPEN: 'research_profile_open',
    RESEARCH_SOURCE_REVIEW: 'research_source_review',
    RESEARCH_FILTER_CHANGE: 'research_filter_change',
    RESEARCH_SAVE: 'research_save',
    RESEARCH_COMPARE: 'research_compare',
    RESEARCH_PLAN_UPDATE: 'research_plan_update',
    RESEARCH_QUALIFIED_ACTION: 'research_qualified_action',
  },
  RESEARCH_ENTITY_TYPES: ['profile', 'listing', 'fellowship', 'research_entity'],
  AnalyticsEvent: {
    aggregate: mocks.analyticsAggregate,
    create: mocks.analyticsCreate,
    find: mocks.analyticsFind,
    updateOne: mocks.analyticsUpdateOne,
  },
}));

vi.mock('../../models/index', () => ({
  User: {
    findOne: vi.fn(),
    findOneAndUpdate: mocks.userFindOneAndUpdate,
    aggregate: mocks.userAggregate,
    find: mocks.userFind,
  },
  ResearchEntity: {
    aggregate: mocks.researchEntityAggregate,
    find: mocks.researchEntityFind,
  },
  Fellowship: {
    find: mocks.fellowshipFind,
  },
}));

vi.mock('../../models/account', () => ({
  Account: {
    aggregate: mocks.accountAggregate,
    find: mocks.accountFind,
  },
}));

vi.mock('../../models/researcher', () => ({
  Researcher: {
    find: mocks.researcherFind,
  },
}));

vi.mock('../../db/connections', () => ({
  getListingModel: mocks.getListingModel,
}));

import {
  combineAnalyticsUserTypeCounts,
  getUserAnalytics,
  getUserAnalyticsDrilldown,
  getSearchQualityAnalytics,
  getFunnelAnalytics,
  getAnalytics,
  invalidateAnalyticsCaches,
  logEvent,
  normalizeAnalyticsUserTypeBucket,
  shouldSuppressBetaAnalyticsEvent,
} from '../analyticsService';
import { AnalyticsEventType } from '../../models/analytics';

afterEach(() => {
  invalidateAnalyticsCaches();
});

describe('analytics user type normalization', () => {
  it('combines professor and faculty into the canonical professor bucket', () => {
    expect(normalizeAnalyticsUserTypeBucket('professor')).toBe('professor');
    expect(normalizeAnalyticsUserTypeBucket('faculty')).toBe('professor');
    expect(
      combineAnalyticsUserTypeCounts([
        { userType: 'professor', count: 10755 },
        { userType: 'faculty', count: 6701 },
        { userType: 'undergraduate', count: 1340 },
      ]),
    ).toEqual([
      { userType: 'professor', count: 17456 },
      { userType: 'undergraduate', count: 1340 },
    ]);
  });
});

describe('search engagement attribution', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reports action-aware success from a single windowed pass without a self-join', async () => {
    mocks.analyticsAggregate.mockResolvedValueOnce([
      {
        overall: [
          {
            totalSearches: 10,
            zeroResultSearches: 2,
            uniqueSearchers: 4,
            engagedSearches: 3,
            returnedButIgnoredSearches: 5,
          },
        ],
        byQueryAndEntityType: [],
      },
    ]);

    await expect(getSearchQualityAnalytics()).resolves.toMatchObject({
      totalSearches: 10,
      engagedSearches: 3,
      returnedButIgnoredSearches: 5,
      engagementRate: 0.3,
      attributionWindowMinutes: 30,
    });

    const pipeline = mocks.analyticsAggregate.mock.calls[0][0];
    expect(pipeline.some((stage: any) => stage.$lookup)).toBe(false);
    const windowStage = pipeline.find((stage: any) => stage.$setWindowFields)?.$setWindowFields;
    expect(windowStage.partitionBy).toBe('$netid');
    expect(windowStage.sortBy).toEqual({ timestamp: 1 });
    expect(windowStage.output.forwardEvents.window).toEqual({ range: [0, 30], unit: 'minute' });
    expect(JSON.stringify(pipeline)).toContain('nextSearchAt');
    expect(JSON.stringify(pipeline)).toContain('$resultCount');
    expect(JSON.stringify(pipeline)).toContain('amount":30');
  });

  it('shares one computed search-quality result across repeated reads', async () => {
    mocks.analyticsAggregate.mockResolvedValue([
      {
        overall: [
          {
            totalSearches: 4,
            zeroResultSearches: 1,
            uniqueSearchers: 2,
            engagedSearches: 2,
            returnedButIgnoredSearches: 1,
          },
        ],
        byQueryAndEntityType: [],
      },
    ]);

    const start = new Date('2026-03-01T00:00:00.000Z');
    const end = new Date('2026-03-08T00:00:00.000Z');
    const first = await getSearchQualityAnalytics({ start, end });
    const second = await getSearchQualityAnalytics({ start, end });

    expect(second).toBe(first);
    expect(mocks.analyticsAggregate).toHaveBeenCalledTimes(1);
  });
});

describe('per-user activity view aggregation', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('counts listing views and research views as separate per-user metrics', async () => {
    mocks.analyticsAggregate.mockResolvedValueOnce([{ users: [], total: 0 }]);

    await getUserAnalytics({});

    const pipeline = mocks.analyticsAggregate.mock.calls[0][0];
    const groupStage = pipeline.find((stage: any) => stage.$group)?.$group;
    const viewsAccumulator = groupStage.views?.$sum?.$cond?.[0]?.$eq;
    const researchViewsAccumulator = groupStage.researchViews?.$sum?.$cond?.[0]?.$eq;

    expect(viewsAccumulator).toEqual(['$eventType', AnalyticsEventType.LISTING_VIEW]);
    expect(researchViewsAccumulator).toEqual(['$eventType', AnalyticsEventType.RESEARCH_VIEW]);
  });
});

describe('claim-specific research funnel', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps source inspection, route attempts, application opens, and outcomes separate', async () => {
    mocks.analyticsAggregate.mockResolvedValueOnce([
      {
        uniqueActorsByEventType: [
          { eventType: 'research_source_review', count: 7 },
          { eventType: 'research_qualified_action', count: 6 },
          { eventType: 'outreach_outcome', count: 1 },
        ],
        qualifiedActorsByCategory: [
          {
            actionCategory: 'official_application',
            uniqueNetids: ['student-1', 'student-2', 'student-3'],
          },
          { actionCategory: 'reviewed_route', uniqueNetids: ['student-1', 'student-4'] },
          { actionCategory: 'qualified_participation', uniqueNetids: ['student-5', 'student-6'] },
        ],
      },
    ]);

    const funnel = await getFunnelAnalytics();

    expect(funnel).toMatchObject({
      sourceInspections: 7,
      qualifiedActions: 6,
      officialRouteAttempts: 4,
      applicationOpens: 3,
      confirmedOutcomes: 1,
    });
    expect(funnel.officialRouteAttempts).not.toBe(funnel.qualifiedActions);
    expect(funnel.applicationOpens).toBeLessThan(funnel.officialRouteAttempts);
    expect(funnel.officialRouteAttempts).toBeLessThan(funnel.qualifiedActions);
  });
});

describe('getAnalytics research coverage and range scoping', () => {
  const eventFacetStub = {
    lifetimeVisitors: [],
    lifetimeVisitorsByType: [],
    last7DaysVisitors: [],
    last7DaysVisitorsByType: [],
    todayVisitors: [],
    todayVisitorsByType: [],
    totalLogins: [],
    loginsLast7Days: [],
    loginsToday: [],
    searchStats: [],
    topSearchQueries: [],
    viewStats: [],
    favoriteStats: [],
    trendingListings: [],
    userActivityStats: [],
    mostActiveUsers: [],
    byEventType: [],
    byEntityType: [],
    byUserType: [],
    topEntities: [],
    summary: [],
    byOutcome: [],
    topListings: [],
    recentEvents: [],
  };

  const listingFacetStub = {
    overview: [],
    newListingsLast7Days: [],
    newListingsToday: [],
    listingsByDepartment: [],
    listingsPerProfessor: [],
    listingsWithZeroViews: [],
    topViewedListings: [],
    topFavoritedListings: [],
    viewsAndFavorites: [],
    viewsByDepartment: [],
  };

  const chainableFind = () => ({
    select: () => ({ lean: async () => [] }),
    lean: async () => [],
  });

  const primeAnalyticsMocks = () => {
    mocks.analyticsAggregate.mockResolvedValue([eventFacetStub]);
    mocks.accountAggregate.mockResolvedValue([
      {
        overview: [{ total: 50, confirmed: 40 }],
        byType: [],
        newUsersLast7Days: [],
        newUsersToday: [],
        newUsersTodayByType: [],
      },
    ]);
    mocks.accountFind.mockImplementation(chainableFind);
    mocks.researcherFind.mockImplementation(chainableFind);
    mocks.getListingModel.mockReturnValue({
      aggregate: vi.fn().mockResolvedValue([listingFacetStub]),
      find: chainableFind,
      collection: { name: 'listings' },
    });
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('counts visitors-by-type at the same distinct-netid grain as the visitor headline', async () => {
    primeAnalyticsMocks();
    mocks.researchEntityAggregate.mockResolvedValue([
      {
        overview: [{ total: 0, active: 0 }],
        byType: [],
        byVisibilityTier: [],
        freshness: [],
        scholarly: [],
      },
    ]);

    await getAnalytics();

    const visitorFacetCall = mocks.analyticsAggregate.mock.calls.find((call) =>
      call[0].some((stage: Record<string, any>) => stage.$facet && stage.$facet.lifetimeVisitors),
    );
    expect(visitorFacetCall).toBeDefined();
    const facet = visitorFacetCall![0].find(
      (stage: Record<string, any>) => stage.$facet && stage.$facet.lifetimeVisitors,
    ).$facet;

    const groupStages = (branch: any[]) =>
      branch.filter((stage: Record<string, any>) => stage.$group);
    const headlineGrain = (branch: any[]) => groupStages(branch)[0].$group._id;
    const byTypeGrain = (branch: any[]) => {
      const grouping = groupStages(branch);
      return {
        perNetid: grouping[0].$group._id,
        perNetidUserType: grouping[0].$group.userType,
        rollup: grouping[1].$group._id,
      };
    };

    for (const window of ['lifetime', 'last7Days', 'today'] as const) {
      const headlineBranch = facet[`${window}Visitors`];
      const byTypeBranch = facet[`${window}VisitorsByType`];
      expect(headlineGrain(headlineBranch)).toBe('$netid');
      const grain = byTypeGrain(byTypeBranch);
      expect(grain.perNetid).toBe('$netid');
      expect(grain.perNetidUserType).toEqual({ $first: '$userType' });
      expect(grain.rollup).toBe('$userType');
    }
  });

  it('reconciles by-type visitor counts to the headline total against a drifting-netid dataset', async () => {
    primeAnalyticsMocks();
    mocks.researchEntityAggregate.mockResolvedValue([
      {
        overview: [{ total: 0, active: 0 }],
        byType: [],
        byVisibilityTier: [],
        freshness: [],
        scholarly: [],
      },
    ]);

    await getAnalytics();

    const visitorFacetPipeline = mocks.analyticsAggregate.mock.calls.find((call) =>
      call[0].some((stage: Record<string, any>) => stage.$facet && stage.$facet.lifetimeVisitors),
    )![0];

    const server = await MongoMemoryServer.create();
    const client = new MongoClient(server.getUri());
    try {
      await client.connect();
      const collection = client.db('analytics_grain').collection('analyticsevents');

      const now = new Date();
      await collection.insertMany([
        {
          eventType: AnalyticsEventType.LOGIN,
          netid: 'clean_undergrad',
          userType: 'undergraduate',
          timestamp: now,
        },
        {
          eventType: AnalyticsEventType.LOGIN,
          netid: 'clean_grad',
          userType: 'graduate',
          timestamp: now,
        },
        {
          eventType: AnalyticsEventType.LOGIN,
          netid: 'drifting_visitor',
          userType: 'undergraduate',
          timestamp: now,
        },
        {
          eventType: AnalyticsEventType.VISITOR,
          netid: 'drifting_visitor',
          userType: 'graduate',
          timestamp: now,
        },
      ]);

      const [result] = await collection.aggregate(visitorFacetPipeline).toArray();

      const distinctNetids = new Set(['clean_undergrad', 'clean_grad', 'drifting_visitor']).size;

      for (const window of ['lifetime', 'last7Days', 'today'] as const) {
        const headline = result[`${window}Visitors`][0]?.total ?? 0;
        const byType = result[`${window}VisitorsByType`] as Array<{
          userType: string;
          count: number;
        }>;
        const byTypeSum = byType.reduce((sum, bucket) => sum + bucket.count, 0);

        expect(headline).toBe(distinctNetids);
        expect(byTypeSum).toBe(headline);
      }

      const buggyByType = await collection
        .aggregate([
          {
            $match: { eventType: { $in: [AnalyticsEventType.LOGIN, AnalyticsEventType.VISITOR] } },
          },
          { $group: { _id: { netid: '$netid', userType: '$userType' } } },
          { $group: { _id: '$_id.userType', count: { $sum: 1 } } },
        ])
        .toArray();
      const buggySum = buggyByType.reduce((sum, bucket) => sum + bucket.count, 0);
      expect(buggySum).toBe(4);
      expect(buggySum).toBeGreaterThan(distinctNetids);
    } finally {
      await client.close();
      await server.stop();
    }
  });

  it('reports total as archived-inclusive and active as the non-archived subset', async () => {
    primeAnalyticsMocks();
    mocks.researchEntityAggregate.mockResolvedValue([
      {
        overview: [{ total: 12, active: 9 }],
        byType: [],
        byVisibilityTier: [],
        freshness: [],
        scholarly: [],
      },
    ]);

    const analytics = await getAnalytics();

    expect(analytics.researchEntities.overview).toEqual({ active: 9, total: 12 });
    expect(analytics.researchEntities.overview.total).toBeGreaterThan(
      analytics.researchEntities.overview.active,
    );
  });

  it('threads the selected range into event-based aggregations', async () => {
    primeAnalyticsMocks();
    mocks.researchEntityAggregate.mockResolvedValue([
      {
        overview: [{ total: 0, active: 0 }],
        byType: [],
        byVisibilityTier: [],
        freshness: [],
        scholarly: [],
      },
    ]);

    const start = new Date('2026-01-01T00:00:00.000Z');
    const end = new Date('2026-02-01T00:00:00.000Z');
    await getAnalytics({ start, end });

    const everyEventPipelineScoped = mocks.analyticsAggregate.mock.calls.every((call) => {
      const topMatch = call[0][0].$match;
      return topMatch && topMatch.timestamp && topMatch.timestamp.$gte instanceof Date;
    });
    expect(mocks.analyticsAggregate).toHaveBeenCalled();
    expect(everyEventPipelineScoped).toBe(true);
  });

  it('leaves event aggregations unfiltered when no range is selected', async () => {
    primeAnalyticsMocks();
    mocks.researchEntityAggregate.mockResolvedValue([
      {
        overview: [{ total: 0, active: 0 }],
        byType: [],
        byVisibilityTier: [],
        freshness: [],
        scholarly: [],
      },
    ]);

    await getAnalytics();

    const noneScoped = mocks.analyticsAggregate.mock.calls.every((call) => {
      const topMatch = call[0][0].$match || {};
      return topMatch.timestamp === undefined;
    });
    expect(noneScoped).toBe(true);
  });

  it('serves a repeated dashboard load from the short-TTL cache and recomputes after invalidation', async () => {
    primeAnalyticsMocks();
    mocks.researchEntityAggregate.mockResolvedValue([
      {
        overview: [{ total: 0, active: 0 }],
        byType: [],
        byVisibilityTier: [],
        freshness: [],
        scholarly: [],
      },
    ]);

    const start = new Date('2026-04-01T00:00:00.000Z');
    const end = new Date('2026-04-08T00:00:00.000Z');

    const first = await getAnalytics({ start, end });
    const passesAfterFirst = mocks.analyticsAggregate.mock.calls.length;
    expect(passesAfterFirst).toBeGreaterThan(0);

    const second = await getAnalytics({ start, end });
    expect(second).toBe(first);
    expect(mocks.analyticsAggregate.mock.calls.length).toBe(passesAfterFirst);

    invalidateAnalyticsCaches();
    await getAnalytics({ start, end });
    expect(mocks.analyticsAggregate.mock.calls.length).toBeGreaterThan(passesAfterFirst);
  });

  it('keeps distinct ranges in separate cache entries', async () => {
    primeAnalyticsMocks();
    mocks.researchEntityAggregate.mockResolvedValue([
      {
        overview: [{ total: 0, active: 0 }],
        byType: [],
        byVisibilityTier: [],
        freshness: [],
        scholarly: [],
      },
    ]);

    await getAnalytics({
      start: new Date('2026-05-01T00:00:00.000Z'),
      end: new Date('2026-05-08T00:00:00.000Z'),
    });
    const passesAfterFirstRange = mocks.analyticsAggregate.mock.calls.length;

    await getAnalytics({
      start: new Date('2026-06-01T00:00:00.000Z'),
      end: new Date('2026-06-08T00:00:00.000Z'),
    });
    expect(mocks.analyticsAggregate.mock.calls.length).toBeGreaterThan(passesAfterFirstRange);
  });

  it('joins display names onto most-active users and preserves them through the payload', async () => {
    primeAnalyticsMocks();
    mocks.analyticsAggregate.mockResolvedValue([
      {
        ...eventFacetStub,
        mostActiveUsers: [
          {
            userId: 'analyst01',
            userType: 'undergraduate',
            eventCount: 7,
            displayName: 'Ada Analyst',
          },
        ],
      },
    ]);
    mocks.researchEntityAggregate.mockResolvedValue([
      {
        overview: [{ total: 0, active: 0 }],
        byType: [],
        byVisibilityTier: [],
        freshness: [],
        scholarly: [],
      },
    ]);

    const analytics = await getAnalytics({
      start: new Date('2026-07-01T00:00:00.000Z'),
      end: new Date('2026-07-08T00:00:00.000Z'),
    });

    expect(analytics.engagement.mostActiveUsers).toEqual([
      {
        userId: 'analyst01',
        userType: 'undergraduate',
        eventCount: 7,
        displayName: 'Ada Analyst',
      },
    ]);

    const facetCall = mocks.analyticsAggregate.mock.calls.find((call) =>
      call[0].some((stage: Record<string, any>) => stage.$facet && stage.$facet.mostActiveUsers),
    );
    expect(facetCall).toBeDefined();
    const mostActiveStages = facetCall![0].find(
      (stage: Record<string, any>) => stage.$facet && stage.$facet.mostActiveUsers,
    ).$facet.mostActiveUsers;
    const lookupStage = mostActiveStages.find((stage: Record<string, any>) => stage.$lookup);
    expect(lookupStage.$lookup.from).toBe('accounts');
    expect(lookupStage.$lookup.foreignField).toBe('netid');
    const projectStage = mostActiveStages.find((stage: Record<string, any>) => stage.$project);
    expect(projectStage.$project.displayName).toBe('$researcher.displayName');
  });

  it('resolves top research entity ids to human-readable names and hrefs', async () => {
    const researchEntityId = '507f1f77bcf86cd799439011';
    const fellowshipId = '507f1f77bcf86cd799439012';
    const listingId = '507f1f77bcf86cd799439013';

    mocks.analyticsAggregate.mockResolvedValue([
      {
        ...eventFacetStub,
        topEntities: [
          {
            entityType: 'research_entity',
            entityId: researchEntityId,
            views: 12,
            uniqueViewers: 4,
          },
          { entityType: 'fellowship', entityId: fellowshipId, views: 8, uniqueViewers: 2 },
          { entityType: 'listing', entityId: listingId, views: 5, uniqueViewers: 1 },
          { entityType: 'profile', entityId: 'prof-netid', views: 3, uniqueViewers: 1 },
        ],
      },
    ]);
    mocks.accountAggregate.mockResolvedValue([
      {
        overview: [{ total: 1, confirmed: 1 }],
        byType: [],
        newUsersLast7Days: [],
        newUsersToday: [],
        newUsersTodayByType: [],
      },
    ]);
    mocks.researchEntityAggregate.mockResolvedValue([
      {
        overview: [{ total: 0, active: 0 }],
        byType: [],
        byVisibilityTier: [],
        freshness: [],
        scholarly: [],
      },
    ]);

    const chainableFindReturning =
      (docs: unknown[]) =>
      () => ({
        select: () => ({ lean: async () => docs }),
        lean: async () => docs,
      });
    mocks.getListingModel.mockReturnValue({
      aggregate: vi.fn().mockResolvedValue([listingFacetStub]),
      find: chainableFindReturning([{ _id: listingId, title: 'Legacy Listing Title' }]),
      collection: { name: 'listings' },
    });
    mocks.researchEntityFind.mockImplementation(
      chainableFindReturning([
        {
          _id: researchEntityId,
          name: 'Quantum Lab',
          displayName: 'Quantum Computing Lab',
          slug: 'quantum-lab',
        },
      ]),
    );
    mocks.fellowshipFind.mockImplementation(
      chainableFindReturning([{ _id: fellowshipId, title: 'Summer Research Fellowship' }]),
    );
    mocks.accountFind.mockImplementation(
      chainableFindReturning([{ _id: 'acc-prof', netid: 'prof-netid' }]),
    );
    mocks.researcherFind.mockImplementation(
      chainableFindReturning([{ accountId: 'acc-prof', displayName: 'Jane Doe' }]),
    );

    const analytics = await getAnalytics({
      start: new Date('2026-08-01T00:00:00.000Z'),
      end: new Date('2026-08-08T00:00:00.000Z'),
    });

    expect(analytics.research.topEntities).toEqual([
      {
        entityType: 'research_entity',
        entityId: researchEntityId,
        views: 12,
        uniqueViewers: 4,
        name: 'Quantum Computing Lab',
        href: '/research/quantum-lab',
      },
      {
        entityType: 'fellowship',
        entityId: fellowshipId,
        views: 8,
        uniqueViewers: 2,
        name: 'Summer Research Fellowship',
      },
      {
        entityType: 'listing',
        entityId: listingId,
        views: 5,
        uniqueViewers: 1,
        name: 'Legacy Listing Title',
      },
      {
        entityType: 'profile',
        entityId: 'prof-netid',
        views: 3,
        uniqueViewers: 1,
        name: 'Jane Doe',
        href: '/profile/prof-netid',
      },
    ]);
  });
});

describe('shouldSuppressBetaAnalyticsEvent', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('suppresses real student analytics in Beta', () => {
    vi.stubEnv('SCRAPER_ENV', 'beta');

    expect(shouldSuppressBetaAnalyticsEvent({ netid: 'aa3246', userType: 'undergraduate' })).toBe(
      true,
    );
    expect(shouldSuppressBetaAnalyticsEvent({ netid: 'aa3246', userType: 'student' })).toBe(true);
    expect(shouldSuppressBetaAnalyticsEvent({ netid: 'aa3246', userType: 'graduate' })).toBe(true);
  });

  it('keeps Beta admin and fixture analytics available for operator testing', () => {
    vi.stubEnv('SCRAPER_ENV', 'beta');

    expect(shouldSuppressBetaAnalyticsEvent({ netid: 'qz285', userType: 'admin' })).toBe(false);
    expect(shouldSuppressBetaAnalyticsEvent({ netid: 'devadmin', userType: 'undergraduate' })).toBe(
      false,
    );
    expect(shouldSuppressBetaAnalyticsEvent({ netid: 'test123', userType: 'student' })).toBe(false);
  });

  it('does not suppress production analytics', () => {
    vi.stubEnv('SCRAPER_ENV', 'production');

    expect(shouldSuppressBetaAnalyticsEvent({ netid: 'aa3246', userType: 'undergraduate' })).toBe(
      false,
    );
  });
});

describe('getUserAnalytics', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects oversized search before building the aggregation pipeline', async () => {
    await expect(getUserAnalytics({ search: 'a'.repeat(121) })).rejects.toThrow('Invalid search');

    expect(mocks.analyticsAggregate).not.toHaveBeenCalled();
  });

  it('threads a skip stage into the users facet when an offset is provided', async () => {
    mocks.analyticsAggregate.mockResolvedValue([{ users: [], total: 275 }]);

    const result = await getUserAnalytics({ limit: 25, offset: 50 });

    expect(result.offset).toBe(50);
    expect(result.total).toBe(275);
    const pipeline = mocks.analyticsAggregate.mock.calls[0][0];
    const facetStage = pipeline.find((stage: any) => stage.$facet);
    expect(facetStage.$facet.users).toEqual([{ $skip: 50 }, { $limit: 25 }]);
  });

  it('omits the skip stage on the first page', async () => {
    mocks.analyticsAggregate.mockResolvedValue([{ users: [], total: 0 }]);

    const result = await getUserAnalytics({ limit: 25 });

    expect(result.offset).toBe(0);
    const pipeline = mocks.analyticsAggregate.mock.calls[0][0];
    const facetStage = pipeline.find((stage: any) => stage.$facet);
    expect(facetStage.$facet.users).toEqual([{ $limit: 25 }]);
  });

  it('rejects a negative offset before building the aggregation pipeline', async () => {
    await expect(getUserAnalytics({ offset: -1 })).rejects.toThrow('Invalid offset');

    expect(mocks.analyticsAggregate).not.toHaveBeenCalled();
  });
});

describe('getUserAnalyticsDrilldown', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects malformed netids before building analytics regex filters', async () => {
    await expect(getUserAnalyticsDrilldown('../not-a-netid')).rejects.toThrow('Invalid netid');
    await expect(getUserAnalyticsDrilldown('a'.repeat(121))).rejects.toThrow('Invalid netid');

    expect(mocks.analyticsAggregate).not.toHaveBeenCalled();
    expect(mocks.analyticsFind).not.toHaveBeenCalled();
  });

  it('resolves listing and fellowship ids to titles for drilldown events', async () => {
    const listingId = '507f1f77bcf86cd799439021';
    const fellowshipId = '507f1f77bcf86cd799439022';
    mocks.userFindOneAndUpdate.mockReturnValue({ catch: vi.fn() });
    mocks.analyticsAggregate.mockResolvedValue([
      { users: [{ netid: 'student1', userType: 'undergraduate', totalEvents: 2 }], total: 1 },
    ]);
    mocks.analyticsFind.mockReturnValue({
      sort: () => ({
        limit: () => ({
          lean: async () => [
            {
              _id: 'evt1',
              eventType: 'research_view',
              userType: 'undergraduate',
              listingId,
              timestamp: new Date('2026-08-01T00:00:00.000Z'),
            },
            {
              _id: 'evt2',
              eventType: 'fellowship_view',
              userType: 'undergraduate',
              fellowshipId,
              timestamp: new Date('2026-08-02T00:00:00.000Z'),
            },
          ],
        }),
      }),
    });
    const chainableFindReturning =
      (docs: unknown[]) =>
      () => ({
        select: () => ({ lean: async () => docs }),
        lean: async () => docs,
      });
    mocks.getListingModel.mockReturnValue({
      find: chainableFindReturning([{ _id: listingId, title: 'Genomics Lab Position' }]),
    });
    mocks.fellowshipFind.mockImplementation(
      chainableFindReturning([{ _id: fellowshipId, title: 'Summer Fellowship' }]),
    );

    const result = await getUserAnalyticsDrilldown('student1');

    expect(result?.events).toEqual([
      expect.objectContaining({ listingId, listingTitle: 'Genomics Lab Position' }),
      expect.objectContaining({ fellowshipId, fellowshipTitle: 'Summer Fellowship' }),
    ]);
  });
});

describe('logEvent', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('redacts direct contact details before persisting analytics text and metadata', async () => {
    mocks.userFindOneAndUpdate.mockReturnValue({ catch: vi.fn() });

    await logEvent({
      eventType: AnalyticsEventType.SEARCH,
      netid: 'student123',
      userType: 'undergraduate',
      searchQuery: 'email ada@example.edu or call 203-555-1212',
      searchDepartments: ['Computer Science', 'hidden@example.edu'],
      metadata: {
        entityType: 'listing',
        note: 'Reach ada@example.edu at 203-555-3434',
        nested: {
          values: ['visible', 'contact hidden@example.edu'],
        },
      },
    });

    expect(mocks.analyticsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        searchQuery: 'email [email redacted] or call [phone redacted]',
        searchDepartments: ['Computer Science', '[email redacted]'],
        metadata: {
          entityType: 'listing',
          note: 'Reach [email redacted] at [phone redacted]',
          nested: {
            values: ['visible', 'contact [email redacted]'],
          },
        },
      }),
    );
    expect(JSON.stringify(mocks.analyticsCreate.mock.calls[0][0])).not.toContain('ada@example.edu');
    expect(JSON.stringify(mocks.analyticsCreate.mock.calls[0][0])).not.toContain(
      'hidden@example.edu',
    );
    expect(JSON.stringify(mocks.analyticsCreate.mock.calls[0][0])).not.toContain('203-555');
  });

  it('bounds analytics text and metadata before persistence', async () => {
    mocks.userFindOneAndUpdate.mockReturnValue({ catch: vi.fn() });

    await logEvent({
      eventType: AnalyticsEventType.SEARCH,
      netid: 'student123',
      userType: 'undergraduate',
      searchQuery: `prefix ${'a'.repeat(800)} hidden@example.edu`,
      searchDepartments: Array.from({ length: 55 }, (_, index) => `Department ${index}`),
      metadata: {
        '$private.key': 'hidden@example.edu',
        constructor: 'prototype payload',
        prototype: 'prototype payload',
        longText: 'x'.repeat(800),
        wideArray: Array.from({ length: 55 }, (_, index) => index),
        notFinite: Number.POSITIVE_INFINITY,
        nested: {
          values: Array.from({ length: 55 }, (_, index) => `value-${index}`),
        },
      },
    });

    const created = mocks.analyticsCreate.mock.calls[0][0];
    expect(created.searchQuery).toHaveLength(512);
    expect(created.searchQuery).not.toContain('hidden@example.edu');
    expect(created.searchDepartments).toHaveLength(50);
    expect(Object.prototype.hasOwnProperty.call(created.metadata, '$private.key')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(created.metadata, '_private_key')).toBe(false);
    expect(JSON.stringify(created.metadata)).not.toContain('hidden@example.edu');
    expect(Object.prototype.hasOwnProperty.call(created.metadata, 'constructor')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(created.metadata, 'prototype')).toBe(false);
    expect(created.metadata.longText).toHaveLength(512);
    expect(created.metadata.wideArray).toHaveLength(50);
    expect(created.metadata).not.toHaveProperty('notFinite');
    expect(created.metadata.nested.values).toHaveLength(50);
    expect(JSON.stringify(created)).not.toContain('hidden@example.edu');
  });

  it('rejects malformed analytics actor netids before persistence', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.userFindOneAndUpdate.mockReturnValue({ catch: vi.fn() });

    await logEvent({
      eventType: AnalyticsEventType.SEARCH,
      netid: '../not-a-netid',
      userType: 'undergraduate',
    });

    expect(mocks.analyticsCreate).not.toHaveBeenCalled();
    expect(mocks.userFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects malformed analytics event types before persistence', async () => {
    mocks.userFindOneAndUpdate.mockReturnValue({ catch: vi.fn() });

    await logEvent({
      eventType: 'search.$where' as AnalyticsEventType,
      netid: 'student123',
      userType: 'undergraduate',
      searchQuery: 'machine learning',
    });

    expect(mocks.analyticsCreate).not.toHaveBeenCalled();
    expect(mocks.userFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('sanitizes analytics actor fields before persistence and skips non-user buckets for user updates', async () => {
    mocks.userFindOneAndUpdate.mockReturnValue({ catch: vi.fn() });

    await logEvent({
      eventType: AnalyticsEventType.VISITOR,
      netid: ' anonymous ',
      userType: 'admin<script>',
    });

    expect(mocks.analyticsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        netid: 'anonymous',
        userType: 'unknown',
      }),
    );
    expect(mocks.userFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('drops malformed analytics entity ids before persistence', async () => {
    mocks.userFindOneAndUpdate.mockReturnValue({ catch: vi.fn() });

    await logEvent({
      eventType: AnalyticsEventType.LISTING_VIEW,
      netid: 'student123',
      userType: 'undergraduate',
      listingId: '../not-an-object-id',
      fellowshipId: '123',
    });

    const created = mocks.analyticsCreate.mock.calls[0][0];
    expect(created).not.toHaveProperty('listingId');
    expect(created).not.toHaveProperty('fellowshipId');
  });

  it('keeps valid analytics entity ObjectIds before persistence', async () => {
    mocks.userFindOneAndUpdate.mockReturnValue({ catch: vi.fn() });

    await logEvent({
      eventType: AnalyticsEventType.LISTING_VIEW,
      netid: 'student123',
      userType: 'undergraduate',
      listingId: '507f1f77bcf86cd799439011',
      fellowshipId: '507f1f77bcf86cd799439012',
    });

    expect(mocks.analyticsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        listingId: '507f1f77bcf86cd799439011',
        fellowshipId: '507f1f77bcf86cd799439012',
      }),
    );
  });

  it('uses an atomic per-actor upsert for retry-safe journey events', async () => {
    mocks.analyticsUpdateOne.mockResolvedValue({ upsertedCount: 1 });
    mocks.userFindOneAndUpdate.mockReturnValue({ catch: vi.fn() });

    await logEvent({
      eventType: AnalyticsEventType.RESEARCH_SAVE,
      netid: 'student123',
      userType: 'undergraduate',
      entityType: 'research_entity',
      entityId: '507f1f77bcf86cd799439011',
      metadata: { operation: 'save' },
      dedupeKey: 'save:fixture-1',
    });

    expect(mocks.analyticsCreate).not.toHaveBeenCalled();
    expect(mocks.analyticsUpdateOne).toHaveBeenCalledWith(
      { netid: 'student123', dedupeKey: 'save:fixture-1' },
      { $setOnInsert: expect.objectContaining({ eventType: 'research_save' }) },
      { upsert: true },
    );
  });
});
