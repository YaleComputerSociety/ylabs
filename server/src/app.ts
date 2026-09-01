/**
 * Express application setup with middleware, routes, and CORS configuration.
 */
import cors from 'cors';
import express from 'express';
import {
  allowsNonProductionSecurityBypass,
  requiresSecureSessionCookie,
} from './utils/environment';
import passport, { passportRoutes } from './passport';
import routes from './routes/index';
import cookieSession from 'cookie-session';
import dotenv from 'dotenv';
import { BlockList, isIP } from 'node:net';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { securityHeaders } from './middleware/securityHeaders';
import { sanitizeMongo } from './middleware/sanitizeMongo';
import { csrfOriginGuard } from './middleware/csrfOriginGuard';
import { createCorsOriginHandler } from './middleware/corsOrigin';
import { sessionCookieName } from './utils/sessionCookie';
import {
  ensureAnonymousRateLimitId,
  firstContactLimiter,
  globalLimiter,
  observeFirstContactVolume,
} from './middleware/rateLimiters';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistPath = path.join(__dirname, '../../client/dist');
const clientIndexPath = path.join(clientDistPath, 'index.html');
const API_BODY_LIMIT = '64kb';
const API_URLENCODED_PARAMETER_LIMIT = 100;
// GET/HEAD/OPTIONS paths the CSRF origin guard must still treat as
// state-changing. Empty today; logout is protected by isTrustedLogoutRequest
// (Sec-Fetch-Site + Origin/Referer) inside its own handler. Write-limiting is
// opt-in per route via writeLimit, so no read/telemetry path lists are needed.
const WRITE_LIKE_SAFE_METHOD_API_PATHS = new Set<string>();

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
  // Mounted AFTER ensureAnonymousRateLimitId so the session cookie is already on
  // the response when this 429s: the rejection is then retryable by honouring
  // the cookie just issued, which a browser does automatically and a caller that
  // discards cookies does not. Mounted BEFORE globalLimiter so a first-contact
  // flood is rejected without first consuming a per-session budget it minted
  // itself (#2319).
  .use('/api', firstContactLimiter)
  .use('/api', observeFirstContactVolume)
  .use('/api', globalLimiter)
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
