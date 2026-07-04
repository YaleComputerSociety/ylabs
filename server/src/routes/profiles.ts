/**
 * Express routes for faculty profile viewing and self-editing.
 */
import { Router } from 'express';
import { isAuthenticated, isProfessor, validateNetid } from '../middleware/index';
import {
  getProfile,
  getPublications,
  getProfileListings,
  getProfileCourses,
  updateProfile,
  verifyProfile,
} from '../controllers/profileController';
import { AnalyticsEventType } from '../models/index';
import { logResearchEventOnSuccess } from '../services/researchAnalytics';

const router = Router();

router.get(
  '/:netid',
  isAuthenticated,
  validateNetid('netid'),
  logResearchEventOnSuccess(AnalyticsEventType.RESEARCH_VIEW, 'profile', (req) => req.params.netid),
  getProfile,
);
router.get('/:netid/publications', isAuthenticated, getPublications);
router.get('/:netid/listings', isAuthenticated, getProfileListings);
router.get('/:netid/courses', isAuthenticated, getProfileCourses);

router.put('/me', isAuthenticated, isProfessor, updateProfile);
router.put('/me/verify', isAuthenticated, isProfessor, verifyProfile);

export default router;
