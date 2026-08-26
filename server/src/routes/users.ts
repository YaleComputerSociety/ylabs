/**
 * User routes for favorites, fellowships, listings, and profile updates.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { isAuthenticated, validateObjectId, validateResearchEntityId } from '../middleware/index';
import { writeLimit } from '../middleware/rateLimiters';
import * as userController from '../controllers/userController';
import { logEvent } from '../services/analyticsService';
import { AnalyticsEventType } from '../models/index';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { emitResearchEvent } from '../services/researchAnalytics';

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
        ? (parsed as Record<string, any>)
        : undefined;
    } catch {
      return undefined;
    }
  }
  return typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, any>)
    : undefined;
};

const visibleFavoriteAnalyticsIdsFromResponse = (
  data: unknown,
  requestedIds: string[],
): string[] => {
  const payload = parseFavoriteAnalyticsResponse(data);
  const visibleIds = new Set(normalizeFavoriteAnalyticsIds(payload?.user?.favListings));
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

const logFavoriteEvent = (isFavorite: boolean) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send.bind(res);

    res.send = function (data: any) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const currentUser = req.user as { netId?: string; userType: string };
        const requestedIds = getFavoriteIds(req, 'favListings');
        const visibleIds = isFavorite
          ? visibleFavoriteAnalyticsIdsFromResponse(data, requestedIds)
          : [];

        if (
          currentUser?.netId &&
          (visibleIds.length > 0 || (!isFavorite && requestedIds.length > 0))
        ) {
          const eventType = isFavorite
            ? AnalyticsEventType.LISTING_FAVORITE
            : AnalyticsEventType.LISTING_UNFAVORITE;

          if (!isFavorite && requestedIds.length > 0) {
            logEvent({
              eventType,
              netid: currentUser.netId!,
              userType: currentUser.userType,
              metadata: { entityType: 'listing', itemIdsRedacted: true },
            }).catch((err) =>
              console.error('Error logging favorite event:', sanitizeLogValue(err)),
            );
          }

          const pathwayIds = isFavorite ? visibleIds : requestedIds;
          pathwayIds.forEach((itemId: string) => {
            emitResearchEvent({
              eventType: AnalyticsEventType.PATHWAY_SAVE,
              entityType: 'listing',
              entityId: itemId,
              user: currentUser,
              payload: { action: isFavorite ? 'save' : 'unsave' },
            }).catch((err) =>
              console.error('Error logging pathway save event:', sanitizeLogValue(err)),
            );
          });

          visibleIds.forEach((itemId: string) => {
            logEvent({
              eventType,
              netid: currentUser.netId!,
              userType: currentUser.userType,
              listingId: itemId,
              metadata: { entityType: 'listing' },
            }).catch((err) =>
              console.error('Error logging favorite event:', sanitizeLogValue(err)),
            );
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
      const fields = profileUpdateAnalyticsFields(req.body);
      if (currentUser?.netId && fields.length > 0) {
        logEvent({
          eventType: AnalyticsEventType.PROFILE_UPDATE,
          netid: currentUser.netId,
          userType: currentUser.userType,
          metadata: {
            fields,
          },
        }).catch((err) =>
          console.error('Error logging profile update event:', sanitizeLogValue(err)),
        );
      }
    }

    return originalSend(data);
  };

  next();
};

router.get('/favListingsIds', isAuthenticated, userController.getFavListingsIds);
router.put(
  '/favListings',
  writeLimit,
  isAuthenticated,
  logFavoriteEvent(true),
  userController.addFavListings,
);
router.delete(
  '/favListings',
  writeLimit,
  isAuthenticated,
  logFavoriteEvent(false),
  userController.removeFavListings,
);

router.get('/watchedProgramIds', isAuthenticated, userController.getWatchedProgramIds);
router.get('/watchedPrograms', isAuthenticated, userController.getWatchedPrograms);
router.put('/watchedPrograms', writeLimit, isAuthenticated, userController.addWatchedPrograms);
router.delete(
  '/watchedPrograms',
  writeLimit,
  isAuthenticated,
  userController.removeWatchedPrograms,
);
router.get('/watchedProgramPlans', isAuthenticated, userController.getWatchedProgramPlans);
router.put(
  '/watchedProgramPlans/:programId',
  writeLimit,
  isAuthenticated,
  validateObjectId('programId'),
  userController.updateWatchedProgramPlan,
);
router.delete(
  '/watchedProgramPlans/:programId',
  writeLimit,
  isAuthenticated,
  validateObjectId('programId'),
  userController.deleteWatchedProgramPlan,
);

router.get('/savedResearchEntityIds', isAuthenticated, userController.getSavedResearchEntityIds);
router.get('/savedResearchEntities', isAuthenticated, userController.getSavedResearchEntities);
router.put(
  '/savedResearchEntities',
  writeLimit,
  isAuthenticated,
  userController.addSavedResearchEntities,
);
router.delete(
  '/savedResearchEntities',
  writeLimit,
  isAuthenticated,
  userController.removeSavedResearchEntities,
);
router.get(
  '/savedResearchEntityPlans',
  isAuthenticated,
  userController.getSavedResearchEntityPlans,
);
router.get(
  '/savedResearchEntityPlans/export',
  isAuthenticated,
  userController.exportSavedResearchEntities,
);
router.post(
  '/savedResearchEntityPlans/export',
  isAuthenticated,
  userController.exportSavedResearchEntities,
);
router.put(
  '/savedResearchEntityPlans/:entityId',
  writeLimit,
  isAuthenticated,
  validateResearchEntityId('entityId'),
  userController.updateSavedResearchEntityPlan,
);
router.delete(
  '/savedResearchEntityPlans/:entityId',
  writeLimit,
  isAuthenticated,
  validateResearchEntityId('entityId'),
  userController.deleteSavedResearchEntityPlan,
);
router.get(
  '/savedResearchFollowUps',
  isAuthenticated,
  userController.getSavedResearchFollowUps,
);
router.post(
  '/savedResearchFollowUps/:entityId/dismiss',
  writeLimit,
  isAuthenticated,
  validateResearchEntityId('entityId'),
  userController.dismissSavedResearchFollowUp,
);
router.put(
  '/',
  writeLimit,
  isAuthenticated,
  logProfileUpdateEvent,
  userController.updateCurrentUser,
);

export default router;
