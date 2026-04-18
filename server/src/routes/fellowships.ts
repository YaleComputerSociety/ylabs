/**
 * Express routes for fellowship browsing, search, and CRUD.
 */
import { Router } from 'express';
import { isAuthenticated, validateObjectId, validatePagination } from '../middleware/index';
import * as fellowshipController from '../controllers/fellowshipController';

const router = Router();

router.get(
  '/search',
  isAuthenticated,
  validatePagination,
  fellowshipController.searchFellowshipsController,
);

router.get('/filters', isAuthenticated, fellowshipController.getFellowshipFilterOptions);

router.get('/:id', isAuthenticated, validateObjectId('id'), fellowshipController.getFellowshipById);

router.put(
  '/:id/addView',
  isAuthenticated,
  validateObjectId('id'),
  fellowshipController.addViewToFellowship,
);

router.put(
  '/:id/addFavorite',
  isAuthenticated,
  validateObjectId('id'),
  fellowshipController.addFavoriteToFellowship,
);

router.put(
  '/:id/removeFavorite',
  isAuthenticated,
  validateObjectId('id'),
  fellowshipController.removeFavoriteFromFellowship,
);

export default router;
