/**
 * Express routes for analytics event tracking and dashboard data.
 */
import { Request, Response, Router } from 'express';
import { isAuthenticated, isAdmin } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import {
  AnalyticsSortDirection,
  AnalyticsUserSort,
  AnalyticsDateRange,
  MAX_USER_ANALYTICS_SEARCH_LENGTH,
  getAnalytics,
  getActionNeededAnalytics,
  getFunnelAnalytics,
  getSearchQueryAnalytics,
  getSearchQualityAnalytics,
  getUserAnalytics,
  getUserAnalyticsDrilldown,
} from '../services/analyticsService';
import { AnalyticsEvent, AnalyticsEventType } from '../models/analytics';
import { validateNetid } from '../middleware/validation';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  emitResearchEvent,
  isResearchEntityType,
  isResearchEventType,
  isResearchJourneyEventType,
  researchEntityExists,
  researchJourneyEventRequiresEntity,
} from '../services/researchAnalytics';

const router = Router();
const ANALYTICS_USER_SORTS: readonly AnalyticsUserSort[] = [
  'lastActive',
  'totalEvents',
  'logins',
  'searches',
  'views',
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

class AnalyticsRequestError extends Error {}

router.post(
  '/research',
  isAuthenticated,
  asyncHandler(async (request: Request, response: Response) => {
    const { eventType, entityType, entityId, payload, dedupeKey } = request.body || {};

    if (!isResearchEventType(eventType)) {
      return response.status(400).json({ error: 'Invalid research analytics eventType' });
    }

    const requiresEntity =
      !isResearchJourneyEventType(eventType) || researchJourneyEventRequiresEntity(eventType);

    if (requiresEntity && !isResearchEntityType(entityType)) {
      return response.status(400).json({ error: 'Invalid research analytics entityType' });
    }

    if (requiresEntity && (typeof entityId !== 'string' || entityId.trim() === '')) {
      return response.status(400).json({ error: 'Invalid research analytics entityId' });
    }

    if (requiresEntity && !(await researchEntityExists(entityType, entityId))) {
      return response.status(404).json({ error: 'Research analytics entity not found' });
    }

    const emitted = await emitResearchEvent({
      eventType,
      entityType,
      entityId,
      payload,
      dedupeKey,
      user: request.user as { netId?: string; userType?: string },
    });

    if (!emitted) {
      return response.status(400).json({ error: 'Unable to record research analytics event' });
    }

    return response.status(202).json({ ok: true });
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

const handleAnalyticsError = (response: Response, error: unknown, fallbackMessage: string) => {
  const isValidationFailure = error instanceof AnalyticsRequestError;
  response.status(isValidationFailure ? 400 : 500).json({
    error: isValidationFailure ? 'Invalid analytics request' : fallbackMessage,
  });
};

const parseUserAnalyticsSearch = (search: unknown): string | undefined => {
  if (typeof search !== 'string') {
    return undefined;
  }

  if (search.length > MAX_USER_ANALYTICS_SEARCH_LENGTH) {
    throw new AnalyticsRequestError('Invalid analytics request');
  }

  return search;
};

const parseAnalyticsLimit = (limit: unknown, max: number): number | undefined => {
  if (limit === undefined) {
    return undefined;
  }

  if (typeof limit !== 'string' || limit.length > 16) {
    throw new AnalyticsRequestError('Invalid analytics request');
  }

  const numericLimit = Number(limit);
  if (!Number.isInteger(numericLimit) || numericLimit < 1 || numericLimit > max) {
    throw new AnalyticsRequestError('Invalid analytics request');
  }

  return numericLimit;
};

const parseAnalyticsUserSort = (sort: unknown): AnalyticsUserSort | undefined => {
  if (sort === undefined) {
    return undefined;
  }

  if (typeof sort !== 'string' || !ANALYTICS_USER_SORTS.includes(sort as AnalyticsUserSort)) {
    throw new AnalyticsRequestError('Invalid analytics request');
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
    throw new AnalyticsRequestError('Invalid analytics request');
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
    throw new AnalyticsRequestError('Invalid analytics request');
  }

  return userType;
};

const parseAnalyticsActiveSince = (activeSince: unknown): string | undefined => {
  if (activeSince === undefined) {
    return undefined;
  }

  if (typeof activeSince !== 'string' || activeSince.length > MAX_ANALYTICS_ACTIVE_SINCE_LENGTH) {
    throw new AnalyticsRequestError('Invalid analytics request');
  }

  const trimmed = activeSince.trim();
  if (!trimmed || Number.isNaN(new Date(trimmed).getTime())) {
    throw new AnalyticsRequestError('Invalid analytics request');
  }

  return trimmed;
};

const publicAnalyticsDebugEvent = (event: any) => ({
  eventType: typeof event?.eventType === 'string' ? event.eventType : 'unknown',
  userType: typeof event?.userType === 'string' ? event.userType : 'unknown',
  timestamp: event?.timestamp,
});

router.get('/', isAuthenticated, isAdmin, async (request: Request, response: Response) => {
  try {
    const analytics = await getAnalytics();
    response.status(200).json(analytics);
  } catch (error) {
    console.error('Error fetching analytics:', sanitizeLogValue(error));
    response.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

router.get('/users', isAuthenticated, isAdmin, async (request: Request, response: Response) => {
  try {
    const { userType, activeSince, search, sort, direction, limit } = request.query;
    const analytics = await getUserAnalytics({
      userType: parseAnalyticsUserType(userType),
      activeSince: parseAnalyticsActiveSince(activeSince),
      search: parseUserAnalyticsSearch(search),
      sort: parseAnalyticsUserSort(sort),
      direction: parseAnalyticsSortDirection(direction),
      limit: parseAnalyticsLimit(limit, 200),
    });

    response.status(200).json(analytics);
  } catch (error) {
    console.error('Error fetching user analytics:', sanitizeLogValue(error));
    handleAnalyticsError(response, error, 'Failed to fetch user analytics');
  }
});

router.get(
  '/search-quality',
  isAuthenticated,
  isAdmin,
  async (request: Request, response: Response) => {
    try {
      const analytics = await getSearchQualityAnalytics(parseAnalyticsRange(request.query.range));
      response.status(200).json({
        ...analytics,
        searchesWithResults: Math.max(analytics.totalSearches - analytics.zeroResultSearches, 0),
        avgResultsPerSearch:
          analytics.byQueryAndEntityType.length > 0
            ? analytics.byQueryAndEntityType.reduce(
                (sum, query) => sum + query.avgResultCount * query.totalSearches,
                0,
              ) /
              analytics.byQueryAndEntityType.reduce((sum, query) => sum + query.totalSearches, 0)
            : 0,
        topQueries: analytics.topQueries.map((query) => ({
          ...query,
          count: query.totalSearches,
          zeroResults: query.zeroResultSearches,
          avgResults: query.avgResultCount,
        })),
        zeroResultQueries: analytics.topZeroResultQueries.map((query) => ({
          ...query,
          count: query.totalSearches,
          zeroResults: query.zeroResultSearches,
          avgResults: query.avgResultCount,
        })),
        lowResultQueries: analytics.byQueryAndEntityType
          .filter((query) => query.avgResultCount > 0 && query.avgResultCount <= 3)
          .slice(0, 10)
          .map((query) => ({
            ...query,
            count: query.totalSearches,
            zeroResults: query.zeroResultSearches,
            avgResults: query.avgResultCount,
          })),
      });
    } catch (error) {
      console.error('Error fetching search quality analytics:', sanitizeLogValue(error));
      handleAnalyticsError(response, error, 'Failed to fetch search quality analytics');
    }
  },
);

router.get(
  '/search-queries',
  isAuthenticated,
  isAdmin,
  async (request: Request, response: Response) => {
    try {
      const analytics = await getSearchQueryAnalytics(parseAnalyticsRange(request.query.range), {
        limit: parseAnalyticsLimit(request.query.limit, 100),
      });
      response.status(200).json(analytics);
    } catch (error) {
      console.error('Error fetching search query analytics:', sanitizeLogValue(error));
      handleAnalyticsError(response, error, 'Failed to fetch search query analytics');
    }
  },
);

router.get('/funnel', isAuthenticated, isAdmin, async (request: Request, response: Response) => {
  try {
    const analytics = await getFunnelAnalytics(parseAnalyticsRange(request.query.range));
    const viewerCount = analytics.listingViews + analytics.fellowshipViews;
    const legacyStages = [
      { key: 'logins', label: 'Logged In', count: analytics.logins },
      { key: 'searches', label: 'Searched', count: analytics.searches },
      { key: 'views', label: 'Viewed', count: viewerCount },
      { key: 'favorites', label: 'Favorited', count: analytics.favoritesOrSaves },
      { key: 'outreach', label: 'Outreach Clicked', count: analytics.outreachClicks },
      { key: 'outcomes', label: 'Outcome Reported', count: analytics.outreachOutcomes },
    ];
    const journeyStages = [
      { key: 'research_searches', label: 'Searched research', count: analytics.researchSearches },
      { key: 'profile_opens', label: 'Opened a profile', count: analytics.researchProfileOpens },
      { key: 'research_saves', label: 'Saved a research home', count: analytics.researchSaves },
      { key: 'comparisons', label: 'Compared saved homes', count: analytics.researchComparisons },
      { key: 'plans', label: 'Updated a plan', count: analytics.researchPlanUpdates },
      {
        key: 'qualified_actions',
        label: 'Used a qualified route',
        count: analytics.qualifiedActions,
      },
    ];
    const stages = journeyStages.some((stage) => stage.count > 0) ? journeyStages : legacyStages;

    response.status(200).json({
      ...analytics,
      stages: stages.map((stage, index) => {
        const previous = index === 0 ? stage.count : stages[index - 1].count;
        return {
          ...stage,
          conversionRate: previous > 0 ? stage.count / previous : 0,
        };
      }),
      visitorCount: analytics.logins,
      searcherCount: analytics.searches,
      viewerCount,
      favoriteCount: analytics.favoritesOrSaves,
      applicantCount: analytics.qualifiedActions,
      journeyMetrics: {
        sourceInspections: analytics.sourceInspections,
        officialRouteAttempts: analytics.officialRouteAttempts,
        applicationOpens: analytics.applicationOpens,
        confirmedOutcomes: analytics.confirmedOutcomes,
      },
      overallConversionRate:
        analytics.logins > 0 ? analytics.qualifiedActions / analytics.logins : 0,
    });
  } catch (error) {
    console.error('Error fetching funnel analytics:', sanitizeLogValue(error));
    handleAnalyticsError(response, error, 'Failed to fetch funnel analytics');
  }
});

router.get('/actions', isAuthenticated, isAdmin, async (request: Request, response: Response) => {
  try {
    const analytics = await getActionNeededAnalytics(parseAnalyticsRange(request.query.range));
    const searchCards = analytics.highSearchLowResults.slice(0, 4).map((query) => ({
      id: `search-${query.entityType}-${query.query}`,
      type: 'Search gap',
      priority: query.zeroResultRate >= 0.8 ? 'high' : 'medium',
      title: query.query || '(empty search)',
      metric: `${Math.round(query.zeroResultRate * 100)}% zero-result`,
      count: query.totalSearches,
      department: query.entityType,
    }));
    const listingItems = analytics.listingsHighViewsLowFavorites.map((listing) => ({
      id: listing.listingId,
      type: 'Listing conversion',
      priority: listing.favoriteRate <= 0.05 ? 'high' : 'medium',
      title: listing.title || listing.listingId,
      owner: [listing.ownerFirstName, listing.ownerLastName].filter(Boolean).join(' '),
      department: listing.departments?.slice(0, 2).join(', '),
      metric: `${listing.rangeViews} views / ${listing.rangeFavorites} favorites`,
      count: listing.rangeViews,
    }));

    response.status(200).json({
      ...analytics,
      cards: [...searchCards, ...listingItems.slice(0, 4)].slice(0, 6),
      items: listingItems,
    });
  } catch (error) {
    console.error('Error fetching action-needed analytics:', sanitizeLogValue(error));
    handleAnalyticsError(response, error, 'Failed to fetch action-needed analytics');
  }
});

router.get(
  '/users/:netid',
  isAuthenticated,
  isAdmin,
  validateNetid('netid'),
  async (request: Request, response: Response) => {
    try {
      const limit = parseAnalyticsLimit(request.query.limit, 300);
      const analytics = await getUserAnalyticsDrilldown(request.params.netid, { limit });

      if (!analytics) {
        return response.status(404).json({ error: 'User analytics not found' });
      }

      response.status(200).json(analytics);
    } catch (error) {
      console.error('Error fetching user analytics drilldown:', sanitizeLogValue(error));
      handleAnalyticsError(response, error, 'Failed to fetch user analytics');
    }
  },
);

router.get('/debug', isAuthenticated, isAdmin, async (_request: Request, response: Response) => {
  try {
    const events = await AnalyticsEvent.find({
      eventType: { $in: [AnalyticsEventType.LOGIN, AnalyticsEventType.VISITOR] },
    })
      .select('eventType userType timestamp')
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();

    response.status(200).json({ events: events.map(publicAnalyticsDebugEvent) });
  } catch (error) {
    console.error('Error fetching analytics debug events:', sanitizeLogValue(error));
    response.status(500).json({ error: 'Failed to fetch analytics debug events' });
  }
});

export default router;
