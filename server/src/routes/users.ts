/**
 * User routes for favorites, fellowships, listings, and profile updates.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { isAuthenticated } from '../middleware/index';
import * as userController from '../controllers/userController';
import { logEvent } from '../services/analyticsService';
import { AnalyticsEventType } from '../models/index';

const router = Router();

const getFavoriteIds = (req: Request, key: string): string[] => {
  const value = req.body?.data?.[key] ?? req.body?.[key];
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

const logFavoriteEvent = (
  isFavorite: boolean,
  kind: 'listing' | 'fellowship' = 'listing',
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send.bind(res);

    res.send = function (data: any) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const currentUser = req.user as { netId?: string; userType: string };
        const ids = getFavoriteIds(req, kind === 'listing' ? 'favListings' : 'favFellowships');

        if (currentUser?.netId && ids.length > 0) {
          ids.forEach((itemId: string) => {
            logEvent({
              eventType:
                kind === 'listing'
                  ? isFavorite
                    ? AnalyticsEventType.LISTING_FAVORITE
                    : AnalyticsEventType.LISTING_UNFAVORITE
                  : isFavorite
                    ? AnalyticsEventType.FELLOWSHIP_FAVORITE
                    : AnalyticsEventType.FELLOWSHIP_UNFAVORITE,
              netid: currentUser.netId!,
              userType: currentUser.userType,
              listingId: kind === 'listing' ? itemId : undefined,
              fellowshipId: kind === 'fellowship' ? itemId : undefined,
              metadata: { entityType: kind },
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
router.put(
  '/favFellowships',
  isAuthenticated,
  logFavoriteEvent(true, 'fellowship'),
  userController.addFavFellowships,
);
router.delete(
  '/favFellowships',
  isAuthenticated,
  logFavoriteEvent(false, 'fellowship'),
  userController.removeFavFellowships,
);

router.get('/listings', isAuthenticated, userController.getUserListings);
router.put('/', isAuthenticated, logProfileUpdateEvent, userController.updateCurrentUser);

export default router;
