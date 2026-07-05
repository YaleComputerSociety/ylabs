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
import { serializedDocumentId } from '../utils/idSerialization';
import { publicHttpUrl } from '../utils/urlSafety';
import { sanitizeLogValue } from '../utils/logSanitizer';

const LISTING_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const MAX_LISTING_ID_READS = 100;
const PUBLIC_LISTING_MUTATION_FILTER = {
  archived: false,
  confirmed: true,
};

const prepareListingForMeili = (doc: any) => {
  const id = serializedDocumentId(doc._id) || serializedDocumentId(doc.id);
  if (!id) return null;

  const meiliDoc = { ...doc, id };
  delete meiliDoc._id;
  delete meiliDoc.__v;
  delete meiliDoc.embedding;
  if (meiliDoc.evidence && typeof meiliDoc.evidence === 'object') {
    delete meiliDoc.evidence.internalNotes;
  }
  return meiliDoc;
};

export function normalizeListingObjectId(value: unknown): string | undefined {
  const id =
    typeof value === 'string'
      ? value.trim()
      : value instanceof mongoose.Types.ObjectId
        ? value.toHexString()
        : '';
  return LISTING_OBJECT_ID_RE.test(id) ? id : undefined;
}

const placeholderYaleEmail = (netid: string): string => `${netid.trim().toLowerCase()}@yale.edu`;

async function syncPostedOpportunityBridge(listing: any): Promise<void> {
  try {
    await materializePostedOpportunityFromListing(listing);
  } catch (error) {
    console.error('Failed to sync listing to PostedOpportunity:', sanitizeLogValue(error));
  }
}

async function syncResearchEntityProfileFromListing(listing: any): Promise<void> {
  const researchEntityId = listing?.researchEntityId || listing?.researchGroupId;
  const safeResearchEntityId = normalizeListingObjectId(researchEntityId);
  if (!safeResearchEntityId) return;

  try {
    const entity = await ResearchEntity.findById(safeResearchEntityId).lean();
    if (!entity) return;
    const patch = buildListingResearchEntityProfilePatch({ entity, listing });
    if (Object.keys(patch).length === 0) return;
    await ResearchEntity.updateOne({ _id: safeResearchEntityId }, { $set: patch });
  } catch (error) {
    console.error('Failed to sync listing profile fields to ResearchEntity:', sanitizeLogValue(error));
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
  const safeResearchEntityId = normalizeListingObjectId(researchEntityId);
  if (!safeResearchEntityId) {
    return false;
  }

  const identityClauses: Record<string, any>[] = [];
  const ownerUserId = normalizeListingObjectId(owner?._id);
  if (ownerUserId) {
    identityClauses.push({ userId: ownerUserId });
  }
  const ownerFacultyMemberId = normalizeListingObjectId(owner?.facultyMemberId);
  if (ownerFacultyMemberId) {
    identityClauses.push({ facultyMemberId: ownerFacultyMemberId });
  }

  if (identityClauses.length === 0) {
    return false;
  }

  const membership = await ResearchGroupMember.findOne({
    researchEntityId: safeResearchEntityId,
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
  const suppliedResearchEntityId = normalizeListingObjectId(data?.researchEntityId || data?.researchGroupId);
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

const MAX_SELF_SERVICE_LISTING_TITLE_LENGTH = 160;
const MAX_SELF_SERVICE_LISTING_DESCRIPTION_LENGTH = 5000;
const MAX_SELF_SERVICE_LISTING_APPLICANT_DESCRIPTION_LENGTH = 3000;
const MAX_SELF_SERVICE_LISTING_TEXT_LENGTH = 160;
const MAX_SELF_SERVICE_LISTING_ARRAY_ITEMS = 50;
const MAX_SELF_SERVICE_LISTING_ARRAY_VALUE_LENGTH = 120;
const MAX_SELF_SERVICE_LISTING_WEBSITES = 20;
const MAX_SELF_SERVICE_LISTING_URL_LENGTH = 2048;
const MAX_ADMIN_LISTING_NETID_LENGTH = 12;
const MAX_ADMIN_LISTING_NUMBER = 1_000_000;
const LISTING_NETID_RE = /^[A-Za-z0-9]{2,12}$/;

const boundedListingString = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  return value.trim().slice(0, maxLength);
};

const boundedListingStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value
    .slice(0, MAX_SELF_SERVICE_LISTING_ARRAY_ITEMS)
    .flatMap((item) => {
      const normalized = boundedListingString(item, MAX_SELF_SERVICE_LISTING_ARRAY_VALUE_LENGTH);
      return normalized ? [normalized] : [];
    });
};

const boundedListingWebsiteArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value
    .slice(0, MAX_SELF_SERVICE_LISTING_WEBSITES)
    .flatMap((item) => {
      const url = publicHttpUrl(item);
      return url && url.length <= MAX_SELF_SERVICE_LISTING_URL_LENGTH ? [url] : [];
    });
};

const boundedListingNumber = (
  value: unknown,
  { min = 0, max = MAX_ADMIN_LISTING_NUMBER }: { min?: number; max?: number } = {},
): number | undefined => {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(number) || number < min || number > max) return undefined;
  return Math.trunc(number);
};

const boundedListingDate = (value: unknown): Date | undefined => {
  if (value === null || value === '') return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const boundedListingNetid = (value: unknown): string | undefined => {
  const netid = boundedListingString(value, MAX_ADMIN_LISTING_NETID_LENGTH)?.toLowerCase();
  return netid && LISTING_NETID_RE.test(netid) ? netid : undefined;
};

const boundedListingNetidArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value
    .slice(0, MAX_SELF_SERVICE_LISTING_ARRAY_ITEMS)
    .flatMap((item) => {
      const netid = boundedListingNetid(item);
      return netid ? [netid] : [];
    });
};

const sanitizeSelfServiceListingPayload = (safeData: Record<string, any>) => {
  if ('title' in safeData) {
    const title = boundedListingString(safeData.title, MAX_SELF_SERVICE_LISTING_TITLE_LENGTH);
    if (title !== undefined) safeData.title = title;
    else delete safeData.title;
  }

  if ('description' in safeData) {
    const description = boundedListingString(
      safeData.description,
      MAX_SELF_SERVICE_LISTING_DESCRIPTION_LENGTH,
    );
    if (description !== undefined) safeData.description = description;
    else delete safeData.description;
  }

  if ('applicantDescription' in safeData) {
    const applicantDescription = boundedListingString(
      safeData.applicantDescription,
      MAX_SELF_SERVICE_LISTING_APPLICANT_DESCRIPTION_LENGTH,
    );
    if (applicantDescription !== undefined) safeData.applicantDescription = applicantDescription;
    else delete safeData.applicantDescription;
  }

  for (const field of ['hiringStatus', 'commitment', 'type', 'compensationType']) {
    if (field in safeData) {
      const value = boundedListingString(safeData[field], MAX_SELF_SERVICE_LISTING_TEXT_LENGTH);
      if (value !== undefined) safeData[field] = value;
      else delete safeData[field];
    }
  }

  if ('established' in safeData) {
    const established = boundedListingNumber(safeData.established);
    if (established !== undefined) safeData.established = established;
    else delete safeData.established;
  }

  if ('expiresAt' in safeData) {
    const expiresAt = boundedListingDate(safeData.expiresAt);
    if (expiresAt !== undefined) safeData.expiresAt = expiresAt;
    else delete safeData.expiresAt;
  }

  if ('websites' in safeData) {
    const websites = boundedListingWebsiteArray(safeData.websites);
    if (websites !== undefined) safeData.websites = websites;
    else delete safeData.websites;
  }

  for (const field of ['researchAreas', 'keywords', 'departments']) {
    if (field in safeData) {
      const values = boundedListingStringArray(safeData[field]);
      if (values !== undefined) safeData[field] = values;
      else delete safeData[field];
    }
  }
};

const filterListingCreateData = (data: any): Record<string, any> => {
  const safeData: Record<string, any> = {};
  if (!data || typeof data !== 'object') return safeData;
  for (const field of LISTING_SELF_CREATABLE_FIELDS) {
    if (data[field] !== undefined) {
      safeData[field] = data[field];
    }
  }
  sanitizeSelfServiceListingPayload(safeData);
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
  sanitizeSelfServiceListingPayload(safeData);
  return safeData;
};

const filterAdminListingUpdateData = (data: any): Record<string, any> => {
  const safeData: Record<string, any> = {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) return safeData;

  for (const field of LISTING_SELF_UPDATABLE_FIELDS) {
    if (data[field] !== undefined) {
      safeData[field] = data[field];
    }
  }

  for (const field of LISTING_OWNER_STATE_FIELDS) {
    if (typeof data[field] === 'boolean') {
      safeData[field] = data[field];
    }
  }

  for (const field of ['ownerFirstName', 'ownerLastName', 'ownerEmail', 'ownerTitle', 'ownerPrimaryDepartment']) {
    if (data[field] !== undefined) {
      const value = boundedListingString(data[field], MAX_SELF_SERVICE_LISTING_TEXT_LENGTH);
      if (value !== undefined) safeData[field] = value;
    }
  }

  if (data.ownerId !== undefined) {
    const ownerId = boundedListingNetid(data.ownerId);
    if (ownerId !== undefined) safeData.ownerId = ownerId;
  }
  if (data.professorIds !== undefined) {
    const professorIds = boundedListingNetidArray(data.professorIds);
    if (professorIds !== undefined) safeData.professorIds = professorIds;
  }
  for (const field of ['professorNames', 'emails']) {
    if (data[field] !== undefined) {
      const values = boundedListingStringArray(data[field]);
      if (values !== undefined) safeData[field] = values;
    }
  }

  for (const field of ['researchEntityId', 'researchGroupId', 'createdByUserId']) {
    if (data[field] !== undefined) {
      const id = normalizeListingObjectId(data[field]);
      if (id !== undefined) safeData[field] = id;
    }
  }

  for (const field of ['hiringStatus', 'established', 'views', 'favorites']) {
    if (data[field] !== undefined) {
      const value = boundedListingNumber(data[field]);
      if (value !== undefined) safeData[field] = value;
    }
  }

  for (const field of ['expiresAt', 'archivedAt']) {
    if (data[field] !== undefined) {
      const value = boundedListingDate(data[field]);
      if (value !== undefined) safeData[field] = value;
    }
  }

  sanitizeSelfServiceListingPayload(safeData);
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
    console.error('Failed to attach listing to ResearchEntity:', sanitizeLogValue(error));
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
    const meiliDoc = prepareListingForMeili(doc);
    if (meiliDoc) {
      const index = await getMeiliIndex('listings');
      await index.addDocuments([meiliDoc]);
    }
  } catch (error) {
    console.error('Failed to sync new listing to Meilisearch:', sanitizeLogValue(error));
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
  const safeId = normalizeListingObjectId(id);
  if (safeId) {
    const listing = await getListingModel().findById(safeId);
    if (!listing) {
      throw new NotFoundError('Listing not found');
    }
    return listing.toObject();
  } else {
    throw new ObjectIdError('Did not received expected id type ObjectId');
  }
};

export const readPublicListing = async (id: any) => {
  const safeId = normalizeListingObjectId(id);
  if (safeId) {
    const listing = await getListingModel().findOne({
      _id: safeId,
      ...PUBLIC_LISTING_MUTATION_FILTER,
    });
    if (!listing) {
      throw new NotFoundError('Listing not found');
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
  const requestedIds = Array.isArray(ids) ? ids : [];
  for (const id of requestedIds.slice(0, MAX_LISTING_ID_READS)) {
    const safeId = normalizeListingObjectId(id);
    if (safeId) {
      const listing = await getListingModel().findById(safeId);
      if (listing) {
        listings.push(listing.toObject());
      }
    }
  }
  return listings;
};

export const readPublicListings = async (ids: any[]) => {
  const listings = [];
  const requestedIds = Array.isArray(ids) ? ids : [];
  for (const id of requestedIds.slice(0, MAX_LISTING_ID_READS)) {
    const safeId = normalizeListingObjectId(id);
    if (safeId) {
      const listing = await getListingModel().findOne({
        _id: safeId,
        ...PUBLIC_LISTING_MUTATION_FILTER,
      });
      if (listing) {
        listings.push(listing.toObject());
      }
    }
  }
  return listings;
};

export const listingExists = async (id: any) => {
  const safeId = normalizeListingObjectId(id);
  if (safeId) {
    const listing = await getListingModel().findById(safeId);
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
  const safeId = normalizeListingObjectId(id);
  if (safeId) {
    const safeData = noAuth
      ? filterAdminListingUpdateData(data)
      : filterSelfServiceListingUpdateData(data, { allowOwnerStateFields });
    const oldListing = await getListingModel().findById(safeId);

    if (!oldListing) {
      throw new NotFoundError('Listing not found');
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
      throw new IncorrectPermissionsError('Forbidden');
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

    const listing = await getListingModel().findByIdAndUpdate(safeId, safeData, {
      new: true,
      runValidators: true,
      timestamps: useTimestamps,
    });

    if (!listing || !oldListing) {
      throw new NotFoundError('Listing not found');
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
      const meiliDoc = prepareListingForMeili(doc);
      if (meiliDoc) {
        const index = await getMeiliIndex('listings');
        await index.updateDocuments([meiliDoc]);
      }
    } catch (error) {
      console.error('Failed to sync updated listing to Meilisearch:', sanitizeLogValue(error));
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
  return itemOps.addView(getListingModel(), id, PUBLIC_LISTING_MUTATION_FILTER);
};

export const addFavorite = async (id: any, _userId: string) => {
  return itemOps.addFavorite(getListingModel(), id, PUBLIC_LISTING_MUTATION_FILTER);
};

export const removeFavorite = async (id: any, _userId: string) => {
  return itemOps.removeFavorite(getListingModel(), id, PUBLIC_LISTING_MUTATION_FILTER);
};

export const deleteListing = async (id: any) => {
  const safeId = normalizeListingObjectId(id);
  if (safeId) {
    const listing = await getListingModel().findById(safeId);
    if (!listing) {
      throw new NotFoundError('Listing not found');
    }

    await getListingModel().findByIdAndDelete(safeId);

    try {
      const index = await getMeiliIndex('listings');
      await index.deleteDocument(safeId);
    } catch (error) {
      console.error('Failed to delete listing from Meilisearch:', sanitizeLogValue(error));
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
