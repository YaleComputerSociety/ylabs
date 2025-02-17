import { User } from "../models";
import { NotFoundError } from "../utils/errors";
import { createUserBackup, updateUserBackup, userBackupExists } from "./userBackupService";
import mongoose from "mongoose";

export const createUser = async (userData: any) => {
    try {
        const user = new User(userData);
        await user.save();
        return user.toObject();
    } catch (error) {
        throw new Error(error.message);
    }
};

export const readAllUsers = async () => {
    try {
        const users = await User.find();
        return users.map(user => user.toObject());
    } catch (error) {
        throw new Error(error.message);
    }
};

export const readUser = async(id: any) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
        const user = await User.findById(id);
        if (!user) {
            throw new NotFoundError(`User not found with ObjectId: ${id}`);
        }
        return user.toObject();
    } else {
        const user = await User.findOne({ netid: { $regex: `^${id}$`, $options: 'i'} });
        if (!user) {
            throw new NotFoundError(`User not found with NetId: ${id}`);
        }
        return user.toObject();
    }
};

export const userExists = async(id: any) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
        const user = await User.findById(id);
        if (!user) {
            return false;
        }
        return true;
    } else {
        const user = await User.findOne({ netid: { $regex: `^${id}$`, $options: 'i'} });
        if (!user) {
            return false;
        }
        return true;
    }
}

export const updateUser = async(id: any, data: any) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
        const user = await User.findByIdAndUpdate(id, data,
            { new: true, runValidators: true}
        );
        if (!user) {
            throw new NotFoundError(`User not found with ObjectId: ${id}`);
        }
        return user.toObject();
    } else {
        const user = await User.findOneAndUpdate(
            { netid: { $regex: `^${id}$`, $options: 'i'} }, 
            data, 
            { new: true, runValidators: true }
        );
        if (!user) {
            throw new NotFoundError(`User not found with NetId: ${id}`);
        }
        return user.toObject();
    }
};

export const deleteUser = async(id: any) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
        const user = await User.findById(id);
        if (!user) {
            throw new NotFoundError(`User not found with ObjectId: ${id}`);
        }
        const {netid, email, isProfessor, fname, lname, departments, ownListings, favListings} = user;

        if (await userBackupExists(netid)) {
            await updateUserBackup(netid, {netid, email, isProfessor, fname, lname, departments, ownListings, favListings});
        } else {
            await createUserBackup({netid, email, isProfessor, fname, lname, departments, ownListings, favListings});
        }
        await User.findByIdAndDelete(id);

        return user.toObject();
    } else {
        const user = await User.findOne({ netid: { $regex: `^${id}$`, $options: 'i'} });
        if (!user) {
            throw new NotFoundError(`User not found with NetId: ${id}`);
        }
        const {netid, email, isProfessor, fname, lname, departments, ownListings, favListings} = user;


        if (await userBackupExists(netid)) {
            await updateUserBackup(id, {netid, email, isProfessor, fname, lname, departments, ownListings, favListings});
        } else {
            await createUserBackup({netid, email, isProfessor, fname, lname, departments, ownListings, favListings});
        }
        await User.findOneAndDelete({ netid: { $regex: `^${id}$`, $options: 'i'} });

        return user.toObject();
    }
}