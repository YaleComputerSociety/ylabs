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
 */
import { Router } from 'express';
import * as researchGroupController from '../controllers/researchGroupController';
import * as entityCorrectionReportController from '../controllers/entityCorrectionReportController';
import { asyncHandler, isAuthenticated } from '../middleware/index';
import { writeLimit } from '../middleware/rateLimiters';

const router = Router();

router.post('/search', asyncHandler(researchGroupController.searchResearchGroups));

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
