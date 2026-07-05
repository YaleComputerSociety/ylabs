/**
 * Public read-only routes for research discovery.
 */
import { NextFunction, Request, Response, Router } from 'express';
import {
  asyncHandler,
  isAuthenticated,
  validatePagination,
  validateQuery,
  validateSort,
} from '../middleware/index';
import * as listingController from '../controllers/listingController';

const router = Router();

const PUBLIC_RESEARCH_QUERY_PARAMS = [
  'query',
  'page',
  'pageSize',
  'sortBy',
  'sortOrder',
  'departments',
  'academicDisciplines',
  'researchAreas',
  'departmentsMode',
  'academicDisciplinesMode',
  'researchAreasMode',
];

const validatePublicResearchFilterModes = (req: Request, res: Response, next: NextFunction) => {
  const modeParams = ['departmentsMode', 'academicDisciplinesMode', 'researchAreasMode'];
  const invalidMode = modeParams.find((param) => {
    const value = req.query[param];
    return value !== undefined && value !== 'union' && value !== 'intersection';
  });

  if (invalidMode) {
    return res.status(400).json({
      error: `${invalidMode} must be "union" or "intersection"`,
    });
  }

  next();
};

router.get(
  '/',
  validateQuery(PUBLIC_RESEARCH_QUERY_PARAMS),
  validatePagination,
  validateSort(['createdAt', 'updatedAt']),
  validatePublicResearchFilterModes,
  listingController.searchPublicResearch,
);
router.get(
  '/:slug/contact',
  isAuthenticated,
  asyncHandler(listingController.getAuthenticatedPublicResearchBySlug),
);
router.get('/:slug', asyncHandler(listingController.getPublicResearchBySlug));

export default router;
