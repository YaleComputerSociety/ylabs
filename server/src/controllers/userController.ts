/**
 * Controller for user operations: favorites, saved plans, and profile updates.
 */
import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { readFellowships } from '../services/fellowshipService';
import { readPrograms } from '../services/programService';
import { matchFellowshipsForPathways } from '../services/fellowshipMatchingService';
import { getPathwaysByIds } from '../services/pathwaySearchService';
import {
  readUser,
  updateUser,
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

const retiredLegacyListings = (_request: Request, response: Response) => {
  response.status(410).json({
    message: 'Legacy listing favorites have been retired. Use saved research plans instead.',
  });
};

export const getFavListingsIds = async (request: Request, response: Response) => {
  retiredLegacyListings(request, response);
};

export const addFavListings = async (request: Request, response: Response) => {
  retiredLegacyListings(request, response);
};

export const removeFavListings = async (request: Request, response: Response) => {
  retiredLegacyListings(request, response);
};

export const getFavFellowshipIds = async (request: Request, response: Response) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
  const user = await readUser(currentUser.netId);
  response.status(200).json({ favFellowshipIds: user.favFellowships || [] });
};

export const getSavedProgramIds = async (request: Request, response: Response) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
  const user = await readUser(currentUser.netId);
  response.status(200).json({ savedProgramIds: user.favFellowships || [] });
};

export const getFavFellowships = async (request: Request, response: Response) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
  const user = await readUser(currentUser.netId);
  const favFellowships = await readFellowships(user.favFellowships || []);

  const validIds: mongoose.Types.ObjectId[] = [];
  for (const fellowship of favFellowships) {
    validIds.push(fellowship._id);
  }

  await updateUser(currentUser.netId, { favFellowships: validIds });
  response.status(200).json({ favFellowships });
};

export const getSavedPrograms = async (request: Request, response: Response) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
  const user = await readUser(currentUser.netId);
  const savedPrograms = await readPrograms(user.favFellowships || []);

  const validIds: mongoose.Types.ObjectId[] = [];
  for (const program of savedPrograms) {
    validIds.push(program._id);
  }

  await updateUser(currentUser.netId, { favFellowships: validIds });
  response.status(200).json({ savedPrograms });
};

export const addFavFellowships = async (request: Request, response: Response) => {
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
  response.status(200).json({ user });
};

export const addSavedPrograms = async (request: Request, response: Response) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
  const ids = request.body.data?.savedPrograms ?? request.body.data?.favFellowships;

  if (!ids) {
    const error: any = new Error('No savedPrograms provided');
    error.status = 400;
    throw error;
  }

  const savedProgramsArray = Array.isArray(ids) ? ids : [ids];
  const user = await addFavFellowshipsService(currentUser.netId, savedProgramsArray);
  response.status(200).json({ user });
};

export const removeFavFellowships = async (request: Request, response: Response) => {
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
  response.status(200).json({ user });
};

export const removeSavedPrograms = async (request: Request, response: Response) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
  const ids = request.body.savedPrograms ?? request.body.favFellowships;

  if (!ids) {
    const error: any = new Error('No savedPrograms provided');
    error.status = 400;
    throw error;
  }

  const savedProgramsArray = Array.isArray(ids) ? ids : [ids];
  const user = await deleteFavFellowshipsService(currentUser.netId, savedProgramsArray);
  response.status(200).json({ user });
};

export const getFavPathwayIds = async (request: Request, response: Response) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
  const user = await readUser(currentUser.netId);
  response.status(200).json({ favPathwayIds: user.favPathways || [] });
};

export const getFavPathways = async (request: Request, response: Response) => {
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
};

export const getSavedResearchPlanIds = async (request: Request, response: Response) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
  const user = await readUser(currentUser.netId);
  response.status(200).json({ savedResearchPlanIds: user.favPathways || [] });
};

export const getSavedResearchPlans = async (request: Request, response: Response) => {
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
};

export const getFavPathwayFundingMatches = async (request: Request, response: Response) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
  const user = await readUser(currentUser.netId);
  const favPathwayIds = (user.favPathways || []).map((id: mongoose.Types.ObjectId | string) =>
    id.toString(),
  );
  const matchesByPathwayId = await matchFellowshipsForPathways(favPathwayIds);
  response.status(200).json({ matchesByPathwayId });
};

export const getSavedResearchPlanFundingMatches = async (
  request: Request,
  response: Response,
) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
  const user = await readUser(currentUser.netId);
  const savedResearchPlanIds = (user.favPathways || []).map(
    (id: mongoose.Types.ObjectId | string) => id.toString(),
  );
  const matchesByPathwayId = await matchFellowshipsForPathways(savedResearchPlanIds);
  response.status(200).json({
    matchesByPathwayId,
    matchesByResearchPlanId: matchesByPathwayId,
  });
};

export const addFavPathways = async (request: Request, response: Response) => {
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
  response.status(200).json({ user });
};

export const addSavedResearchPlans = async (request: Request, response: Response) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
  const ids = request.body.data?.savedResearchPlans ?? request.body.data?.favPathways;

  if (!ids) {
    const error: any = new Error('No savedResearchPlans provided');
    error.status = 400;
    throw error;
  }

  const savedResearchPlansArray = Array.isArray(ids) ? ids : [ids];
  const user = await addFavPathwaysService(currentUser.netId, savedResearchPlansArray);
  response.status(200).json({ user });
};

export const removeFavPathways = async (request: Request, response: Response) => {
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
  response.status(200).json({ user });
};

export const removeSavedResearchPlans = async (request: Request, response: Response) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
  const ids = request.body.savedResearchPlans ?? request.body.favPathways;

  if (!ids) {
    const error: any = new Error('No savedResearchPlans provided');
    error.status = 400;
    throw error;
  }

  const savedResearchPlansArray = Array.isArray(ids) ? ids : [ids];
  const user = await deleteFavPathwaysService(currentUser.netId, savedResearchPlansArray);
  response.status(200).json({ user });
};

export const getSavedPathwayPlans = async (request: Request, response: Response) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
  const savedPathwayPlans = await getSavedPathwayPlansService(currentUser.netId);
  response.status(200).json({ savedPathwayPlans });
};

export const getSavedResearchPlanDetails = async (request: Request, response: Response) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
  const savedResearchPlanDetails = await getSavedPathwayPlansService(currentUser.netId);
  response.status(200).json({ savedResearchPlanDetails, savedPathwayPlans: savedResearchPlanDetails });
};

export const exportSavedPathwayPlans = async (request: Request, response: Response) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
  const includePrivateNotes = request.query.includePrivateNotes === 'true';
  const exportPayload = await exportSavedPathwayPlansService(currentUser.netId, {
    includePrivateNotes,
  });

  response.setHeader('Content-Disposition', 'attachment; filename="saved-pathway-plans.json"');
  response.status(200).json(exportPayload);
};

export const exportSavedResearchPlanDetails = async (request: Request, response: Response) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
  const includePrivateNotes = request.query.includePrivateNotes === 'true';
  const exportPayload = await exportSavedPathwayPlansService(currentUser.netId, {
    includePrivateNotes,
  });

  response.setHeader('Content-Disposition', 'attachment; filename="saved-research-plans.json"');
  response.status(200).json(exportPayload);
};

export const updateSavedPathwayPlan = async (request: Request, response: Response) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
  const savedPathwayPlans = await updateSavedPathwayPlanService(
    currentUser.netId,
    request.params.pathwayId,
    request.body?.data?.plan || request.body?.plan || {},
  );
  response.status(200).json({ savedPathwayPlans });
};

export const updateSavedResearchPlanDetail = async (request: Request, response: Response) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
  const savedResearchPlanDetails = await updateSavedPathwayPlanService(
    currentUser.netId,
    request.params.pathwayId,
    request.body?.data?.plan || request.body?.plan || {},
  );
  response.status(200).json({ savedResearchPlanDetails, savedPathwayPlans: savedResearchPlanDetails });
};

export const deleteSavedPathwayPlan = async (request: Request, response: Response) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
  const savedPathwayPlans = await deleteSavedPathwayPlanService(
    currentUser.netId,
    request.params.pathwayId,
  );
  response.status(200).json({ savedPathwayPlans });
};

export const deleteSavedResearchPlanDetail = async (request: Request, response: Response) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
  const savedResearchPlanDetails = await deleteSavedPathwayPlanService(
    currentUser.netId,
    request.params.pathwayId,
  );
  response.status(200).json({ savedResearchPlanDetails, savedPathwayPlans: savedResearchPlanDetails });
};

export const getUserListings = async (request: Request, response: Response) => {
  retiredLegacyListings(request, response);
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
    response.status(200).json({ user });
  } catch (error) {
    next(error);
  }
};
