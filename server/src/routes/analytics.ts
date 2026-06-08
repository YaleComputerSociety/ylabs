/**
 * Express routes for analytics event tracking and dashboard data.
 */
import { Request, Response, Router } from 'express';
import { isAuthenticated, isAdmin } from '../middleware/auth';
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

const router = Router();

function setPrivateAnalyticsCacheHeaders(_request: Request, response: Response, next: () => void) {
  response.setHeader('Cache-Control', 'no-store, private, max-age=0');
  response.setHeader('Pragma', 'no-cache');
  next();
}

router.use(setPrivateAnalyticsCacheHeaders);

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
      now.getMonth() >= 6
        ? new Date(now.getFullYear(), 6, 1)
        : new Date(now.getFullYear(), 0, 1);
    return { start: semesterStart, end: now };
  }

  return { start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), end: now };
};

const handleAnalyticsError = (
  response: Response,
  error: unknown,
  fallbackMessage: string,
) => {
  const message = error instanceof Error ? error.message : '';
  const isValidationFailure = message.startsWith('Invalid');
  response.status(isValidationFailure ? 400 : 500).json({
    error: isValidationFailure ? 'Invalid analytics request' : fallbackMessage,
  });
};

const parseUserAnalyticsSearch = (search: unknown): string | undefined => {
  if (typeof search !== 'string') {
    return undefined;
  }

  if (search.length > MAX_USER_ANALYTICS_SEARCH_LENGTH) {
    throw new Error('Invalid search');
  }

  return search;
};

router.get('/', isAuthenticated, isAdmin, async (request: Request, response: Response) => {
  try {
    const analytics = await getAnalytics();
    response.status(200).json(analytics);
  } catch (error) {
    console.error('Error fetching analytics:', error);
    response.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

router.get('/users', isAuthenticated, isAdmin, async (request: Request, response: Response) => {
  try {
    const { userType, activeSince, search, sort, direction, limit } = request.query;
    const analytics = await getUserAnalytics({
      userType: typeof userType === 'string' ? userType : undefined,
      activeSince: typeof activeSince === 'string' ? activeSince : undefined,
      search: parseUserAnalyticsSearch(search),
      sort: typeof sort === 'string' ? (sort as AnalyticsUserSort) : undefined,
      direction: typeof direction === 'string' ? (direction as AnalyticsSortDirection) : undefined,
      limit: typeof limit === 'string' ? Number(limit) : undefined,
    });

    response.status(200).json(analytics);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const isValidationFailure = message.startsWith('Invalid');
    console.error('Error fetching user analytics:', error);
    response.status(isValidationFailure ? 400 : 500).json({
      error: isValidationFailure ? 'Invalid analytics request' : 'Failed to fetch user analytics',
    });
  }
});

router.get('/search-quality', isAuthenticated, isAdmin, async (request: Request, response: Response) => {
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
            ) / analytics.byQueryAndEntityType.reduce((sum, query) => sum + query.totalSearches, 0)
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
    console.error('Error fetching search quality analytics:', error);
    handleAnalyticsError(response, error, 'Failed to fetch search quality analytics');
  }
});

router.get('/search-queries', isAuthenticated, isAdmin, async (request: Request, response: Response) => {
  try {
    const analytics = await getSearchQueryAnalytics(parseAnalyticsRange(request.query.range), {
      limit: typeof request.query.limit === 'string' ? Number(request.query.limit) : undefined,
    });
    response.status(200).json(analytics);
  } catch (error) {
    console.error('Error fetching search query analytics:', error);
    handleAnalyticsError(response, error, 'Failed to fetch search query analytics');
  }
});

router.get('/funnel', isAuthenticated, isAdmin, async (request: Request, response: Response) => {
  try {
    const analytics = await getFunnelAnalytics(parseAnalyticsRange(request.query.range));
    const viewerCount = analytics.listingViews + analytics.fellowshipViews;
    const stages = [
      { key: 'logins', label: 'Logged In', count: analytics.logins },
      { key: 'searches', label: 'Searched', count: analytics.searches },
      { key: 'views', label: 'Viewed', count: viewerCount },
      { key: 'favorites', label: 'Favorited', count: analytics.favoritesOrSaves },
      { key: 'outreach', label: 'Outreach Clicked', count: analytics.outreachClicks },
      { key: 'outcomes', label: 'Outcome Reported', count: analytics.outreachOutcomes },
    ];

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
      applicantCount: analytics.outreachClicks,
      overallConversionRate: analytics.logins > 0 ? analytics.outreachOutcomes / analytics.logins : 0,
    });
  } catch (error) {
    console.error('Error fetching funnel analytics:', error);
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
    console.error('Error fetching action-needed analytics:', error);
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
      const limit = typeof request.query.limit === 'string' ? Number(request.query.limit) : undefined;
      const analytics = await getUserAnalyticsDrilldown(request.params.netid, { limit });

      if (!analytics) {
        return response.status(404).json({ error: 'User analytics not found' });
      }

      response.status(200).json(analytics);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const isValidationFailure = message.startsWith('Invalid');
      console.error('Error fetching user analytics drilldown:', error);
      response.status(isValidationFailure ? 400 : 500).json({
        error: isValidationFailure ? 'Invalid analytics request' : 'Failed to fetch user analytics',
      });
    }
  },
);

router.get('/debug', isAuthenticated, isAdmin, async (request: Request, response: Response) => {
  const events = await AnalyticsEvent.find({
    eventType: { $in: [AnalyticsEventType.LOGIN, AnalyticsEventType.VISITOR] },
  }).limit(50);
  response.json(events);
});

export default router;
