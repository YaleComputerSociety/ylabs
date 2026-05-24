/**
 * User routes for saved programs, saved research plans, and profile updates.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { isAuthenticated } from '../middleware/index';
import * as userController from '../controllers/userController';
import { logEvent } from '../services/analyticsService';
import { AnalyticsEventType } from '../models/index';

const router = Router();

const deprecateFavPathwayEndpoint = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', '</api/users/savedResearchPlans>; rel="successor-version"');
  next();
};

const deprecateFavFellowshipEndpoint = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', '</api/users/savedPrograms>; rel="successor-version"');
  next();
};

const getFavoriteIds = (req: Request, key: string): string[] => {
  const value = req.body?.data?.[key] ?? req.body?.[key];
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

const logFavoriteEvent = (
  isFavorite: boolean,
  kind: 'listing' | 'fellowship' | 'program' = 'listing',
  payloadKey?: string,
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send.bind(res);

    res.send = function (data: any) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const currentUser = req.user as { netId?: string; userType: string };
        const ids = getFavoriteIds(
          req,
          payloadKey || (kind === 'listing' ? 'favListings' : 'favFellowships'),
        );

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
              fellowshipId: kind !== 'listing' ? itemId : undefined,
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
router.put('/favListings', isAuthenticated, userController.addFavListings);
router.delete('/favListings', isAuthenticated, userController.removeFavListings);

router.get('/savedProgramIds', isAuthenticated, userController.getSavedProgramIds);
router.get('/savedPrograms', isAuthenticated, userController.getSavedPrograms);
router.put(
  '/savedPrograms',
  isAuthenticated,
  logFavoriteEvent(true, 'program', 'savedPrograms'),
  userController.addSavedPrograms,
);
router.delete(
  '/savedPrograms',
  isAuthenticated,
  logFavoriteEvent(false, 'program', 'savedPrograms'),
  userController.removeSavedPrograms,
);

router.get(
  '/favFellowshipIds',
  isAuthenticated,
  deprecateFavFellowshipEndpoint,
  userController.getFavFellowshipIds,
);
router.get(
  '/favFellowships',
  isAuthenticated,
  deprecateFavFellowshipEndpoint,
  userController.getFavFellowships,
);
router.put(
  '/favFellowships',
  isAuthenticated,
  deprecateFavFellowshipEndpoint,
  logFavoriteEvent(true, 'fellowship'),
  userController.addFavFellowships,
);
router.delete(
  '/favFellowships',
  isAuthenticated,
  deprecateFavFellowshipEndpoint,
  logFavoriteEvent(false, 'fellowship'),
  userController.removeFavFellowships,
);

router.get('/savedResearchPlanIds', isAuthenticated, userController.getSavedResearchPlanIds);
router.get('/savedResearchPlans', isAuthenticated, userController.getSavedResearchPlans);
router.get(
  '/savedResearchPlanFundingMatches',
  isAuthenticated,
  userController.getSavedResearchPlanFundingMatches,
);
router.put('/savedResearchPlans', isAuthenticated, userController.addSavedResearchPlans);
router.delete('/savedResearchPlans', isAuthenticated, userController.removeSavedResearchPlans);
router.get('/savedResearchPlanDetails', isAuthenticated, userController.getSavedResearchPlanDetails);
router.get(
  '/savedResearchPlanDetails/export',
  isAuthenticated,
  userController.exportSavedResearchPlanDetails,
);
router.put(
  '/savedResearchPlanDetails/:pathwayId',
  isAuthenticated,
  userController.updateSavedResearchPlanDetail,
);
router.delete(
  '/savedResearchPlanDetails/:pathwayId',
  isAuthenticated,
  userController.deleteSavedResearchPlanDetail,
);

router.get(
  '/favPathwayIds',
  isAuthenticated,
  deprecateFavPathwayEndpoint,
  userController.getFavPathwayIds,
);
router.get(
  '/favPathways',
  isAuthenticated,
  deprecateFavPathwayEndpoint,
  userController.getFavPathways,
);
router.get(
  '/favPathwayFundingMatches',
  isAuthenticated,
  deprecateFavPathwayEndpoint,
  userController.getFavPathwayFundingMatches,
);
router.put(
  '/favPathways',
  isAuthenticated,
  deprecateFavPathwayEndpoint,
  userController.addFavPathways,
);
router.delete(
  '/favPathways',
  isAuthenticated,
  deprecateFavPathwayEndpoint,
  userController.removeFavPathways,
);
router.get(
  '/favPathwayPlans',
  isAuthenticated,
  deprecateFavPathwayEndpoint,
  userController.getSavedPathwayPlans,
);
router.get(
  '/favPathwayPlans/export',
  isAuthenticated,
  deprecateFavPathwayEndpoint,
  userController.exportSavedPathwayPlans,
);
router.put(
  '/favPathwayPlans/:pathwayId',
  isAuthenticated,
  deprecateFavPathwayEndpoint,
  userController.updateSavedPathwayPlan,
);
router.delete(
  '/favPathwayPlans/:pathwayId',
  isAuthenticated,
  deprecateFavPathwayEndpoint,
  userController.deleteSavedPathwayPlan,
);

router.get('/listings', isAuthenticated, userController.getUserListings);
router.put('/', isAuthenticated, logProfileUpdateEvent, userController.updateCurrentUser);

export default router;
