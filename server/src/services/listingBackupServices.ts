import { ListingBackup } from "../models";
import { NotFoundError, ObjectIdError } from "../utils/errors";
import mongoose from "mongoose";

export const createListingBackup = async (data: any) => {
    try {
        const listing = new ListingBackup(data);
        await listing.save();
        return listing.toObject();
    } catch (error) {
        throw new Error(error.message);
    }
};

export const readAllListingBackups = async () => {
    try {
        const listings = await ListingBackup.find();
        return listings.map(listing => listing.toObject());
    } catch (error) {
        throw new Error(error.message);
    }
};

export const readListingBackup = async(id: any) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
        const listing = await ListingBackup.findById(id);
        if (!listing) {
            throw new NotFoundError(`Listing backup not found with ObjectId: ${id}`);
        }
        return listing.toObject();
    } else {
        throw new ObjectIdError("Did not received expected id type ObjectId");
    }
};

export const listingBackupExists = async(id: any) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
        const listing = await ListingBackup.findById(id);
        if (!listing) {
            return false;
        }
        return true;
    } else {
        throw new ObjectIdError("Did not received expected id type ObjectId");
    }
}

export const updateListingBackup = async(id: any, data: any) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
        const listing = await ListingBackup.findByIdAndUpdate(id, data,
            { new: true, runValidators: true}
        );
        if (!listing) {
            throw new NotFoundError(`Listing backup not found with ObjectId: ${id}`);
        }
        return listing.toObject();
    } else {
        throw new ObjectIdError("Did not received expected id type ObjectId");
    }
};

export const deleteListingBackup = async(id: any) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
        const user = await ListingBackup.findByIdAndDelete(id);
        if (!user) {
            throw new NotFoundError(`Listing backup not found with ObjectId: ${id}`);
        }
        return user.toObject();
    } else {
        throw new ObjectIdError("Did not received expected id type ObjectId");
    }
}

//Restore listing backup (with addition of ownListings)
//Clear outdated