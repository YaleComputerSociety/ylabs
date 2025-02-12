import express from "express";
import mongoose from "mongoose";
import { UserBackup } from '../models';
import { Request, Response, Router } from "express";

const router = Router();

//Create new user backup
router.post("/", async (request: Request, response: Response) => {
    try {
        const user = new UserBackup(request.body);
        await user.save();
        response.status(201).json({ user: user.toObject(), success: true });
    } catch (error) {
        console.log(error.message);
        response.status(400).json({ error: error.message, success: false });
    }
});

//Read all user backups
router.get("/", async (request: Request, response: Response) => {
    try {
        const users = await UserBackup.find();
        response.status(200).json({ users: users.map(user => user.toObject()), success: true });
    } catch (error) {
        console.log(error.message);
        response.status(500).json({ error: error.message, success: false })
    }
});

//Read specific user backup by ObjectId
router.get('/byId/:id', async (request: Request, response: Response) => {
    if (!mongoose.Types.ObjectId.isValid(request.params.id)) {
            return response.status(400).json({ message: `Id does not conform to ObjectId format: ${request.params.id}`, success: false, valid: false});
    }
    
    try {
        const user = await UserBackup.findById(request.params.id);

        if (!user) {
            return response.status(404).json({ message: `User backup not found: id: ${request.params.id}`, success: false, valid: true, exists: false })
        }
        
        response.status(200).json({ user: user.toObject(), success: true, valid: true, exists: true });
    } catch (error) {
        console.log(error.message);
        response.status(500).json({ error: error.message, success: false });
    }
});

//Read specific user backup by NetId
router.get('/byNetId/:netid', async (request: Request, response: Response) => {
    try {
        const user = await UserBackup.findOne({ netid: { $regex: `^${request.params.netid}$`, $options: 'i'} });

        if (!user) {
            return response.status(404).json({ message: `User backup not found: netid: ${request.params.netid}`, success: false, exists: false })
        }
        
        response.status(200).json({ user: user.toObject(), success: true, exists: true });
    } catch (error) {
        console.log(error.message);
        response.status(500).json({ error: error.message, success: false });
    }
});

//Update data for a specific user backup by ObjectId
router.put('/byId/:id', async (request: Request, response: Response) => {
    if (!mongoose.Types.ObjectId.isValid(request.params.id)) {
            return response.status(400).json({ message: `Id does not conform to ObjectId format: ${request.params.id}`, success: false, valid: false });
    }
    
    try {
        const user = await UserBackup.findByIdAndUpdate(request.params.id, request.body,
            { new: true, runValidators: true }
        );

        if (!user) {
            return response.status(404).json({ message: `User backup not found: id: ${request.params.id}`, success: false, valid: true, exists: false })
        }
        
        response.status(200).json({ user: user.toObject(), success: true, valid: true, exists: true });
    } catch (error) {
        console.log(error.message);
        response.status(500).json({ error: error.message, success: false });
    }
});

//Update data for a specific user backup by NetId
router.put('/byNetId/:netid', async (request: Request, response: Response) => {
    try {
        const user = await UserBackup.findOneAndUpdate(
            { netid: { $regex: `^${request.params.netid}$`, $options: 'i'} }, 
            request.body, 
            { new: true, runValidators: true }
        );

        if (!user) {
            return response.status(404).json({ message: `User backup not found: netid: ${request.params.netid}`, success: false, exists: false })
        }
        
        response.status(200).json({ user: user.toObject(), success: true, exists: true });
    } catch (error) {
        console.log(error.message);
        response.status(500).json({ error: error.message, success: false });
    }
});

//Delete user backup by ObjectId
router.delete('/byId/:id', async (request: Request, response: Response) => {
    if (!mongoose.Types.ObjectId.isValid(request.params.id)) {
            return response.status(400).json({ message: `Id does not conform to ObjectId format: ${request.params.id}`, success: false, valid: false });
    }
    
    try {
        const user = await UserBackup.findByIdAndDelete(request.params.id);

        if (!user) {
            return response.status(404).json({ message: `User not found: id: ${request.params.id}`, success: false, valid: true, exists: false })
        }

        response.status(200).json({ message: "User backup deleted successfully", success: true, valid: true, exists: true });
    } catch (error) {
        console.log(error.message);
        response.status(500).json({ error: error.message, success: false });
    }
});

//Delete user backup by NetId
router.delete('/byNetId/:netid', async (request: Request, response: Response) => {
    try {
        const user = await UserBackup.findOneAndDelete({ netid: { $regex: `^${request.params.netid}$`, $options: 'i'} });

        if (!user) {
            return response.status(404).json({ message: `User not found: netid: ${request.params.netid}`, success: false, exists: false })
        }
        
        response.status(200).json({ message: "User deleted successfully", success: true, exists: true });
    } catch (error) {
        console.log(error.message);
        response.status(500).json({ error: error.message, success: false });
    }
});

export default router;