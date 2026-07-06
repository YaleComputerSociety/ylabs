/**
 * Public read-only routes for research discovery.
 */
import { Router } from 'express';
import { asyncHandler, isAuthenticated, validatePagination } from '../middleware/index';
import * as listingController from '../controllers/listingController';

const router = Router();

router.get('/', validatePagination, listingController.searchPublicResearch);
router.get(
  '/:slug/contact',
  isAuthenticated,
  asyncHandler(listingController.getAuthenticatedPublicResearchBySlug),
);
router.post(
  '/:slug/outreach',
  isAuthenticated,
  asyncHandler(listingController.recordPublicResearchOutreach),
);
router.get('/:slug', asyncHandler(listingController.getPublicResearchBySlug));

export default router;
