/**
 * User routes for favorites, fellowships, listings, and profile updates.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { isAuthenticated } from '../middleware/index';
import * as userController from '../controllers/userController';
import { logEvent } from '../services/analyticsService';
import { AnalyticsEventType } from '../models/index';
import { emitResearchEvent } from '../services/researchAnalytics';

const router = Router();

const logFavoriteEvent = (isFavorite: boolean) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send.bind(res);

    res.send = function (data: any) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const currentUser = req.user as { netId?: string; userType: string };
        const favListings = req.body?.data?.favListings ?? req.body?.favListings;
        if (currentUser?.netId && favListings) {
          const listings = Array.isArray(favListings) ? favListings : [favListings];

          listings.forEach((listingId: string) => {
            logEvent({
              eventType: isFavorite
                ? AnalyticsEventType.LISTING_FAVORITE
                : AnalyticsEventType.LISTING_UNFAVORITE,
              netid: currentUser.netId!,
              userType: currentUser.userType,
              listingId: listingId,
            }).catch((err) => console.error('Error logging favorite event:', err));
            emitResearchEvent({
              eventType: AnalyticsEventType.PATHWAY_SAVE,
              entityType: 'listing',
              entityId: listingId,
              user: currentUser,
              payload: { action: isFavorite ? 'save' : 'unsave' },
            }).catch((err) => console.error('Error logging pathway save event:', err));
          });
        }
      }

      return originalSend(data);
    };

    next();
  };
};

const logFellowshipFavoriteEvent = (isFavorite: boolean) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send.bind(res);

    res.send = function (data: any) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const currentUser = req.user as { netId?: string; userType: string };
        const favFellowships = req.body?.data?.favFellowships ?? req.body?.favFellowships;
        if (currentUser?.netId && favFellowships) {
          const fellowships = Array.isArray(favFellowships) ? favFellowships : [favFellowships];

          fellowships.forEach((fellowshipId: string) => {
            emitResearchEvent({
              eventType: AnalyticsEventType.PATHWAY_SAVE,
              entityType: 'fellowship',
              entityId: fellowshipId,
              user: currentUser,
              payload: { action: isFavorite ? 'save' : 'unsave' },
            }).catch((err) => console.error('Error logging fellowship pathway save event:', err));
          });
        }
      }

      return originalSend(data);
    };

    next();
  };
};

const logProfileUpdateEvent = async (req: Request, res: Response, next: NextFunction) => {
  const originalSend = res.send.bind(res);

  res.send = function (data: any) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const currentUser = req.user as { netId?: string; userType: string };
      if (currentUser?.netId && req.body && Object.keys(req.body).length > 0) {
        logEvent({
          eventType: AnalyticsEventType.PROFILE_UPDATE,
          netid: currentUser.netId,
          userType: currentUser.userType,
          metadata: {
            fields: Object.keys(req.body),
          },
        }).catch((err) => console.error('Error logging profile update event:', err));
      }
    }

    return originalSend(data);
  };

  next();
};

router.get('/favListingsIds', isAuthenticated, userController.getFavListingsIds);
router.put('/favListings', isAuthenticated, logFavoriteEvent(true), userController.addFavListings);
router.delete(
  '/favListings',
  isAuthenticated,
  logFavoriteEvent(false),
  userController.removeFavListings,
);

router.get('/favFellowshipIds', isAuthenticated, userController.getFavFellowshipIds);
router.get('/favFellowships', isAuthenticated, userController.getFavFellowships);
router.put(
  '/favFellowships',
  isAuthenticated,
  logFellowshipFavoriteEvent(true),
  userController.addFavFellowships,
);
router.delete(
  '/favFellowships',
  isAuthenticated,
  logFellowshipFavoriteEvent(false),
  userController.removeFavFellowships,
);

router.get('/listings', isAuthenticated, userController.getUserListings);
router.put('/', isAuthenticated, logProfileUpdateEvent, userController.updateCurrentUser);

export default router;
