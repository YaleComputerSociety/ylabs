/**
 * Authentication guards and role-based access control middleware.
 */
import express from 'express';
import { isDevelopment, isTest } from '../utils/environment';

const LOCAL_AUTH_BYPASS_SKIPPED_PATHS = new Set(['/api/cas', '/api/logout']);

type AuthUser = {
  netId: string;
  userType: string;
  userConfirmed: boolean;
  profileVerified: boolean;
};

const requestPath = (req: express.Request): string => {
  return (req.originalUrl || req.path || '').split('?')[0].replace(/\/$/, '');
};

const devHeader = (req: express.Request, name: string): string | undefined => {
  const value = req.get(name);
  return value?.trim() || undefined;
};

/**
 * Local/test-only auth bypass for developer workflows.
 *
 * This intentionally fails closed unless LOCAL_AUTH_BYPASS=true and the runtime
 * environment is development or test.
 */
export function localAuthBypass(
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction,
) {
  const enabled = process.env.LOCAL_AUTH_BYPASS === 'true';
  const allowedEnvironment = isDevelopment() || isTest();

  if (
    !enabled ||
    !allowedEnvironment ||
    req.user ||
    LOCAL_AUTH_BYPASS_SKIPPED_PATHS.has(requestPath(req))
  ) {
    return next();
  }

  const user: AuthUser = {
    netId:
      devHeader(req, 'x-dev-netid') || process.env.LOCAL_AUTH_BYPASS_NETID || 'devadmin',
    userType:
      devHeader(req, 'x-dev-user-type') || process.env.LOCAL_AUTH_BYPASS_USER_TYPE || 'admin',
    userConfirmed: true,
    profileVerified: true,
  };

  req.user = user as Express.User;
  return next();
}

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
 * Middleware to check if user has permission to create listings.
 * Requires professor/faculty/admin type AND profileVerified (admins bypass verification).
 */
export const canCreateListing = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const currentUser = req.user as {
    netId?: string;
    userType?: string;
    userConfirmed?: boolean;
    profileVerified?: boolean;
  };

  if (!currentUser) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const allowedTypes = ['admin', 'professor', 'faculty'];
  if (!allowedTypes.includes(currentUser.userType ?? '')) {
    return res.status(403).json({ error: 'User does not have permission to create listings' });
  }

  if (currentUser.userType !== 'admin' && !currentUser.profileVerified) {
    return res
      .status(403)
      .json({
        error:
          'You must verify your profile before creating listings. Go to your account page to review and verify your profile.',
      });
  }

  next();
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
