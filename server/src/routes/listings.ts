/**
 * Express routes for listing browsing, search, and CRUD.
 */
import { Router, Request, Response, NextFunction } from 'express';
import {
  isAuthenticated,
  canSubmitListingClaimRequest,
  canCreateListing,
  validateObjectId,
  validatePagination,
} from '../middleware/index';
import * as listingController from '../controllers/listingController';
import * as listingClaimRequestController from '../controllers/listingClaimRequestController';
import { logEvent } from '../services/analyticsService';
import { AnalyticsEventType } from '../models/index';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { logResearchEventOnSuccess } from '../services/researchAnalytics';

const router = Router();

function setPrivateListingCacheHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  next();
}

router.use(setPrivateListingCacheHeaders);

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

const buildListingSearchFilters = (query: Request['query']) => ({
  departments: parseFilterParam(query.departments),
  academicDisciplines: parseFilterParam(query.academicDisciplines),
  researchAreas: parseFilterParam(query.researchAreas),
  departmentsMode: getStringParam(query.departmentsMode) || 'union',
  academicDisciplinesMode: getStringParam(query.academicDisciplinesMode) || 'union',
  researchAreasMode: getStringParam(query.researchAreasMode) || 'union',
});

const hasListingSearchFilters = (filters: ReturnType<typeof buildListingSearchFilters>) =>
  filters.departments.length > 0 ||
  filters.academicDisciplines.length > 0 ||
  filters.researchAreas.length > 0;

const logSearchEvent = async (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json.bind(res);

  res.json = function (data: any) {
    const response = originalJson(data);

    if (res.statusCode >= 200 && res.statusCode < 300) {
      const currentUser = req.user as { netId?: string; userType: string };
      const searchQuery = getStringParam(req.query.query);
      const filters = buildListingSearchFilters(req.query);

      if (currentUser?.netId && (searchQuery.trim() !== '' || hasListingSearchFilters(filters))) {
        const resultCount =
          typeof data?.totalCount === 'number'
            ? data.totalCount
            : Array.isArray(data?.results)
              ? data.results.length
              : 0;

        logEvent({
          eventType: AnalyticsEventType.SEARCH,
          netid: currentUser.netId,
          userType: currentUser.userType,
          searchQuery,
          searchDepartments: filters.departments,
          metadata: {
            entityType: 'listing',
            resultCount,
            totalCount: data?.totalCount,
            filters,
            page: data?.page,
            pageSize: data?.pageSize,
          },
        }).catch((err) => console.error('Error logging search event:', sanitizeLogValue(err)));
      }
    }

    return response;
  };

  next();
};

const logListingEvent = (eventType: AnalyticsEventType) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send.bind(res);

    res.send = function (data: any) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const currentUser = req.user as { netId?: string; userType: string };
        const listingId = req.params.id;

        if (currentUser?.netId && listingId) {
          logEvent({
            eventType: eventType,
            netid: currentUser.netId,
            userType: currentUser.userType,
            listingId: listingId,
          }).catch((err) => console.error(`Error logging ${eventType} event:`, sanitizeLogValue(err)));
        }
      }

      return originalSend(data);
    };

    next();
  };
};

const logListingCreateEvent = async (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json.bind(res);

  res.json = function (data: any) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const currentUser = req.user as { netId?: string; userType: string };

      if (currentUser?.netId && data?.listing?._id) {
        logEvent({
          eventType: AnalyticsEventType.LISTING_CREATE,
          netid: currentUser.netId,
          userType: currentUser.userType,
          listingId: data.listing._id,
        }).catch((err) => console.error('Error logging listing create event:', sanitizeLogValue(err)));
      }
    }

    return originalJson(data);
  };

  next();
};

router.get(
  '/search',
  isAuthenticated,
  validatePagination,
  logSearchEvent,
  listingController.searchListings,
);

router.post(
  '/',
  isAuthenticated,
  canCreateListing,
  logListingCreateEvent,
  listingController.createListingForCurrentUser,
);

router.get('/:id', isAuthenticated, validateObjectId('id'), listingController.getListingById);

router.post(
  '/:id/outreach',
  isAuthenticated,
  validateObjectId('id'),
  listingController.recordListingOutreach,
);

router.post(
  '/:id/claim',
  isAuthenticated,
  canSubmitListingClaimRequest,
  validateObjectId('id'),
  listingClaimRequestController.submitListingClaimRequest,
);

router.put(
  '/:id',
  isAuthenticated,
  validateObjectId('id'),
  logListingEvent(AnalyticsEventType.LISTING_UPDATE),
  listingController.updateListingForCurrentUser,
);

router.put(
  '/:id/archive',
  isAuthenticated,
  validateObjectId('id'),
  logListingEvent(AnalyticsEventType.LISTING_ARCHIVE),
  listingController.archiveListingForCurrentUser,
);

router.put(
  '/:id/unarchive',
  isAuthenticated,
  validateObjectId('id'),
  logListingEvent(AnalyticsEventType.LISTING_UNARCHIVE),
  listingController.unarchiveListingForCurrentUser,
);

router.put(
  '/:id/addView',
  isAuthenticated,
  validateObjectId('id'),
  logListingEvent(AnalyticsEventType.LISTING_VIEW),
  logResearchEventOnSuccess(AnalyticsEventType.RESEARCH_VIEW, 'listing'),
  listingController.addViewToListing,
);

router.delete(
  '/:id',
  isAuthenticated,
  validateObjectId('id'),
  listingController.deleteListingForCurrentUser,
);

export default router;
