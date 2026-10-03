import { randomBytes } from 'node:crypto';

export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

const SESSION_CLOCK_SKEW_MS = 60 * 1000;
const SESSION_ID_BYTES = 16;
const SESSION_ID_RE = /^[0-9a-f]{32}$/;

export type SessionClaim = {
  sessionId: string;
  issuedAt: number;
  sessionVersion: number;
};

export const normalizedSessionVersion = (value: unknown): number =>
  Number.isInteger(value) && (value as number) >= 0 ? (value as number) : 0;

export const mintSessionClaim = (sessionVersion: unknown, now = Date.now()): SessionClaim => ({
  sessionId: randomBytes(SESSION_ID_BYTES).toString('hex'),
  issuedAt: now,
  sessionVersion: normalizedSessionVersion(sessionVersion),
});

export const storedSessionClaim = (stored: unknown): SessionClaim | null => {
  if (!stored || typeof stored !== 'object') return null;
  const { sessionId, issuedAt, sessionVersion } = stored as Record<string, unknown>;
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) return null;
  if (typeof issuedAt !== 'number' || !Number.isFinite(issuedAt)) return null;
  if (!Number.isInteger(sessionVersion) || (sessionVersion as number) < 0) return null;
  return { sessionId, issuedAt, sessionVersion: sessionVersion as number };
};

export const isSessionClaimLive = (
  claim: SessionClaim,
  accountSessionVersion: unknown,
  now = Date.now(),
): boolean =>
  claim.sessionVersion === normalizedSessionVersion(accountSessionVersion) &&
  claim.issuedAt <= now + SESSION_CLOCK_SKEW_MS &&
  now - claim.issuedAt < SESSION_LIFETIME_MS;
