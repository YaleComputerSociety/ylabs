import { User } from "../models";
import { NotFoundError } from "../utils/errors";
import { createUserBackup, updateUserBackup, userBackupExists } from "./userBackupService";
import { readListing, confirmListing, unconfirmListing, addFavorite, removeFavorite } from "./newListingsService";
import mongoose from "mongoose";

export const createUser = async (userData: any) => {
    const user = new User(userData);
    await user.save();
    return user.toObject();
};

export const readAllUsers = async () => {
    const users = await User.find();
    return users.map((user: any) => user.toObject());
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

export const validateUser = async(id: any) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
        const user = await User.findById(id);
        if (!user) {
            return null;
        }
        return user.toObject();
    } else {
        const user = await User.findOne({ netid: { $regex: `^${id}$`, $options: 'i'} });
        if (!user) {
            return null;
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

export const confirmUser = async(id: any) => {
    const user = await updateUser(id, { userConfirmed: true });
    for (const id of user.ownListings) {
        const listing = await readListing(id);
        if (listing && listing.ownerId === user.netid) {
            await confirmListing(id, user.netid);
        }
    }
    return user;
};

export const unconfirmUser = async(id: any) => {
    const user = await updateUser(id, { userConfirmed: false });
    for (const id of user.ownListings) {
        const listing = await readListing(id);
        if (listing && listing.ownerId === user.netid) {
            await unconfirmListing(id, user.netid);
        }
    }
    return user;
};

export const deleteUser = async(id: any) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
        const user = await User.findById(id);
        if (!user) {
            throw new NotFoundError(`User not found with ObjectId: ${id}`);
        }

        const {netid, email, userType, userConfirmed, fname, lname, website, bio, departments, ownListings, favListings} = user;
        const userBackupData = Object.fromEntries(
            Object.entries({netid, email, userType, userConfirmed, fname, lname, website, bio, departments, ownListings, favListings})
                .filter(([_, value]) => value !== undefined)
        );

        if (await userBackupExists(netid)) {
            await updateUserBackup(netid, userBackupData);
        } else {
            await createUserBackup(userBackupData);
        }
        await User.findByIdAndDelete(id);

        return user.toObject();
    } else {
        const user = await User.findOne({ netid: { $regex: `^${id}$`, $options: 'i'} });
        if (!user) {
            throw new NotFoundError(`User not found with NetId: ${id}`);
        }
        
        const {netid, email, userType, userConfirmed, fname, lname, website, bio, departments, ownListings, favListings} = user;
        const userBackupData = Object.fromEntries(
            Object.entries({netid, email, userType, userConfirmed, fname, lname, website, bio, departments, ownListings, favListings})
                .filter(([_, value]) => value !== undefined)
        );

        let backup;

        if (await userBackupExists(netid)) {
            backup = await updateUserBackup(id, userBackupData);
        } else {
            backup = await createUserBackup(userBackupData);
        }
        await User.findOneAndDelete({ netid: { $regex: `^${id}$`, $options: 'i'} });

        return backup;
    }
}

//List data routes

//Add departments
export const addDepartments = async(id: any, newDepartments: [string]) => {
    let user = await readUser(id);

    user.departments.unshift(...newDepartments);
    user.departments = Array.from(new Set(user.departments));

    const newUser = await updateUser(id, {"departments": user.departments});

    return newUser;
};

//Remove departments
export const deleteDepartments = async(id: any, removedDepartments: [string]) => {
    let user = await readUser(id);

    user.departments = user.departments.filter((department: string) => 
        removedDepartments.indexOf(department) < 0);

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

    user.ownListings.unshift(...Listings);
user.ownListings = Array.from(new Set(user.ownListings.map((listing: any) => listing.toString())))
    .map(listing => new mongoose.Types.ObjectId(listing as string));

    const newUser = await updateUser(id, {"ownListings": user.ownListings});

    return newUser;
};

//Remove own listings
export const deleteOwnListings = async(id: any, removedListings: [mongoose.Types.ObjectId]) => {
    let user = await readUser(id);

    const removedListingsStrings = removedListings.map(listing => listing.toString());

    user.ownListings = user.ownListings.filter((listing: any) => removedListingsStrings.indexOf(listing.toString()) < 0);

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

    user.favListings.unshift(...Listings);
    user.favListings = Array.from(new Set(user.favListings.map((listing: any) => listing.toString()))).map(listing => new mongoose.Types.ObjectId(listing));

    const newUser = await updateUser(id, {"favListings": user.favListings});

    for (const listingId of newListings) {
        await addFavorite(listingId.toString(), id);
    }

    return newUser;
};

//Remove fav listings
export const deleteFavListings = async(id: any, removedListings: [mongoose.Types.ObjectId]) => {
    let user = await readUser(id);

    const removedListingsStrings = removedListings.map(listing => listing.toString());

    user.favListings = user.favListings.filter((listing: any) => removedListingsStrings.indexOf(listing.toString()) < 0);

    const newUser = await updateUser(id, {"favListings": user.favListings});

    for (const listingId of removedListings) {
        await removeFavorite(listingId.toString(), id);
    }

    return newUser;
};

//Clear fav listings
export const clearFavListings = async(id: any) => {
    const newUser = await updateUser(id, {"favListings": []});

    return newUser;
};