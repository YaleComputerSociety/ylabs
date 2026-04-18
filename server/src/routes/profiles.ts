/**
 * Express routes for faculty profile viewing and self-editing.
 */
import { Router } from 'express';
import { isAuthenticated, isProfessor } from '../middleware/index';
import {
  getProfile,
  getPublications,
  getProfileListings,
  getProfileCourses,
  updateProfile,
  verifyProfile,
} from '../controllers/profileController';

const router = Router();

router.get('/:netid', isAuthenticated, getProfile);
router.get('/:netid/publications', isAuthenticated, getPublications);
router.get('/:netid/listings', isAuthenticated, getProfileListings);
router.get('/:netid/courses', isAuthenticated, getProfileCourses);

router.put('/me', isAuthenticated, isProfessor, updateProfile);
router.put('/me/verify', isAuthenticated, isProfessor, verifyProfile);

export default router;
