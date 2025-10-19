import { Router } from "express";
import { isAuthenticated, isAdmin} from '../middleware';
import * as userController from '../controllers/userController';

const router = Router();

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
router.put('/favListings', isAuthenticated, userController.addFavListings);

// Favorite listings routes (for specific user - Admin only - COMMENTED)
// router.delete('/:id/favListings', isAuthenticated, isAdmin, validateObjectId('id'), userController.removeFavListingsByUserId);

// Remove favListings for the user currently logged in
router.delete('/favListings', isAuthenticated, userController.removeFavListings);

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
router.put('/', isAuthenticated, userController.updateCurrentUser);

// Delete user by ObjectId or NetId (Admin only - COMMENTED)
// router.delete('/:id', isAuthenticated, isAdmin, validateObjectId('id'), userController.deleteUserById);

export default router;