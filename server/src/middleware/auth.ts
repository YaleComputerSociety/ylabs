/**
 * Authentication guards and admin authorization middleware.
 */
import express from 'express';
import { hasActiveAdminGrant } from '../services/adminGrantService';

const AUTH_NETID_RE = /^[A-Za-z0-9]{2,12}$/;

type AuthenticatedUser = {
  netId?: unknown;
  netid?: unknown;
};

const normalizeAuthNetid = (value: unknown): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return AUTH_NETID_RE.test(normalized) ? normalized : '';
};

const requestNetid = (user: AuthenticatedUser | null | undefined): string =>
  normalizeAuthNetid(user?.netId) || normalizeAuthNetid(user?.netid);

const hasAuthenticatedPrincipal = (user: unknown): user is AuthenticatedUser =>
  Boolean(user && typeof user === 'object' && requestNetid(user as AuthenticatedUser));

const sendAuthRequired = (res: express.Response) =>
  res.status(401).json({
    error: 'Unauthorized',
    code: 'AUTH_REQUIRED',
  });

/**
 * Middleware to check if user is authenticated
 */
export const isAuthenticated = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  if (hasAuthenticatedPrincipal(req.user)) {
    return next();
  }
  return sendAuthRequired(res);
};

/**
 * Middleware to check if user is an admin
 */
export const isAdmin = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const currentUser = req.user as AuthenticatedUser;

  if (!hasAuthenticatedPrincipal(currentUser)) {
    return sendAuthRequired(res);
  }

  return hasActiveAdminGrant(requestNetid(currentUser))
    .then((hasGrant) => {
      if (hasGrant) {
        return next();
      }

      return res.status(403).json({ error: 'Admin privileges required' });
    })
    .catch(next);
};
