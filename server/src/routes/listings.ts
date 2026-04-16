/**
 * Express routes for listing browsing, search, and CRUD.
 */
import { Router, Request, Response, NextFunction } from "express";
import { isAuthenticated, canCreateListing, validateObjectId, validatePagination } from '../middleware/index';
import * as listingController from '../controllers/listingController';
import { logEvent } from '../services/analyticsService';
import { AnalyticsEventType } from '../models/index';

const router = Router();

const logSearchEvent = async (req: Request, res: Response, next: NextFunction) => {
  const currentUser = req.user as { netId?: string, userType: string };
  
  if (currentUser?.netId) {
    const { query, departments } = req.query;
    const searchQuery = (query as string) || '';

    if (searchQuery.trim() !== '') {
      logEvent({
        eventType: AnalyticsEventType.SEARCH,
        netid: currentUser.netId,
        userType: currentUser.userType,
        searchQuery: searchQuery,
        searchDepartments: departments ? (departments as string).split(',') : []
      }).catch(err => console.error('Error logging search event:', err));
    }
  }
  next();
};

const logListingEvent = (eventType: AnalyticsEventType) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send.bind(res);
    
    res.send = function(data: any) {
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
      
      return originalSend(data);
    };
    
    next();
  };
};

const logListingCreateEvent = async (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json.bind(res);
  
  res.json = function(data: any) {
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
    
    return originalJson(data);
  };
  
  next();
};

router.get('/search', isAuthenticated, validatePagination, logSearchEvent, listingController.searchListings);

router.post("/", isAuthenticated, canCreateListing, logListingCreateEvent, listingController.createListingForCurrentUser);

router.get('/skeleton', isAuthenticated, listingController.getSkeletonListingForCurrentUser);

router.get('/:id', isAuthenticated, validateObjectId('id'), listingController.getListingById);

router.put('/:id', isAuthenticated, validateObjectId('id'), logListingEvent(AnalyticsEventType.LISTING_UPDATE), listingController.updateListingForCurrentUser);

router.put('/:id/archive', isAuthenticated, validateObjectId('id'), logListingEvent(AnalyticsEventType.LISTING_ARCHIVE), listingController.archiveListingForCurrentUser);

router.put('/:id/unarchive', isAuthenticated, validateObjectId('id'), logListingEvent(AnalyticsEventType.LISTING_UNARCHIVE), listingController.unarchiveListingForCurrentUser);

router.put('/:id/addView', isAuthenticated, validateObjectId('id'), logListingEvent(AnalyticsEventType.LISTING_VIEW), listingController.addViewToListing);

router.delete('/:id', isAuthenticated, validateObjectId('id'), listingController.deleteListingForCurrentUser);

export default router;