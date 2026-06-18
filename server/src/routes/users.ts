/**
 * User routes for favorites, fellowships, listings, and profile updates.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { isAuthenticated, validateObjectId } from '../middleware/index';
import * as userController from '../controllers/userController';
import { logEvent } from '../services/analyticsService';
import { AnalyticsEventType } from '../models/index';
import { sanitizeLogValue } from '../utils/logSanitizer';

const router = Router();
const FAVORITE_ANALYTICS_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const MAX_FAVORITE_ANALYTICS_IDS = 100;
const PROFILE_UPDATE_ANALYTICS_FIELD_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_PROFILE_UPDATE_ANALYTICS_FIELDS = 50;

function setPrivateUserCacheHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

router.use(setPrivateUserCacheHeaders);

const normalizeFavoriteAnalyticsIds = (value: unknown): string[] => {
  if (!value) {
    return [];
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  const rawIds = Array.isArray(value) ? value : [value];

  for (const rawId of rawIds.slice(0, MAX_FAVORITE_ANALYTICS_IDS)) {
    if (typeof rawId !== 'string') continue;
    const id = rawId.trim().toLowerCase();
    if (!FAVORITE_ANALYTICS_OBJECT_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return ids;
};

const getFavoriteIds = (req: Request, key: string): string[] =>
  normalizeFavoriteAnalyticsIds(req.body?.data?.[key] ?? req.body?.[key]);

const parseFavoriteAnalyticsResponse = (data: unknown): Record<string, any> | undefined => {
  if (!data) return undefined;
  if (Buffer.isBuffer(data)) {
    return parseFavoriteAnalyticsResponse(data.toString('utf8'));
  }
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, any>
        : undefined;
    } catch {
      return undefined;
    }
  }
  return typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, any>
    : undefined;
};

const visibleFavoriteAnalyticsIdsFromResponse = (
  data: unknown,
  kind: 'listing' | 'fellowship' | 'program',
  requestedIds: string[],
): string[] => {
  const payload = parseFavoriteAnalyticsResponse(data);
  const favoriteField = kind === 'listing' ? 'favListings' : 'favFellowships';
  const visibleIds = new Set(normalizeFavoriteAnalyticsIds(payload?.user?.[favoriteField]));
  return requestedIds.filter((id) => visibleIds.has(id));
};

const profileUpdateAnalyticsFields = (value: unknown): string[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];

  const fields: string[] = [];
  const seen = new Set<string>();
  const source = value as Record<string, unknown>;

  for (const key in source) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const field = key.trim();
    if (!PROFILE_UPDATE_ANALYTICS_FIELD_RE.test(field) || seen.has(field)) continue;
    seen.add(field);
    fields.push(field);
    if (fields.length >= MAX_PROFILE_UPDATE_ANALYTICS_FIELDS) break;
  }

  return fields;
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
        const requestedIds = getFavoriteIds(
          req,
          payloadKey || (kind === 'listing' ? 'favListings' : 'favFellowships'),
        );
        const visibleIds = isFavorite
          ? visibleFavoriteAnalyticsIdsFromResponse(data, kind, requestedIds)
          : [];

        if (currentUser?.netId && (visibleIds.length > 0 || (!isFavorite && requestedIds.length > 0))) {
          const eventType =
            kind === 'listing'
              ? isFavorite
                ? AnalyticsEventType.LISTING_FAVORITE
                : AnalyticsEventType.LISTING_UNFAVORITE
              : isFavorite
                ? AnalyticsEventType.FELLOWSHIP_FAVORITE
                : AnalyticsEventType.FELLOWSHIP_UNFAVORITE;

          if (!isFavorite && requestedIds.length > 0) {
            logEvent({
              eventType,
              netid: currentUser.netId!,
              userType: currentUser.userType,
              metadata: { entityType: kind, itemIdsRedacted: true },
            }).catch((err) => console.error('Error logging favorite event:', sanitizeLogValue(err)));
          }

          visibleIds.forEach((itemId: string) => {
            logEvent({
              eventType,
              netid: currentUser.netId!,
              userType: currentUser.userType,
              listingId: kind === 'listing' ? itemId : undefined,
              fellowshipId: kind !== 'listing' ? itemId : undefined,
              metadata: { entityType: kind },
            }).catch((err) => console.error('Error logging favorite event:', sanitizeLogValue(err)));
          });
        }
      }

      return originalSend(data);
    };

    next();
  };
};

const deprecateFavFellowshipEndpoint = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', '</api/users/savedPrograms>; rel="successor-version"');
  next();
};

const logProfileUpdateEvent = async (req: Request, res: Response, next: NextFunction) => {
  const originalSend = res.send.bind(res);

  res.send = function (data: any) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const currentUser = req.user as { netId?: string; userType: string };
      const fields = profileUpdateAnalyticsFields(req.body);
      if (currentUser?.netId && fields.length > 0) {
        logEvent({
          eventType: AnalyticsEventType.PROFILE_UPDATE,
          netid: currentUser.netId,
          userType: currentUser.userType,
          metadata: {
            fields,
          },
        }).catch((err) => console.error('Error logging profile update event:', sanitizeLogValue(err)));
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

router.get('/favPathwayIds', isAuthenticated, userController.getFavPathwayIds);
router.get('/favPathways', isAuthenticated, userController.getFavPathways);
router.get(
  '/favPathwayFundingMatches',
  isAuthenticated,
  userController.getFavPathwayFundingMatches,
);
router.put('/favPathways', isAuthenticated, userController.addFavPathways);
router.delete('/favPathways', isAuthenticated, userController.removeFavPathways);
router.get('/savedResearchPlanIds', isAuthenticated, userController.getSavedResearchPlanIds);
router.get('/savedResearchPlans', isAuthenticated, userController.getSavedResearchPlans);
router.put('/savedResearchPlans', isAuthenticated, userController.addSavedResearchPlans);
router.delete('/savedResearchPlans', isAuthenticated, userController.removeSavedResearchPlans);
router.get(
  '/savedResearchPlanFundingMatches',
  isAuthenticated,
  userController.getSavedResearchPlanFundingMatches,
);
router.get('/savedResearchPlanDetails', isAuthenticated, userController.getSavedResearchPlanDetails);
router.get(
  '/savedResearchPlanDetails/export',
  isAuthenticated,
  userController.exportSavedResearchPlanDetails,
);
router.post(
  '/savedResearchPlanDetails/export',
  isAuthenticated,
  userController.exportSavedResearchPlanDetails,
);
router.put(
  '/savedResearchPlanDetails/:pathwayId',
  isAuthenticated,
  validateObjectId('pathwayId'),
  userController.updateSavedResearchPlanDetail,
);
router.delete(
  '/savedResearchPlanDetails/:pathwayId',
  isAuthenticated,
  validateObjectId('pathwayId'),
  userController.deleteSavedResearchPlanDetail,
);
router.get('/favPathwayPlans', isAuthenticated, userController.getSavedPathwayPlans);
router.get(
  '/favPathwayPlans/export',
  isAuthenticated,
  userController.exportSavedPathwayPlans,
);
router.post(
  '/favPathwayPlans/export',
  isAuthenticated,
  userController.exportSavedPathwayPlans,
);
router.put(
  '/favPathwayPlans/:pathwayId',
  isAuthenticated,
  validateObjectId('pathwayId'),
  userController.updateSavedPathwayPlan,
);
router.delete(
  '/favPathwayPlans/:pathwayId',
  isAuthenticated,
  validateObjectId('pathwayId'),
  userController.deleteSavedPathwayPlan,
);

router.get('/listings', isAuthenticated, userController.getUserListings);
router.put('/', isAuthenticated, logProfileUpdateEvent, userController.updateCurrentUser);

export default router;
