/**
 * User routes for saved research, watched programs, and the account holder's own data.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { isAuthenticated, validateObjectId, validateResearchEntityId } from '../middleware/index';
import { writeLimit } from '../middleware/rateLimiters';
import * as userController from '../controllers/userController';
import * as accountDataController from '../controllers/accountDataController';
import { issueSessionCsrfToken, requireSessionCsrfToken } from '../middleware/sessionCsrfToken';
import {
  getOwnDirectoryRemovalRequest,
  submitOwnDirectoryRemovalRequest,
} from '../controllers/directoryRemovalRequestController';

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

router.get(
  '/me/export',
  isAuthenticated,
  accountDataController.requireAccountDataControls,
  accountDataController.exportAccountData,
);
router.get(
  '/me/deletion-csrf-token',
  isAuthenticated,
  accountDataController.requireAccountDataControls,
  issueSessionCsrfToken,
);
router.get('/me/csrf-token', isAuthenticated, issueSessionCsrfToken);
router.delete(
  '/me',
  writeLimit,
  isAuthenticated,
  accountDataController.requireAccountDataControls,
  requireSessionCsrfToken,
  accountDataController.deleteOwnAccountData,
);
router.get('/directoryRemovalRequest', isAuthenticated, getOwnDirectoryRemovalRequest);
router.post(
  '/directoryRemovalRequest',
  writeLimit,
  isAuthenticated,
  requireSessionCsrfToken,
  submitOwnDirectoryRemovalRequest,
);

export default router;
