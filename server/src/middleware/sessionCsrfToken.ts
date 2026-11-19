/**
 * A per-session synchronizer token for state-changing routes, on top of the global
 * `csrfOriginGuard` (#4156, #4160). The token lives in the signed cookie session and must come
 * back in a header, which another site can neither read (CORS) nor forge, so a guarded write
 * needs both a trusted origin and a token this session was issued.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const SESSION_CSRF_HEADER = 'x-csrf-token';
export const CSRF_TOKEN_REQUIRED_CODE = 'CSRF_TOKEN_REQUIRED';

const CSRF_TOKEN_BYTES = 32;
const CSRF_TOKEN_RE = /^[0-9a-f]{64}$/;

export const csrfTokensEqual = (expected: unknown, presented: unknown): boolean => {
  if (typeof expected !== 'string' || typeof presented !== 'string') return false;
  if (!CSRF_TOKEN_RE.test(expected) || !CSRF_TOKEN_RE.test(presented)) return false;
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(presented, 'utf8'));
};

export const issueSessionCsrfToken = (req: Request, res: Response): void => {
  if (!req.session) {
    res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
    return;
  }
  if (!CSRF_TOKEN_RE.test(String(req.session.csrfToken ?? ''))) {
    req.session.csrfToken = randomBytes(CSRF_TOKEN_BYTES).toString('hex');
  }
  res.status(200).json({ csrfToken: req.session.csrfToken });
};

export const requireSessionCsrfToken = (req: Request, res: Response, next: NextFunction): void => {
  if (!csrfTokensEqual(req.session?.csrfToken, req.get(SESSION_CSRF_HEADER))) {
    res
      .status(403)
      .json({ error: 'Missing or invalid CSRF token', code: CSRF_TOKEN_REQUIRED_CODE });
    return;
  }
  next();
};
