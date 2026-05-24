/**
 * Authentication guards and role-based access control middleware.
 */
import express from 'express';
import { isDevelopment, isTest } from '../utils/environment';

const DEV_AUTH_USER_TYPES = new Set([
  'undergraduate',
  'graduate',
  'professor',
  'faculty',
  'admin',
  'unknown',
]);

const CAS_ROUTE_PREFIXES = ['/cas', '/logout'];

const envFlagEnabled = (value: string | undefined) => value === 'true' || value === '1';

const allowedDevUserType = (value: unknown): string | undefined =>
  typeof value === 'string' && DEV_AUTH_USER_TYPES.has(value) ? value : undefined;

/**
 * Resolve a local-development auth user. The default is an admin for local
 * operator testing, while env vars and request headers can exercise other roles.
 */
export function buildLocalAuthBypassUser(req?: express.Request) {
  const requestedUserType =
    allowedDevUserType(req?.header('x-dev-user-type')) ||
    allowedDevUserType(process.env.LOCAL_AUTH_BYPASS_USER_TYPE);
  const userType = requestedUserType || 'admin';
  const requestedNetid = req?.header('x-dev-netid') || process.env.LOCAL_AUTH_BYPASS_NETID;
  const netId = requestedNetid?.trim() || (userType === 'admin' ? 'devadmin' : 'test123');

  return {
    netId,
    userType,
    userConfirmed: true,
    profileVerified: true,
  };
}

const canBypassLocalAuth = () =>
  envFlagEnabled(process.env.LOCAL_AUTH_BYPASS) && (isDevelopment() || isTest());

const isCasExerciseRoute = (path: string) =>
  CAS_ROUTE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

/**
 * Optional local/dev auth bypass. It never runs in production and deliberately
 * skips CAS routes so developers can still test the real Yale CAS flow.
 */
export const applyLocalAuthBypass = (
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction,
) => {
  if (!req.user && canBypassLocalAuth() && !isCasExerciseRoute(req.path)) {
    req.user = buildLocalAuthBypassUser(req);
  }

  next();
};

/**
 * Middleware to check if user is authenticated
 */
export const isAuthenticated = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  if (req.user) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
};

/**
 * Middleware to check if user is trustworthy (confirmed admin/professor/faculty)
 */
export const isTrustworthy = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const user = req.user as { netId?: string; userType?: string; userConfirmed?: boolean };

  if (
    user &&
    user.userConfirmed &&
    (user.userType === 'admin' || user.userType === 'professor' || user.userType === 'faculty')
  ) {
    return next();
  }
  res.status(403).json({ error: 'Forbidden' });
};

/**
 * Middleware to check if user is an admin
 */
export const isAdmin = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const currentUser = req.user as { netId?: string; userType?: string; userConfirmed?: boolean };

  if (!currentUser) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (currentUser.userType !== 'admin') {
    return res.status(403).json({ error: 'Admin privileges required' });
  }

  next();
};

/**
 * Middleware to check if user is a professor
 */
export const isProfessor = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const currentUser = req.user as { netId?: string; userType?: string; userConfirmed?: boolean };

  if (!currentUser) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (
    currentUser.userType !== 'professor' &&
    currentUser.userType !== 'faculty' &&
    currentUser.userType !== 'admin'
  ) {
    return res.status(403).json({ error: 'Professor privileges required' });
  }

  next();
};

/**
 * Middleware to check if user account is confirmed
 */
export const isConfirmed = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const currentUser = req.user as { netId?: string; userType?: string; userConfirmed?: boolean };

  if (!currentUser) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!currentUser.userConfirmed) {
    return res.status(403).json({ error: 'Account must be confirmed' });
  }

  next();
};
