/**
 * Controller for user operations: favorites, listings, and profile updates.
 */
import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { readListings, readPublicListings } from '../services/listingService';
import { readFellowships } from '../services/fellowshipService';
import { readPrograms } from '../services/programService';
import {
  readUser,
  updateUser,
  addFavListings as addFavListingsService,
  deleteFavListings as deleteFavListingsService,
  addFavFellowships as addFavFellowshipsService,
  deleteFavFellowships as deleteFavFellowshipsService,
  normalizeObjectIdsForUserMutation,
  getSavedProgramTracking as getSavedProgramTrackingService,
  updateSavedProgramTracking as updateSavedProgramTrackingService,
} from '../services/userService';
import {
  getSavedResearchEntities as getSavedResearchEntitiesService,
  getSavedResearchEntitySlugs as getSavedResearchEntitySlugsService,
  getSavedResearchEntityPlans as getSavedResearchEntityPlansService,
  addSavedResearchEntities as addSavedResearchEntitiesService,
  removeSavedResearchEntities as removeSavedResearchEntitiesService,
  updateSavedResearchEntityPlan as updateSavedResearchEntityPlanService,
  deleteSavedResearchEntityPlan as deleteSavedResearchEntityPlanService,
  exportSavedResearchEntities as exportSavedResearchEntitiesService,
} from '../services/researchPlanService';
import { publicProgramForReader } from './programPayload';
import { isPublicHttpUrl } from '../utils/urlSafety';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { serializedDocumentId } from '../utils/idSerialization';

const publicHttpUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  try {
    const url = new URL(trimmed);
    return isPublicHttpUrl(trimmed) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const publicHttpUrls = (values: unknown): string[] =>
  Array.isArray(values)
    ? values
        .slice(0, MAX_ACCOUNT_LISTING_URLS)
        .map(publicHttpUrl)
        .filter((value): value is string => Boolean(value))
    : [];

const MAX_ACCOUNT_LISTING_URLS = 20;
const MAX_CURRENT_USER_PROFILE_URLS = 20;
const MAX_CURRENT_USER_PROFILE_URL_KEY_LENGTH = 80;
const MAX_CURRENT_USER_PROFILE_URL_LENGTH = 2048;
const MAX_CURRENT_USER_BIO_LENGTH = 2000;
const MAX_CURRENT_USER_TEXT_LENGTH = 500;
const MAX_CURRENT_USER_SHORT_TEXT_LENGTH = 120;
const MAX_CURRENT_USER_ARRAY_ITEMS = 50;
const MAX_CURRENT_USER_ARRAY_VALUE_LENGTH = 120;
const SAFE_CURRENT_USER_PROFILE_URL_KEY_RE = /^[A-Za-z0-9 _-]{1,80}$/;

const publicProfileUrlKey = (key: unknown): string | undefined => {
  if (typeof key !== 'string') return undefined;
  const trimmed = key.trim();
  if (
    !trimmed ||
    trimmed.length > MAX_CURRENT_USER_PROFILE_URL_KEY_LENGTH ||
    !SAFE_CURRENT_USER_PROFILE_URL_KEY_RE.test(trimmed) ||
    trimmed === '__proto__' ||
    trimmed === 'constructor' ||
    trimmed === 'prototype'
  ) {
    return undefined;
  }
  return trimmed;
};

const boundedAccountString = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  return value.trim().slice(0, maxLength);
};

const boundedAccountStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value
    .flatMap((item) => {
      const normalized = boundedAccountString(item, MAX_CURRENT_USER_ARRAY_VALUE_LENGTH);
      return normalized ? [normalized] : [];
    })
    .slice(0, MAX_CURRENT_USER_ARRAY_ITEMS);
};

const publicAccountListingText = (value: unknown): string | undefined =>
  typeof value === 'string' ? redactDirectContactInfo(value) : undefined;

const publicAccountListingTextArray = (values: unknown): string[] =>
  Array.isArray(values) ? values.flatMap((value) => publicAccountListingText(value) ?? []) : [];

const publicAccountListing = (listing: any) => {
  const id = serializedDocumentId(listing._id) || serializedDocumentId(listing.id) || '';
  return {
    _id: id,
    id,
    title: publicAccountListingText(listing.title),
    hiringStatus: publicAccountListingText(listing.hiringStatus),
    websites: publicHttpUrls(listing.websites),
    description: publicAccountListingText(listing.description),
    applicantDescription: publicAccountListingText(listing.applicantDescription),
    researchAreas: publicAccountListingTextArray(listing.researchAreas),
    keywords: publicAccountListingTextArray(listing.keywords),
    established: listing.established,
    departments: publicAccountListingTextArray(listing.departments),
    type: publicAccountListingText(listing.type),
    commitment: publicAccountListingText(listing.commitment),
    compensationType: publicAccountListingText(listing.compensationType),
    expiresAt: listing.expiresAt,
  };
};

const normalizeStoredObjectIdsForAccountRead = (values: unknown, fieldName: string): string[] => {
  const ids = Array.isArray(values) ? values : [];
  return normalizeObjectIdsForUserMutation(ids, fieldName).map((id) => id.toString());
};

const CURRENT_USER_RESPONSE_FIELDS = [
  '_id',
  'id',
  'netid',
  'userType',
  'userConfirmed',
  'fname',
  'lname',
  'website',
  'bio',
  'departments',
  'college',
  'year',
  'major',
  'phone',
  'title',
  'unit',
  'physicalLocation',
  'buildingDesk',
  'mailingAddress',
  'primaryDepartment',
  'imageUrl',
  'secondaryDepartments',
  'researchInterests',
  'topics',
  'profileUrls',
] as const;

const publicProfileUrlMap = (value: unknown): Record<string, string> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .flatMap(([key, rawUrl]) => {
      const normalizedKey = publicProfileUrlKey(key);
      const url = publicHttpUrl(rawUrl);
      return normalizedKey && url && url.length <= MAX_CURRENT_USER_PROFILE_URL_LENGTH
        ? [[normalizedKey, url] as const]
        : [];
    })
    .slice(0, MAX_CURRENT_USER_PROFILE_URLS);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const sanitizeSelfEditableTextFields = (update: Record<string, any>) => {
  if ('bio' in update) {
    const bio = boundedAccountString(update.bio, MAX_CURRENT_USER_BIO_LENGTH);
    if (bio !== undefined) update.bio = bio;
    else delete update.bio;
  }

  for (const field of ['phone', 'college', 'year', 'title', 'primaryDepartment']) {
    if (field in update) {
      const value = boundedAccountString(update[field], MAX_CURRENT_USER_SHORT_TEXT_LENGTH);
      if (value !== undefined) update[field] = value;
      else delete update[field];
    }
  }

  for (const field of ['physicalLocation', 'buildingDesk', 'mailingAddress']) {
    if (field in update) {
      const value = boundedAccountString(update[field], MAX_CURRENT_USER_TEXT_LENGTH);
      if (value !== undefined) update[field] = value;
      else delete update[field];
    }
  }

  for (const field of [
    'major',
    'departments',
    'secondaryDepartments',
    'researchInterests',
    'topics',
  ]) {
    if (field in update) {
      const values = boundedAccountStringArray(update[field]);
      if (values !== undefined) update[field] = values;
      else delete update[field];
    }
  }
};

const sanitizeUnknownBootstrapFields = (update: Record<string, any>) => {
  for (const field of UNKNOWN_BOOTSTRAP_FIELDS) {
    if (field in update) {
      const value = boundedAccountString(
        update[field],
        field === 'email' ? 254 : MAX_CURRENT_USER_SHORT_TEXT_LENGTH,
      );
      if (value !== undefined) update[field] = value;
      else delete update[field];
    }
  }
};

const sanitizeSelfEditableUrlFields = (update: Record<string, any>) => {
  if ('website' in update) {
    const website = publicHttpUrl(update.website);
    if (website) update.website = website;
    else delete update.website;
  }
  if ('imageUrl' in update) {
    const imageUrl = publicHttpUrl(update.imageUrl);
    if (imageUrl) update.imageUrl = imageUrl;
    else delete update.imageUrl;
  }
  if ('profileUrls' in update) {
    const profileUrls = publicProfileUrlMap(update.profileUrls);
    if (profileUrls) update.profileUrls = profileUrls;
    else delete update.profileUrls;
  }
};

const publicCurrentUserForResponse = (user: any) => {
  if (!user || typeof user !== 'object') return user;
  const publicUser: Record<string, any> = {};
  for (const field of CURRENT_USER_RESPONSE_FIELDS) {
    if (user[field] !== undefined) {
      publicUser[field] = user[field];
    }
  }
  if ('website' in publicUser) {
    const website = publicHttpUrl(publicUser.website);
    if (website) publicUser.website = website;
    else delete publicUser.website;
  }
  if ('imageUrl' in publicUser) {
    const imageUrl = publicHttpUrl(publicUser.imageUrl);
    if (imageUrl) publicUser.imageUrl = imageUrl;
    else delete publicUser.imageUrl;
  }
  if ('profileUrls' in publicUser) {
    const profileUrls = publicProfileUrlMap(publicUser.profileUrls);
    if (profileUrls) publicUser.profileUrls = profileUrls;
    else delete publicUser.profileUrls;
  }
  return publicUser;
};

const setPrivateAccountResponseHeaders = (response: Response) => {
  response.setHeader('Cache-Control', 'no-store, private, max-age=0');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Surrogate-Control', 'no-store');
  response.setHeader('Expires', '0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
};

const publicAccountClientErrorMessage = (status: number): string => {
  if (status === 400) return 'Bad request';
  if (status === 401) return 'Unauthorized';
  if (status === 403) return 'Forbidden';
  if (status === 404) return 'Not found';
  if (status === 409) return 'Conflict';
  return 'Request failed';
};

const sendAccountMutationError = (response: Response, error: any, fallbackMessage: string) => {
  const status = error?.status ?? error?.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return response.status(status).json({ error: publicAccountClientErrorMessage(status) });
  }
  if (error?.name === 'ValidationError') {
    return response.status(400).json({ error: 'Validation error' });
  }
  return response.status(500).json({ error: fallbackMessage });
};

const sendPrivateAccountError = (response: Response, error: any, fallbackMessage: string) => {
  setPrivateAccountResponseHeaders(response);
  return sendAccountMutationError(response, error, fallbackMessage);
};

export const getFavListingsIds = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as {
      netId?: string;
      userType: string;
      userConfirmed: boolean;
    };
    const user = await readUser(currentUser.netId);
    const favListingIds = normalizeStoredObjectIdsForAccountRead(user.favListings, 'favListings');
    const favListings = await readPublicListings(favListingIds);
    response.status(200).json({
      favListingsIds: normalizeObjectIdsForUserMutation(
        favListings.map((listing) => listing._id),
        'favListings',
      ),
    });
  } catch (error: any) {
    console.error('Favorite listing id fetch failed:', sanitizeLogValue(error));
    sendAccountMutationError(response, error, 'Failed to fetch favorite listing ids');
  }
};

export const addFavListings = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as {
      netId?: string;
      userType: string;
      userConfirmed: boolean;
    };

    if (!request.body.data?.favListings) {
      const error: any = new Error('No favListings provided');
      error.status = 400;
      throw error;
    }

    const favListingsArray = Array.isArray(request.body.data.favListings)
      ? request.body.data.favListings
      : [request.body.data.favListings];

    const user = await addFavListingsService(currentUser.netId, favListingsArray);
    response.status(200).json({ user: publicCurrentUserForResponse(user) });
  } catch (error: any) {
    console.error('Favorite listing mutation failed:', sanitizeLogValue(error));
    sendAccountMutationError(response, error, 'Failed to update favorite listings');
  }
};

export const removeFavListings = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as {
      netId?: string;
      userType: string;
      userConfirmed: boolean;
    };

    if (!request.body.favListings) {
      const error: any = new Error('No favListings provided');
      error.status = 400;
      throw error;
    }

    const favListingsArray = Array.isArray(request.body.favListings)
      ? request.body.favListings
      : [request.body.favListings];

    const user = await deleteFavListingsService(currentUser.netId, favListingsArray);
    response.status(200).json({ user: publicCurrentUserForResponse(user) });
  } catch (error: any) {
    console.error('Favorite listing removal failed:', sanitizeLogValue(error));
    sendAccountMutationError(response, error, 'Failed to update favorite listings');
  }
};

export const getFavFellowshipIds = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as {
      netId?: string;
      userType: string;
      userConfirmed: boolean;
    };
    const user = await readUser(currentUser.netId);
    const favFellowshipIds = normalizeStoredObjectIdsForAccountRead(
      user.favFellowships,
      'favFellowships',
    );
    const favFellowships = await readFellowships(favFellowshipIds);
    response.status(200).json({
      favFellowshipIds: normalizeObjectIdsForUserMutation(
        favFellowships.map((fellowship) => fellowship._id),
        'favFellowships',
      ),
    });
  } catch (error: any) {
    console.error('Favorite program id fetch failed:', sanitizeLogValue(error));
    sendAccountMutationError(response, error, 'Failed to fetch favorite program ids');
  }
};

export const getSavedProgramIds = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as {
      netId?: string;
      userType: string;
      userConfirmed: boolean;
    };
    const user = await readUser(currentUser.netId);
    const savedProgramIds = normalizeStoredObjectIdsForAccountRead(
      user.favFellowships,
      'favFellowships',
    );
    const savedPrograms = await readPrograms(savedProgramIds);
    response.status(200).json({
      savedProgramIds: normalizeObjectIdsForUserMutation(
        savedPrograms.map((program) => program._id),
        'favFellowships',
      ),
    });
  } catch (error: any) {
    console.error('Saved program id fetch failed:', sanitizeLogValue(error));
    sendAccountMutationError(response, error, 'Failed to fetch saved program ids');
  }
};

export const getFavFellowships = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as {
      netId?: string;
      userType: string;
      userConfirmed: boolean;
    };
    const user = await readUser(currentUser.netId);
    const favFellowshipIds = normalizeStoredObjectIdsForAccountRead(
      user.favFellowships,
      'favFellowships',
    );
    const favFellowships = await readFellowships(favFellowshipIds);

    const validIds: mongoose.Types.ObjectId[] = [];
    for (const fellowship of favFellowships) {
      validIds.push(fellowship._id);
    }

    await updateUser(currentUser.netId, { favFellowships: validIds });
    response.status(200).json({ favFellowships: favFellowships.map(publicProgramForReader) });
  } catch (error: any) {
    console.error('Favorite program fetch failed:', sanitizeLogValue(error));
    sendAccountMutationError(response, error, 'Failed to fetch favorite programs');
  }
};

export const getSavedPrograms = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as {
      netId?: string;
      userType: string;
      userConfirmed: boolean;
    };
    const user = await readUser(currentUser.netId);
    const savedProgramIds = normalizeStoredObjectIdsForAccountRead(
      user.favFellowships,
      'favFellowships',
    );
    const savedPrograms = await readPrograms(savedProgramIds);

    const validIds: mongoose.Types.ObjectId[] = [];
    for (const program of savedPrograms) {
      validIds.push(program._id);
    }

    await updateUser(currentUser.netId, { favFellowships: validIds });
    response.status(200).json({ savedPrograms: savedPrograms.map(publicProgramForReader) });
  } catch (error: any) {
    console.error('Saved program fetch failed:', sanitizeLogValue(error));
    sendAccountMutationError(response, error, 'Failed to fetch saved programs');
  }
};

export const addFavFellowships = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as {
      netId?: string;
      userType: string;
      userConfirmed: boolean;
    };

    if (!request.body.data?.favFellowships) {
      const error: any = new Error('No favFellowships provided');
      error.status = 400;
      throw error;
    }

    const favFellowshipsArray = Array.isArray(request.body.data.favFellowships)
      ? request.body.data.favFellowships
      : [request.body.data.favFellowships];

    const user = await addFavFellowshipsService(currentUser.netId, favFellowshipsArray);
    response.status(200).json({ user: publicCurrentUserForResponse(user) });
  } catch (error: any) {
    console.error('Favorite program mutation failed:', sanitizeLogValue(error));
    sendAccountMutationError(response, error, 'Failed to update favorite programs');
  }
};

export const addSavedPrograms = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as {
      netId?: string;
      userType: string;
      userConfirmed: boolean;
    };
    const ids = request.body.data?.savedPrograms ?? request.body.data?.favFellowships;

    if (!ids) {
      const error: any = new Error('No savedPrograms provided');
      error.status = 400;
      throw error;
    }

    const savedProgramsArray = Array.isArray(ids) ? ids : [ids];
    const user = await addFavFellowshipsService(currentUser.netId, savedProgramsArray);
    response.status(200).json({ user: publicCurrentUserForResponse(user) });
  } catch (error: any) {
    console.error('Saved program mutation failed:', sanitizeLogValue(error));
    sendAccountMutationError(response, error, 'Failed to save programs');
  }
};

export const removeFavFellowships = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as {
      netId?: string;
      userType: string;
      userConfirmed: boolean;
    };

    if (!request.body.favFellowships) {
      const error: any = new Error('No favFellowships provided');
      error.status = 400;
      throw error;
    }

    const favFellowshipsArray = Array.isArray(request.body.favFellowships)
      ? request.body.favFellowships
      : [request.body.favFellowships];

    const user = await deleteFavFellowshipsService(currentUser.netId, favFellowshipsArray);
    response.status(200).json({ user: publicCurrentUserForResponse(user) });
  } catch (error: any) {
    console.error('Favorite program removal failed:', sanitizeLogValue(error));
    sendAccountMutationError(response, error, 'Failed to update favorite programs');
  }
};

export const removeSavedPrograms = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as {
      netId?: string;
      userType: string;
      userConfirmed: boolean;
    };
    const ids = request.body.savedPrograms ?? request.body.favFellowships;

    if (!ids) {
      const error: any = new Error('No savedPrograms provided');
      error.status = 400;
      throw error;
    }

    const savedProgramsArray = Array.isArray(ids) ? ids : [ids];
    const user = await deleteFavFellowshipsService(currentUser.netId, savedProgramsArray);
    response.status(200).json({ user: publicCurrentUserForResponse(user) });
  } catch (error: any) {
    console.error('Saved program removal failed:', sanitizeLogValue(error));
    sendAccountMutationError(response, error, 'Failed to remove saved programs');
  }
};

export const getSavedProgramTracking = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string };
    const savedProgramTracking = await getSavedProgramTrackingService(currentUser.netId);
    setPrivateAccountResponseHeaders(response);
    response.status(200).json({ savedProgramTracking });
  } catch (error: any) {
    console.error('Saved program tracking fetch failed:', sanitizeLogValue(error));
    sendPrivateAccountError(response, error, 'Failed to fetch saved program tracking');
  }
};

export const updateSavedProgramTracking = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string };
    const tracking = await updateSavedProgramTrackingService(
      currentUser.netId,
      request.params.programId,
      request.body?.data?.tracking || request.body?.tracking || {},
    );
    setPrivateAccountResponseHeaders(response);
    response.status(200).json({ tracking });
  } catch (error: any) {
    console.error('Saved program tracking update failed:', sanitizeLogValue(error));
    if (error?.status === 409 && error.current) {
      setPrivateAccountResponseHeaders(response);
      response.status(409).json({ error: error.message, current: error.current });
      return;
    }
    sendPrivateAccountError(response, error, 'Failed to update saved program tracking');
  }
};

export const getSavedResearchEntityIds = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string };
    response.status(200).json({
      savedResearchEntityIds: await getSavedResearchEntitySlugsService(currentUser.netId),
    });
  } catch (error) {
    console.error('Saved research entity id fetch failed:', sanitizeLogValue(error));
    sendAccountMutationError(response, error, 'Failed to fetch saved research entity ids');
  }
};

export const getSavedResearchEntities = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string };
    response.status(200).json({
      savedResearchEntities: await getSavedResearchEntitiesService(currentUser.netId),
    });
  } catch (error) {
    console.error('Saved research entity fetch failed:', sanitizeLogValue(error));
    sendAccountMutationError(response, error, 'Failed to fetch saved research entities');
  }
};

export const addSavedResearchEntities = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string };
    const values = request.body?.data?.savedResearchEntities;
    if (!values) {
      const error: any = new Error('No savedResearchEntities provided');
      error.status = 400;
      throw error;
    }
    const ids = await addSavedResearchEntitiesService(
      currentUser.netId,
      Array.isArray(values) ? values : [values],
    );
    response.status(200).json({ savedResearchEntityIds: ids });
  } catch (error) {
    console.error('Saved research entity mutation failed:', sanitizeLogValue(error));
    sendAccountMutationError(response, error, 'Failed to save research entities');
  }
};

export const removeSavedResearchEntities = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string };
    const values = request.body?.savedResearchEntities;
    if (!values) {
      const error: any = new Error('No savedResearchEntities provided');
      error.status = 400;
      throw error;
    }
    const ids = await removeSavedResearchEntitiesService(
      currentUser.netId,
      Array.isArray(values) ? values : [values],
    );
    response.status(200).json({ savedResearchEntityIds: ids });
  } catch (error) {
    console.error('Saved research entity removal failed:', sanitizeLogValue(error));
    sendAccountMutationError(response, error, 'Failed to remove saved research entities');
  }
};

export const getSavedResearchEntityPlans = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string };
    setPrivateAccountResponseHeaders(response);
    response.status(200).json({
      savedResearchEntityPlans: await getSavedResearchEntityPlansService(currentUser.netId),
    });
  } catch (error) {
    console.error('Saved research entity plan fetch failed:', sanitizeLogValue(error));
    sendPrivateAccountError(response, error, 'Failed to fetch saved research entity plans');
  }
};

export const updateSavedResearchEntityPlan = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string };
    const plans = await updateSavedResearchEntityPlanService(
      currentUser.netId,
      request.params.entityId,
      request.body?.data?.plan || request.body?.plan || {},
    );
    setPrivateAccountResponseHeaders(response);
    response.status(200).json({ savedResearchEntityPlans: plans });
  } catch (error) {
    console.error('Saved research entity plan update failed:', sanitizeLogValue(error));
    sendPrivateAccountError(response, error, 'Failed to update saved research entity plan');
  }
};

export const deleteSavedResearchEntityPlan = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string };
    const plans = await deleteSavedResearchEntityPlanService(
      currentUser.netId,
      request.params.entityId,
    );
    setPrivateAccountResponseHeaders(response);
    response.status(200).json({ savedResearchEntityPlans: plans });
  } catch (error) {
    console.error('Saved research entity plan delete failed:', sanitizeLogValue(error));
    sendPrivateAccountError(response, error, 'Failed to delete saved research entity plan');
  }
};

export const exportSavedResearchEntities = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string };
    const payload = await exportSavedResearchEntitiesService(currentUser.netId, {
      includePrivateNotes: request.method === 'POST' && request.body?.includePrivateNotes === true,
    });
    setPrivateAccountResponseHeaders(response);
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="saved-research-entities.json"',
    );
    response.status(200).json(payload);
  } catch (error) {
    console.error('Saved research entity export failed:', sanitizeLogValue(error));
    sendPrivateAccountError(response, error, 'Failed to export saved research entities');
  }
};

export const getUserListings = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as {
      netId?: string;
      userType: string;
      userConfirmed: boolean;
    };
    const user = await readUser(currentUser.netId);
    const ownListingIds = normalizeStoredObjectIdsForAccountRead(user.ownListings, 'ownListings');
    const favListingIds = normalizeStoredObjectIdsForAccountRead(user.favListings, 'favListings');
    const ownListings = await readListings(ownListingIds);
    const favListings = await readPublicListings(favListingIds);

    const ownIds: mongoose.Types.ObjectId[] = [];
    for (const listing of ownListings) {
      ownIds.push(listing._id);
    }

    const favIds: mongoose.Types.ObjectId[] = [];
    for (const listing of favListings) {
      favIds.push(listing._id);
    }

    await updateUser(currentUser.netId, { ownListings: ownIds, favListings: favIds });
    response.status(200).json({
      ownListings: ownListings.map(publicAccountListing),
      favListings: favListings.map(publicAccountListing),
    });
  } catch (error: any) {
    console.error('Account listing fetch failed:', sanitizeLogValue(error));
    sendAccountMutationError(response, error, 'Failed to fetch account listings');
  }
};

const SELF_UPDATABLE_FIELDS = [
  'bio',
  'website',
  'imageUrl',
  'phone',
  'college',
  'year',
  'major',
  'title',
  'physicalLocation',
  'buildingDesk',
  'mailingAddress',
  'primaryDepartment',
  'secondaryDepartments',
  'researchInterests',
  'topics',
  'profileUrls',
] as const;

const ALLOWED_SELF_USER_TYPES = new Set(['undergraduate', 'graduate', 'professor', 'faculty']);

// Identity fields can only be set during the unknown-user bootstrap flow,
// then become admin-only to prevent impersonation of established accounts.
const UNKNOWN_BOOTSTRAP_FIELDS = ['fname', 'lname', 'email'] as const;

export const updateCurrentUser = async (
  request: Request,
  response: Response,
  _next: NextFunction,
) => {
  try {
    const currentUser = request.user as {
      netId?: string;
      userType: string;
      userConfirmed: boolean;
    };
    const payload = request.body?.data ?? {};

    const update: Record<string, any> = {};
    for (const field of SELF_UPDATABLE_FIELDS) {
      if (payload[field] !== undefined) {
        update[field] = payload[field];
      }
    }
    sanitizeSelfEditableTextFields(update);
    sanitizeSelfEditableUrlFields(update);

    if (update.primaryDepartment !== undefined || update.secondaryDepartments !== undefined) {
      const current = await readUser(currentUser.netId);
      const primary = update.primaryDepartment ?? (current as any)?.primaryDepartment ?? '';
      const secondary =
        update.secondaryDepartments ??
        ((Array.isArray((current as any)?.secondaryDepartments)
          ? (current as any).secondaryDepartments
          : []) as string[]);
      update.departments = [primary, ...secondary].filter(Boolean);
    }

    if (currentUser.userType === 'unknown') {
      for (const field of UNKNOWN_BOOTSTRAP_FIELDS) {
        if (payload[field] !== undefined) {
          update[field] = payload[field];
        }
      }
      sanitizeUnknownBootstrapFields(update);

      if (payload.userType !== undefined) {
        if (!ALLOWED_SELF_USER_TYPES.has(payload.userType)) {
          response.status(400).json({ error: 'Invalid userType' });
          return;
        }
        update.userType = payload.userType;
      }
    }

    const user = await updateUser(currentUser.netId, update);
    response.status(200).json({ user: publicCurrentUserForResponse(user) });
  } catch (error: any) {
    console.error('Current-user profile update failed:', sanitizeLogValue(error));
    sendAccountMutationError(response, error, 'Failed to update account profile');
  }
};
