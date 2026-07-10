/**
 * Public routes for browsing ResearchGroups (labs, centers, individual prof pages).
 *
 * - POST /search → Meilisearch-backed hybrid search with filter strings.
 * - GET  /:slug  → Full lab detail payload (group + members + papers + listings).
 *
 * Both endpoints are public so unauthenticated visitors can explore Yale labs;
 * `publicDiscoveryLimiter` in app.ts provides per-IP rate limiting.
 */
import { Router, Request, Response, NextFunction } from 'express';
import * as researchGroupController from '../controllers/researchGroupController';
import { asyncHandler, isAuthenticated } from '../middleware/index';

const router = Router();

// Detail payloads are identical for every viewer, so allow brief caching
// (same pattern as GET /api/config) instead of the global /api no-store.
function setPublicDetailCacheHeaders(_req: Request, res: Response, next: NextFunction) {
  res.set('Cache-Control', 'public, max-age=60');
  res.removeHeader('Pragma');
  res.removeHeader('Surrogate-Control');
  res.vary('Origin');
  next();
}

router.post('/search', asyncHandler(researchGroupController.searchResearchGroups));

router.post(
  '/:slug/outreach',
  isAuthenticated,
  asyncHandler(researchGroupController.recordResearchOutreach),
);

router.get(
  '/:slug',
  setPublicDetailCacheHeaders,
  asyncHandler(researchGroupController.getResearchGroupBySlug),
);

export default router;
