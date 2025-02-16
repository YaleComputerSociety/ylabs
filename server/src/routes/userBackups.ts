import { createUserBackup, deleteUserBackup, readAllUserBackups, readUserBackup, updateUserBackup } from "../services/userBackupService";
import { NotFoundError } from "../utils/errors";
import { Request, Response, Router } from "express";

const router = Router();

//Create new user backup
router.post("/", async (request: Request, response: Response) => {
    try {
        const user = await createUserBackup(request.body);
        response.status(201).json({ user });
    } catch (error) {
        console.log(error.message);
        response.status(400).json({ error: error.message });
    }
});

//Read all user backups
router.get("/", async (request: Request, response: Response) => {
    try {
        const users = await readAllUserBackups();
        response.status(200).json({ users });
    } catch (error) {
        console.log(error.message);
        response.status(500).json({ error: error.message });
    }
});

//Read specific user backup by ObjectId or NetId
router.get('/:id', async (request: Request, response: Response) => {
    try {
        const user = await readUserBackup(request.params.id);
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

//Update data for a specific user backup by ObjectId or NetId
router.put('/:id', async (request: Request, response: Response) => {
    try {
        const user = await updateUserBackup(request.params.id, request.body);
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

//Delete user backup by ObjectId or NetId
router.delete('/:id', async (request: Request, response: Response) => {
    try {
        const user = await deleteUserBackup(request.params.id);
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