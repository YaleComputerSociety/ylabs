/**
 * Canonical routes for structured research programs and fellowships.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { isAuthenticated, validateObjectId, validatePagination } from '../middleware/index';
import * as programController from '../controllers/programController';
import { logEvent } from '../services/analyticsService';
import { AnalyticsEventType } from '../models/index';

const router = Router();

function setPrivateProgramCacheHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  next();
}

router.use(setPrivateProgramCacheHeaders);

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

const buildProgramSearchFilters = (query: Request['query']) => ({
  yearOfStudy: parseFilterParam(query.yearOfStudy),
  termOfAward: parseFilterParam(query.termOfAward),
  purpose: parseFilterParam(query.purpose),
  globalRegions: parseFilterParam(query.globalRegions),
  citizenshipStatus: parseFilterParam(query.citizenshipStatus),
  programCategory: parseFilterParam(query.programCategory),
  programKind: parseFilterParam(query.programKind),
  entryMode: parseFilterParam(query.entryMode),
  studentFacingCategory: parseFilterParam(query.studentFacingCategory),
  studentVisibilityTier: parseFilterParam(query.studentVisibilityTier),
});

const hasProgramSearchFilters = (filters: ReturnType<typeof buildProgramSearchFilters>) =>
  filters.yearOfStudy.length > 0 ||
  filters.termOfAward.length > 0 ||
  filters.purpose.length > 0 ||
  filters.globalRegions.length > 0 ||
  filters.citizenshipStatus.length > 0 ||
  filters.programCategory.length > 0 ||
  filters.programKind.length > 0 ||
  filters.entryMode.length > 0 ||
  filters.studentFacingCategory.length > 0 ||
  filters.studentVisibilityTier.length > 0;

const logProgramSearchEvent = async (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json.bind(res);

  res.json = function (data: any) {
    const response = originalJson(data);

    if (res.statusCode >= 200 && res.statusCode < 300) {
      const currentUser = req.user as { netId?: string; userType: string };
      const searchQuery = getStringParam(req.query.query);
      const filters = buildProgramSearchFilters(req.query);

      if (currentUser?.netId && (searchQuery.trim() !== '' || hasProgramSearchFilters(filters))) {
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
            entityType: 'program',
            resultCount,
            totalCount: data?.total,
            filters,
            page: data?.page,
            pageSize: data?.pageSize,
            totalPages: data?.totalPages,
          },
        }).catch((err) => console.error('Error logging program search event:', err));
      }
    }

    return response;
  };

  next();
};

const logProgramEvent = (eventType: AnalyticsEventType) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send.bind(res);

    res.send = function (data: any) {
      const response = originalSend(data);

      if (res.statusCode >= 200 && res.statusCode < 300) {
        const currentUser = req.user as { netId?: string; userType: string };
        const programId = req.params.id;

        if (currentUser?.netId && programId) {
          logEvent({
            eventType,
            netid: currentUser.netId,
            userType: currentUser.userType,
            fellowshipId: programId,
            metadata: {
              entityType: 'program',
              programId,
            },
          }).catch((err: unknown) => console.error(`Error logging ${eventType} event:`, err));
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
  logProgramSearchEvent,
  programController.searchProgramsController,
);

router.get('/filters', isAuthenticated, programController.getProgramFilterOptions);

router.get('/:id', isAuthenticated, validateObjectId('id'), programController.getProgramById);

router.put(
  '/:id/addView',
  isAuthenticated,
  validateObjectId('id'),
  logProgramEvent(AnalyticsEventType.FELLOWSHIP_VIEW),
  programController.addViewToProgram,
);

router.put(
  '/:id/addFavorite',
  isAuthenticated,
  validateObjectId('id'),
  logProgramEvent(AnalyticsEventType.FELLOWSHIP_FAVORITE),
  programController.addFavoriteToProgram,
);

router.put(
  '/:id/removeFavorite',
  isAuthenticated,
  validateObjectId('id'),
  logProgramEvent(AnalyticsEventType.FELLOWSHIP_UNFAVORITE),
  programController.removeFavoriteFromProgram,
);

export default router;
