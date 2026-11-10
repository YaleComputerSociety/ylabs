/**
 * A synchronizer token for the account deletion route (#4156), on top of the global
 * `csrfOriginGuard`. The token lives in the signed cookie session and must come back in a
 * header, which another site can neither read (CORS) nor forge, so a deletion needs both a
 * trusted origin and a token this session was issued.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const ACCOUNT_DELETION_CSRF_HEADER = 'x-csrf-token';
export const CSRF_TOKEN_REQUIRED_CODE = 'CSRF_TOKEN_REQUIRED';

const CSRF_TOKEN_BYTES = 32;
const CSRF_TOKEN_RE = /^[0-9a-f]{64}$/;

export const csrfTokensEqual = (expected: unknown, presented: unknown): boolean => {
  if (typeof expected !== 'string' || typeof presented !== 'string') return false;
  if (!CSRF_TOKEN_RE.test(expected) || !CSRF_TOKEN_RE.test(presented)) return false;
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(presented, 'utf8'));
};

export const issueAccountDeletionCsrfToken = (req: Request, res: Response): void => {
  if (!req.session) {
    res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
    return;
  }
  if (!CSRF_TOKEN_RE.test(String(req.session.accountDeletionCsrfToken ?? ''))) {
    req.session.accountDeletionCsrfToken = randomBytes(CSRF_TOKEN_BYTES).toString('hex');
  }
  res.status(200).json({ csrfToken: req.session.accountDeletionCsrfToken });
};

export const requireAccountDeletionCsrfToken = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (
    !csrfTokensEqual(req.session?.accountDeletionCsrfToken, req.get(ACCOUNT_DELETION_CSRF_HEADER))
  ) {
    res
      .status(403)
      .json({ error: 'Missing or invalid CSRF token', code: CSRF_TOKEN_REQUIRED_CODE });
    return;
  }
  next();
};
