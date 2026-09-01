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

// A request that arrives without a valid `rateLimitId` is a FIRST CONTACT: the
// caller is not yet carrying a session cookie. Recorded per-request rather than
// re-derived later, because `ensureAnonymousRateLimitId` mints the id in place
// and a downstream reader can no longer tell whether the caller supplied it.
// A WeakSet keeps this out of the `Request` type and out of every other
// middleware's view.
const firstContactRequests = new WeakSet<Request>();

export const isFirstContactRequest = (req: Request): boolean => firstContactRequests.has(req);

export const ensureAnonymousRateLimitId = (req: Request, _res: Response, next: NextFunction) => {
  if (req.session && !normalizedAnonymousRateLimitId(req.session.rateLimitId)) {
    firstContactRequests.add(req);
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
  return anonymousId ? `anonymous:${anonymousId}` : `ip:${ipKeyGenerator(rateLimitClientIp(req))}`;
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

// First-contact metering (#2319).
//
// The anonymous bucket is keyed on `session.rateLimitId`, which the CALLER
// supplies, so a client that simply discards cookies gets a fresh bucket on
// every request and the budget is unbounded. Per-IP limiting of ordinary
// requests is not the answer: Yale NATs many students behind few addresses, so
// an IP bucket punishes a cohort for one bad actor.
//
// The scarce resource is not identity, it is FIRST CONTACT. A real browser
// needs exactly one cookie-less request ever - it carries the cookie
// afterwards. A cookie-less scraper needs one per request. So the session bucket
// stays as-is (NAT-immune, which is why it was chosen) and only first-contact
// requests are metered per IP, in units of distinct new visitors per window.
//
// On exhaustion this 429s cookie-less callers ONLY, and the cookie minted by
// `ensureAnonymousRateLimitId` is already on the response, so the failure is
// retryable by honouring the cookie just issued: a browser recovers on its next
// request automatically, a caller that discards cookies does not. There is no
// shared fallback bucket - a limited one would collectively punish students
// behind the same NAT as a scraper, and an unlimited one would just rename the
// bypass.
//
// Cookie-less browsing is ALREADY anonymous-read-only: `cookie-session` is
// stateless (the session IS the signed cookie) and `req.logIn` writes to it
// (`passport.ts`), so a caller that discards cookies cannot hold a login. This
// therefore costs no logged-in student anything.
const DEFAULT_FIRST_CONTACT_MAX = 300;

// A configurable ceiling is a safe default plus an available misconfiguration, so
// the value is floored and logged rather than merely defaulted. A single-digit
// ceiling would lock out an entire NATed cohort, which is the outcome this
// design exists to prevent, so it is not reachable by a fat-fingered env var.
export const MIN_FIRST_CONTACT_MAX = 50;

const parsedFirstContactMax = (raw: string | undefined): number => {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_FIRST_CONTACT_MAX;
  return Math.max(MIN_FIRST_CONTACT_MAX, parsed);
};

export const firstContactMax = (env: NodeJS.ProcessEnv = process.env): number =>
  parsedFirstContactMax(env.FIRST_CONTACT_RATE_LIMIT_MAX);

export const describeFirstContactCeiling = (env: NodeJS.ProcessEnv = process.env): string => {
  const raw = env.FIRST_CONTACT_RATE_LIMIT_MAX;
  const effective = firstContactMax(env);
  if (raw === undefined || raw === '') {
    return `first-contact ceiling ${effective}/${WINDOW_MS / 60000}m (default; FIRST_CONTACT_RATE_LIMIT_MAX unset)`;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return `first-contact ceiling ${effective}/${WINDOW_MS / 60000}m (default; FIRST_CONTACT_RATE_LIMIT_MAX=${raw} is not a positive integer)`;
  }
  if (parsed < MIN_FIRST_CONTACT_MAX) {
    return `first-contact ceiling ${effective}/${WINDOW_MS / 60000}m (floored; FIRST_CONTACT_RATE_LIMIT_MAX=${raw} is below the ${MIN_FIRST_CONTACT_MAX} minimum)`;
  }
  return `first-contact ceiling ${effective}/${WINDOW_MS / 60000}m (from FIRST_CONTACT_RATE_LIMIT_MAX)`;
};

// The ceiling is NOT validated against real campus traffic: `analytics_events`
// requires a `netid` and records no source address, so anonymous first-contact
// volume per IP is unmeasurable from it by construction. Rather than trust a
// guessed number, saturation is made observable - a ceiling that silently stops
// discriminating is indistinguishable from one that is working.
let firstContactSaturationCount = 0;

export const firstContactSaturationTotal = (): number => firstContactSaturationCount;

export const resetFirstContactSaturationTotal = (): void => {
  firstContactSaturationCount = 0;
};

export const recordFirstContactSaturation = (key: string): void => {
  firstContactSaturationCount += 1;
  console.warn(
    `[rate-limit] first-contact budget exhausted for ${key} ` +
      `(max=${firstContactMax()} per ${WINDOW_MS / 60000}m, total saturations=${firstContactSaturationCount}). ` +
      'If this recurs for legitimate traffic, raise FIRST_CONTACT_RATE_LIMIT_MAX and investigate the source.',
  );
};

export const firstContactLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: firstContactMax(),
  keyGenerator: getPeerIpKey,
  standardHeaders: false,
  legacyHeaders: false,
  requestWasSuccessful,
  message: { error: 'Too many new sessions from this network, please retry.' },
  handler: (req, res) => {
    recordFirstContactSaturation(getPeerIpKey(req));
    return createRateLimitHandler(
      'Too many new sessions from this network. Retry with the session cookie just issued.',
    )(req, res);
  },
  skip: (req) => bypassRuntimeSecurity || !isFirstContactRequest(req),
});

// Exhaustion telemetry alone only reveals a ceiling that is too LOW. It is
// silent when the ceiling is too HIGH: a scraper running comfortably below a
// generous default never trips it, so the control reads green both when it is
// working and when it is not limiting anything at all. Emitting issuance VOLUME
// as well turns "nothing ever approaches the ceiling" into data rather than an
// inference from silence, and collects the distribution in the only component
// that sees anonymous first contacts - so a real number can be chosen from
// production traffic without needing web-server access logs.
export const FIRST_CONTACT_VOLUME_NOTICE_FRACTION = 0.5;

const volumeNoticesSent = new Map<string, number>();
const VOLUME_NOTICE_CACHE_LIMIT = 500;

export const resetFirstContactVolumeNotices = (): void => {
  volumeNoticesSent.clear();
};

export const observeFirstContactVolume = (req: Request, _res: Response, next: NextFunction) => {
  const info = (req as any).rateLimit as
    | { used?: number; limit?: number; resetTime?: Date }
    | undefined;
  if (!isFirstContactRequest(req) || !info || typeof info.used !== 'number') return next();

  const limit = typeof info.limit === 'number' && info.limit > 0 ? info.limit : firstContactMax();
  const threshold = Math.ceil(limit * FIRST_CONTACT_VOLUME_NOTICE_FRACTION);
  if (info.used < threshold) return next();

  const key = `${getPeerIpKey(req)}|${info.resetTime?.getTime() ?? 'nowindow'}`;
  if (volumeNoticesSent.has(key)) return next();
  if (volumeNoticesSent.size >= VOLUME_NOTICE_CACHE_LIMIT) volumeNoticesSent.clear();
  volumeNoticesSent.set(key, info.used);

  console.warn(
    `[rate-limit] first-contact issuance at ${info.used}/${limit} for ${getPeerIpKey(req)} ` +
      `in the current ${WINDOW_MS / 60000}m window. Recurring notices mean the ceiling is close to real ` +
      'traffic; an absence of them across a rollout means the ceiling is too permissive to be discriminating.',
  );
  return next();
};

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
