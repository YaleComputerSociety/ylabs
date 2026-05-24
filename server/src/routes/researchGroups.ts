/**
 * Public routes for browsing ResearchGroups (labs, centers, individual prof pages).
 *
 * - POST /search → Meilisearch-backed hybrid search with filter strings.
 * - GET  /:slug  → Full research-home detail payload with members and access evidence.
 *
 * Both endpoints are public so unauthenticated visitors can explore Yale labs;
 * the global `apiLimiter` in app.ts already provides per-IP rate limiting.
 */
import { Router, Request, Response, NextFunction } from 'express';
import * as researchGroupController from '../controllers/researchGroupController';
import { asyncHandler } from '../middleware/index';
import { logEvent } from '../services/analyticsService';
import { AnalyticsEventType } from '../models/index';

const router = Router();

const hasResearchSearchFilters = (filters: unknown): boolean => {
  if (!filters || typeof filters !== 'object') return false;
  return Object.values(filters as Record<string, unknown>).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== null && value !== false && value !== '';
  });
};

const logResearchSearchEvent = (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json.bind(res);

  res.json = function (data: any) {
    const response = originalJson(data);

    if (res.statusCode >= 200 && res.statusCode < 300) {
      const currentUser = req.user as { netId?: string; userType?: string } | undefined;
      const body = (req.body || {}) as {
        q?: unknown;
        filters?: unknown;
        page?: unknown;
        pageSize?: unknown;
      };
      const searchQuery = typeof body.q === 'string' ? body.q : '';
      const filters = body.filters && typeof body.filters === 'object' ? body.filters : {};

      if (currentUser?.netId && (searchQuery.trim() !== '' || hasResearchSearchFilters(filters))) {
        const resultCount =
          typeof data?.estimatedTotalHits === 'number'
            ? data.estimatedTotalHits
            : Array.isArray(data?.researchEntities)
              ? data.researchEntities.length
              : 0;

        logEvent({
          eventType: AnalyticsEventType.SEARCH,
          netid: currentUser.netId,
          userType: currentUser.userType || 'unknown',
          searchQuery,
          metadata: {
            entityType: 'research',
            resultCount,
            filters,
            page: data?.page ?? body.page,
            pageSize: data?.pageSize ?? body.pageSize,
            estimatedTotalHits: data?.estimatedTotalHits,
          },
        }).catch((err: unknown) => console.error('Error logging research search event:', err));
      }
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

router.get('/suggestions', asyncHandler(researchGroupController.getResearchSearchSuggestions));

router.get('/:slug', asyncHandler(researchGroupController.getResearchGroupBySlug));

export default router;
