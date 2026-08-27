/**
 * Service layer for listing CRUD, view tracking, and favorites.
 */
import { IncorrectPermissionsError, NotFoundError, ObjectIdError } from '../utils/errors';
import mongoose from 'mongoose';
import { getListingModel } from '../db/connections';
import { isCustomTitle, generateSmartTitle } from '../utils/smartTitle';
import * as itemOps from './itemOperations';
import { ResearchEntity } from '../models/researchEntity';
import { buildListingResearchEntityProfilePatch } from './listingResearchEntityProfile';
import { publicHttpUrl } from '../utils/urlSafety';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { mutateAndRefreshAdminAccessReviewProjection } from './adminAccessReviewProjectionService';

const LISTING_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const PUBLIC_LISTING_MUTATION_FILTER = {
  archived: false,
  confirmed: true,
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

async function syncResearchEntityProfileFromListing(listing: any): Promise<void> {
  const researchEntityId = listing?.researchEntityId;
  const safeResearchEntityId = normalizeListingObjectId(researchEntityId);
  if (!safeResearchEntityId) return;

  try {
    const entity = await ResearchEntity.findById(safeResearchEntityId).lean();
    if (!entity) return;
    const patch = buildListingResearchEntityProfilePatch({ entity, listing });
    if (Object.keys(patch).length === 0) return;
    await mutateAndRefreshAdminAccessReviewProjection(safeResearchEntityId, (session) =>
      ResearchEntity.updateOne({ _id: safeResearchEntityId }, { $set: patch }, { session }).then(
        () => undefined,
      ),
    );
  } catch (error) {
    console.error(
      'Failed to sync listing profile fields to ResearchEntity:',
      sanitizeLogValue(error),
    );
  }
}

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
  return value.slice(0, MAX_SELF_SERVICE_LISTING_ARRAY_ITEMS).flatMap((item) => {
    const normalized = boundedListingString(item, MAX_SELF_SERVICE_LISTING_ARRAY_VALUE_LENGTH);
    return normalized ? [normalized] : [];
  });
};

const boundedListingWebsiteArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, MAX_SELF_SERVICE_LISTING_WEBSITES).flatMap((item) => {
    const url = publicHttpUrl(item);
    return url && url.length <= MAX_SELF_SERVICE_LISTING_URL_LENGTH ? [url] : [];
  });
};

const boundedListingNumber = (
  value: unknown,
  { min = 0, max = MAX_ADMIN_LISTING_NUMBER }: { min?: number; max?: number } = {},
): number | undefined => {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
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
  return value.slice(0, MAX_SELF_SERVICE_LISTING_ARRAY_ITEMS).flatMap((item) => {
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

  for (const field of [
    'ownerFirstName',
    'ownerLastName',
    'ownerEmail',
    'ownerTitle',
    'ownerPrimaryDepartment',
  ]) {
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

  for (const field of ['researchEntityId', 'createdByUserId']) {
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

export const readAllListings = async () => {
  const listings = await getListingModel().find();
  return listings.map((listing: any) => listing.toObject());
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

    const updatedListing = listing.toObject();
    await syncResearchEntityProfileFromListing(updatedListing);

    return updatedListing;
  } else {
    throw new ObjectIdError('Did not received expected id type ObjectId');
  }
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
