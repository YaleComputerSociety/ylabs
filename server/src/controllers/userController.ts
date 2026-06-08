/**
 * Controller for user operations: favorites, listings, and profile updates.
 */
import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { readListings } from '../services/listingService';
import { readFellowships } from '../services/fellowshipService';
import { readPrograms } from '../services/programService';
import { matchFellowshipsForPathways } from '../services/fellowshipMatchingService';
import { getPathwaysByIds } from '../services/pathwaySearchService';
import {
  readUser,
  updateUser,
  addFavListings as addFavListingsService,
  deleteFavListings as deleteFavListingsService,
  addFavFellowships as addFavFellowshipsService,
  deleteFavFellowships as deleteFavFellowshipsService,
  addFavPathways as addFavPathwaysService,
  deleteFavPathways as deleteFavPathwaysService,
  getSavedPathwayPlans as getSavedPathwayPlansService,
  exportSavedPathwayPlans as exportSavedPathwayPlansService,
  pruneSavedPathwayPlansForExistingPathways,
  updateSavedPathwayPlan as updateSavedPathwayPlanService,
  deleteSavedPathwayPlan as deleteSavedPathwayPlanService,
} from '../services/userService';
import { publicProgramForReader } from './programPayload';
import { isPublicHttpUrl } from '../utils/urlSafety';

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
    ? values.map(publicHttpUrl).filter((value): value is string => Boolean(value))
    : [];

const publicAccountListing = (listing: any) => {
  const id = listing._id?.toString?.() || listing._id || listing.id;
  return {
    _id: id,
    id,
    researchEntityId: listing.researchEntityId,
    researchGroupId: listing.researchGroupId,
    title: listing.title,
    hiringStatus: listing.hiringStatus,
    websites: publicHttpUrls(listing.websites),
    description: listing.description,
    applicantDescription: listing.applicantDescription,
    researchAreas: Array.isArray(listing.researchAreas) ? listing.researchAreas : [],
    keywords: Array.isArray(listing.keywords) ? listing.keywords : [],
    established: listing.established,
    departments: Array.isArray(listing.departments) ? listing.departments : [],
    type: listing.type,
    commitment: listing.commitment,
    compensationType: listing.compensationType,
    expiresAt: listing.expiresAt,
    createdAt: listing.createdAt,
    updatedAt: listing.updatedAt,
  };
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
  'ownListings',
  'favListings',
  'favFellowships',
  'favPathways',
  'facultyMemberId',
  'studentProfileId',
  'createdAt',
  'updatedAt',
] as const;

const publicProfileUrlMap = (value: unknown): Record<string, string> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>).flatMap(([key, rawUrl]) => {
    const url = publicHttpUrl(rawUrl);
    return url ? [[key, url] as const] : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
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
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
    const user = await readUser(currentUser.netId);
    response.status(200).json({ favListingsIds: user.favListings });
  } catch (error: any) {
    console.error('Favorite listing id fetch failed:', error);
    sendAccountMutationError(response, error, 'Failed to fetch favorite listing ids');
  }
};

export const addFavListings = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };

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
    console.error('Favorite listing mutation failed:', error);
    sendAccountMutationError(response, error, 'Failed to update favorite listings');
  }
};

export const removeFavListings = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };

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
    console.error('Favorite listing removal failed:', error);
    sendAccountMutationError(response, error, 'Failed to update favorite listings');
  }
};

export const getFavFellowshipIds = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
    const user = await readUser(currentUser.netId);
    response.status(200).json({ favFellowshipIds: user.favFellowships || [] });
  } catch (error: any) {
    console.error('Favorite program id fetch failed:', error);
    sendAccountMutationError(response, error, 'Failed to fetch favorite program ids');
  }
};

export const getSavedProgramIds = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
    const user = await readUser(currentUser.netId);
    response.status(200).json({ savedProgramIds: user.favFellowships || [] });
  } catch (error: any) {
    console.error('Saved program id fetch failed:', error);
    sendAccountMutationError(response, error, 'Failed to fetch saved program ids');
  }
};

export const getFavFellowships = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
    const user = await readUser(currentUser.netId);
    const favFellowships = await readFellowships(user.favFellowships || []);

    const validIds: mongoose.Types.ObjectId[] = [];
    for (const fellowship of favFellowships) {
      validIds.push(fellowship._id);
    }

    await updateUser(currentUser.netId, { favFellowships: validIds });
    response.status(200).json({ favFellowships: favFellowships.map(publicProgramForReader) });
  } catch (error: any) {
    console.error('Favorite program fetch failed:', error);
    sendAccountMutationError(response, error, 'Failed to fetch favorite programs');
  }
};

export const getSavedPrograms = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
    const user = await readUser(currentUser.netId);
    const savedPrograms = await readPrograms(user.favFellowships || []);

    const validIds: mongoose.Types.ObjectId[] = [];
    for (const program of savedPrograms) {
      validIds.push(program._id);
    }

    await updateUser(currentUser.netId, { favFellowships: validIds });
    response.status(200).json({ savedPrograms: savedPrograms.map(publicProgramForReader) });
  } catch (error: any) {
    console.error('Saved program fetch failed:', error);
    sendAccountMutationError(response, error, 'Failed to fetch saved programs');
  }
};

export const addFavFellowships = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };

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
    console.error('Favorite program mutation failed:', error);
    sendAccountMutationError(response, error, 'Failed to update favorite programs');
  }
};

export const addSavedPrograms = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
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
    console.error('Saved program mutation failed:', error);
    sendAccountMutationError(response, error, 'Failed to save programs');
  }
};

export const removeFavFellowships = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };

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
    console.error('Favorite program removal failed:', error);
    sendAccountMutationError(response, error, 'Failed to update favorite programs');
  }
};

export const removeSavedPrograms = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
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
    console.error('Saved program removal failed:', error);
    sendAccountMutationError(response, error, 'Failed to remove saved programs');
  }
};

export const getFavPathwayIds = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
    const user = await readUser(currentUser.netId);
    response.status(200).json({ favPathwayIds: user.favPathways || [] });
  } catch (error: any) {
    console.error('Favorite pathway id fetch failed:', error);
    sendAccountMutationError(response, error, 'Failed to fetch favorite pathway ids');
  }
};

export const getSavedResearchPlanIds = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
    const user = await readUser(currentUser.netId);
    response.status(200).json({ savedResearchPlanIds: user.favPathways || [] });
  } catch (error: any) {
    console.error('Saved research-plan id fetch failed:', error);
    sendAccountMutationError(response, error, 'Failed to fetch saved research plan ids');
  }
};

export const getFavPathways = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
    const user = await readUser(currentUser.netId);
    const favPathwayIds = (user.favPathways || []).map((id: mongoose.Types.ObjectId | string) =>
      id.toString(),
    );
    const favPathways = await getPathwaysByIds(favPathwayIds);
    const validIds = favPathways.map((pathway) => new mongoose.Types.ObjectId(pathway._id));
    const savedPathwayPlans = pruneSavedPathwayPlansForExistingPathways(
      user.savedPathwayPlans || {},
      validIds,
    );

    await updateUser(currentUser.netId, { favPathways: validIds, savedPathwayPlans });
    response.status(200).json({ favPathways });
  } catch (error: any) {
    console.error('Favorite pathway fetch failed:', error);
    sendAccountMutationError(response, error, 'Failed to fetch favorite pathways');
  }
};

export const getSavedResearchPlans = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
    const user = await readUser(currentUser.netId);
    const savedResearchPlanIds = (user.favPathways || []).map(
      (id: mongoose.Types.ObjectId | string) => id.toString(),
    );
    const savedResearchPlans = await getPathwaysByIds(savedResearchPlanIds);
    const validIds = savedResearchPlans.map((pathway) => new mongoose.Types.ObjectId(pathway._id));
    const savedPathwayPlans = pruneSavedPathwayPlansForExistingPathways(
      user.savedPathwayPlans || {},
      validIds,
    );

    await updateUser(currentUser.netId, { favPathways: validIds, savedPathwayPlans });
    response.status(200).json({ savedResearchPlans });
  } catch (error: any) {
    console.error('Saved research-plan fetch failed:', error);
    sendAccountMutationError(response, error, 'Failed to fetch saved research plans');
  }
};

export const getFavPathwayFundingMatches = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
    const user = await readUser(currentUser.netId);
    const favPathwayIds = (user.favPathways || []).map((id: mongoose.Types.ObjectId | string) =>
      id.toString(),
    );
    const matchesByPathwayId = await matchFellowshipsForPathways(favPathwayIds);
    response.status(200).json({ matchesByPathwayId });
  } catch (error: any) {
    console.error('Pathway funding-match fetch failed:', error);
    sendAccountMutationError(response, error, 'Failed to fetch pathway funding matches');
  }
};

export const getSavedResearchPlanFundingMatches = getFavPathwayFundingMatches;

export const addFavPathways = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };

    if (!request.body.data?.favPathways) {
      const error: any = new Error('No favPathways provided');
      error.status = 400;
      throw error;
    }

    const favPathwaysArray = Array.isArray(request.body.data.favPathways)
      ? request.body.data.favPathways
      : [request.body.data.favPathways];

    const user = await addFavPathwaysService(currentUser.netId, favPathwaysArray);
    response.status(200).json({ user: publicCurrentUserForResponse(user) });
  } catch (error: any) {
    console.error('Favorite pathway mutation failed:', error);
    sendAccountMutationError(response, error, 'Failed to update favorite pathways');
  }
};

export const addSavedResearchPlans = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };

    if (!request.body.data?.savedResearchPlans) {
      const error: any = new Error('No savedResearchPlans provided');
      error.status = 400;
      throw error;
    }

    const savedResearchPlansArray = Array.isArray(request.body.data.savedResearchPlans)
      ? request.body.data.savedResearchPlans
      : [request.body.data.savedResearchPlans];

    const user = await addFavPathwaysService(currentUser.netId, savedResearchPlansArray);
    response.status(200).json({ user: publicCurrentUserForResponse(user) });
  } catch (error: any) {
    console.error('Saved research-plan mutation failed:', error);
    sendAccountMutationError(response, error, 'Failed to save research plans');
  }
};

export const removeFavPathways = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };

    if (!request.body.favPathways) {
      const error: any = new Error('No favPathways provided');
      error.status = 400;
      throw error;
    }

    const favPathwaysArray = Array.isArray(request.body.favPathways)
      ? request.body.favPathways
      : [request.body.favPathways];

    const user = await deleteFavPathwaysService(currentUser.netId, favPathwaysArray);
    response.status(200).json({ user: publicCurrentUserForResponse(user) });
  } catch (error: any) {
    console.error('Favorite pathway removal failed:', error);
    sendAccountMutationError(response, error, 'Failed to update favorite pathways');
  }
};

export const removeSavedResearchPlans = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };

    if (!request.body.savedResearchPlans) {
      const error: any = new Error('No savedResearchPlans provided');
      error.status = 400;
      throw error;
    }

    const savedResearchPlansArray = Array.isArray(request.body.savedResearchPlans)
      ? request.body.savedResearchPlans
      : [request.body.savedResearchPlans];

    const user = await deleteFavPathwaysService(currentUser.netId, savedResearchPlansArray);
    response.status(200).json({ user: publicCurrentUserForResponse(user) });
  } catch (error: any) {
    console.error('Saved research-plan removal failed:', error);
    sendAccountMutationError(response, error, 'Failed to remove saved research plans');
  }
};

export const getSavedPathwayPlans = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
    const savedPathwayPlans = await getSavedPathwayPlansService(currentUser.netId);
    setPrivateAccountResponseHeaders(response);
    response.status(200).json({ savedPathwayPlans });
  } catch (error: any) {
    console.error('Saved pathway-plan detail fetch failed:', error);
    sendPrivateAccountError(response, error, 'Failed to fetch saved pathway plans');
  }
};

export const getSavedResearchPlanDetails = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
    const savedResearchPlanDetails = await getSavedPathwayPlansService(currentUser.netId);
    setPrivateAccountResponseHeaders(response);
    response.status(200).json({ savedResearchPlanDetails });
  } catch (error: any) {
    console.error('Saved research-plan detail fetch failed:', error);
    sendPrivateAccountError(response, error, 'Failed to fetch saved research-plan details');
  }
};

export const exportSavedPathwayPlans = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
    const includePrivateNotes = request.query.includePrivateNotes === 'true';
    const exportPayload = await exportSavedPathwayPlansService(currentUser.netId, {
      includePrivateNotes,
    });

    setPrivateAccountResponseHeaders(response);
    response.setHeader('Content-Disposition', 'attachment; filename="saved-pathway-plans.json"');
    response.status(200).json(exportPayload);
  } catch (error: any) {
    console.error('Saved pathway-plan export failed:', error);
    sendPrivateAccountError(response, error, 'Failed to export saved research-plan details');
  }
};

export const exportSavedResearchPlanDetails = exportSavedPathwayPlans;

export const updateSavedPathwayPlan = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
    const savedPathwayPlans = await updateSavedPathwayPlanService(
      currentUser.netId,
      request.params.pathwayId,
      request.body?.data?.plan || request.body?.plan || {},
    );
    setPrivateAccountResponseHeaders(response);
    response.status(200).json({ savedPathwayPlans });
  } catch (error: any) {
    console.error('Saved pathway-plan update failed:', error);
    sendPrivateAccountError(response, error, 'Failed to update saved pathway plan');
  }
};

export const updateSavedResearchPlanDetail = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
    const savedResearchPlanDetails = await updateSavedPathwayPlanService(
      currentUser.netId,
      request.params.pathwayId,
      request.body?.data?.plan || request.body?.plan || {},
    );
    setPrivateAccountResponseHeaders(response);
    response.status(200).json({ savedResearchPlanDetails });
  } catch (error: any) {
    console.error('Saved research-plan detail update failed:', error);
    sendPrivateAccountError(response, error, 'Failed to update saved research-plan detail');
  }
};

export const deleteSavedPathwayPlan = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
    const savedPathwayPlans = await deleteSavedPathwayPlanService(
      currentUser.netId,
      request.params.pathwayId,
    );
    setPrivateAccountResponseHeaders(response);
    response.status(200).json({ savedPathwayPlans });
  } catch (error: any) {
    console.error('Saved pathway-plan delete failed:', error);
    sendPrivateAccountError(response, error, 'Failed to delete saved pathway plan');
  }
};

export const deleteSavedResearchPlanDetail = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
    const savedResearchPlanDetails = await deleteSavedPathwayPlanService(
      currentUser.netId,
      request.params.pathwayId,
    );
    setPrivateAccountResponseHeaders(response);
    response.status(200).json({ savedResearchPlanDetails });
  } catch (error: any) {
    console.error('Saved research-plan detail delete failed:', error);
    sendPrivateAccountError(response, error, 'Failed to delete saved research-plan detail');
  }
};

export const getUserListings = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
    const user = await readUser(currentUser.netId);
    const ownListings = await readListings(user.ownListings);
    const favListings = await readListings(user.favListings);

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
    console.error('Account listing fetch failed:', error);
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
  'departments',
  'researchInterests',
  'topics',
  'profileUrls',
] as const;

const ALLOWED_SELF_USER_TYPES = new Set(['undergraduate', 'graduate']);

// Identity fields can only be set during the unknown-user bootstrap flow,
// then become admin-only to prevent impersonation of established accounts.
const UNKNOWN_BOOTSTRAP_FIELDS = ['fname', 'lname', 'email'] as const;

export const updateCurrentUser = async (
  request: Request,
  response: Response,
  next: NextFunction,
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
    sanitizeSelfEditableUrlFields(update);

    if (currentUser.userType === 'unknown') {
      for (const field of UNKNOWN_BOOTSTRAP_FIELDS) {
        if (payload[field] !== undefined) {
          update[field] = payload[field];
        }
      }

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
    console.error('Current-user profile update failed:', error);
    sendAccountMutationError(response, error, 'Failed to update account profile');
  }
};
