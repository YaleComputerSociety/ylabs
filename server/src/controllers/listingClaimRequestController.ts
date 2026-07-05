/**
 * Controller handlers for listing claim/correction request workflows.
 */
import { Request, Response, NextFunction } from 'express';
import {
  createListingClaimRequest,
  listListingClaimRequests,
  readListingClaimRequest,
  reviewListingClaimRequest,
} from '../services/listingClaimRequestService';
import { readUser } from '../services/userService';

export const submitListingClaimRequest = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  try {
    const currentUser = request.user as { netId?: string };
    if (!currentUser.netId) {
      return response.status(401).json({ error: 'Unauthorized' });
    }

    const user = await readUser(currentUser.netId);
    const claimRequest = await createListingClaimRequest(request.params.id, request.body, {
      netId: user.netid,
      email: user.email,
      fname: user.fname,
      lname: user.lname,
      userType: user.userType,
      userConfirmed: user.userConfirmed,
      profileVerified: user.profileVerified,
    });

    response.status(201).json({ request: claimRequest });
  } catch (error) {
    next(error);
  }
};

export const listAdminListingClaimRequests = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  try {
    const result = await listListingClaimRequests({
      status: request.query.status as string | undefined,
      requestType: request.query.requestType as string | undefined,
      listingId: request.query.listingId as string | undefined,
      page: request.query.page as string | undefined,
      pageSize: request.query.pageSize as string | undefined,
    });

    response.json(result);
  } catch (error) {
    next(error);
  }
};

export const getAdminListingClaimRequest = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  try {
    const claimRequest = await readListingClaimRequest(request.params.id);
    response.json({ request: claimRequest });
  } catch (error) {
    next(error);
  }
};

export const reviewAdminListingClaimRequest = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  try {
    const currentUser = request.user as { netId?: string };
    const claimRequest = await reviewListingClaimRequest(
      request.params.id,
      currentUser.netId || '',
      request.body,
    );

    response.json({ request: claimRequest });
  } catch (error) {
    next(error);
  }
};
