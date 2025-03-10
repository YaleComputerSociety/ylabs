import { NewListing } from "../models";
import { NotFoundError, ObjectIdError } from "../utils/errors";
import { createListingBackup } from "./listingBackupServices";
import { addOwnListings, deleteOwnListings, userExists } from "./userService";
import mongoose from "mongoose";

export const createListing = async (data: any) => {
    const listing = new NewListing(data);

    // Add listing id to ownListings of all professors associated with the listing
    const listingId = listing._id;
    const professorIds = listing.professorIds;

    // Check if userExists returns true for all professor ids before proceeding
    for (const id of professorIds) {
        const user = await userExists(id);
        if (!user) {
            throw new NotFoundError(`User not found with ObjectId: ${id}`);
        }
    }

    for (const id of professorIds) {
        await addOwnListings(id, [listingId]);
    }

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

//Get data for multiple listings by ids, if not found, don't add to array instead of throwing error
export const readListings = async(ids: any[]) => {
    let listings = [];
    for (const id of ids) {
        if (mongoose.Types.ObjectId.isValid(id)) {
            const listing = await NewListing.findById(id);
            if (listing) {
                listings.push(listing.toObject());
            }
        }
    }
    return listings;
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
        // Check if userExists returns true for all professor ids before proceeding
        const professorIds = data.professorIds || [];
        for (const id of professorIds) {
            const user = await userExists(id);
            if (!user) {
                throw new NotFoundError(`User not found with ObjectId: ${id}`);
            }
        }

        const oldListing = await NewListing.findById(id);
        const listing = await NewListing.findByIdAndUpdate(id, data,
            { new: true, runValidators: true}
        );

        if (!listing || !oldListing) {
            throw new NotFoundError(`Listing not found with ObjectId: ${id}`);
        }

        // Add or remove listing from ownListings of professors based on if professorIds have changed
        const oldProfessorIds = oldListing.professorIds;
        const newProfessorIds = listing.professorIds;
        const removedIds = oldProfessorIds.filter(id => !newProfessorIds.includes(id));
        const listingId = listing._id;

        for (const id of newProfessorIds) {
            await addOwnListings(id, [listingId]);
        }
        for (const id of removedIds) {
            await deleteOwnListings(id, [listingId]);
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

export const unarchiveListing = async(id: any) => {
    const listing = await updateListing(id, {"archived": false});
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

        // Remove listing id from ownListings of all professors associated with the listing
        const oldListingId = listing._id;
        const oldProfessorIds = listing.professorIds;

        for (const id of oldProfessorIds) {
            await deleteOwnListings(id, [oldListingId]);
        }

        return backup;
    } else {
        throw new ObjectIdError("Did not received expected id type ObjectId");
    }
}