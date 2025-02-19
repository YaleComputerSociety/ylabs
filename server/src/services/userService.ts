import { User } from "../models";
import { NotFoundError } from "../utils/errors";
import { createUserBackup, updateUserBackup, userBackupExists } from "./userBackupService";
import mongoose from "mongoose";

export const createUser = async (userData: any) => {
    const user = new User(userData);
    await user.save();
    return user.toObject();
};

export const readAllUsers = async () => {
    const users = await User.find();
    return users.map(user => user.toObject());
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

//List data routes

//Add departments
export const addDepartments = async(id: any, newDepartments: [string]) => {
    let user = await readUser(id);

    user.departments.push(...newDepartments);
    user.departments = Array.from(new Set(user.departments));

    const newUser = await updateUser(id, {"departments": user.departments});

    return newUser;
};

//Remove departments
export const deleteDepartments = async(id: any, removedDepartments: [string]) => {
    let user = await readUser(id);

    user.departments = user.departments.filter(department => removedDepartments.indexOf(department) < 0);

    const newUser = await updateUser(id, {"departments": user.departments});

    return newUser;
};

//Clear departments
export const clearDepartments = async(id: any) => {
    const newUser = await updateUser(id, {"departments": []});

    return newUser;
};

//Add own listings
export const addOwnListings = async(id: any, newListings: [mongoose.Types.ObjectId]) => {
    let user = await readUser(id);

    user.ownListings.push(...newListings);
    user.ownListings = Array.from(new Set(user.ownListings));

    const newUser = await updateUser(id, {"ownListings": user.ownListings});

    return newUser;
};

//Remove own listings
export const deleteOwnListings = async(id: any, removedListings: [mongoose.Types.ObjectId]) => {
    let user = await readUser(id);

    user.ownListings = user.ownListings.filter(listing => removedListings.indexOf(listing) < 0);

    const newUser = await updateUser(id, {"ownListings": user.ownListings});

    return newUser;
};

//Clear own listings
export const clearOwnListings = async(id: any) => {
    const newUser = await updateUser(id, {"ownListings": []});

    return newUser;
};

//Add fav listings
export const addFavListings = async(id: any, newListings: [mongoose.Types.ObjectId]) => {
    let user = await readUser(id);

    user.favListings.push(...newListings);
    user.favListings = Array.from(new Set(user.favListings));

    const newUser = await updateUser(id, {"favListings": user.favListings});

    return newUser;
};

//Remove fav listings
export const deleteFavListings = async(id: any, removedListings: [mongoose.Types.ObjectId]) => {
    let user = await readUser(id);

    user.favListings = user.favListings.filter(listing => removedListings.indexOf(listing) < 0);

    const newUser = await updateUser(id, {"favListings": user.favListings});

    return newUser;
};

//Clear fav listings
export const clearFavListings = async(id: any) => {
    const newUser = await updateUser(id, {"favListings": []});

    return newUser;
};