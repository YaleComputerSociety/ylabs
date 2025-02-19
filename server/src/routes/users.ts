import { createUser, readAllUsers, readUser, updateUser, deleteUser, addDepartments, deleteDepartments, clearDepartments, addOwnListings, deleteOwnListings, clearOwnListings, addFavListings, deleteFavListings, clearFavListings } from '../services/userService';
import { NotFoundError } from "../utils/errors";
import { Request, Response, Router } from "express";

const router = Router();

//User level routes

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
});

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
});

//Fav listings level routes

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
});

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
});

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
});

//Handle login (/users/loginData/:id)

export default router;