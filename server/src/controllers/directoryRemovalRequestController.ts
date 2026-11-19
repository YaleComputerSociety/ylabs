import { NextFunction, Request, Response } from 'express';
import {
  assertNoRequestFields,
  createOwnDirectoryRemovalRequest,
  decideDirectoryRemovalRequest,
  getOwnDirectoryRemovalEligibility,
  listDirectoryRemovalRequests,
} from '../services/directoryRemovalRequestService';
import { routeParam } from '../utils/routeParams';
import { sanitizeLogValue } from '../utils/logSanitizer';

export const eligibilityFailureLogLine = (error: unknown): string => {
  const name = error instanceof Error ? error.name : typeof error;
  const code = (error as { code?: unknown } | null)?.code;
  const detail = code === undefined ? name : `${name} code=${String(code)}`;
  return sanitizeLogValue(`Directory removal eligibility check failed: ${detail}`);
};

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
    // A driver message can quote the queried netid, so neither this log nor the error
    // handler's report may carry the original error.
    const logLine = eligibilityFailureLogLine(error);
    console.error(logLine);
    next(new Error(logLine));
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
