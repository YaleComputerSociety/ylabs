/**
 * User routes for favorites, fellowships, listings, and profile updates.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { isAuthenticated, validateObjectId, validateResearchEntityId } from '../middleware/index';
import { writeLimit } from '../middleware/rateLimiters';
import * as userController from '../controllers/userController';
import { logEvent } from '../services/analyticsService';
import { AnalyticsEventType } from '../models/index';
import { sanitizeLogValue } from '../utils/logSanitizer';

const router = Router();
const PROFILE_UPDATE_ANALYTICS_FIELD_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_PROFILE_UPDATE_ANALYTICS_FIELDS = 50;

function setPrivateUserCacheHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

router.use(setPrivateUserCacheHeaders);

const profileUpdateAnalyticsFields = (value: unknown): string[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];

  const fields: string[] = [];
  const seen = new Set<string>();
  const source = value as Record<string, unknown>;

  for (const key in source) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const field = key.trim();
    if (!PROFILE_UPDATE_ANALYTICS_FIELD_RE.test(field) || seen.has(field)) continue;
    seen.add(field);
    fields.push(field);
    if (fields.length >= MAX_PROFILE_UPDATE_ANALYTICS_FIELDS) break;
  }

  return fields;
};

const logProfileUpdateEvent = async (req: Request, res: Response, next: NextFunction) => {
  const originalSend = res.send.bind(res);

  res.send = function (data: any) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const currentUser = req.user as { netId?: string; userType: string };
      const fields = profileUpdateAnalyticsFields(req.body);
      if (currentUser?.netId && fields.length > 0) {
        logEvent({
          eventType: AnalyticsEventType.PROFILE_UPDATE,
          netid: currentUser.netId,
          userType: currentUser.userType,
          metadata: {
            fields,
          },
        }).catch((err) =>
          console.error('Error logging profile update event:', sanitizeLogValue(err)),
        );
      }
    }

    return originalSend(data);
  };

  next();
};

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
router.delete(
  '/watchedProgramPlans/:programId',
  writeLimit,
  isAuthenticated,
  validateObjectId('programId'),
  userController.deleteWatchedProgramPlan,
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
router.get(
  '/savedResearchEntityPlans/export',
  isAuthenticated,
  userController.exportSavedResearchEntities,
);
router.post(
  '/savedResearchEntityPlans/export',
  isAuthenticated,
  userController.exportSavedResearchEntities,
);
router.put(
  '/savedResearchEntityPlans/:entityId',
  writeLimit,
  isAuthenticated,
  validateResearchEntityId('entityId'),
  userController.updateSavedResearchEntityPlan,
);
router.delete(
  '/savedResearchEntityPlans/:entityId',
  writeLimit,
  isAuthenticated,
  validateResearchEntityId('entityId'),
  userController.deleteSavedResearchEntityPlan,
);
router.put(
  '/',
  writeLimit,
  isAuthenticated,
  logProfileUpdateEvent,
  userController.updateCurrentUser,
);

export default router;
