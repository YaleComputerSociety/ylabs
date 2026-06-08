/**
 * Authenticated routes for Ways In / pathway search.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import * as pathwayController from '../controllers/pathwayController';
import { asyncHandler, isAuthenticated } from '../middleware/index';

const router = Router();

function setPrivatePathwayCacheHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  next();
}

router.use(setPrivatePathwayCacheHeaders);

router.post('/search', isAuthenticated, asyncHandler(pathwayController.searchPathwaysHandler));

export default router;
