/**
 * Express application setup with middleware, routes, and CORS configuration.
 */
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { ipKeyGenerator } from 'express-rate-limit';
import {
  allowsNonProductionSecurityBypass,
  requiresSecureSessionCookie,
} from './utils/environment';
import passport, { passportRoutes } from './passport';
import routes from './routes/index';
import cookieSession from 'cookie-session';
import dotenv from 'dotenv';
import { randomBytes } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { securityHeaders } from './middleware/securityHeaders';
import { sanitizeMongo } from './middleware/sanitizeMongo';
import { csrfOriginGuard } from './middleware/csrfOriginGuard';
import { createCorsOriginHandler } from './middleware/corsOrigin';
import { sessionCookieName } from './utils/sessionCookie';
import { createRateLimitHandler } from './middleware/rateLimitResponse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistPath = path.join(__dirname, '../../client/dist');
const clientIndexPath = path.join(clientDistPath, 'index.html');
const API_BODY_LIMIT = '64kb';
const API_URLENCODED_PARAMETER_LIMIT = 100;
const SAFE_RATE_LIMIT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// No GET routes currently need write-limiter treatment; logout is protected by
// isTrustedLogoutRequest (Sec-Fetch-Site + Origin/Referer) inside its own handler.
const WRITE_LIKE_SAFE_METHOD_API_PATHS = new Set<string>();
// POST routes that are pure reads (search bodies too rich for a query string).
// They stay behind the CSRF origin guard and the general per-user limiter, but
// must not consume the write budget: research search drives the main browse
// page, so billing it as a write would throttle ordinary browsing at 50/15min.
const READ_ONLY_UNSAFE_METHOD_API_PATHS = new Set<string>(['/research/search']);
// View-telemetry PUTs fired on every detail-page open. Billing them as writes
// lets ordinary browsing exhaust the 50/15min budget and 429 the user's real
// mutations (favorites, tracking, profile edits). They remain under the
// general per-user limiter.
const READ_ONLY_UNSAFE_METHOD_API_PATH_PATTERNS = [
  /^\/(?:programs|listings)\/[0-9a-fA-F]{24}\/addView$/,
];

dotenv.config();

const sessionSecret = (process.env.SESSION_SECRET ?? '').trim();
const MIN_SESSION_SECRET_LENGTH = 32;
const MIN_SESSION_SECRET_UNIQUE_CHARS = 8;

function isWeakSessionSecret(value: string): boolean {
  const uniqueChars = new Set(value).size;
  if (uniqueChars < MIN_SESSION_SECRET_UNIQUE_CHARS) return true;

  const compact = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const weakTokens = [
    'changeme',
    'changeit',
    'default',
    'development',
    'password',
    'production',
    'secret',
    'sessionsecret',
    'testsecret',
    'yaleresearch',
    'ylabssecret',
  ];
  return weakTokens.some((token) => compact.includes(token));
}

if (sessionSecret.length < MIN_SESSION_SECRET_LENGTH || isWeakSessionSecret(sessionSecret)) {
  if (allowsNonProductionSecurityBypass()) {
    console.warn(
      '[security] SESSION_SECRET blank, weak, or <32 chars after trimming — acceptable only in local dev/test/ci.',
    );
  } else {
    throw new Error(
      'SESSION_SECRET must be set to a high-entropy string of at least 32 characters.',
    );
  }
}

const bypassRuntimeSecurity = allowsNonProductionSecurityBypass();
const RATE_LIMIT_NETID_RE = /^[A-Za-z0-9]{2,12}$/;
const RATE_LIMIT_ANONYMOUS_ID_RE = /^[a-f0-9]{32}$/;

const trustedProxyAddresses = new BlockList();
let trustedProxyAddressCount = 0;
for (const entry of (process.env.TRUSTED_PROXY_CIDRS || '').split(',')) {
  const value = entry.trim();
  if (!value) continue;
  const cidrParts = value.split('/');
  const [address, prefixValue] = cidrParts;
  const addressType = isIP(address);
  const hasValidPrefixSyntax = prefixValue === undefined || /^\d+$/.test(prefixValue);
  const prefix = prefixValue === undefined ? undefined : Number(prefixValue);
  const maximumPrefix = addressType === 4 ? 32 : 128;
  if (
    cidrParts.length > 2 ||
    addressType === 0 ||
    !hasValidPrefixSyntax ||
    (prefix !== undefined && (!Number.isInteger(prefix) || prefix < 0 || prefix > maximumPrefix))
  ) {
    throw new Error(`TRUSTED_PROXY_CIDRS contains an invalid address or CIDR: ${value}`);
  }
  const family = addressType === 4 ? 'ipv4' : 'ipv6';
  if (prefix === undefined) {
    trustedProxyAddresses.addAddress(address, family);
  } else {
    trustedProxyAddresses.addSubnet(address, prefix, family);
  }
  trustedProxyAddressCount += 1;
}

if (!bypassRuntimeSecurity && trustedProxyAddressCount === 0) {
  throw new Error(
    'TRUSTED_PROXY_CIDRS must define at least one trusted proxy in deployed runtimes.',
  );
}

const normalizedPeerAddress = (value: string): string =>
  value.startsWith('::ffff:') && isIP(value.slice(7)) === 4 ? value.slice(7) : value;

const isTrustedProxyAddress = (value: string): boolean => {
  const address = normalizedPeerAddress(value);
  const addressType = isIP(address);
  return (
    addressType !== 0 && trustedProxyAddresses.check(address, addressType === 4 ? 'ipv4' : 'ipv6')
  );
};

const normalizedRateLimitNetId = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return RATE_LIMIT_NETID_RE.test(normalized) ? normalized : undefined;
};

const normalizedAnonymousRateLimitId = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  return RATE_LIMIT_ANONYMOUS_ID_RE.test(value) ? value : undefined;
};

const ensureAnonymousRateLimitId = (
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction,
) => {
  if (req.session && !normalizedAnonymousRateLimitId(req.session.rateLimitId)) {
    req.session.rateLimitId = randomBytes(16).toString('hex');
  }
  next();
};

const getRateLimitKey = (req: express.Request): string => {
  const user = req.user as { netId?: unknown; netid?: unknown } | undefined;
  const netId = normalizedRateLimitNetId(user?.netId ?? user?.netid);
  if (netId) {
    return `user:${netId}`;
  }

  const anonymousId = normalizedAnonymousRateLimitId(req.session?.rateLimitId);
  return anonymousId
    ? `anonymous:${anonymousId}`
    : `ip:${ipKeyGenerator(req.socket.remoteAddress ?? '')}`;
};

// Login availability must not depend on the general API traffic budget.
// CAS ticket validation already gates the callback, so it is exempt from the
// general limiter.
const isCasLoginCallback = (req: express.Request): boolean => req.path === '/cas';

// A 5xx is our failure, not the caller's: counting it against their budget
// turns a transient outage (e.g. a MongoDB reconnect returning 503) into a
// full-window lockout on a backend that has already recovered. 4xx still
// counts so genuine abuse and bad input remain limited.
const requestWasSuccessful = (_req: express.Request, res: express.Response): boolean =>
  res.statusCode < 500;

// General rate limiter: 200 requests per 15 minutes per validated session bucket.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  keyGenerator: getRateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true,
  requestWasSuccessful,
  message: { error: 'Too many requests, please try again later.' },
  handler: createRateLimitHandler('Too many requests, please try again later.'),
  skip: (req) => bypassRuntimeSecurity || isCasLoginCallback(req),
});

// Write limiter for API mutations
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
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

const shouldApplyWriteLimiter = (req: express.Request): boolean => {
  if (READ_ONLY_UNSAFE_METHOD_API_PATHS.has(req.path)) return false;
  if (READ_ONLY_UNSAFE_METHOD_API_PATH_PATTERNS.some((pattern) => pattern.test(req.path))) {
    return false;
  }
  return WRITE_LIKE_SAFE_METHOD_API_PATHS.has(req.path) || !SAFE_RATE_LIMIT_METHODS.has(req.method);
};

const deployedBrowserOrigins = new Set([
  'https://yalelabs.onrender.com',
  'https://ylabs-gr4v.onrender.com',
  'https://yalelabs.io',
  'https://www.yalelabs.io',
]);
const localDevelopmentOrigins = ['http://localhost:3000'];
const allowList = new Set([
  ...deployedBrowserOrigins,
  ...(bypassRuntimeSecurity ? localDevelopmentOrigins : []),
]);

const corsOptions = {
  origin: createCorsOriginHandler(allowList, bypassRuntimeSecurity),
  credentials: true,
};

function setPrivateApiCacheHeaders(
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

function blockSourceMapAssetRequests(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (req.path.endsWith('.map')) {
    res.setHeader('Cache-Control', 'no-store, private, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('Expires', '0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(404).type('text/plain').send('Not found');
  }

  return next();
}

function setOAuthCallbackAssetCacheHeaders(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (req.path === '/oauth-callback.html' || req.path === '/oauth-callback.js') {
    res.setHeader('Cache-Control', 'no-store, private, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('Expires', '0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }

  return next();
}

function shouldServeSpaFallback(req: express.Request): boolean {
  const segments = req.path.split('/').filter(Boolean);
  if (segments.some((segment) => segment.startsWith('.'))) return false;

  const lastSegment = segments.at(-1) || '';
  if (path.extname(lastSegment)) return false;

  return true;
}

function sendStaticNotFound(res: express.Response) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(404).type('text/plain').send('Not found');
}

const app = express()
  .set('trust proxy', isTrustedProxyAddress)
  .set('query parser', 'simple')
  .disable('x-powered-by')
  .use(securityHeaders)
  .use(cors(corsOptions))
  .use('/api', setPrivateApiCacheHeaders)
  .use(
    '/api',
    csrfOriginGuard(allowList, {
      writeLikeSafeMethodPaths: WRITE_LIKE_SAFE_METHOD_API_PATHS,
    }),
  )
  .use(express.json({ limit: API_BODY_LIMIT }))
  .use(
    express.urlencoded({
      extended: false,
      limit: API_BODY_LIMIT,
      parameterLimit: API_URLENCODED_PARAMETER_LIMIT,
    }),
  )
  .use(
    cookieSession({
      name: sessionCookieName(),
      keys: [sessionSecret],
      // 30 days: long enough that students aren't silently logged out
      // mid-semester workflows, short enough to bound stale sessions.
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: requiresSecureSessionCookie(),
      path: '/',
      sameSite: 'lax',
    }),
  )
  .use('/api', ensureAnonymousRateLimitId)
  // cookie-session is stateless and does not implement session.regenerate /
  // session.save, which Passport >= 0.6 calls during req.logIn (session-
  // fixation hardening). Without these shims every login throws
  // "req.session.regenerate is not a function". No-ops are safe here because
  // the whole session lives in the signed cookie, not server-side state.
  .use((req, _res, next) => {
    const session = req.session as
      | (Record<string, unknown> & {
          regenerate?: (cb: (err?: unknown) => void) => void;
          save?: (cb: (err?: unknown) => void) => void;
        })
      | null;
    if (session) {
      if (typeof session.regenerate !== 'function') {
        session.regenerate = (cb: (err?: unknown) => void) => cb();
      }
      if (typeof session.save !== 'function') {
        session.save = (cb: (err?: unknown) => void) => cb();
      }
    }
    next();
  })
  .use(passport.initialize())
  .use(passport.session())
  .use('/api', sanitizeMongo)
  .use('/api', apiLimiter)
  .use('/api', (req, res, next) => {
    if (!shouldApplyWriteLimiter(req)) {
      return next();
    }
    return writeLimiter(req, res, next);
  })
  .use('/api', passportRoutes)
  .use('/api', routes);

app.use('/api', notFoundHandler);

app.use(blockSourceMapAssetRequests);
app.use(setOAuthCallbackAssetCacheHeaders);
app.use(
  express.static(path.join(__dirname, '../../client/dist'), {
    dotfiles: 'ignore',
    fallthrough: true,
    index: false,
  }),
);

app.get('*', (req, res) => {
  if (!shouldServeSpaFallback(req)) {
    return sendStaticNotFound(res);
  }

  res.sendFile(clientIndexPath);
});

app.use(errorHandler);

export default app;
