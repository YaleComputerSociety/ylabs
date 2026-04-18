/**
 * Controller for user operations: favorites, listings, and profile updates.
 */
import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { readListings } from '../services/listingService';
import { readFellowships } from '../services/fellowshipService';
import {
  readUser,
  updateUser,
  addFavListings as addFavListingsService,
  deleteFavListings as deleteFavListingsService,
  addFavFellowships as addFavFellowshipsService,
  deleteFavFellowships as deleteFavFellowshipsService,
} from '../services/userService';

export const getFavListingsIds = async (request: Request, response: Response) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
  const user = await readUser(currentUser.netId);
  response.status(200).json({ favListingsIds: user.favListings });
};

export const addFavListings = async (request: Request, response: Response) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };

  if (!request.body.data.favListings) {
    const error: any = new Error('No favListings provided');
    error.status = 400;
    throw error;
  }

  const favListingsArray = Array.isArray(request.body.data.favListings)
    ? request.body.data.favListings
    : [request.body.data.favListings];

  const user = await addFavListingsService(currentUser.netId, favListingsArray);
  response.status(200).json({ user });
};

export const removeFavListings = async (request: Request, response: Response) => {
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
  response.status(200).json({ user });
};

export const getFavFellowshipIds = async (request: Request, response: Response) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };
  const user = await readUser(currentUser.netId);
  response.status(200).json({ favFellowshipIds: user.favFellowships || [] });
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

export const getUserListings = async (request: Request, response: Response) => {
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
  response.status(200).json({ ownListings, favListings });
};

const SELF_UPDATABLE_FIELDS = [
  'bio',
  'website',
  'image_url',
  'phone',
  'college',
  'year',
  'major',
  'title',
  'physical_location',
  'building_desk',
  'mailing_address',
  'primary_department',
  'secondary_departments',
  'departments',
  'research_interests',
  'topics',
  'profile_urls',
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
