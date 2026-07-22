/**
 * Public detail and private faculty-authoring routes for real opportunities.
 *
 * - GET /:id -> detail payload for one non-archived PostedOpportunity.
 * - /mine, /preview, and mutation routes -> verified faculty-owned records.
 *
 * The route is intentionally backed by PostedOpportunity only. Durable
 * exploratory EntryPathway records appear as planning context on Research.
 */
import { Router, Request, Response, NextFunction } from 'express';
import * as opportunityController from '../controllers/opportunityController';
import {
  asyncHandler,
  canManagePostedOpportunities,
  isAuthenticated,
  requireBody,
  validateObjectId,
} from '../middleware/index';

const router = Router();

const facultyWriteGuards = [isAuthenticated, canManagePostedOpportunities];

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
  '/mine',
  ...facultyWriteGuards,
  asyncHandler(opportunityController.listMyFacultyOpportunities),
);

router.get(
  '/mine/research-entities',
  ...facultyWriteGuards,
  asyncHandler(opportunityController.listMyOwnedResearchEntities),
);

router.post(
  '/preview',
  ...facultyWriteGuards,
  requireBody,
  asyncHandler(opportunityController.previewMyFacultyOpportunity),
);

router.post(
  '/',
  ...facultyWriteGuards,
  requireBody,
  asyncHandler(opportunityController.createMyFacultyOpportunity),
);

router.put(
  '/:id',
  ...facultyWriteGuards,
  validateObjectId('id'),
  requireBody,
  asyncHandler(opportunityController.updateMyFacultyOpportunity),
);

router.post(
  '/:id/submit',
  ...facultyWriteGuards,
  validateObjectId('id'),
  requireBody,
  asyncHandler(opportunityController.submitMyFacultyOpportunity),
);

router.post(
  '/:id/close',
  ...facultyWriteGuards,
  validateObjectId('id'),
  requireBody,
  asyncHandler(opportunityController.closeMyFacultyOpportunity),
);

router.post(
  '/:id/archive',
  ...facultyWriteGuards,
  validateObjectId('id'),
  requireBody,
  asyncHandler(opportunityController.archiveMyFacultyOpportunity),
);

router.get(
  '/:id',
  setPublicDetailCacheHeaders,
  validateObjectId('id'),
  asyncHandler(opportunityController.getOpportunityById),
);

export default router;
