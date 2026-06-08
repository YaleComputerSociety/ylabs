/**
 * Service layer for listing CRUD, view tracking, and favorites.
 */
import { IncorrectPermissionsError, NotFoundError, ObjectIdError } from '../utils/errors';
import { addOwnListings, deleteOwnListings, userExists, createUser, readUser } from './userService';
import { fetchYalie } from './yaliesService';
import mongoose from 'mongoose';
import { getMeiliIndex } from '../utils/meiliClient';
import { getListingModel } from '../db/connections';
import { processListingTitle, isCustomTitle, generateSmartTitle } from '../utils/smartTitle';
import * as itemOps from './itemOperations';
import { materializePostedOpportunityFromListing } from './postedOpportunityService';
import { findOrCreateForOwner } from './researchGroupService';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { buildListingResearchEntityProfilePatch } from './listingResearchEntityProfile';

const placeholderYaleEmail = (netid: string): string => `${netid.trim().toLowerCase()}@yale.edu`;

async function syncPostedOpportunityBridge(listing: any): Promise<void> {
  try {
    await materializePostedOpportunityFromListing(listing);
  } catch (error) {
    console.error('Failed to sync listing to PostedOpportunity:', error);
  }
}

async function syncResearchEntityProfileFromListing(listing: any): Promise<void> {
  const researchEntityId = listing?.researchEntityId || listing?.researchGroupId;
  if (!researchEntityId || !mongoose.Types.ObjectId.isValid(researchEntityId)) return;

  try {
    const entity = await ResearchEntity.findById(researchEntityId).lean();
    if (!entity) return;
    const patch = buildListingResearchEntityProfilePatch({ entity, listing });
    if (Object.keys(patch).length === 0) return;
    await ResearchEntity.updateOne({ _id: researchEntityId }, { $set: patch });
  } catch (error) {
    console.error('Failed to sync listing profile fields to ResearchEntity:', error);
  }
}

const LISTING_ENTITY_AUTHOR_ROLES = [
  'pi',
  'co-pi',
  'director',
  'co-director',
  'core-faculty',
];

const hasListingEntityAuthority = async (researchEntityId: unknown, owner: any): Promise<boolean> => {
  if (!researchEntityId || !mongoose.Types.ObjectId.isValid(researchEntityId as any)) {
    return false;
  }

  const identityClauses: Record<string, any>[] = [];
  if (owner?._id && mongoose.Types.ObjectId.isValid(owner._id)) {
    identityClauses.push({ userId: owner._id });
  }
  if (owner?.facultyMemberId && mongoose.Types.ObjectId.isValid(owner.facultyMemberId)) {
    identityClauses.push({ facultyMemberId: owner.facultyMemberId });
  }

  if (identityClauses.length === 0) {
    return false;
  }

  const membership = await ResearchGroupMember.findOne({
    researchEntityId,
    archived: { $ne: true },
    isCurrentMember: { $ne: false },
    role: { $in: LISTING_ENTITY_AUTHOR_ROLES },
    $or: identityClauses,
  })
    .select('_id')
    .lean();

  return Boolean(membership);
};

const resolveListingResearchEntityId = async (data: any, owner: any): Promise<any> => {
  const suppliedResearchEntityId = data?.researchEntityId || data?.researchGroupId;
  if (await hasListingEntityAuthority(suppliedResearchEntityId, owner)) {
    return suppliedResearchEntityId;
  }

  const { group } = await findOrCreateForOwner({
    _id: owner._id,
    netid: owner.netid,
    fname: owner.fname,
    lname: owner.lname,
    primaryDepartment: owner.primaryDepartment,
  });
  return group?._id;
};

const LISTING_SELF_CREATABLE_FIELDS = [
  'title',
  'hiringStatus',
  'websites',
  'description',
  'applicantDescription',
  'researchAreas',
  'keywords',
  'established',
  'departments',
  'type',
  'commitment',
  'compensationType',
  'expiresAt',
] as const;

const filterListingCreateData = (data: any): Record<string, any> => {
  const safeData: Record<string, any> = {};
  if (!data || typeof data !== 'object') return safeData;
  for (const field of LISTING_SELF_CREATABLE_FIELDS) {
    if (data[field] !== undefined) {
      safeData[field] = data[field];
    }
  }
  return safeData;
};

const LISTING_SELF_UPDATABLE_FIELDS = [
  'title',
  'hiringStatus',
  'websites',
  'description',
  'applicantDescription',
  'researchAreas',
  'keywords',
  'established',
  'departments',
  'type',
  'commitment',
  'compensationType',
  'expiresAt',
] as const;

const LISTING_OWNER_STATE_FIELDS = ['archived', 'confirmed'] as const;

const filterSelfServiceListingUpdateData = (
  data: any,
  options: { allowOwnerStateFields?: boolean } = {},
): Record<string, any> => {
  const safeData: Record<string, any> = {};
  if (!data || typeof data !== 'object') return safeData;
  for (const field of LISTING_SELF_UPDATABLE_FIELDS) {
    if (data[field] !== undefined) {
      safeData[field] = data[field];
    }
  }
  if (options.allowOwnerStateFields) {
    for (const field of LISTING_OWNER_STATE_FIELDS) {
      if (data[field] !== undefined) {
        safeData[field] = data[field];
      }
    }
  }
  return safeData;
};

export const createListing = async (data: any, owner: any) => {
  if (!owner.netid || !owner.email || !owner.fname || !owner.lname) {
    throw new Error('Incomplete user data for owner');
  }

  const safeData = filterListingCreateData(data);
  const processedTitle = await processListingTitle(
    safeData.title,
    owner.fname,
    owner.lname,
    safeData.departments || [],
  );

  const ownerDepts = [owner.primaryDepartment, ...(owner.secondaryDepartments || [])].filter(
    Boolean,
  );

  const ownerResearchAreas = owner.researchInterests || [];
  let researchEntityId;
  try {
    researchEntityId = await resolveListingResearchEntityId(data, owner);
  } catch (error) {
    console.error('Failed to attach listing to ResearchEntity:', error);
  }

  const listing = new (getListingModel())({
    ...safeData,
    researchEntityId,
    researchGroupId: researchEntityId,
    createdByUserId: owner._id,
    title: processedTitle,
    ownerId: owner.netid,
    ownerEmail: owner.email,
    ownerFirstName: owner.fname,
    ownerLastName: owner.lname,
    ownerTitle: owner.title || '',
    ownerPrimaryDepartment: owner.primaryDepartment || '',
    departments: ownerDepts.length > 0 ? ownerDepts : safeData.departments || [],
    researchAreas:
      ownerResearchAreas.length > 0
        ? ownerResearchAreas
        : safeData.researchAreas || safeData.keywords || [],
    keywords:
      ownerResearchAreas.length > 0
        ? ownerResearchAreas
        : safeData.keywords || safeData.researchAreas || [],
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
          fname: id,
          lname: id,
          email: placeholderYaleEmail(id),
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

  const savedListing = listing.toObject();
  await syncPostedOpportunityBridge(savedListing);
  await syncResearchEntityProfileFromListing(savedListing);

  return savedListing;
};

export const readAllListings = async () => {
  const listings = await getListingModel().find();
  return listings.map((listing: any) => listing.toObject());
};

export const readListing = async (id: any) => {
  if (mongoose.Types.ObjectId.isValid(id)) {
    const listing = await getListingModel().findById(id);
    if (!listing) {
      throw new NotFoundError(`Listing not found with ObjectId: ${id}`);
    }
    return listing.toObject();
  } else {
    throw new ObjectIdError('Did not received expected id type ObjectId');
  }
};

export const getSkeletonListing = async (userId: string) => {
  const user = await readUser(userId);
  const departments = [user.primaryDepartment, ...(user.secondaryDepartments || [])].filter(
    Boolean,
  );
  return {
    _id: 'create',
    ownerId: userId,
    ownerFirstName: user.fname,
    ownerLastName: user.lname,
    ownerEmail: user.email,
    ownerTitle: user.title || '',
    ownerPrimaryDepartment: user.primaryDepartment || '',
    departments,
    researchAreas: user.researchInterests || [],
    keywords: user.researchInterests || [],
    confirmed: user.userConfirmed,
  };
};

export const readListings = async (ids: any[]) => {
  const listings = [];
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

export const listingExists = async (id: any) => {
  if (mongoose.Types.ObjectId.isValid(id)) {
    const listing = await getListingModel().findById(id);
    if (!listing) {
      return false;
    }
    return true;
  } else {
    throw new ObjectIdError('Did not received expected id type ObjectId');
  }
};

export const updateListing = async (
  id: any,
  userId: string,
  data: any,
  noAuth: boolean = false,
  useTimestamps: boolean = true,
  allowOwnerStateFields: boolean = false,
) => {
  if (mongoose.Types.ObjectId.isValid(id)) {
    const safeData = noAuth
      ? { ...data }
      : filterSelfServiceListingUpdateData(data, { allowOwnerStateFields });
    const oldListing = await getListingModel().findById(id);

    if (!oldListing) {
      throw new NotFoundError(`Listing not found with ObjectId: ${id}`);
    }

    let toUpdate = [...oldListing.professorIds, oldListing.ownerId];

    if (safeData.professorIds) {
      toUpdate = [...toUpdate, ...safeData.professorIds];
    }
    if (safeData.ownerId) {
      toUpdate.push(safeData.ownerId);
    }

    for (const id of toUpdate) {
      const exists = await userExists(id);

      if (!exists) {
        let user = await fetchYalie(id);
        if (!user) {
          user = await createUser({
            netid: id,
            fname: id,
            lname: id,
            email: placeholderYaleEmail(id),
          });
        }
      }
    }

    if (!noAuth && !oldListing.professorIds.includes(userId) && oldListing.ownerId !== userId) {
      throw new IncorrectPermissionsError(
        `User with id ${userId} does not have permission to update listing with id ${id}`,
      );
    }

    if (safeData.departments && safeData.departments.length > 0) {
      const currentTitle = safeData.title || oldListing.title;
      const ownerFirstName = oldListing.ownerFirstName;
      const ownerLastName = oldListing.ownerLastName;

      if (!isCustomTitle(currentTitle, ownerFirstName, ownerLastName)) {
        const smartTitleResult = await generateSmartTitle(ownerLastName, safeData.departments);
        safeData.title = smartTitleResult.title;
      }
    }

    const listing = await getListingModel().findByIdAndUpdate(id, safeData, {
      new: true,
      runValidators: true,
      timestamps: useTimestamps,
    });

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

    const updatedListing = listing.toObject();
    await syncPostedOpportunityBridge(updatedListing);
    await syncResearchEntityProfileFromListing(updatedListing);

    return updatedListing;
  } else {
    throw new ObjectIdError('Did not received expected id type ObjectId');
  }
};

export const archiveListing = async (id: any, userId: string) => {
  const listing = await updateListing(id, userId, { archived: true }, false, true, true);
  return listing;
};

export const unarchiveListing = async (id: any, userId: string) => {
  const listing = await updateListing(id, userId, { archived: false }, false, true, true);
  return listing;
};

export const confirmListing = async (id: any, userId: string) => {
  const listing = await updateListing(id, userId, { confirmed: true }, false, true, true);
  return listing;
};

export const unconfirmListing = async (id: any, userId: string) => {
  const listing = await updateListing(id, userId, { confirmed: false }, false, true, true);
  return listing;
};

export const addView = async (id: any, _userId: string) => {
  return itemOps.addView(getListingModel(), id);
};

export const addFavorite = async (id: any, _userId: string) => {
  return itemOps.addFavorite(getListingModel(), id);
};

export const removeFavorite = async (id: any, _userId: string) => {
  return itemOps.removeFavorite(getListingModel(), id);
};

export const deleteListing = async (id: any) => {
  if (mongoose.Types.ObjectId.isValid(id)) {
    const listing = await getListingModel().findById(id);
    if (!listing) {
      throw new NotFoundError(`Listing not found with ObjectId: ${id}`);
    }

    await getListingModel().findByIdAndDelete(id);

    try {
      const index = await getMeiliIndex('listings');
      await index.deleteDocument(id.toString());
    } catch (error) {
      console.error('Failed to delete listing from Meilisearch:', error);
    }

    const oldListingId = listing._id;
    const oldProfessorIds = listing.professorIds;

    await syncPostedOpportunityBridge({
      ...listing.toObject(),
      archived: true,
    });

    for (const id of oldProfessorIds) {
      if (await userExists(id)) {
        await deleteOwnListings(id, [oldListingId]);
      }
    }
  } else {
    throw new ObjectIdError('Did not received expected id type ObjectId');
  }
};
