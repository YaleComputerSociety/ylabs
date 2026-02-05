import { NotFoundError, ObjectIdError } from "../utils/errors";
import mongoose from "mongoose";
import { Fellowship } from "../models/fellowship";

// Create a new fellowship
export const createFellowship = async (data: any) => {
    const fellowship = new Fellowship(data);
    await fellowship.save();
    return fellowship.toObject();
};

// Read a single fellowship by ID
export const readFellowship = async (id: any) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
        const fellowship = await Fellowship.findById(id);
        if (!fellowship) {
            throw new NotFoundError(`Fellowship not found with ObjectId: ${id}`);
        }
        return fellowship.toObject();
    } else {
        throw new ObjectIdError("Did not receive expected id type ObjectId");
    }
};

// Read multiple fellowships by IDs
export const readFellowships = async (ids: any[]) => {
    let fellowships = [];
    for (const id of ids) {
        if (mongoose.Types.ObjectId.isValid(id)) {
            const fellowship = await Fellowship.findById(id);
            if (fellowship) {
                fellowships.push(fellowship.toObject());
            }
        }
    }
    return fellowships;
};

// Read all fellowships
export const readAllFellowships = async () => {
    const fellowships = await Fellowship.find({ archived: false });
    return fellowships.map(fellowship => fellowship.toObject());
};

// Check if fellowship exists
export const fellowshipExists = async (id: any) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
        const fellowship = await Fellowship.findById(id);
        return !!fellowship;
    } else {
        throw new ObjectIdError("Did not receive expected id type ObjectId");
    }
};

// Update a fellowship
export const updateFellowship = async (id: any, data: any) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
        const fellowship = await Fellowship.findByIdAndUpdate(
            id,
            data,
            { new: true, runValidators: true }
        );

        if (!fellowship) {
            throw new NotFoundError(`Fellowship not found with ObjectId: ${id}`);
        }

        return fellowship.toObject();
    } else {
        throw new ObjectIdError("Did not receive expected id type ObjectId");
    }
};

// Archive a fellowship
export const archiveFellowship = async (id: any) => {
    return await updateFellowship(id, { archived: true });
};

// Unarchive a fellowship
export const unarchiveFellowship = async (id: any) => {
    return await updateFellowship(id, { archived: false });
};

// Add a view to a fellowship
export const addView = async (id: any) => {
    const fellowship = await readFellowship(id);
    const oldViews = fellowship.views as number || 0;
    return await updateFellowship(id, { views: oldViews + 1 });
};

// Add a favorite to a fellowship
export const addFavorite = async (id: any) => {
    const fellowship = await readFellowship(id);
    const oldFavorites = fellowship.favorites as number || 0;
    return await updateFellowship(id, { favorites: oldFavorites + 1 });
};

// Remove a favorite from a fellowship
export const removeFavorite = async (id: any) => {
    const fellowship = await readFellowship(id);
    const oldFavorites = fellowship.favorites as number || 0;
    const newFavorites = oldFavorites <= 0 ? 0 : oldFavorites - 1;
    return await updateFellowship(id, { favorites: newFavorites });
};

// Delete a fellowship
export const deleteFellowship = async (id: any) => {
    if (mongoose.Types.ObjectId.isValid(id)) {
        const fellowship = await Fellowship.findById(id);
        if (!fellowship) {
            throw new NotFoundError(`Fellowship not found with ObjectId: ${id}`);
        }
        await Fellowship.findByIdAndDelete(id);
    } else {
        throw new ObjectIdError("Did not receive expected id type ObjectId");
    }
};

// Search fellowships with filters
export const searchFellowships = async (params: {
    query?: string;
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortOrder?: number;
    yearOfStudy?: string[];
    termOfAward?: string[];
    purpose?: string[];
    globalRegions?: string[];
    citizenshipStatus?: string[];
}) => {
    const {
        query = '',
        page = 1,
        pageSize = 20,
        sortBy = 'updatedAt',
        sortOrder = -1,
        yearOfStudy = [],
        termOfAward = [],
        purpose = [],
        globalRegions = [],
        citizenshipStatus = [],
    } = params;

    // Build filter query
    const filter: any = { archived: false };

    // Text search
    if (query && query.trim()) {
        filter.$text = { $search: query };
    }

    // Array filters - use $in for OR matching within each filter
    if (yearOfStudy.length > 0) {
        filter.yearOfStudy = { $in: yearOfStudy };
    }
    if (termOfAward.length > 0) {
        filter.termOfAward = { $in: termOfAward };
    }
    if (purpose.length > 0) {
        filter.purpose = { $in: purpose };
    }
    if (globalRegions.length > 0) {
        filter.globalRegions = { $in: globalRegions };
    }
    if (citizenshipStatus.length > 0) {
        filter.citizenshipStatus = { $in: citizenshipStatus };
    }

    // Build sort options
    const sortOptions: any = {};
    if (query && query.trim()) {
        // If searching, sort by text score first
        sortOptions.score = { $meta: 'textScore' };
    }
    sortOptions[sortBy] = sortOrder;

    // Calculate pagination
    const skip = (page - 1) * pageSize;

    // Execute query
    let fellowshipsQuery = Fellowship.find(filter);

    if (query && query.trim()) {
        fellowshipsQuery = fellowshipsQuery.select({ score: { $meta: 'textScore' } });
    }

    const [fellowships, total] = await Promise.all([
        fellowshipsQuery
            .sort(sortOptions)
            .skip(skip)
            .limit(pageSize)
            .lean(),
        Fellowship.countDocuments(filter),
    ]);

    return {
        fellowships,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
    };
};

// Get distinct filter values (for populating filter dropdowns)
export const getFilterOptions = async () => {
    const [
        yearOfStudyOptions,
        termOfAwardOptions,
        purposeOptions,
        globalRegionsOptions,
        citizenshipStatusOptions,
    ] = await Promise.all([
        Fellowship.distinct('yearOfStudy', { archived: false }),
        Fellowship.distinct('termOfAward', { archived: false }),
        Fellowship.distinct('purpose', { archived: false }),
        Fellowship.distinct('globalRegions', { archived: false }),
        Fellowship.distinct('citizenshipStatus', { archived: false }),
    ]);

    return {
        yearOfStudy: yearOfStudyOptions.filter(Boolean).sort(),
        termOfAward: termOfAwardOptions.filter(Boolean).sort(),
        purpose: purposeOptions.filter(Boolean).sort(),
        globalRegions: globalRegionsOptions.filter(Boolean).sort(),
        citizenshipStatus: citizenshipStatusOptions.filter(Boolean).sort(),
    };
};

// Bulk create fellowships (for import)
export const bulkCreateFellowships = async (fellowships: any[]) => {
    const result = await Fellowship.insertMany(fellowships);
    return result.map(f => f.toObject());
};
