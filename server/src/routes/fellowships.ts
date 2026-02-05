import { Router } from "express";
import { isAuthenticated, validateObjectId, validatePagination } from '../middleware';
import * as fellowshipController from '../controllers/fellowshipController';

const router = Router();

// Search fellowships
router.get('/search', isAuthenticated, validatePagination, fellowshipController.searchFellowshipsController);

// Get filter options for dropdowns
router.get('/filters', isAuthenticated, fellowshipController.getFellowshipFilterOptions);

// Get specific fellowship by ID
router.get('/:id', isAuthenticated, validateObjectId('id'), fellowshipController.getFellowshipById);

// Add view to fellowship
router.put('/:id/addView', isAuthenticated, validateObjectId('id'), fellowshipController.addViewToFellowship);

// Add favorite to fellowship
router.put('/:id/addFavorite', isAuthenticated, validateObjectId('id'), fellowshipController.addFavoriteToFellowship);

// Remove favorite from fellowship
router.put('/:id/removeFavorite', isAuthenticated, validateObjectId('id'), fellowshipController.removeFavoriteFromFellowship);

export default router;
