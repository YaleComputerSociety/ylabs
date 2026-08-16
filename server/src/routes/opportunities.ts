/**
 * Authenticated detail routes for source-discovered opportunities.
 *
 * - GET /:id -> detail payload for one non-archived PostedOpportunity.
 * The route is intentionally backed by PostedOpportunity only. Durable
 * exploratory EntryPathway records appear as planning context on Research.
 */
import { Router } from 'express';
import * as opportunityController from '../controllers/opportunityController';
import { asyncHandler, isAuthenticated, validateObjectId } from '../middleware/index';

const router = Router();

router.get(
  '/:id',
  isAuthenticated,
  validateObjectId('id'),
  asyncHandler(opportunityController.getOpportunityById),
);

export default router;
