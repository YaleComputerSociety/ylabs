import { Router } from "express";
import { isAuthenticated, canCreateListing, validateObjectId, validatePagination } from '../middleware';
import * as listingController from '../controllers/listingController';

const router = Router();

// Search listings
router.get('/search', isAuthenticated, validatePagination, listingController.searchListings);

// Create listing
router.post("/", isAuthenticated, canCreateListing, listingController.createListingForCurrentUser);

// Get skeleton listing
router.get('/skeleton', isAuthenticated, listingController.getSkeletonListingForCurrentUser);

// Read specific listing
router.get('/:id', isAuthenticated, validateObjectId('id'), listingController.getListingById);

// Update listing
router.put('/:id', isAuthenticated, validateObjectId('id'), listingController.updateListingForCurrentUser);

// Archive listing
router.put('/:id/archive', isAuthenticated, validateObjectId('id'), listingController.archiveListingForCurrentUser);

// Unarchive listing
router.put('/:id/unarchive', isAuthenticated, validateObjectId('id'), listingController.unarchiveListingForCurrentUser);

// Add view to listing
router.put('/:id/addView', isAuthenticated, validateObjectId('id'), listingController.addViewToListing);

// Delete listing
router.delete('/:id', isAuthenticated, validateObjectId('id'), listingController.deleteListingForCurrentUser);

export default router;