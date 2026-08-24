/**
 * Authenticated routes for browsing ResearchGroups (labs, centers, individual prof pages).
 *
 * - POST /search → Meilisearch-backed hybrid search with filter strings.
 * - GET  /:slug  → Full lab detail payload (group + members + papers + listings).
 *
 * Every endpoint requires a Yale CAS session; there is no anonymous browsing.
 */
import { Router } from 'express';
import * as researchGroupController from '../controllers/researchGroupController';
import { asyncHandler, isAuthenticated } from '../middleware/index';
import { writeLimit } from '../middleware/rateLimiters';

const router = Router();

router.post('/search', isAuthenticated, asyncHandler(researchGroupController.searchResearchGroups));

router.post(
  '/related-programs',
  isAuthenticated,
  asyncHandler(researchGroupController.searchRelatedPrograms),
);

router.post(
  '/:slug/outreach',
  writeLimit,
  isAuthenticated,
  asyncHandler(researchGroupController.recordResearchOutreach),
);

router.get(
  '/:slug',
  isAuthenticated,
  asyncHandler(researchGroupController.getResearchGroupBySlug),
);

export default router;
