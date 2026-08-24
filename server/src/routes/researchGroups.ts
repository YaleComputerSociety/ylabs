/**
 * Routes for browsing ResearchGroups (labs, centers, individual prof pages).
 *
 * - POST /search → Meilisearch-backed hybrid search with filter strings.
 * - GET  /:slug  → Full lab detail payload (group + members + papers + listings).
 *
 * The read paths (search, related-programs, detail, and researcher profile) are
 * public: a logged-out visitor can browse and open any research home, and the
 * controllers only ever serve the public student-visibility tiers because no
 * authenticated principal means no operator authority and no personalization.
 * Write and account paths (outreach, correction reports) stay behind
 * `isAuthenticated` so nothing state-changing is reachable anonymously.
 */
import { Router } from 'express';
import * as researchGroupController from '../controllers/researchGroupController';
import * as entityCorrectionReportController from '../controllers/entityCorrectionReportController';
import { asyncHandler, isAuthenticated } from '../middleware/index';
import { writeLimit } from '../middleware/rateLimiters';

const router = Router();

router.post('/search', asyncHandler(researchGroupController.searchResearchGroups));

router.post('/related-programs', asyncHandler(researchGroupController.searchRelatedPrograms));

router.post('/people/search', asyncHandler(researchGroupController.searchResearchers));

router.post(
  '/:slug/outreach',
  writeLimit,
  isAuthenticated,
  asyncHandler(researchGroupController.recordResearchOutreach),
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

router.get('/person/:publicKey', asyncHandler(researchGroupController.getResearcherProfile));

router.get(
  '/department/:slug',
  isAuthenticated,
  asyncHandler(researchGroupController.getResearchDepartmentPage),
);

router.get(
  '/area/:slug',
  isAuthenticated,
  asyncHandler(researchGroupController.getResearchAreaPage),
);

router.get(
  '/field/:slug',
  isAuthenticated,
  asyncHandler(researchGroupController.getResearchFieldPage),
);

router.get(
  '/school/:slug',
  isAuthenticated,
  asyncHandler(researchGroupController.getResearchSchoolPage),
);

router.get('/:slug', asyncHandler(researchGroupController.getResearchGroupBySlug));

export default router;
