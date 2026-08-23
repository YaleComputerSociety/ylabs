/**
 * Express routes for public faculty profile viewing.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { isAuthenticated, validateNetid } from '../middleware/index';
import {
  canViewProfile,
  getProfile,
  getProfileListings,
  getProfileCourses,
} from '../controllers/profileController';
import { AnalyticsEventType } from '../models/index';
import { logResearchEventOnSuccess } from '../services/researchAnalytics';

const router = Router();

function setPrivateProfileCacheHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

router.use(setPrivateProfileCacheHeaders);

router.get(
  '/:netid',
  isAuthenticated,
  validateNetid('netid'),
  canViewProfile,
  logResearchEventOnSuccess(AnalyticsEventType.RESEARCH_VIEW, 'profile', (req) => req.params.netid),
  getProfile,
);
router.get(
  '/:netid/listings',
  isAuthenticated,
  validateNetid('netid'),
  canViewProfile,
  getProfileListings,
);
router.get(
  '/:netid/courses',
  isAuthenticated,
  validateNetid('netid'),
  canViewProfile,
  getProfileCourses,
);

export default router;
