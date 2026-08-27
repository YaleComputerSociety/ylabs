/**
 * Controller handlers for listing claim/correction request workflows.
 */
import { Request, Response, NextFunction } from 'express';
import {
  createListingClaimRequest,
  listListingClaimRequests,
  reviewListingClaimRequest,
  applyListingClaimRequestDecision,
} from '../services/listingClaimRequestService';

export const submitListingClaimRequest = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  try {
    const currentUser = request.user as {
      netId?: string;
      isAdmin?: boolean;
      userConfirmed?: boolean;
      profileVerified?: boolean;
    };
    if (!currentUser.netId) {
      return response.status(401).json({ error: 'Unauthorized' });
    }

    const claimRequest = await createListingClaimRequest(request.params.id, request.body, {
      netId: currentUser.netId,
      userType: currentUser.isAdmin ? 'admin' : undefined,
      userConfirmed: currentUser.userConfirmed,
      profileVerified: currentUser.profileVerified,
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

export const listMyListingClaimRequests = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  try {
    const currentUser = request.user as { netId?: string };
    if (!currentUser.netId) return response.status(401).json({ error: 'Unauthorized' });
    const result = await listListingClaimRequests({
      requesterNetId: currentUser.netId,
      status: request.query.status as string | undefined,
      page: request.query.page as string | undefined,
      pageSize: request.query.pageSize as string | undefined,
    });
    response.json(result);
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

export const applyAdminListingClaimRequest = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  try {
    const currentUser = request.user as { netId?: string };
    const claimRequest = await applyListingClaimRequestDecision(
      request.params.id,
      currentUser.netId || '',
      request.body,
    );

    response.json({ request: claimRequest });
  } catch (error) {
    next(error);
  }
};
