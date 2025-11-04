import mongoose from 'mongoose';
import { readListings } from '../services/newListingsService';
import { createUser, readAllUsers, readUser, updateUser, deleteUser, addDepartments, deleteDepartments, clearDepartments, addOwnListings, deleteOwnListings, clearOwnListings, addFavListings, deleteFavListings, clearFavListings, confirmUser, unconfirmUser } from '../services/userService';
import { NotFoundError } from "../utils/errors";
import { Request, Response, Router } from "express";
import { isAuthenticated } from '../utils/permissions';

const router = Router();


//User confirmation routes

/*
//Confirm user and update listings
router.put('/:id/confirm', async (request: Request, response: Response) => {
    try {
        const user = await confirmUser(request.params.id);
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

//Unconfirm user and update listings
router.put('/:id/unconfirm', async (request: Request, response: Response) => {
    try {
        const user = await unconfirmUser(request.params.id);
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

//Departments level routes

//Add departments by ObjectId or NetId
router.put('/:id/departments', async (request: Request, response: Response) => {
    try {
        const user = await addDepartments(request.params.id, Array.isArray(request.body.departments) ? request.body.departments : [request.body.departments]);
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

//Remove departments by ObjectId or NetId
router.delete('/:id/departments', async (request: Request, response: Response) => {
    try {
        const user = await deleteDepartments(request.params.id, Array.isArray(request.body.departments) ? request.body.departments : [request.body.departments]);
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

//Clear departments by ObjectId or NetId
router.delete('/:id/departments/all', async (request: Request, response: Response) => {
    try {
        const user = await clearDepartments(request.params.id);
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

//Own listings level routes

//Add ownListings by ObjectId or NetId
router.put('/:id/ownListings', async (request: Request, response: Response) => {
    try {
        const user = await addOwnListings(request.params.id, Array.isArray(request.body.ownListings) ? request.body.ownListings : [request.body.ownListings]);
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

//Remove ownListings by ObjectId or NetId
router.delete('/:id/ownListings', async (request: Request, response: Response) => {
    try {
        const user = await deleteOwnListings(request.params.id, Array.isArray(request.body.ownListings) ? request.body.ownListings : [request.body.ownListings]);
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

//Clear ownListings by ObjectId or NetId
router.delete('/:id/ownListings/all', async (request: Request, response: Response) => {
    try {
        const user = await clearOwnListings(request.params.id);
        response.status(200).json({ user });
    } catch (error) {
        console.log(error.message);
        if (error instanceof NotFoundError) {
            response.status(error.status).json({ error: error.message });
        } else {
            response.status(500).json({ error: error.message });
        }
    }
});*/

//Fav listings level routes

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

/*
//Add favListings by ObjectId or NetId
router.put('/:id/favListings', async (request: Request, response: Response) => {
    try {
        const user = await addFavListings(request.params.id, Array.isArray(request.body.favListings) ? request.body.favListings : [request.body.favListings]);
        response.status(200).json({ user });
    } catch (error) {
        console.log(error.message);
        if (error instanceof NotFoundError) {
            response.status(error.status).json({ error: error.message });
        } else {
            response.status(500).json({ error: error.message });
        }
    }
});*/

//Add favListings for the user currently logged in
router.put('/favListings', isAuthenticated, async (request: Request, response: Response) => {
    try {
        const currentUser = request.user as { netId? : string, userType: string, userConfirmed: boolean};
        if (!currentUser) {
            throw new Error('User not logged in');
        }
        if (!request.body.data.favListings) {
            throw new Error('No favListings provided');
        }
        const user = await addFavListings(currentUser.netId, Array.isArray(request.body.data.favListings) ? request.body.data.favListings : [request.body.data.favListings]);
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

/*
//Remove favListings by ObjectId or NetId
router.delete('/:id/favListings', async (request: Request, response: Response) => {
    try {
        const user = await deleteFavListings(request.params.id, Array.isArray(request.body.favListings) ? request.body.favListings : [request.body.favListings]);
        response.status(200).json({ user });
    } catch (error) {
        console.log(error.message);
        if (error instanceof NotFoundError) {
            response.status(error.status).json({ error: error.message });
        } else {
            response.status(500).json({ error: error.message });
        }
    }
});*/

//Remove favListings for the user currently logged in
router.delete('/favListings', isAuthenticated, async (request: Request, response: Response) => {
    try {
        const currentUser = request.user as { netId? : string, userType: string, userConfirmed: boolean};
        if (!currentUser) {
            throw new Error('User not logged in');
        }
        if (!request.body.favListings) {
            throw new Error('No favListings provided');
        }
        console.log(request.body);
        const user = await deleteFavListings(currentUser.netId, Array.isArray(request.body.favListings) ? request.body.favListings : [request.body.favListings]);
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

/*
//Clear favListings by ObjectId or NetId
router.delete('/:id/favListings/all', async (request: Request, response: Response) => {
    try {
        const user = await clearFavListings(request.params.id);
        response.status(200).json({ user });
    } catch (error) {
        console.log(error.message);
        if (error instanceof NotFoundError) {
            response.status(error.status).json({ error: error.message });
        } else {
            response.status(500).json({ error: error.message });
        }
    }
});*/

//User level routes

/*
//Create new user
router.post("/", async (request: Request, response: Response) => {
    try {
        const user = await createUser(request.body);
        response.status(201).json({ user });
    } catch (error) {
        console.log(error.message);
        response.status(400).json({ error: error.message });
    }
});

//Read all users
router.get("/", async (request: Request, response: Response) => {
    try {
        const users = await readAllUsers();
        response.status(200).json({ users });
    } catch (error) {
        console.log(error.message);
        response.status(500).json({ error: error.message });
    }
});

//Return all listings data for a specific user by ObjectId or NetId
router.get('/:id/listings', async (request: Request, response: Response) => {
    try {
        const user = await readUser(request.params.id);
        const ownListings = await readListings(user.ownListings);
        const favListings = await readListings(user.favListings);
        response.status(200).json({ ownListings: ownListings, favListings: favListings });
    } catch (error) {
        console.log(error.message);
        if (error instanceof NotFoundError) {
            response.status(error.status).json({ error: error.message });
        } else {
            response.status(500).json({ error: error.message });
        }
    }
});*/

//Return all listings data for the user currently logged in (for reload on accounts page, so also returns relevant user data)
router.get('/listings', isAuthenticated, async (request: Request, response: Response) => {
    try {
        const currentUser = request.user as { netId? : string, userType: string, userConfirmed: boolean};
        if (!currentUser) {
            throw new Error('User not logged in');
        }
        const user = await readUser(currentUser.netId);
        const ownListings = await readListings(user.ownListings);
        const favListings = await readListings(user.favListings);

        //Clean listings to remove those that no longer exist
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
        console.log(error.message);
        if (error instanceof NotFoundError) {
            response.status(error.status).json({ error: error.message });
        } else {
            response.status(500).json({ error: error.message });
        }
    }
});

/*
//Read specific user by ObjectId or NetId
router.get('/:id', async (request: Request, response: Response) => {
    try {
        const user = await readUser(request.params.id);
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

//Update data for a specific user by ObjectId or NetId
router.put('/:id', async (request: Request, response: Response) => {
    try {
        const user = await updateUser(request.params.id, request.body);
        response.status(200).json({ user });
    } catch (error) {
        console.log(error.message);
        if (error instanceof NotFoundError) {
            response.status(error.status).json({ error: error.message });
        } else {
            response.status(500).json({ error: error.message });
        }
    }
});*/

//Update data for user currently logged in
router.put('/', isAuthenticated, async (request: Request, response: Response) => {
    try {
        const currentUser = request.user as { netId? : string, userType: string, userConfirmed: boolean};
        if (!currentUser) {
            throw new Error('User not logged in');
        }

        if(request.body.data.userConfirmed !== undefined) {
            if(request.body.data.userConfirmed) {
                await confirmUser(currentUser.netId);
            } else {
                await unconfirmUser(currentUser.netId);
            }
        }

        const user = await updateUser(currentUser.netId, request.body.data);
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

/*
//Delete user by ObjectId or NetId
router.delete('/:id', async (request: Request, response: Response) => {
    try {
        const user = await deleteUser(request.params.id);
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
*/

export default router;