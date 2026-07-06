/**
 * Public routes for real posted opportunity detail pages.
 *
 * - GET /:id -> detail payload for one non-archived PostedOpportunity.
 *
 * The route is intentionally backed by PostedOpportunity only. Durable
 * exploratory EntryPathway records belong on the Pathways surface.
 */
import { Router, Request, Response, NextFunction } from 'express';
import * as opportunityController from '../controllers/opportunityController';
import { asyncHandler, validateObjectId } from '../middleware/index';

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

router.get(
  '/:id',
  setPublicDetailCacheHeaders,
  validateObjectId('id'),
  asyncHandler(opportunityController.getOpportunityById),
);

export default router;
