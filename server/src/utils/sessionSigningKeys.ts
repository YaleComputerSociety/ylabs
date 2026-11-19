import { createHmac } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const SESSION_SECRET_PREVIOUS_ENV = 'SESSION_SECRET_PREVIOUS';

export interface SessionSigningKeyOptions {
  currentSecret: string;
  previousSecret?: string;
  isAcceptableSecret: (value: string) => boolean;
  requireStrongSecrets: boolean;
}

// cookie-session signs with the first key and verifies with any; a cookie verified by a
// later key is re-signed with the first, so active sessions move to the new secret.
// The overlap is bounded by SESSION_LIFETIME_MS, after which no older cookie can pass
// deserializeUser; docs/incident-runbook.md has the rotation steps.
export const sessionSigningKeys = ({
  currentSecret,
  previousSecret,
  isAcceptableSecret,
  requireStrongSecrets,
}: SessionSigningKeyOptions): string[] => {
  const previous = (previousSecret ?? '').trim();
  if (!previous) return [currentSecret];
  if (previous === currentSecret) {
    throw new Error(`${SESSION_SECRET_PREVIOUS_ENV} must differ from SESSION_SECRET.`);
  }
  if (requireStrongSecrets && !isAcceptableSecret(previous)) {
    throw new Error(
      `${SESSION_SECRET_PREVIOUS_ENV} must be a high-entropy string of at least 32 characters.`,
    );
  }
  return [currentSecret, previous];
};

const BASE64_TO_COOKIE_SAFE: Record<string, string> = { '/': '_', '+': '-', '=': '' };

// Mirrors keygrip's default signature (HMAC-SHA1, cookie-safe base64), which cookie-session uses.
const cookieSignature = (secret: string, data: string): string =>
  createHmac('sha1', secret)
    .update(data)
    .digest('base64')
    .replace(/[/+=]/g, (character) => BASE64_TO_COOKIE_SAFE[character]);

const requestCookie = (req: Request, name: string): string | undefined => {
  const prefix = `${name}=`;
  return (req.headers.cookie ?? '')
    .split(';')
    .map((pair) => pair.trim())
    .find((pair) => pair.startsWith(prefix))
    ?.slice(prefix.length);
};

// cookies re-signs a previous-key cookie without maxAge, secure or sameSite, which would
// turn the 30-day session into a browser-session one; replacing req.session makes
// cookie-session re-issue both cookies with the configured options instead.
export const reissueSessionSignedWithPreviousKey =
  (cookieName: string, currentSecret: string) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const value = requestCookie(req, cookieName);
    const signature = requestCookie(req, `${cookieName}.sig`);
    if (
      value &&
      signature &&
      req.session?.isPopulated &&
      signature !== cookieSignature(currentSecret, `${cookieName}=${value}`)
    ) {
      req.session = { ...req.session };
    }
    next();
  };
