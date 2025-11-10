import { Router, Request, Response, NextFunction } from "express";
import { isAuthenticated, isAdmin } from '../middleware';
import * as userController from '../controllers/userController';
import { logEvent } from '../services/analyticsService';
import { AnalyticsEventType } from '../models';

const router = Router();

// ==================== ANALYTICS WRAPPER MIDDLEWARE ====================

// Wrapper to log favorite events
const logFavoriteEvent = (isFavorite: boolean) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Store the original send function
    const originalSend = res.send.bind(res);
    
    // Override send to log after successful response
    res.send = function(data: any) {
      // Only log if response was successful (2xx status)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const currentUser = req.user as { netId?: string, userType: string };
        if (currentUser?.netId && req.body.favListings) {
          const listings = Array.isArray(req.body.favListings) 
            ? req.body.favListings 
            : [req.body.favListings];
          
          // Log events asynchronously (don't await)
          listings.forEach((listingId: string) => {
            logEvent({
              eventType: isFavorite ? AnalyticsEventType.LISTING_FAVORITE : AnalyticsEventType.LISTING_UNFAVORITE,
              netid: currentUser.netId!,
              userType: currentUser.userType,
              listingId: listingId
            }).catch(err => console.error('Error logging favorite event:', err));
          });
        }
      }
      
      // Call original send
      return originalSend(data);
    };
    
    next();
  };
};

// Wrapper to log profile update events
const logProfileUpdateEvent = async (req: Request, res: Response, next: NextFunction) => {
  // Store the original send function
  const originalSend = res.send.bind(res);
  
  // Override send to log after successful response
  res.send = function(data: any) {
    // Only log if response was successful (2xx status)
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const currentUser = req.user as { netId?: string, userType: string };
      if (currentUser?.netId && req.body && Object.keys(req.body).length > 0) {
        logEvent({
          eventType: AnalyticsEventType.PROFILE_UPDATE,
          netid: currentUser.netId,
          userType: currentUser.userType,
          metadata: {
            fields: Object.keys(req.body)
          }
        }).catch(err => console.error('Error logging profile update event:', err));
      }
    }
    
    // Call original send
    return originalSend(data);
  };
  
  next();
};

// ==================== ADMIN ROUTES (COMMENTED) ====================

// User confirmation routes (Admin only)
// router.put('/:id/confirm', isAuthenticated, isAdmin, validateObjectId('id'), userController.confirmUserById);
// router.put('/:id/unconfirm', isAuthenticated, isAdmin, validateObjectId('id'), userController.unconfirmUserById);

// Department routes (Admin only)
// router.put('/:id/departments', isAuthenticated, isAdmin, validateObjectId('id'), userController.addDepartments);
// router.delete('/:id/departments', isAuthenticated, isAdmin, validateObjectId('id'), userController.removeDepartments);
// router.delete('/:id/departments/all', isAuthenticated, isAdmin, validateObjectId('id'), userController.clearDepartments);

// Own listings routes (Admin only)
// router.put('/:id/ownListings', isAuthenticated, isAdmin, validateObjectId('id'), userController.addOwnListings);
// router.delete('/:id/ownListings', isAuthenticated, isAdmin, validateObjectId('id'), userController.removeOwnListings);
// router.delete('/:id/ownListings/all', isAuthenticated, isAdmin, validateObjectId('id'), userController.clearOwnListings);

// ==================== FAV LISTINGS ROUTES ====================

// Get favListings id's for current user
router.get('/favListingsIds', isAuthenticated, userController.getFavListingsIds);

// Favorite listings routes (for specific user - Admin only - COMMENTED)
// router.put('/:id/favListings', isAuthenticated, isAdmin, validateObjectId('id'), userController.addFavListingsByUserId);

// Add favListings for the user currently logged in
router.put('/favListings', isAuthenticated, logFavoriteEvent(true), userController.addFavListings);

// Favorite listings routes (for specific user - Admin only - COMMENTED)
// router.delete('/:id/favListings', isAuthenticated, isAdmin, validateObjectId('id'), userController.removeFavListingsByUserId);

// Remove favListings for the user currently logged in
router.delete('/favListings', isAuthenticated, logFavoriteEvent(false), userController.removeFavListings);

// Favorite listings routes (for specific user - Admin only - COMMENTED)
// router.delete('/:id/favListings/all', isAuthenticated, isAdmin, validateObjectId('id'), userController.clearFavListings);

// ==================== USER CRUD ROUTES (ADMIN - COMMENTED) ====================

// Create new user
// router.post("/", isAuthenticated, isAdmin, userController.createUser);

// Read all users
// router.get("/", isAuthenticated, isAdmin, userController.getAllUsers);

// Return all listings data for a specific user by ObjectId or NetId
// router.get('/:id/listings', isAuthenticated, isAdmin, validateObjectId('id'), userController.getUserListingsById);

// ==================== USER PROFILE ROUTES (CURRENT USER) ====================

// Return all listings data for the user currently logged in
router.get('/listings', isAuthenticated, userController.getUserListings);

// User CRUD routes (Admin only - COMMENTED)
// router.get('/:id', isAuthenticated, isAdmin, validateObjectId('id'), userController.getUserById);
// router.put('/:id', isAuthenticated, isAdmin, validateObjectId('id'), userController.updateUserById);

// Update data for user currently logged in
router.put('/', isAuthenticated, logProfileUpdateEvent, userController.updateCurrentUser);

// Delete user by ObjectId or NetId (Admin only - COMMENTED)
// router.delete('/:id', isAuthenticated, isAdmin, validateObjectId('id'), userController.deleteUserById);

export default router;