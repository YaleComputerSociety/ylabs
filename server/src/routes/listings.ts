/**
 * Legacy authenticated listing reads, outreach, claims, and view tracking.
 * Listing authoring is retired.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { isAuthenticated, validateObjectId } from '../middleware/index';
import * as listingController from '../controllers/listingController';
import * as listingClaimRequestController from '../controllers/listingClaimRequestController';
import { logEvent } from '../services/analyticsService';
import { AnalyticsEventType } from '../models/index';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { logResearchEventOnSuccess } from '../services/researchAnalytics';
import { writeLimit } from '../middleware/rateLimiters';

const router = Router();

function setPrivateListingCacheHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  next();
}

router.use(setPrivateListingCacheHeaders);

const logListingEvent = (eventType: AnalyticsEventType) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send.bind(res);

    res.send = function (data: any) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const currentUser = req.user as { netId?: string; userType: string };
        const listingId = req.params.id;

        if (currentUser?.netId && listingId) {
          logEvent({
            eventType: eventType,
            netid: currentUser.netId,
            userType: currentUser.userType,
            listingId: listingId,
          }).catch((err) =>
            console.error(`Error logging ${eventType} event:`, sanitizeLogValue(err)),
          );
        }
      }

      return originalSend(data);
    };

    next();
  };
};

router.get(
  '/claims/mine',
  isAuthenticated,
  listingClaimRequestController.listMyListingClaimRequests,
);

router.get('/:id', isAuthenticated, validateObjectId('id'), listingController.getListingById);

router.post(
  '/:id/outreach',
  isAuthenticated,
  validateObjectId('id'),
  listingController.recordListingOutreach,
);

router.post(
  '/:id/claim',
  writeLimit,
  isAuthenticated,
  validateObjectId('id'),
  listingClaimRequestController.submitListingClaimRequest,
);

router.put(
  '/:id/addView',
  isAuthenticated,
  validateObjectId('id'),
  logListingEvent(AnalyticsEventType.LISTING_VIEW),
  logResearchEventOnSuccess(AnalyticsEventType.RESEARCH_VIEW, 'listing'),
  listingController.addViewToListing,
);

export default router;
