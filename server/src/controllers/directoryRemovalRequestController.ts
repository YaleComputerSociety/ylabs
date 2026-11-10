import { NextFunction, Request, Response } from 'express';
import {
  assertNoRequestFields,
  createOwnDirectoryRemovalRequest,
  decideDirectoryRemovalRequest,
  getOwnDirectoryRemovalEligibility,
  listDirectoryRemovalRequests,
} from '../services/directoryRemovalRequestService';
import { routeParam } from '../utils/routeParams';

const sessionNetid = (request: Request): string => {
  const currentUser = request.user as { netId?: string; netid?: string } | undefined;
  return currentUser?.netId || currentUser?.netid || '';
};

export const getOwnDirectoryRemovalRequest = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  try {
    response.json(await getOwnDirectoryRemovalEligibility(sessionNetid(request)));
  } catch (error) {
    next(error);
  }
};

export const submitOwnDirectoryRemovalRequest = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  try {
    assertNoRequestFields(request.body);
    const { created, request: ownRequest } = await createOwnDirectoryRemovalRequest(
      sessionNetid(request),
    );
    response.status(created ? 201 : 200).json({ request: ownRequest });
  } catch (error) {
    next(error);
  }
};

export const listAdminDirectoryRemovalRequests = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  try {
    response.json(await listDirectoryRemovalRequests({ status: request.query.status }));
  } catch (error) {
    next(error);
  }
};

export const decideAdminDirectoryRemovalRequest = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  try {
    const decided = await decideDirectoryRemovalRequest(
      routeParam(request, 'id'),
      sessionNetid(request),
      request.body,
    );
    response.json({ request: decided });
  } catch (error) {
    next(error);
  }
};
