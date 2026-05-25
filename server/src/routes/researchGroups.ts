/**
 * Public routes for browsing ResearchGroups (labs, centers, individual prof pages).
 *
 * - POST /search → Meilisearch-backed hybrid search with filter strings.
 * - GET  /:slug  → Full lab detail payload (group + members + papers + listings).
 *
 * Both endpoints are public so unauthenticated visitors can explore Yale labs;
 * the global `apiLimiter` in app.ts already provides per-IP rate limiting.
 */
import { Router } from 'express';
import * as researchGroupController from '../controllers/researchGroupController';
import { asyncHandler } from '../middleware/index';

const router = Router();

router.post('/search', asyncHandler(researchGroupController.searchResearchGroups));

router.get('/:slug', asyncHandler(researchGroupController.getResearchGroupBySlug));

export default router;
