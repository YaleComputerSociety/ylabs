/**
 * Express routes for analytics event tracking and dashboard data.
 */
import { Request, Response, Router } from 'express';
import { isAuthenticated, isAdmin } from '../middleware/auth';
import { getAnalytics } from '../services/analyticsService';
import { AnalyticsEvent, AnalyticsEventType } from '../models/analytics';
import {
  emitResearchEvent,
  isResearchEntityType,
  isResearchEventType,
  researchEntityExists,
} from '../services/researchAnalytics';

const router = Router();

router.post('/research', isAuthenticated, async (request: Request, response: Response) => {
  const { eventType, entityType, entityId, payload } = request.body || {};

  if (!isResearchEventType(eventType)) {
    return response.status(400).json({ error: 'Invalid research analytics eventType' });
  }

  if (!isResearchEntityType(entityType)) {
    return response.status(400).json({ error: 'Invalid research analytics entityType' });
  }

  if (typeof entityId !== 'string' || entityId.trim() === '') {
    return response.status(400).json({ error: 'Invalid research analytics entityId' });
  }

  if (!(await researchEntityExists(entityType, entityId))) {
    return response.status(404).json({ error: 'Research analytics entity not found' });
  }

  const emitted = await emitResearchEvent({
    eventType,
    entityType,
    entityId,
    payload,
    user: request.user as { netId?: string; userType?: string },
  });

  if (!emitted) {
    return response.status(400).json({ error: 'Unable to record research analytics event' });
  }

  return response.status(202).json({ ok: true });
});

router.get('/', isAuthenticated, isAdmin, async (request: Request, response: Response) => {
  try {
    const analytics = await getAnalytics();
    response.status(200).json(analytics);
  } catch (error) {
    console.error('Error fetching analytics:', error);
    response.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

router.get('/debug', isAuthenticated, isAdmin, async (request: Request, response: Response) => {
  const events = await AnalyticsEvent.find({
    eventType: { $in: [AnalyticsEventType.LOGIN, AnalyticsEventType.VISITOR] },
  }).limit(50);
  response.json(events);
});

export default router;
