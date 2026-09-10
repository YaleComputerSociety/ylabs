/**
 * Canonical routes for structured research programs and fellowships.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { isAuthenticated, validateObjectId, validatePagination } from '../middleware/index';
import * as programController from '../controllers/programController';
import { recordSiteSearch } from '../services/siteSearchAnalytics';
import { sanitizeLogValue } from '../utils/logSanitizer';

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

/**
 * The student-chosen filters only. `studentVisibilityTier` is an operator
 * control, so counting it would put an admin sweeping the suppressed tier into
 * the student search-query report as a titled filter-only search.
 */
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
  subjects: parseFilterParam(query.subjects),
});

/**
 * Reads the page from the response, falling back to the request.
 *
 * Reporting page 1 for a later page would record the same search again for every
 * page of the walk, so an unreadable page number has to resolve to the requested
 * one rather than to the default.
 */
const requestedProgramSearchPage = (req: Request, data: any): number => {
  if (typeof data?.page === 'number' && Number.isFinite(data.page)) return data.page;
  const requested = Number.parseInt(getStringParam(req.query.page), 10);
  return Number.isFinite(requested) && requested > 0 ? requested : 1;
};

const logProgramSearchEvent = async (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json.bind(res);

  res.json = function (data: any) {
    const response = originalJson(data);

    if (res.statusCode >= 200 && res.statusCode < 300) {
      const currentUser = req.user as { netId?: string; userType: string };
      const resultCount =
        typeof data?.total === 'number'
          ? data.total
          : Array.isArray(data?.results)
            ? data.results.length
            : 0;

      recordSiteSearch({
        netid: currentUser?.netId,
        userType: currentUser?.userType,
        surface: 'program',
        searchQuery: getStringParam(req.query.query),
        filters: buildProgramSearchFilters(req.query),
        resultCount,
        page: requestedProgramSearchPage(req, data),
        metadata: {
          totalCount: data?.total,
          pageSize: data?.pageSize,
          totalPages: data?.totalPages,
        },
      }).catch((err) =>
        console.error('Error logging program search event:', sanitizeLogValue(err)),
      );
    }

    return response;
  };

  next();
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

export default router;
