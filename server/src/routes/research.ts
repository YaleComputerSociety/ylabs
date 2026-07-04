/**
 * Public read-only routes for research discovery.
 */
import { Router } from 'express';
import { validatePagination } from '../middleware/index';
import * as listingController from '../controllers/listingController';

const router = Router();

router.get('/', validatePagination, listingController.searchPublicResearch);
router.get('/:slug', listingController.getPublicResearchBySlug);

export default router;
