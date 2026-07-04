/**
 * Express routes for fellowship browsing, search, and CRUD.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { isAuthenticated, validateObjectId, validatePagination } from '../middleware/index';
import * as fellowshipController from '../controllers/fellowshipController';
import { logEvent } from '../services/analyticsService';
import { AnalyticsEventType } from '../models/index';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { logResearchEventOnSuccess } from '../services/researchAnalytics';

const router = Router();

function setPrivateFellowshipCacheHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  next();
}

router.use(setPrivateFellowshipCacheHeaders);

const getStringParam = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return getStringParam(value[0]);
  return '';
};

const parseFilterParam = (value: unknown): string[] =>
  getStringParam(value)
    .split(/[,|]/)
    .map((item) => item.trim())
    .filter(Boolean);

const buildFellowshipSearchFilters = (query: Request['query']) => ({
  yearOfStudy: parseFilterParam(query.yearOfStudy),
  termOfAward: parseFilterParam(query.termOfAward),
  purpose: parseFilterParam(query.purpose),
  globalRegions: parseFilterParam(query.globalRegions),
  citizenshipStatus: parseFilterParam(query.citizenshipStatus),
});

const hasFellowshipSearchFilters = (filters: ReturnType<typeof buildFellowshipSearchFilters>) =>
  filters.yearOfStudy.length > 0 ||
  filters.termOfAward.length > 0 ||
  filters.purpose.length > 0 ||
  filters.globalRegions.length > 0 ||
  filters.citizenshipStatus.length > 0;

const logFellowshipSearchEvent = async (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json.bind(res);

  res.json = function (data: any) {
    const response = originalJson(data);

    if (res.statusCode >= 200 && res.statusCode < 300) {
      const currentUser = req.user as { netId?: string; userType: string };
      const searchQuery = getStringParam(req.query.query);
      const filters = buildFellowshipSearchFilters(req.query);

      if (currentUser?.netId && (searchQuery.trim() !== '' || hasFellowshipSearchFilters(filters))) {
        const resultCount =
          typeof data?.total === 'number'
            ? data.total
            : Array.isArray(data?.results)
              ? data.results.length
              : 0;

        logEvent({
          eventType: AnalyticsEventType.SEARCH,
          netid: currentUser.netId,
          userType: currentUser.userType,
          searchQuery,
          metadata: {
            entityType: 'fellowship',
            resultCount,
            totalCount: data?.total,
            filters,
            page: data?.page,
            pageSize: data?.pageSize,
            totalPages: data?.totalPages,
          },
        }).catch((err) => console.error('Error logging fellowship search event:', sanitizeLogValue(err)));
      }
    }

    return response;
  };

  next();
};

const logFellowshipEvent = (eventType: AnalyticsEventType) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send.bind(res);

    res.send = function (data: any) {
      const response = originalSend(data);

      if (res.statusCode >= 200 && res.statusCode < 300) {
        const currentUser = req.user as { netId?: string; userType: string };
        const fellowshipId = req.params.id;

        if (currentUser?.netId && fellowshipId) {
          logEvent({
            eventType,
            netid: currentUser.netId,
            userType: currentUser.userType,
            fellowshipId,
            metadata: {
              entityType: 'fellowship',
            },
          }).catch((err: unknown) => console.error(`Error logging ${eventType} event:`, sanitizeLogValue(err)));
        }
      }

      return response;
    };

    next();
  };
};

router.get(
  '/search',
  isAuthenticated,
  validatePagination,
  logFellowshipSearchEvent,
  fellowshipController.searchFellowshipsController,
);

router.get('/filters', isAuthenticated, fellowshipController.getFellowshipFilterOptions);

router.get('/:id', isAuthenticated, validateObjectId('id'), fellowshipController.getFellowshipById);

router.put(
  '/:id/addView',
  isAuthenticated,
  validateObjectId('id'),
  logFellowshipEvent(AnalyticsEventType.FELLOWSHIP_VIEW),
  logResearchEventOnSuccess(AnalyticsEventType.RESEARCH_VIEW, 'fellowship'),
  fellowshipController.addViewToFellowship,
);

router.put(
  '/:id/addFavorite',
  isAuthenticated,
  validateObjectId('id'),
  logFellowshipEvent(AnalyticsEventType.FELLOWSHIP_FAVORITE),
  fellowshipController.addFavoriteToFellowship,
);

router.put(
  '/:id/removeFavorite',
  isAuthenticated,
  validateObjectId('id'),
  logFellowshipEvent(AnalyticsEventType.FELLOWSHIP_UNFAVORITE),
  fellowshipController.removeFavoriteFromFellowship,
);

export default router;
