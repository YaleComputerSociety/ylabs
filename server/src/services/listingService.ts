/**
 * Service layer for listing CRUD, view tracking, and favorites.
 */
import { IncorrectPermissionsError, NotFoundError, ObjectIdError } from "../utils/errors";
import { addOwnListings, deleteOwnListings, userExists, createUser, readUser } from "./userService";
import { fetchYalie } from "./yaliesService";
import mongoose from "mongoose";
import { getMeiliIndex } from "../utils/meiliClient";
import { getListingModel } from "../db/connections";
import { processListingTitle, isCustomTitle, generateSmartTitle } from "../utils/smartTitle";
import * as itemOps from './itemOperations';

export const createListing = async (data: any, owner: any) => {
    if (!owner.netid || !owner.email || !owner.fname || !owner.lname) {
        throw new Error('Incomplete user data for owner');
    }

    const processedTitle = await processListingTitle(
        data.title,
        owner.fname,
        owner.lname,
        data.departments || [],
    );

    const ownerDepts = [
        owner.primary_department,
        ...(owner.secondary_departments || []),
    ].filter(Boolean);

    const ownerResearchAreas = owner.research_interests || [];

    const listing = new (getListingModel())({
        ...data,
        title: processedTitle,
        ownerId: owner.netid,
        ownerEmail: owner.email,
        ownerFirstName: owner.fname,
        ownerLastName: owner.lname,
        ownerTitle: owner.title || '',
        ownerPrimaryDepartment: owner.primary_department || '',
        departments: ownerDepts.length > 0 ? ownerDepts : (data.departments || []),
        researchAreas: ownerResearchAreas.length > 0 ? ownerResearchAreas : (data.researchAreas || data.keywords || []),
        keywords: ownerResearchAreas.length > 0 ? ownerResearchAreas : (data.keywords || data.researchAreas || []),
        confirmed: owner.userConfirmed,
    });

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

    try {
        const doc = listing.toObject();
        const meiliDoc = { ...doc, id: doc._id.toString() };
        delete meiliDoc._id;
        delete meiliDoc.__v;
        const index = await getMeiliIndex('listings');
        await index.addDocuments([meiliDoc]);
    } catch (error) {
        console.error('Failed to sync new listing to Meilisearch:', error);
    }

    return listing.toObject();
};

export const readAllListings = async () => {
    const listings = await getListingModel().find();
    return listings.map((listing: any) => listing.toObject());
};

export const readListing = async(id: any) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
        const listing = await getListingModel().findById(id);
        if (!listing) {
            throw new NotFoundError(`Listing not found with ObjectId: ${id}`);
        }
        return listing.toObject();
    } else {
        throw new ObjectIdError("Did not received expected id type ObjectId");
    }
};

export const getSkeletonListing = async(userId: string) => {
    const user = await readUser(userId);
    const departments = [
        user.primary_department,
        ...(user.secondary_departments || []),
    ].filter(Boolean);
    return {
        _id: "create",
        ownerId: userId,
        ownerFirstName: user.fname,
        ownerLastName: user.lname,
        ownerEmail: user.email,
        ownerTitle: user.title || '',
        ownerPrimaryDepartment: user.primary_department || '',
        departments,
        researchAreas: user.research_interests || [],
        keywords: user.research_interests || [],
        confirmed: user.userConfirmed,
    }
}

export const readListings = async(ids: any[]) => {
    let listings = [];
    for (const id of ids) {
        if (mongoose.Types.ObjectId.isValid(id)) {
            const listing = await getListingModel().findById(id);
            if (listing) {
                listings.push(listing.toObject());
            }
        }
    }
    return listings;
};

export const listingExists = async(id: any) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
        const listing = await getListingModel().findById(id);
        if (!listing) {
            return false;
        }
        return true;
    } else {
        throw new ObjectIdError("Did not received expected id type ObjectId");
    }
}

export const updateListing = async(id: any, userId: string, data: any, noAuth: boolean = false, useTimestamps: boolean = true) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
        const oldListing = await getListingModel().findById(id);

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

        if (!noAuth && (!oldListing.professorIds.includes(userId) && oldListing.ownerId !== userId)) {
            throw new IncorrectPermissionsError(`User with id ${userId} does not have permission to update listing with id ${id}`);
        }

        if (data.departments && data.departments.length > 0) {
            const currentTitle = data.title || oldListing.title;
            const ownerFirstName = oldListing.ownerFirstName;
            const ownerLastName = oldListing.ownerLastName;

            if (!isCustomTitle(currentTitle, ownerFirstName, ownerLastName)) {
                const smartTitleResult = await generateSmartTitle(ownerLastName, data.departments);
                data.title = smartTitleResult.title;
            }
        }

        const listing = await getListingModel().findByIdAndUpdate(id, data,
            { new: true, runValidators: true, timestamps: useTimestamps }
        );

        if (!listing || !oldListing) {
            throw new NotFoundError(`Listing not found with ObjectId: ${id}`);
        }

        const oldProfessorIds = [...oldListing.professorIds, oldListing.ownerId];
        const newProfessorIds = [...listing.professorIds, listing.ownerId];
        const listingId = listing._id;

        for (const id of oldProfessorIds) {
            await deleteOwnListings(id, [listingId]);
        }
        for (const id of newProfessorIds) {
            await addOwnListings(id, [listingId]);
        }

        try {
            const doc = listing.toObject();
            const meiliDoc = { ...doc, id: doc._id.toString() };
            delete meiliDoc._id;
            delete meiliDoc.__v;
            const index = await getMeiliIndex('listings');
            await index.updateDocuments([meiliDoc]);
        } catch (error) {
            console.error('Failed to sync updated listing to Meilisearch:', error);
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

export const addView = async (id: any, _userId: string) => {
    return itemOps.addView(getListingModel(), id);
};

export const addFavorite = async (id: any, _userId: string) => {
    return itemOps.addFavorite(getListingModel(), id);
};

export const removeFavorite = async (id: any, _userId: string) => {
    return itemOps.removeFavorite(getListingModel(), id);
};

export const deleteListing = async(id: any) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
        const listing = await getListingModel().findById(id);
        if (!listing) {
            throw new NotFoundError(`Listing not found with ObjectId: ${id}`);
        }

        const {professorIds, professorNames, departments, emails, websites, description, keywords} = listing;
        await getListingModel().findByIdAndDelete(id);

        try {
            const index = await getMeiliIndex('listings');
            await index.deleteDocument(id.toString());
        } catch (error) {
            console.error('Failed to delete listing from Meilisearch:', error);
        }

        const oldListingId = listing._id;
        const oldProfessorIds = listing.professorIds;

        for (const id of oldProfessorIds) {
            if (await userExists(id)) {
                await deleteOwnListings(id, [oldListingId]);
            }
        }
    } else {
        throw new ObjectIdError("Did not received expected id type ObjectId");
    }
}