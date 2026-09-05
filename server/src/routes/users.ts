/**
 * User routes for favorites, fellowships, and profile updates.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { isAuthenticated, validateObjectId, validateResearchEntityId } from '../middleware/index';
import { writeLimit } from '../middleware/rateLimiters';
import * as userController from '../controllers/userController';

const router = Router();

function setPrivateUserCacheHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

router.use(setPrivateUserCacheHeaders);

router.get('/watchedProgramIds', isAuthenticated, userController.getWatchedProgramIds);
router.get('/watchedPrograms', isAuthenticated, userController.getWatchedPrograms);
router.put('/watchedPrograms', writeLimit, isAuthenticated, userController.addWatchedPrograms);
router.delete(
  '/watchedPrograms',
  writeLimit,
  isAuthenticated,
  userController.removeWatchedPrograms,
);
router.get('/watchedProgramPlans', isAuthenticated, userController.getWatchedProgramPlans);
router.put(
  '/watchedProgramPlans/:programId',
  writeLimit,
  isAuthenticated,
  validateObjectId('programId'),
  userController.updateWatchedProgramPlan,
);

router.get('/savedResearchEntityIds', isAuthenticated, userController.getSavedResearchEntityIds);
router.get('/savedResearchEntities', isAuthenticated, userController.getSavedResearchEntities);
router.put(
  '/savedResearchEntities',
  writeLimit,
  isAuthenticated,
  userController.addSavedResearchEntities,
);
router.delete(
  '/savedResearchEntities',
  writeLimit,
  isAuthenticated,
  userController.removeSavedResearchEntities,
);
router.get(
  '/savedResearchEntityPlans',
  isAuthenticated,
  userController.getSavedResearchEntityPlans,
);
router.put(
  '/savedResearchEntityPlans/:entityId',
  writeLimit,
  isAuthenticated,
  validateResearchEntityId('entityId'),
  userController.updateSavedResearchEntityPlan,
);

export default router;
