import mongoose from 'mongoose';
import { readListings } from '../services/newListingsService';
import { createUser, readAllUsers, readUser, updateUser, deleteUser, addDepartments, deleteDepartments, clearDepartments, addOwnListings, deleteOwnListings, clearOwnListings, addFavListings, deleteFavListings, clearFavListings, confirmUser, unconfirmUser } from '../services/userService';
import { NotFoundError } from "../utils/errors";
import { Request, Response, Router } from "express";
import { isAuthenticated } from '../utils/permissions';
import { logEvent } from '../services/analyticsService';
import { AnalyticsEventType } from '../models';

const router = Router();

//Get favListings id's for current user
router.get('/favListingsIds', isAuthenticated, async (request: Request, response: Response) => {
    try {
        const currentUser = request.user as { netId? : string, userType: string, userConfirmed: boolean};
        if (!currentUser) {
            throw new Error('User not logged in');
        }
        const user = await readUser(currentUser.netId);
        response.status(200).json({ favListingsIds: user.favListings });
    } catch (error) {
        console.log(error.message);
        if (error instanceof NotFoundError) {
            response.status(error.status).json({ error: error.message });
        } else {
            response.status(500).json({ error: error.message });
        }
    }
});

//Add favListings for current user
router.put('/favListings', isAuthenticated, async (request: Request, response: Response) => {
    try {
        const currentUser = request.user as { netId? : string, userType: string, userConfirmed: boolean};
        if (!currentUser) {
            throw new Error('User not logged in');
        }
        if (!request.body.favListings) {
            throw new Error('No favListings provided');
        }
        const listings = Array.isArray(request.body.favListings) ? request.body.favListings : [request.body.favListings];
        const user = await addFavListings(currentUser.netId, listings);

        // Log favorite events
        for (const listingId of listings) {
            logEvent({
                eventType: AnalyticsEventType.LISTING_FAVORITE,
                netid: currentUser.netId,
                userType: currentUser.userType,
                listingId: listingId
            });
        }

        response.status(200).json({ user });
    } catch (error) {
        console.log(error.message);
        if (error instanceof NotFoundError) {
            response.status(error.status).json({ error: error.message });
        } else {
            response.status(500).json({ error: error.message });
        }
    }
});

//Remove favListings for current user
router.delete('/favListings', isAuthenticated, async (request: Request, response: Response) => {
    try {
        const currentUser = request.user as { netId? : string, userType: string, userConfirmed: boolean};
        if (!currentUser) {
            throw new Error('User not logged in');
        }
        if (!request.body.favListings) {
            throw new Error('No favListings provided');
        }
        const listings = Array.isArray(request.body.favListings) ? request.body.favListings : [request.body.favListings];
        const user = await deleteFavListings(currentUser.netId, listings);

        // Log unfavorite events
        for (const listingId of listings) {
            logEvent({
                eventType: AnalyticsEventType.LISTING_UNFAVORITE,
                netid: currentUser.netId,
                userType: currentUser.userType,
                listingId: listingId
            });
        }

        response.status(200).json({ user });
    } catch (error) {
        console.log(error.message);
        if (error instanceof NotFoundError) {
            response.status(error.status).json({ error: error.message });
        } else {
            response.status(500).json({ error: error.message });
        }
    }
});

//Return all listings data for the user currently logged in
router.get('/listings', isAuthenticated, async (request: Request, response: Response) => {
    try {
        const currentUser = request.user as { netId? : string, userType: string, userConfirmed: boolean};
        if (!currentUser) {
            throw new Error('User not logged in');
        }
        const user = await readUser(currentUser.netId);
        const ownListings = await readListings(user.ownListings);
        const favListings = await readListings(user.favListings);
        response.status(200).json({ 
            ownListings: ownListings, 
            favListings: favListings, 
            userType: user.userType, 
            userConfirmed: user.userConfirmed,
            userNetid: user.netid
        });
    } catch (error) {
        console.log(error.message);
        if (error instanceof NotFoundError) {
            response.status(error.status).json({ error: error.message });
        } else {
            response.status(500).json({ error: error.message });
        }
    }
});

//Get current logged in user's data
router.get('/current', isAuthenticated, async (request: Request, response: Response) => {
    try {
        const currentUser = request.user as { netId? : string, userType: string, userConfirmed: boolean};
        if (!currentUser) {
            throw new Error('User not logged in');
        }
        const user = await readUser(currentUser.netId);
        response.status(200).json({ user });
    } catch (error) {
        console.log(error.message);
        if (error instanceof NotFoundError) {
            response.status(error.status).json({ error: error.message });
        } else {
            response.status(500).json({ error: error.message });
        }
    }
});

//Update current user's profile data
router.put('/current', isAuthenticated, async (request: Request, response: Response) => {
    try {
        const currentUser = request.user as { netId? : string, userType: string, userConfirmed: boolean};
        if (!currentUser) {
            throw new Error('User not logged in');
        }
        const user = await updateUser(currentUser.netId, request.body);

        // Log profile update
        logEvent({
            eventType: AnalyticsEventType.PROFILE_UPDATE,
            netid: currentUser.netId,
            userType: currentUser.userType,
            metadata: {
                fields: Object.keys(request.body)
            }
        });

        response.status(200).json({ user });
    } catch (error) {
        console.log(error.message);
        if (error instanceof NotFoundError) {
            response.status(error.status).json({ error: error.message });
        } else {
            response.status(500).json({ error: error.message });
        }
    }
});

export default router;