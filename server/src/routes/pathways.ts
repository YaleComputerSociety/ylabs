/**
 * Public routes for browsing practical ways into Yale research.
 *
 * - POST /search → Mongo-backed pathway search across research entities.
 *
 * The endpoint is read-only and intentionally returns guarded contact-route
 * summaries instead of raw scraped contact data.
 */
import { Router } from 'express';
import * as pathwayController from '../controllers/pathwayController';
import { asyncHandler } from '../middleware/index';

const router = Router();

router.post('/search', asyncHandler(pathwayController.searchPathwayResults));

export default router;
