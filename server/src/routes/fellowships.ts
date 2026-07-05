/**
 * Express routes for fellowship browsing, search, and CRUD.
 */
import { Router } from 'express';
import { isAuthenticated, validateObjectId, validatePagination } from '../middleware/index';
import * as fellowshipController from '../controllers/fellowshipController';
import { AnalyticsEventType } from '../models/index';
import { logResearchEventOnSuccess } from '../services/researchAnalytics';

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
  logResearchEventOnSuccess(AnalyticsEventType.RESEARCH_VIEW, 'fellowship'),
  fellowshipController.addViewToFellowship,
);

router.put(
  '/:id/addFavorite',
  isAuthenticated,
  validateObjectId('id'),
  logResearchEventOnSuccess(
    AnalyticsEventType.PATHWAY_SAVE,
    'fellowship',
    (req) => req.params.id,
    () => ({ action: 'save' }),
  ),
  fellowshipController.addFavoriteToFellowship,
);

router.put(
  '/:id/removeFavorite',
  isAuthenticated,
  validateObjectId('id'),
  logResearchEventOnSuccess(
    AnalyticsEventType.PATHWAY_SAVE,
    'fellowship',
    (req) => req.params.id,
    () => ({ action: 'unsave' }),
  ),
  fellowshipController.removeFavoriteFromFellowship,
);

export default router;
