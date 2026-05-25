/**
 * Public routes for real posted opportunity detail pages.
 *
 * - GET /:id -> detail payload for one non-archived PostedOpportunity.
 *
 * The route is intentionally backed by PostedOpportunity only. Durable
 * exploratory EntryPathway records belong on the Pathways surface.
 */
import { Router } from 'express';
import * as opportunityController from '../controllers/opportunityController';
import { asyncHandler } from '../middleware/index';

const router = Router();

router.get('/:id', asyncHandler(opportunityController.getOpportunityById));

export default router;
