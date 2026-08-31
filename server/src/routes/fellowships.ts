/**
 * Express routes for fellowship view telemetry, a legacy compatibility surface.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { isAuthenticated, validateObjectId } from '../middleware/index';
import * as fellowshipController from '../controllers/fellowshipController';
import { logEvent } from '../services/analyticsService';
import { AnalyticsEventType } from '../models/index';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { logResearchEventOnSuccess } from '../services/researchAnalytics';

const router = Router();

function setPrivateFellowshipCacheHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  next();
}

router.use(setPrivateFellowshipCacheHeaders);

const logFellowshipEvent = (eventType: AnalyticsEventType) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send.bind(res);

    res.send = function (data: any) {
      const response = originalSend(data);

      if (res.statusCode >= 200 && res.statusCode < 300) {
        const currentUser = req.user as { netId?: string; userType: string };
        const fellowshipId = req.params.id;

        if (currentUser?.netId && fellowshipId) {
          logEvent({
            eventType,
            netid: currentUser.netId,
            userType: currentUser.userType,
            fellowshipId,
            metadata: {
              entityType: 'fellowship',
            },
          }).catch((err: unknown) =>
            console.error(`Error logging ${eventType} event:`, sanitizeLogValue(err)),
          );
        }
      }

      return response;
    };

    next();
  };
};

router.put(
  '/:id/addView',
  isAuthenticated,
  validateObjectId('id'),
  logFellowshipEvent(AnalyticsEventType.FELLOWSHIP_VIEW),
  logResearchEventOnSuccess(AnalyticsEventType.RESEARCH_VIEW, 'fellowship'),
  fellowshipController.addViewToFellowship,
);

export default router;
