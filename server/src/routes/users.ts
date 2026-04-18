/**
 * User routes for favorites, fellowships, listings, and profile updates.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { isAuthenticated } from '../middleware/index';
import * as userController from '../controllers/userController';
import { logEvent } from '../services/analyticsService';
import { AnalyticsEventType } from '../models/index';

const router = Router();

const logFavoriteEvent = (isFavorite: boolean) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send.bind(res);

    res.send = function (data: any) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const currentUser = req.user as { netId?: string; userType: string };
        if (currentUser?.netId && req.body.favListings) {
          const listings = Array.isArray(req.body.favListings)
            ? req.body.favListings
            : [req.body.favListings];

          listings.forEach((listingId: string) => {
            logEvent({
              eventType: isFavorite
                ? AnalyticsEventType.LISTING_FAVORITE
                : AnalyticsEventType.LISTING_UNFAVORITE,
              netid: currentUser.netId!,
              userType: currentUser.userType,
              listingId: listingId,
            }).catch((err) => console.error('Error logging favorite event:', err));
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
router.put('/favFellowships', isAuthenticated, userController.addFavFellowships);
router.delete('/favFellowships', isAuthenticated, userController.removeFavFellowships);

router.get('/listings', isAuthenticated, userController.getUserListings);
router.put('/', isAuthenticated, logProfileUpdateEvent, userController.updateCurrentUser);

export default router;
