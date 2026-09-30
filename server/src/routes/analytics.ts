/**
 * Express routes for analytics event tracking and dashboard data.
 */
import { Request, Response, Router } from 'express';
import { isAuthenticated, isAdmin } from '../middleware/auth';
import { AnalyticsEventType } from '../models/analytics';
import { asyncHandler } from '../middleware/errorHandler';
import {
  AnalyticsSortDirection,
  AnalyticsUserSort,
  AnalyticsDateRange,
  SearchQualityQueryAnalytics,
  MAX_USER_ANALYTICS_SEARCH_LENGTH,
  getAnalytics,
  getActionNeededAnalytics,
  getFunnelAnalytics,
  getSearchQueryAnalytics,
  getSearchQualityAnalytics,
  getUserAnalytics,
  getUserAnalyticsDrilldown,
} from '../services/analyticsService';
import { getCorpusQualityDashboard } from '../services/corpusQualityDashboardService';
import { getLaneBenchmarkDashboard } from '../services/laneBenchmarkDashboardService';
import { validateNetid } from '../middleware/validation';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { BadRequestError } from '../utils/errors';
import {
  emitResearchEvent,
  existingResearchEntityIds,
  isResearchEntityType,
  isResearchEventType,
  isResearchJourneyEventType,
  researchEntityExists,
  researchJourneyEventRequiresEntity,
  type ResearchEventOutcome,
} from '../services/researchAnalytics';

const router = Router();
const ANALYTICS_USER_SORTS: readonly AnalyticsUserSort[] = [
  'lastActive',
  'totalEvents',
  'logins',
  'searches',
  'researchViews',
];
const ANALYTICS_SORT_DIRECTIONS: readonly AnalyticsSortDirection[] = ['asc', 'desc'];
const MAX_ANALYTICS_USER_TYPE_LENGTH = 40;
const MAX_ANALYTICS_ACTIVE_SINCE_LENGTH = 64;
const ANALYTICS_USER_TYPE_RE = /^[A-Za-z0-9_-]{1,40}$/;

function setPrivateAnalyticsCacheHeaders(_request: Request, response: Response, next: () => void) {
  response.setHeader('Cache-Control', 'no-store, private, max-age=0');
  response.setHeader('Pragma', 'no-cache');
  next();
}

router.use(setPrivateAnalyticsCacheHeaders);

const invalidAnalyticsRequest = () => new BadRequestError('Invalid analytics request');

const MAX_RESEARCH_EVENT_BATCH = 50;

const acceptResearchEvent = async (
  event: unknown,
  user: { netId?: string; userType?: string },
): Promise<ResearchEventOutcome> => {
  const { eventType, entityType, entityId, entityIds, payload, dedupeKey } =
    (event as Record<string, unknown>) || {};

  if (!isResearchEventType(eventType)) return 'rejected';

  if (eventType === AnalyticsEventType.RESEARCH_RESULTS_VIEW) {
    if (entityType !== 'research_entity') return 'rejected';
    const shownEntityIds = await existingResearchEntityIds(entityIds);
    if (shownEntityIds.length === 0) return 'rejected';
    return emitResearchEvent({
      eventType,
      entityType,
      entityId: undefined,
      entityIds: shownEntityIds,
      payload,
      dedupeKey,
      user,
    });
  }

  const requiresEntity =
    !isResearchJourneyEventType(eventType) || researchJourneyEventRequiresEntity(eventType);

  if (requiresEntity && !isResearchEntityType(entityType)) return 'rejected';
  if (requiresEntity && (typeof entityId !== 'string' || entityId.trim() === '')) return 'rejected';
  if (
    requiresEntity &&
    !(await researchEntityExists(
      entityType as Parameters<typeof researchEntityExists>[0],
      entityId as Parameters<typeof researchEntityExists>[1],
    ))
  ) {
    return 'rejected';
  }

  return emitResearchEvent({ eventType, entityType, entityId, payload, dedupeKey, user });
};

router.post(
  '/research/batch',
  isAuthenticated,
  asyncHandler(async (request: Request, response: Response) => {
    const events = (request.body as { events?: unknown })?.events;

    if (!Array.isArray(events) || events.length === 0) {
      return response.status(400).json({ error: 'Invalid research analytics batch' });
    }

    if (events.length > MAX_RESEARCH_EVENT_BATCH) {
      return response.status(413).json({ error: 'Research analytics batch too large' });
    }

    const user = request.user as { netId?: string; userType?: string };
    let accepted = 0;
    let suppressed = 0;
    const rejectedEventTypes = new Map<string, number>();
    const unstoredEventTypes = new Map<string, number>();
    const tally = (counts: Map<string, number>, event: unknown) => {
      const eventType = (event as { eventType?: unknown })?.eventType;
      const key = isResearchEventType(eventType) ? eventType : 'unrecognized';
      counts.set(key, (counts.get(key) || 0) + 1);
    };
    for (const event of events) {
      const outcome = await acceptResearchEvent(event, user);
      if (outcome === 'recorded') accepted += 1;
      else if (outcome === 'suppressed') suppressed += 1;
      else if (outcome === 'failed') tally(unstoredEventTypes, event);
      else tally(rejectedEventTypes, event);
    }

    // A batch answers 202 whatever it stored, and the browser swallows the body,
    // so validation that rejects everything is otherwise invisible. It stayed
    // invisible long enough for every research-entity journey event ever emitted
    // to be dropped (#2677). Event types and counts only, never an identifier.
    if (accepted + suppressed < events.length) {
      console.warn(
        '[analytics] research batch partially rejected:',
        sanitizeLogValue({
          sent: events.length,
          accepted,
          rejected: Object.fromEntries(rejectedEventTypes),
          unstored: Object.fromEntries(unstoredEventTypes),
        }),
      );
    }

    return response.status(202).json({ accepted, sent: events.length });
  }),
);

const parseAnalyticsRange = (range: unknown): AnalyticsDateRange => {
  if (range === 'all') {
    return {};
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (range === 'today') {
    return { start: today, end: now };
  }

  if (range === '7d') {
    return { start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), end: now };
  }

  if (range === 'semester') {
    const semesterStart =
      now.getMonth() >= 6 ? new Date(now.getFullYear(), 6, 1) : new Date(now.getFullYear(), 0, 1);
    return { start: semesterStart, end: now };
  }

  return { start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), end: now };
};

const parseUserAnalyticsSearch = (search: unknown): string | undefined => {
  if (typeof search !== 'string') {
    return undefined;
  }

  if (search.length > MAX_USER_ANALYTICS_SEARCH_LENGTH) {
    throw invalidAnalyticsRequest();
  }

  return search;
};

const parseAnalyticsLimit = (limit: unknown, max: number): number | undefined => {
  if (limit === undefined) {
    return undefined;
  }

  if (typeof limit !== 'string' || limit.length > 16) {
    throw invalidAnalyticsRequest();
  }

  const numericLimit = Number(limit);
  if (!Number.isInteger(numericLimit) || numericLimit < 1 || numericLimit > max) {
    throw invalidAnalyticsRequest();
  }

  return numericLimit;
};

const MAX_USER_ANALYTICS_OFFSET = 100_000;

const parseAnalyticsOffset = (offset: unknown): number | undefined => {
  if (offset === undefined) {
    return undefined;
  }

  if (typeof offset !== 'string' || offset.length > 16) {
    throw invalidAnalyticsRequest();
  }

  const numericOffset = Number(offset);
  if (
    !Number.isInteger(numericOffset) ||
    numericOffset < 0 ||
    numericOffset > MAX_USER_ANALYTICS_OFFSET
  ) {
    throw invalidAnalyticsRequest();
  }

  return numericOffset;
};

const parseAnalyticsUserSort = (sort: unknown): AnalyticsUserSort | undefined => {
  if (sort === undefined) {
    return undefined;
  }

  if (typeof sort !== 'string' || !ANALYTICS_USER_SORTS.includes(sort as AnalyticsUserSort)) {
    throw invalidAnalyticsRequest();
  }

  return sort as AnalyticsUserSort;
};

const parseAnalyticsSortDirection = (direction: unknown): AnalyticsSortDirection | undefined => {
  if (direction === undefined) {
    return undefined;
  }

  if (
    typeof direction !== 'string' ||
    !ANALYTICS_SORT_DIRECTIONS.includes(direction as AnalyticsSortDirection)
  ) {
    throw invalidAnalyticsRequest();
  }

  return direction as AnalyticsSortDirection;
};

const parseAnalyticsUserType = (userType: unknown): string | undefined => {
  if (userType === undefined) {
    return undefined;
  }

  if (
    typeof userType !== 'string' ||
    userType.length > MAX_ANALYTICS_USER_TYPE_LENGTH ||
    !ANALYTICS_USER_TYPE_RE.test(userType)
  ) {
    throw invalidAnalyticsRequest();
  }

  return userType;
};

const parseAnalyticsActiveSince = (activeSince: unknown): string | undefined => {
  if (activeSince === undefined) {
    return undefined;
  }

  if (typeof activeSince !== 'string' || activeSince.length > MAX_ANALYTICS_ACTIVE_SINCE_LENGTH) {
    throw invalidAnalyticsRequest();
  }

  const trimmed = activeSince.trim();
  if (!trimmed || Number.isNaN(new Date(trimmed).getTime())) {
    throw invalidAnalyticsRequest();
  }

  return trimmed;
};

router.get(
  '/',
  isAuthenticated,
  isAdmin,
  asyncHandler(async (request: Request, response: Response) => {
    const analytics = await getAnalytics(parseAnalyticsRange(request.query.range));
    response.status(200).json(analytics);
  }),
);

router.get(
  '/corpus-quality',
  isAuthenticated,
  isAdmin,
  asyncHandler(async (_request: Request, response: Response) => {
    response.status(200).json(await getCorpusQualityDashboard());
  }),
);

router.get(
  '/lane-benchmarks',
  isAuthenticated,
  isAdmin,
  asyncHandler(async (_request: Request, response: Response) => {
    response.status(200).json(await getLaneBenchmarkDashboard());
  }),
);

router.get(
  '/users',
  isAuthenticated,
  isAdmin,
  asyncHandler(async (request: Request, response: Response) => {
    const { userType, activeSince, search, sort, direction, limit, offset } = request.query;
    const analytics = await getUserAnalytics({
      userType: parseAnalyticsUserType(userType),
      activeSince: parseAnalyticsActiveSince(activeSince),
      search: parseUserAnalyticsSearch(search),
      sort: parseAnalyticsUserSort(sort),
      direction: parseAnalyticsSortDirection(direction),
      limit: parseAnalyticsLimit(limit, 200),
      offset: parseAnalyticsOffset(offset),
    });

    response.status(200).json(analytics);
  }),
);

const averageResultsOverSearchesThatReachedTheCorpus = (
  queries: SearchQualityQueryAnalytics[],
): number => {
  const searches = queries.reduce((sum, query) => sum + query.searchesThatReachedTheCorpus, 0);
  if (searches === 0) return 0;
  const results = queries.reduce(
    (sum, query) => sum + query.avgResultCount * query.searchesThatReachedTheCorpus,
    0,
  );
  return results / searches;
};

router.get(
  '/search-quality',
  isAuthenticated,
  isAdmin,
  asyncHandler(async (request: Request, response: Response) => {
    const analytics = await getSearchQualityAnalytics(parseAnalyticsRange(request.query.range));
    response.status(200).json({
      ...analytics,
      searchesWithResults: Math.max(
        analytics.totalSearches - analytics.degradedSearches - analytics.zeroResultSearches,
        0,
      ),
      avgResultsPerSearch: averageResultsOverSearchesThatReachedTheCorpus(
        analytics.byQueryAndEntityType,
      ),
      topQueries: analytics.topQueries.map((query) => ({
        ...query,
        count: query.searchesThatReachedTheCorpus,
        zeroResults: query.zeroResultSearches,
        avgResults: query.avgResultCount,
      })),
      zeroResultQueries: analytics.topZeroResultQueries.map((query) => ({
        ...query,
        count: query.searchesThatReachedTheCorpus,
        zeroResults: query.zeroResultSearches,
        avgResults: query.avgResultCount,
      })),
      lowResultQueries: analytics.byQueryAndEntityType
        .filter((query) => query.avgResultCount > 0 && query.avgResultCount <= 3)
        .slice(0, 10)
        .map((query) => ({
          ...query,
          count: query.searchesThatReachedTheCorpus,
          zeroResults: query.zeroResultSearches,
          avgResults: query.avgResultCount,
        })),
    });
  }),
);

router.get(
  '/search-queries',
  isAuthenticated,
  isAdmin,
  asyncHandler(async (request: Request, response: Response) => {
    const analytics = await getSearchQueryAnalytics(parseAnalyticsRange(request.query.range), {
      limit: parseAnalyticsLimit(request.query.limit, 100),
    });
    response.status(200).json(analytics);
  }),
);

router.get(
  '/funnel',
  isAuthenticated,
  isAdmin,
  asyncHandler(async (request: Request, response: Response) => {
    const analytics = await getFunnelAnalytics(parseAnalyticsRange(request.query.range));
    const qualifiedActionsMeasured = analytics.qualifiedActionEvents > 0;
    const stages = [
      { key: 'research_searches', label: 'Searched research', count: analytics.researchSearches },
      { key: 'profile_opens', label: 'Opened a profile', count: analytics.researchProfileOpens },
      { key: 'research_saves', label: 'Saved research', count: analytics.researchSaves },
      {
        key: 'comparisons',
        label: 'Compared saved research',
        count: analytics.researchComparisons,
      },
      { key: 'plans', label: 'Updated a plan', count: analytics.researchPlanUpdates },
      {
        key: 'qualified_actions',
        label: 'Used a qualified route',
        count: analytics.qualifiedActions,
      },
    ].filter((stage) => stage.key !== 'qualified_actions' || qualifiedActionsMeasured);

    response.status(200).json({
      ...analytics,
      stages: stages.map((stage, index) => {
        const previous = index === 0 ? stage.count : stages[index - 1].count;
        return {
          ...stage,
          conversionRate: previous > 0 ? stage.count / previous : 0,
        };
      }),
      journeyMetrics: {
        sourceInspections: analytics.sourceInspections,
        officialRouteAttempts: qualifiedActionsMeasured ? analytics.officialRouteAttempts : null,
        applicationOpens: qualifiedActionsMeasured ? analytics.applicationOpens : null,
      },
      qualifiedActionEventsRecorded: analytics.qualifiedActionEvents,
      // A rate of 0 and a lane that recorded nothing are different facts, and a
      // dashboard that renders both as "0%" reports an instrumentation gap as a
      // product failure (#2677). Null means unmeasured; 0 means measured at zero.
      overallConversionRate:
        analytics.qualifiedActionEvents === 0
          ? null
          : analytics.logins > 0
            ? analytics.qualifiedActions / analytics.logins
            : 0,
    });
  }),
);

router.get(
  '/actions',
  isAuthenticated,
  isAdmin,
  asyncHandler(async (request: Request, response: Response) => {
    const analytics = await getActionNeededAnalytics(parseAnalyticsRange(request.query.range));
    const searchCards = analytics.highSearchLowResults.slice(0, 4).map((query) => ({
      id: `search-${query.entityType}-${query.query}`,
      query: query.query,
      entityType: query.entityType,
      type: 'Search gap',
      priority: query.zeroResultRate >= 0.8 ? 'high' : 'medium',
      title: query.query || '(empty search)',
      metric: `${Math.round(query.zeroResultRate * 100)}% zero-result`,
      count: query.searchesThatReachedTheCorpus,
      department: query.entityType,
    }));

    response.status(200).json({
      ...analytics,
      cards: searchCards.slice(0, 6),
    });
  }),
);

router.get(
  '/users/:netid',
  isAuthenticated,
  isAdmin,
  validateNetid('netid'),
  asyncHandler(async (request: Request, response: Response) => {
    const limit = parseAnalyticsLimit(request.query.limit, 300);
    const analytics = await getUserAnalyticsDrilldown(request.params.netid, { limit });

    if (!analytics) {
      return response.status(404).json({ error: 'User analytics not found' });
    }

    response.status(200).json(analytics);
  }),
);

export default router;
