/**
 * Authentication guards and role-based access control middleware.
 */
import express from 'express';
import { allowsLegacyAdminUserType, hasActiveAdminGrant } from '../services/adminGrantService';

const AUTH_NETID_RE = /^[A-Za-z0-9]{2,12}$/;

type AuthenticatedUser = {
  netId?: unknown;
  netid?: unknown;
  userType?: unknown;
  userConfirmed?: boolean;
  profileVerified?: boolean;
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

const hasAdminAuthority = async (user: AuthenticatedUser): Promise<boolean> => {
  const netid = requestNetid(user);
  if (user.userType !== 'admin' || !netid) return false;
  return hasActiveAdminGrant(netid).then((hasGrant) => hasGrant || allowsLegacyAdminUserType());
};

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
 * Middleware to check if user is trustworthy (confirmed admin/professor/faculty)
 */
export const isTrustworthy = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const user = req.user as AuthenticatedUser;

  if (!hasAuthenticatedPrincipal(user)) {
    return sendAuthRequired(res);
  }

  if (!user.userConfirmed) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (user.userType === 'professor' || user.userType === 'faculty') {
    return next();
  }

  if (user.userType === 'admin') {
    return hasAdminAuthority(user)
      .then((authorized) => {
        if (authorized) return next();
        return res.status(403).json({ error: 'Forbidden' });
      })
      .catch(next);
  }

  return res.status(403).json({ error: 'Forbidden' });
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
  const currentUser = req.user as AuthenticatedUser;

  if (!hasAuthenticatedPrincipal(currentUser)) {
    return sendAuthRequired(res);
  }

  if (currentUser.userType === 'admin') {
    return hasAdminAuthority(currentUser)
      .then((authorized) => {
        if (authorized) return next();
        return res.status(403).json({ error: 'Admin privileges required' });
      })
      .catch(next);
  }

  const allowedTypes = ['professor', 'faculty'];
  if (!allowedTypes.includes(String(currentUser.userType ?? ''))) {
    return res.status(403).json({ error: 'User does not have permission to create listings' });
  }

  if (currentUser.userType !== 'admin' && currentUser.userConfirmed !== true) {
    return res.status(403).json({ error: 'Account must be confirmed before creating listings' });
  }

  if (currentUser.userType !== 'admin' && !currentUser.profileVerified) {
    return res.status(403).json({
      error:
        'You must verify your profile before creating listings. Go to your account page to review and verify your profile.',
    });
  }

  next();
};

/**
 * Faculty opportunity writes are intentionally narrower than legacy listing
 * creation. Administrators moderate these records through the review queue,
 * but only verified faculty principals may author them.
 */
export const canManagePostedOpportunities = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const currentUser = req.user as AuthenticatedUser;

  if (!hasAuthenticatedPrincipal(currentUser)) {
    return sendAuthRequired(res);
  }

  if (!['professor', 'faculty'].includes(String(currentUser.userType ?? ''))) {
    return res.status(403).json({
      error: 'Verified faculty access is required',
      code: 'FACULTY_ACCESS_REQUIRED',
    });
  }

  if (currentUser.userConfirmed !== true) {
    return res.status(403).json({
      error: 'Account confirmation is required',
      code: 'ACCOUNT_CONFIRMATION_REQUIRED',
    });
  }

  if (currentUser.profileVerified !== true) {
    return res.status(403).json({
      error: 'Faculty profile verification is required',
      code: 'PROFILE_VERIFICATION_REQUIRED',
    });
  }

  next();
};

/**
 * Middleware to check if user can submit listing claim/correction requests.
 * These requests create admin-review work items, so they are limited to
 * confirmed faculty/staff/operator accounts rather than all authenticated users.
 */
export const canSubmitListingClaimRequest = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const currentUser = req.user as AuthenticatedUser;

  if (!hasAuthenticatedPrincipal(currentUser)) {
    return sendAuthRequired(res);
  }

  if (!currentUser.userConfirmed) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (currentUser.userType === 'admin') {
    return hasAdminAuthority(currentUser)
      .then((authorized) => {
        if (authorized) return next();
        return res.status(403).json({ error: 'Forbidden' });
      })
      .catch(next);
  }

  const allowedTypes = ['professor', 'faculty', 'staff'];
  if (allowedTypes.includes(String(currentUser.userType ?? ''))) {
    return next();
  }

  return res.status(403).json({ error: 'Forbidden' });
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
      if (hasGrant || (currentUser.userType === 'admin' && allowsLegacyAdminUserType())) {
        return next();
      }

      return res.status(403).json({ error: 'Admin privileges required' });
    })
    .catch(next);
};

/**
 * Middleware to check if user is a professor
 */
export const isProfessor = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const currentUser = req.user as AuthenticatedUser;

  if (!hasAuthenticatedPrincipal(currentUser)) {
    return sendAuthRequired(res);
  }

  if (currentUser.userType === 'admin') {
    return hasAdminAuthority(currentUser)
      .then((authorized) => {
        if (authorized) return next();
        return res.status(403).json({ error: 'Admin privileges required' });
      })
      .catch(next);
  }

  if (
    (currentUser.userType === 'professor' || currentUser.userType === 'faculty') &&
    currentUser.userConfirmed === true
  ) {
    return next();
  }

  return res.status(403).json({ error: 'Professor privileges required' });
};

/**
 * Middleware to check if user account is confirmed
 */
export const isConfirmed = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const currentUser = req.user as AuthenticatedUser;

  if (!hasAuthenticatedPrincipal(currentUser)) {
    return sendAuthRequired(res);
  }

  if (!currentUser.userConfirmed) {
    return res.status(403).json({ error: 'Account must be confirmed' });
  }

  next();
};
