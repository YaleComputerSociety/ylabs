/**
 * Routes for browsing ResearchGroups (labs, centers, individual prof pages).
 *
 * - POST /search → Meilisearch-backed hybrid search with filter strings.
 * - GET  /:slug  → Full research entity detail payload (entity + members + papers).
 *
 * The read paths (search and detail) are
 * public: a logged-out visitor can browse and open any research home, and the
 * controllers only ever serve the public student-visibility tiers because no
 * authenticated principal means no operator authority and no personalization.
 * Write and account paths (correction reports) stay behind
 * `isAuthenticated` so nothing state-changing is reachable anonymously.
 *
 * Search-query telemetry is keyed on an authenticated netid, so an anonymous
 * browse or search records nothing. A search request may declare
 * `suggestionProbe: true` to say the client issued it on the student's behalf
 * rather than the student typing it; such a request records nothing either.
 * Every other search here comes from a deliberate action, so each one is
 * recorded as its own search rather than folded into the one before it.
 */
import { NextFunction, Request, Response, Router } from 'express';
import * as researchGroupController from '../controllers/researchGroupController';
import * as entityCorrectionReportController from '../controllers/entityCorrectionReportController';
import { asyncHandler, isAuthenticated } from '../middleware/index';
import { writeLimit } from '../middleware/rateLimiters';
import {
  recordSiteSearch,
  resolveSiteSearchPage,
  type SiteSearchFilters,
} from '../services/siteSearchAnalytics';
import { sanitizeLogValue } from '../utils/logSanitizer';

const router = Router();

const RECORDED_RESEARCH_SEARCH_FILTERS = [
  'kind',
  'entityType',
  'school',
  'departments',
  'researchAreas',
  'currentAvailability',
  'compensation',
  'eligibleStudentLevels',
] as const;

/**
 * The student-chosen filters only. `studentVisibilityTier` and `qualityFilters`
 * are operator controls, and the controller injects the public tier set on every
 * anonymous request, so counting them would make an ordinary browse load look
 * like a filtered search.
 */
const buildResearchSearchFilters = (body: unknown): SiteSearchFilters => {
  const filters = (body as { filters?: unknown })?.filters;
  if (!filters || typeof filters !== 'object') return {};
  const source = filters as Record<string, unknown>;

  return Object.fromEntries(
    RECORDED_RESEARCH_SEARCH_FILTERS.map((key) => [
      key,
      (Array.isArray(source[key]) ? source[key] : []).filter(
        (value: unknown): value is string => typeof value === 'string' && value.trim() !== '',
      ),
    ]),
  );
};

const logResearchSearchEvent = (req: Request, res: Response, next: NextFunction) => {
  const requestArrivedAt = new Date();
  const originalJson = res.json.bind(res);

  res.json = function (data: any) {
    const response = originalJson(data);

    if (res.statusCode >= 200 && res.statusCode < 300 && data?.depthLimited !== true) {
      const currentUser = req.user as { netId?: string; userType?: string } | undefined;
      const body = (req.body || {}) as {
        q?: unknown;
        page?: unknown;
        suggestionProbe?: unknown;
      };

      recordSiteSearch({
        netid: currentUser?.netId,
        userType: currentUser?.userType,
        surface: 'research_entity',
        searchQuery: typeof body.q === 'string' ? body.q : '',
        filters: buildResearchSearchFilters(req.body),
        resultCount: typeof data?.estimatedTotalHits === 'number' ? data.estimatedTotalHits : 0,
        page: resolveSiteSearchPage(data?.page, body.page),
        suggestionProbe: body.suggestionProbe === true,
        requestArrivedAt,
        metadata: { pageSize: data?.pageSize },
      }).catch((error) =>
        console.error('Error logging research search event:', sanitizeLogValue(error)),
      );
    }

    return response;
  };

  next();
};

router.post(
  '/search',
  logResearchSearchEvent,
  asyncHandler(researchGroupController.searchResearchGroups),
);

router.post(
  '/:slug/report',
  writeLimit,
  isAuthenticated,
  entityCorrectionReportController.submitEntityCorrectionReport,
);

router.get(
  '/:slug/reports/mine',
  isAuthenticated,
  entityCorrectionReportController.listMyEntityCorrectionReports,
);

router.get('/:slug', asyncHandler(researchGroupController.getResearchGroupBySlug));

export default router;
