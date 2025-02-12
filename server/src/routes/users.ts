import express from "express";
import mongoose from "mongoose";
import { User } from '../models';
import { UserBackup } from '../models';
import { Request, Response, Router } from "express";

const router = Router();

//Create new user
router.post("/", async (request: Request, response: Response) => {
    try {
        const user = new User(request.body);
        await user.save();
        response.status(201).json(user);
    } catch (error) {
        console.log(error.message);
        response.status(400).json({ error: error.message });
    }
});

//Read all users
router.get("/", async (request: Request, response: Response) => {
    try {
        const users = await User.find();
        response.status(200).json(users);
    } catch (error) {
        console.log(error.message);
        response.status(500).json({ error: error.message });
    }
});

//Read specific user by ObjectId
router.get('/byId/:id', async (request: Request, response: Response) => {
    if (!mongoose.Types.ObjectId.isValid(request.params.id)) {
        return response.status(400).json({ message: `Id does not conform to ObjectId format: ${request.params.id}`});
    }
    
    try {
        const user = await User.findById(request.params.id);

        if (!user) {
            return response.status(404).json({ message: `User not found: id: ${request.params.id}` });
        }
        
        response.status(200).json(user);
    } catch (error) {
        console.log(error.message);
        response.status(500).json({ error: error.message });
    }
});

//Read specific user by NetId
router.get('/byNetId/:netid', async (request: Request, response: Response) => {
    try {
        const user = await User.findOne({ netid: { $regex: `^${request.params.netid}$`, $options: 'i'} });

        if (!user) {
            return response.status(404).json({ message: `User not found: netid: ${request.params.netid}` });
        }
        
        response.status(200).json(user);
    } catch (error) {
        console.log(error.message);
        response.status(500).json({ error: error.message });
    }
});

//Update data for a specific user by ObjectId
router.put('/byId/:id', async (request: Request, response: Response) => {
    if (!mongoose.Types.ObjectId.isValid(request.params.id)) {
        return response.status(400).json({ message: `Id does not conform to ObjectId format: ${request.params.id}`});
    }
    
    try {
        const user = await User.findByIdAndUpdate(request.params.id, request.body,
            { new: true, runValidators: true }
        );

        if (!user) {
            return response.status(404).json({ message: `User not found: id: ${request.params.id}` });
        }
        
        response.status(200).json(user);
    } catch (error) {
        console.log(error.message);
        response.status(500).json({ error: error.message });
    }
});

//Update data for a specific user by NetId
router.put('/byNetId/:netid', async (request: Request, response: Response) => {
    try {
        const user = await User.findOneAndUpdate(
            { netid: { $regex: `^${request.params.netid}$`, $options: 'i'} }, 
            request.body, 
            { new: true, runValidators: true }
        );

        if (!user) {
            return response.status(404).json({ message: `User not found: netid: ${request.params.netid}` });
        }
        
        response.status(200).json(user);
    } catch (error) {
        console.log(error.message);
        response.status(500).json({ error: error.message });
    }
});

//Delete user by ObjectId and save to backup
router.delete('/byId/:id', async (request: Request, response: Response) => {
    if (!mongoose.Types.ObjectId.isValid(request.params.id)) {
        return response.status(400).json({ message: `Id does not conform to ObjectId format: ${request.params.id}`});
    }
    
    try {
        const user = await User.findById(request.params.id);

        if (!user) {
            return response.status(404).json({ message: `User not found: id: ${request.params.id}` });
        }

        const userBackup = new UserBackup(user.toObject());
        await userBackup.save();

        await User.findByIdAndDelete(request.params.id);
        
        response.status(200).json({ message: "User deleted successfully and backed up", userBackup });
    } catch (error) {
        console.log(error.message);
        response.status(500).json({ error: error.message });
    }
});

//Delete user by NetId and save to backup
router.delete('/byNetId/:netid', async (request: Request, response: Response) => {
    try {
        const user = await User.findOne({ netid: { $regex: `^${request.params.netid}$`, $options: 'i'} });

        if (!user) {
            return response.status(404).json({ message: `User not found: netid: ${request.params.netid}` });
        }

        const userBackup = new UserBackup(user.toObject());
        await userBackup.save();

        await User.findOneAndDelete({ netid: { $regex: `^${request.params.netid}$`, $options: 'i'} });
        
        response.status(200).json({ message: "User deleted successfully and backed up", userBackup });
    } catch (error) {
        console.log(error.message);
        response.status(500).json({ error: error.message });
    }
});

export default router;