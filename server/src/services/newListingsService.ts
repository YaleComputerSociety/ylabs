import { NewListing } from "../models";
import { IncorrectPermissionsError, NotFoundError, ObjectIdError } from "../utils/errors";
import { createListingBackup } from "./listingBackupServices";
import { addOwnListings, deleteOwnListings, userExists, createUser, readUser } from "./userService";
import { fetchYalie } from "./yaliesService";
import { User } from "../models";
import mongoose from "mongoose";

export const createListing = async (data: any, owner: any) => {
    if (!owner.netid || !owner.email || !owner.fname || !owner.lname) {
        throw new Error('Incomplete user data for owner');
    }

    const listing = new NewListing({...data, ownerId: owner.netid, ownerEmail: owner.email, ownerFirstName: owner.fname, ownerLastName: owner.lname, confirmed: owner.userConfirmed});

    // Add listing id to ownListings of all professors associated with the listing
    const listingId = listing._id;
    const professorIds = listing.professorIds;

    for (const id of [...professorIds, owner.netid]) {
        const exists = await userExists(id);
        
        if (!exists) {
            let user = await fetchYalie(id);
            if (!user) {
                user = await createUser({
                    netid: id,
                    fname: "NA",
                    lname: "NA",
                    email: "NA",
                });
            }
        }

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

//Generate and return a skeleton listing for the given user
export const getSkeletonListing = async(userId: string) => {
    const user = await readUser(userId);
    return {
        _id: "create",
        ownerId: userId,
        ownerFirstName: user.fname,
        ownerLastName: user.lname,
        ownerEmail: user.email,
        confirmed: user.userConfirmed,
    }
}

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

export const updateListing = async(id: any, userId: string, data: any) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
        const oldListing = await NewListing.findById(id);

        if (!oldListing) {
            throw new NotFoundError(`Listing not found with ObjectId: ${id}`);
        }

        let toUpdate = [...oldListing.professorIds, oldListing.ownerId];

        if (data.professorIds) {
            toUpdate = [...toUpdate, ...data.professorIds];
        }
        if(data.ownerId) {
            toUpdate.push(data.ownerId);
        }

        // Create needed users
        for (const id of toUpdate) {
            const exists = await userExists(id);
            
            if (!exists) {
                let user = await fetchYalie(id);
                if (!user) {
                    user = await createUser({
                        netid: id,
                        fname: "NA",
                        lname: "NA",
                        email: "NA",
                    });
                }
            }
        }

        if (!oldListing.professorIds.includes(userId) && oldListing.ownerId !== userId) {
            throw new IncorrectPermissionsError(`User with id ${userId} does not have permission to update listing with id ${id}`);
        }

        const listing = await NewListing.findByIdAndUpdate(id, data,
            { new: true, runValidators: true}
        );

        if (!listing || !oldListing) {
            throw new NotFoundError(`Listing not found with ObjectId: ${id}`);
        }

        // Add or remove listing from ownListings of professors based on if professorIds have changed
        const oldProfessorIds = [...oldListing.professorIds, oldListing.ownerId];
        const newProfessorIds = [...listing.professorIds, listing.ownerId];
        const listingId = listing._id;

        for (const id of oldProfessorIds) {
            await deleteOwnListings(id, [listingId]);
        }
        for (const id of newProfessorIds) {
            await addOwnListings(id, [listingId]);
        }

        return listing.toObject();
    } else {
        throw new ObjectIdError("Did not received expected id type ObjectId");
    }
};

export const archiveListing = async(id: any, userId: string) => {
    const listing = await updateListing(id, userId, {"archived": true});
    return listing;
}

export const unarchiveListing = async(id: any, userId: string) => {
    const listing = await updateListing(id, userId, {"archived": false});
    return listing;
}

export const confirmListing = async(id: any, userId: string) => {
    const listing = await updateListing(id, userId, {"confirmed": true});
    return listing;
}

export const unconfirmListing = async(id: any, userId: string) => {
    const listing = await updateListing(id, userId, {"confirmed": false});
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
            if (userExists(id)) {
                await deleteOwnListings(id, [oldListingId]);
            }
        }

        return backup;
    } else {
        throw new ObjectIdError("Did not received expected id type ObjectId");
    }
}