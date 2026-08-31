import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'node:crypto';
import { allowsNonProductionSecurityBypass } from '../utils/environment';
import { createRateLimitHandler } from './rateLimitResponse';

const RATE_LIMIT_NETID_RE = /^[A-Za-z0-9]{2,12}$/;
const RATE_LIMIT_ANONYMOUS_ID_RE = /^[a-f0-9]{32}$/;

const bypassRuntimeSecurity = allowsNonProductionSecurityBypass();

const normalizedRateLimitNetId = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return RATE_LIMIT_NETID_RE.test(normalized) ? normalized : undefined;
};

const normalizedAnonymousRateLimitId = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  return RATE_LIMIT_ANONYMOUS_ID_RE.test(value) ? value : undefined;
};

export const ensureAnonymousRateLimitId = (req: Request, _res: Response, next: NextFunction) => {
  if (req.session && !normalizedAnonymousRateLimitId(req.session.rateLimitId)) {
    req.session.rateLimitId = randomBytes(16).toString('hex');
  }
  next();
};

// A proxy may append a rotating source port to the forwarded address. Keying on
// that would let one caller reset their own bucket by reopening the connection,
// so the port is stripped. Only a bracketed IPv6 literal or an IPv4 literal can
// carry a bare `:port`; a bare IPv6 address is all colons and must never be
// split.
const withoutTrailingPort = (value: string): string => {
  const bracketed = value.match(/^\[(.+)\](?::\d+)?$/);
  if (bracketed) return bracketed[1];
  const ipv4WithPort = value.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  return ipv4WithPort ? ipv4WithPort[1] : value;
};

// Behind a load balancer, `req.socket.remoteAddress` is the PROXY, not the
// caller, so keying on it collapses every client into a single bucket and turns
// a per-client limit into a global one - express-rate-limit's own troubleshooting
// guide describes this as becoming "effectively a global one and blocking all
// requests once the limit is reached" (#2318). `authLimiter` is 20 per 15 minutes
// on the CAS login path, so that was 20 logins per window for the entire user
// base.
//
// `req.ip` is the client address that the validated `trust proxy` predicate in
// app.ts already resolves from the forwarded chain, which is why that apparatus
// has to be the input here rather than the raw socket.
export const rateLimitClientIp = (req: Request): string =>
  withoutTrailingPort(typeof req.ip === 'string' ? req.ip.trim() : '');

export const getRateLimitKey = (req: Request): string => {
  const user = req.user as { netId?: unknown; netid?: unknown } | undefined;
  const netId = normalizedRateLimitNetId(user?.netId ?? user?.netid);
  if (netId) {
    return `user:${netId}`;
  }

  const anonymousId = normalizedAnonymousRateLimitId(req.session?.rateLimitId);
  return anonymousId
    ? `anonymous:${anonymousId}`
    : `ip:${ipKeyGenerator(rateLimitClientIp(req))}`;
};

export const getPeerIpKey = (req: Request): string =>
  `ip:${ipKeyGenerator(rateLimitClientIp(req))}`;

// Login availability must not depend on the general API traffic budget.
// CAS ticket validation already gates the callback, so it is exempt from the
// global limiter and instead metered by the per-IP auth limiter below.
const isCasLoginCallback = (req: Request): boolean => req.path === '/cas';

// A 5xx is our failure, not the caller's: counting it against their budget
// turns a transient outage (e.g. a MongoDB reconnect returning 503) into a
// full-window lockout on a backend that has already recovered. 4xx still
// counts so genuine abuse and bad input remain limited.
const requestWasSuccessful = (_req: Request, res: Response): boolean => res.statusCode < 500;

const WINDOW_MS = 15 * 60 * 1000;

// Global safety net across every /api request per validated session bucket.
// Sized high because un-batched view/impression telemetry rides this budget;
// lower it once analytics beacons are batched client-side.
export const globalLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 1000,
  keyGenerator: getRateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true,
  requestWasSuccessful,
  message: { error: 'Too many requests, please try again later.' },
  handler: createRateLimitHandler('Too many requests, please try again later.'),
  skip: (req) => bypassRuntimeSecurity || isCasLoginCallback(req),
});

// Opt-in mutation limiter. Applied per-route only on genuine state-changing
// endpoints, so a new route is never accidentally billed as a write and reads
// or telemetry can never exhaust the mutation budget.
export const writeLimit = rateLimit({
  windowMs: WINDOW_MS,
  max: 50,
  keyGenerator: getRateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true,
  requestWasSuccessful,
  message: { error: 'Too many write requests, please try again later.' },
  handler: createRateLimitHandler('Too many write requests, please try again later.'),
  skip: () => bypassRuntimeSecurity,
});

// Per-IP brute-force ceiling on the CAS callback. Keyed by the real TCP peer
// (not forwarding headers) so a client cannot shift buckets by spoofing them.
export const authLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 20,
  keyGenerator: getPeerIpKey,
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true,
  requestWasSuccessful,
  message: { error: 'Too many login attempts, please try again later.' },
  handler: createRateLimitHandler('Too many login attempts, please try again later.'),
  skip: () => bypassRuntimeSecurity,
});
