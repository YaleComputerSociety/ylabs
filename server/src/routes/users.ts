import { createUser, readAllUsers, readUser, updateUser, deleteUser } from '../services/userService';
import { NotFoundError } from "../utils/errors";
import { Request, Response, Router } from "express";

const router = Router();

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

export default router;