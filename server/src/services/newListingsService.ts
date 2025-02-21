import { NewListing } from "../models";
import { NotFoundError, ObjectIdError } from "../utils/errors";
import { createListingBackup } from "./listingBackupServices";
import { readUser } from "./userService";
import mongoose from "mongoose";

export const createListing = async (netid: string, data: any) => {
    data.professorIds = data.professorIds === undefined ? [] : data.professorIds;
    data.professorNames = data.professorNames === undefined ? [] : data.professorNames;
    data.emails = data.emails === undefined ? [] : data.emails;

    const user = await readUser(netid);

    if (data.professorIds.indexOf(user.netid) < 0) {data.professorIds.push(user.netid);}
    if (data.professorNames.indexOf(`${user.fname} ${user.lname}`) < 0) {data.professorNames.push(`${user.fname} ${user.lname}`);}
    if (data.emails.indexOf(user.email) < 0) {data.emails.push(user.email);}

    const listing = new NewListing(data);
    await listing.save();
    return listing.toObject();
};

export const readAllListings = async () => {
    const listings = await NewListing.find();
    return listings.map(listing => listing.toObject());
};

export const readListing = async(id: any) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
        const listing = await NewListing.findById(id);
        if (!listing) {
            throw new NotFoundError(`Listing not found with ObjectId: ${id}`);
        }
        return listing.toObject();
    } else {
        throw new ObjectIdError("Did not received expected id type ObjectId");
    }
};

export const listingExists = async(id: any) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
        const listing = await NewListing.findById(id);
        if (!listing) {
            return false;
        }
        return true;
    } else {
        throw new ObjectIdError("Did not received expected id type ObjectId");
    }
}

/*export const searchListings = async(id: any) => {
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
};*/

export const updateListing = async(id: any, data: any) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
        const listing = await NewListing.findByIdAndUpdate(id, data,
            { new: true, runValidators: true}
        );
        if (!listing) {
            throw new NotFoundError(`Listing not found with ObjectId: ${id}`);
        }
        return listing.toObject();
    } else {
        throw new ObjectIdError("Did not received expected id type ObjectId");
    }
};

export const archiveListing = async(id: any) => {
    const listing = await updateListing(id, {"archived": true});
    return listing;
}

export const deleteListing = async(id: any) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
        const listing = await NewListing.findById(id);
        if (!listing) {
            throw new NotFoundError(`Listing not found with ObjectId: ${id}`);
        }

        const {professorIds, professorNames, departments, emails, websites, description, keywords} = listing;
        const listingBackupData = Object.fromEntries(
            Object.entries({professorIds, professorNames, departments, emails, websites, description, keywords})
                .filter(([_, value]) => value !== undefined)
        );

        const backup = await createListingBackup(listingBackupData);
        await NewListing.findByIdAndDelete(id);

        return backup;
    } else {
        throw new ObjectIdError("Did not received expected id type ObjectId");
    }
}