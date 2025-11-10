import { Router, Request, Response, NextFunction } from "express";
import { isAuthenticated, canCreateListing, validateObjectId, validatePagination } from '../middleware';
import * as listingController from '../controllers/listingController';
import { logEvent } from '../services/analyticsService';
import { AnalyticsEventType } from '../models';

const router = Router();

// ==================== ANALYTICS WRAPPER MIDDLEWARE ====================

// Wrapper to log search events
const logSearchEvent = async (req: Request, res: Response, next: NextFunction) => {
  const currentUser = req.user as { netId?: string, userType: string };
  
  if (currentUser?.netId) {
    const { query, departments } = req.query;
    
    // Log search event (don't await - fire and forget)
    logEvent({
      eventType: AnalyticsEventType.SEARCH,
      netid: currentUser.netId,
      userType: currentUser.userType,
      searchQuery: (query as string) || '',
      searchDepartments: departments ? (departments as string).split(',') : []
    }).catch(err => console.error('Error logging search event:', err));
  }
  
  next();
};

// Wrapper to log listing CRUD events
const logListingEvent = (eventType: AnalyticsEventType) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Store the original send function
    const originalSend = res.send.bind(res);
    
    // Override send to log after successful response
    res.send = function(data: any) {
      // Only log if response was successful (2xx status)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const currentUser = req.user as { netId?: string, userType: string };
        const listingId = req.params.id;
        
        if (currentUser?.netId && listingId) {
          logEvent({
            eventType: eventType,
            netid: currentUser.netId,
            userType: currentUser.userType,
            listingId: listingId
          }).catch(err => console.error(`Error logging ${eventType} event:`, err));
        }
      }
      
      // Call original send
      return originalSend(data);
    };
    
    next();
  };
};

// Wrapper to log listing creation (different because we need the created listing ID from response)
const logListingCreateEvent = async (req: Request, res: Response, next: NextFunction) => {
  // Store the original json function
  const originalJson = res.json.bind(res);
  
  // Override json to log after successful response
  res.json = function(data: any) {
    // Only log if response was successful (2xx status)
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const currentUser = req.user as { netId?: string, userType: string };
      
      if (currentUser?.netId && data?.listing?._id) {
        logEvent({
          eventType: AnalyticsEventType.LISTING_CREATE,
          netid: currentUser.netId,
          userType: currentUser.userType,
          listingId: data.listing._id
        }).catch(err => console.error('Error logging listing create event:', err));
      }
    }
    
    // Call original json
    return originalJson(data);
  };
  
  next();
};

// ==================== ROUTES ====================

// Search listings (with analytics)
router.get('/search', isAuthenticated, validatePagination, logSearchEvent, listingController.searchListings);

// Create listing (with analytics)
router.post("/", isAuthenticated, canCreateListing, logListingCreateEvent, listingController.createListingForCurrentUser);

// Get skeleton listing
router.get('/skeleton', isAuthenticated, listingController.getSkeletonListingForCurrentUser);

// Read specific listing
router.get('/:id', isAuthenticated, validateObjectId('id'), listingController.getListingById);

// Update listing (with analytics)
router.put('/:id', isAuthenticated, validateObjectId('id'), logListingEvent(AnalyticsEventType.LISTING_UPDATE), listingController.updateListingForCurrentUser);

// Archive listing (with analytics)
router.put('/:id/archive', isAuthenticated, validateObjectId('id'), logListingEvent(AnalyticsEventType.LISTING_ARCHIVE), listingController.archiveListingForCurrentUser);

// Unarchive listing (with analytics)
router.put('/:id/unarchive', isAuthenticated, validateObjectId('id'), logListingEvent(AnalyticsEventType.LISTING_UNARCHIVE), listingController.unarchiveListingForCurrentUser);

// Add view to listing (with analytics)
router.put('/:id/addView', isAuthenticated, validateObjectId('id'), logListingEvent(AnalyticsEventType.LISTING_VIEW), listingController.addViewToListing);

// Delete listing
router.delete('/:id', isAuthenticated, validateObjectId('id'), listingController.deleteListingForCurrentUser);

export default router;