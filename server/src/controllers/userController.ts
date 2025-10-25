import { Request, Response } from "express";
import mongoose from 'mongoose';
import { readListings } from '../services/listingService';
import { 
  createUser as createUserService,
  readAllUsers,
  readUser, 
  updateUser, 
  deleteUser as deleteUserService,
  addDepartments as addDepartmentsService,
  deleteDepartments as deleteDepartmentsService,
  clearDepartments as clearDepartmentsService,
  addOwnListings as addOwnListingsService,
  deleteOwnListings as deleteOwnListingsService,
  clearOwnListings as clearOwnListingsService,
  addFavListings as addFavListingsService, 
  deleteFavListings as deleteFavListingsService,
  clearFavListings as clearFavListingsService,
  confirmUser,
  unconfirmUser
} from '../services/userService';

// ==================== ADMIN ROUTES (COMMENTED) ====================

// // Confirm user and update listings
// export const confirmUserById = async (request: Request, response: Response) => {
//   try {
//     const user = await confirmUser(request.params.id);
//     response.status(200).json({ user });
//   } catch (error) {
//     throw error;
//   }
// };

// // Unconfirm user and update listings
// export const unconfirmUserById = async (request: Request, response: Response) => {
//   try {
//     const user = await unconfirmUser(request.params.id);
//     response.status(200).json({ user });
//   } catch (error) {
//     throw error;
//   }
// };

// // Add departments by ObjectId or NetId
// export const addDepartments = async (request: Request, response: Response) => {
//   try {
//     const departmentsArray = Array.isArray(request.body.departments) 
//       ? request.body.departments 
//       : [request.body.departments];
//     
//     const user = await addDepartmentsService(request.params.id, departmentsArray);
//     response.status(200).json({ user });
//   } catch (error) {
//     throw error;
//   }
// };

// // Remove departments by ObjectId or NetId
// export const removeDepartments = async (request: Request, response: Response) => {
//   try {
//     const departmentsArray = Array.isArray(request.body.departments) 
//       ? request.body.departments 
//       : [request.body.departments];
//     
//     const user = await deleteDepartmentsService(request.params.id, departmentsArray);
//     response.status(200).json({ user });
//   } catch (error) {
//     throw error;
//   }
// };

// // Clear departments by ObjectId or NetId
// export const clearDepartments = async (request: Request, response: Response) => {
//   try {
//     const user = await clearDepartmentsService(request.params.id);
//     response.status(200).json({ user });
//   } catch (error) {
//     throw error;
//   }
// };

// // Add ownListings by ObjectId or NetId
// export const addOwnListings = async (request: Request, response: Response) => {
//   try {
//     const ownListingsArray = Array.isArray(request.body.ownListings) 
//       ? request.body.ownListings 
//       : [request.body.ownListings];
//     
//     const user = await addOwnListingsService(request.params.id, ownListingsArray);
//     response.status(200).json({ user });
//   } catch (error) {
//     throw error;
//   }
// };

// // Remove ownListings by ObjectId or NetId
// export const removeOwnListings = async (request: Request, response: Response) => {
//   try {
//     const ownListingsArray = Array.isArray(request.body.ownListings) 
//       ? request.body.ownListings 
//       : [request.body.ownListings];
//     
//     const user = await deleteOwnListingsService(request.params.id, ownListingsArray);
//     response.status(200).json({ user });
//   } catch (error) {
//     throw error;
//   }
// };

// // Clear ownListings by ObjectId or NetId
// export const clearOwnListings = async (request: Request, response: Response) => {
//   try {
//     const user = await clearOwnListingsService(request.params.id);
//     response.status(200).json({ user });
//   } catch (error) {
//     throw error;
//   }
// };

// ==================== FAV LISTINGS ROUTES ====================

// Get favListings id's for current user
export const getFavListingsIds = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string, userType: string, userConfirmed: boolean };
    
    const user = await readUser(currentUser.netId);
    response.status(200).json({ favListingsIds: user.favListings });
  } catch (error) {
    throw error;
  }
};

// // Add favListings by ObjectId or NetId (Admin)
// export const addFavListingsByUserId = async (request: Request, response: Response) => {
//   try {
//     const favListingsArray = Array.isArray(request.body.favListings) 
//       ? request.body.favListings 
//       : [request.body.favListings];
//     
//     const user = await addFavListingsService(request.params.id, favListingsArray);
//     response.status(200).json({ user });
//   } catch (error) {
//     throw error;
//   }
// };

// Add favListings for the user currently logged in
export const addFavListings = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string, userType: string, userConfirmed: boolean };
    
    if (!request.body.data.favListings) {
      const error: any = new Error('No favListings provided');
      error.status = 400;
      throw error;
    }
    
    const favListingsArray = Array.isArray(request.body.data.favListings) 
      ? request.body.data.favListings 
      : [request.body.data.favListings];
    
    const user = await addFavListingsService(currentUser.netId, favListingsArray);
    response.status(200).json({ user });
  } catch (error) {
    throw error;
  }
};

// // Remove favListings by ObjectId or NetId (Admin)
// export const removeFavListingsByUserId = async (request: Request, response: Response) => {
//   try {
//     const favListingsArray = Array.isArray(request.body.favListings) 
//       ? request.body.favListings 
//       : [request.body.favListings];
//     
//     const user = await deleteFavListingsService(request.params.id, favListingsArray);
//     response.status(200).json({ user });
//   } catch (error) {
//     throw error;
//   }
// };

// Remove favListings for the user currently logged in
export const removeFavListings = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string, userType: string, userConfirmed: boolean };
    
    if (!request.body.favListings) {
      const error: any = new Error('No favListings provided');
      error.status = 400;
      throw error;
    }
    
    console.log(request.body);
    
    const favListingsArray = Array.isArray(request.body.favListings) 
      ? request.body.favListings 
      : [request.body.favListings];
    
    const user = await deleteFavListingsService(currentUser.netId, favListingsArray);
    response.status(200).json({ user });
  } catch (error) {
    throw error;
  }
};

// // Clear favListings by ObjectId or NetId (Admin)
// export const clearFavListings = async (request: Request, response: Response) => {
//   try {
//     const user = await clearFavListingsService(request.params.id);
//     response.status(200).json({ user });
//   } catch (error) {
//     throw error;
//   }
// };

// ==================== USER CRUD ROUTES (ADMIN - COMMENTED) ====================

// // Create new user
// export const createUser = async (request: Request, response: Response) => {
//   try {
//     const user = await createUserService(request.body);
//     response.status(201).json({ user });
//   } catch (error) {
//     console.log(error.message);
//     response.status(400).json({ error: error.message });
//   }
// };

// // Read all users
// export const getAllUsers = async (request: Request, response: Response) => {
//   try {
//     const users = await readAllUsers();
//     response.status(200).json({ users });
//   } catch (error) {
//     throw error;
//   }
// };

// // Return all listings data for a specific user by ObjectId or NetId
// export const getUserListingsById = async (request: Request, response: Response) => {
//   try {
//     const user = await readUser(request.params.id);
//     const ownListings = await readListings(user.ownListings);
//     const favListings = await readListings(user.favListings);
//     response.status(200).json({ ownListings, favListings });
//   } catch (error) {
//     throw error;
//   }
// };

// ==================== USER PROFILE ROUTES (CURRENT USER) ====================

// Return all listings data for the user currently logged in (for reload on accounts page, so also returns relevant user data)
export const getUserListings = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string, userType: string, userConfirmed: boolean };
    
    const user = await readUser(currentUser.netId);
    const ownListings = await readListings(user.ownListings);
    const favListings = await readListings(user.favListings);

    // Clean listings to remove those that no longer exist
    let ownIds: mongoose.Types.ObjectId[] = [];
    for (const listing of ownListings) {
      ownIds.push(listing._id);
    }

    let favIds: mongoose.Types.ObjectId[] = [];
    for (const listing of favListings) {
      favIds.push(listing._id);
    }

    await updateUser(currentUser.netId, { ownListings: ownIds, favListings: favIds });

    response.status(200).json({ ownListings: ownListings, favListings: favListings });
  } catch (error) {
    throw error;
  }
};

// // Read specific user by ObjectId or NetId
// export const getUserById = async (request: Request, response: Response) => {
//   try {
//     const user = await readUser(request.params.id);
//     response.status(200).json({ user });
//   } catch (error) {
//     throw error;
//   }
// };

// // Update data for a specific user by ObjectId or NetId
// export const updateUserById = async (request: Request, response: Response) => {
//   try {
//     const user = await updateUser(request.params.id, request.body);
//     response.status(200).json({ user });
//   } catch (error) {
//     throw error;
//   }
// };

// Update data for user currently logged in
export const updateCurrentUser = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string, userType: string, userConfirmed: boolean };
    
    // Handle user confirmation status
    if (request.body.data.userConfirmed !== undefined) {
      if (request.body.data.userConfirmed) {
        await confirmUser(currentUser.netId);
      } else {
        await unconfirmUser(currentUser.netId);
      }
    }

    const user = await updateUser(currentUser.netId, request.body.data);
    response.status(200).json({ user });
  } catch (error) {
    throw error;
  }
};

// // Delete user by ObjectId or NetId
// export const deleteUserById = async (request: Request, response: Response) => {
//   try {
//     const user = await deleteUserService(request.params.id);
//     response.status(200).json({ user });
//   } catch (error) {
//     throw error;
//   }
// };