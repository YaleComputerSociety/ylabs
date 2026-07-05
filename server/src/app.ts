/**
 * Express application setup with middleware, routes, and CORS configuration.
 */
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { ipKeyGenerator } from 'express-rate-limit';
import { allowsNonProductionSecurityBypass, requiresSecureSessionCookie } from './utils/environment';
import passport, { passportRoutes } from './passport';
import routes from './routes/index';
import cookieSession from 'cookie-session';
import dotenv from 'dotenv';
import { readFile } from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { securityHeaders } from './middleware/securityHeaders';
import { sanitizeMongo } from './middleware/sanitizeMongo';
import { csrfOriginGuard } from './middleware/csrfOriginGuard';
import { createCorsOriginHandler } from './middleware/corsOrigin';
import { sessionCookieName } from './utils/sessionCookie';
import { createRateLimitHandler } from './middleware/rateLimitResponse';
import { getResearchGroupBySlug } from './services/researchGroupService';
import {
  buildPublicResearchSeoMetadata,
  injectSeoMetadata,
  resolvePublicBaseUrl,
} from './utils/publicResearchSeo';

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
// They stay behind the CSRF origin guard and their surface limiter, but must
// not consume the write budget: research search is public and IP-keyed for
// anonymous visitors, so 50/15min shared across a campus NAT egress IP would
// throttle the main browse page.
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

const normalizedRateLimitNetId = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return RATE_LIMIT_NETID_RE.test(normalized) ? normalized : undefined;
};

const getRateLimitKey = (req: express.Request): string => {
  const user = req.user as { netId?: unknown; netid?: unknown } | undefined;
  const netId = normalizedRateLimitNetId(user?.netId ?? user?.netid);
  if (netId) {
    return `user:${netId}`;
  }

  return `ip:${ipKeyGenerator(req.ip || '')}`;
};

// The CAS login callback is always unauthenticated, so it keys by IP —
// and Yale campus NAT can put many users behind one egress IP, letting the
// shared budget lock people out of login. CAS ticket validation already
// gates the endpoint, so it is exempt from the general limiter.
const isCasLoginCallback = (req: express.Request): boolean => req.path === '/cas';

// Surfaces governed by publicDiscoveryLimiter below; exempt from the general
// limiter so the discovery budget is the single, deliberately sized cap for
// the anonymous (IP-keyed) browse experience. Both mounts hold only public
// search/detail reads.
const isPublicDiscoveryPath = (req: express.Request): boolean =>
  req.path === '/research' ||
  req.path.startsWith('/research/') ||
  req.path === '/opportunities' ||
  req.path.startsWith('/opportunities/');

// General rate limiter: 200 requests per 15 minutes per user (falls back to IP for unauthenticated requests)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  keyGenerator: getRateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  handler: createRateLimitHandler('Too many requests, please try again later.'),
  skip: (req) => bypassRuntimeSecurity || isCasLoginCallback(req) || isPublicDiscoveryPath(req),
});

// Write limiter for API mutations
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  keyGenerator: getRateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many write requests, please try again later.' },
  handler: createRateLimitHandler('Too many write requests, please try again later.'),
  skip: () => bypassRuntimeSecurity,
});

// Public discovery endpoints (research/opportunity search + detail) are the
// sole rate budget for the anonymous browse surface, which keys by IP — often
// a shared campus NAT egress. The ceiling must absorb debounced
// search-as-you-type, filter toggles, infinite scroll, and detail views from
// several concurrent users on one IP; the fan-out behind it is Meilisearch,
// which is cheap.
const publicDiscoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  keyGenerator: getRateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many discovery requests, please try again later.' },
  handler: createRateLimitHandler('Too many discovery requests, please try again later.'),
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

function setPrivateApiCacheHeaders(_req: express.Request, res: express.Response, next: express.NextFunction) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

function blockSourceMapAssetRequests(req: express.Request, res: express.Response, next: express.NextFunction) {
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
  .set('trust proxy', 1)
  .set('query parser', 'simple')
  .disable('x-powered-by')
  .use(securityHeaders)
  .use(cors(corsOptions))
  .use('/api', setPrivateApiCacheHeaders)
  .use('/api', csrfOriginGuard(allowList, {
    writeLikeSafeMethodPaths: WRITE_LIKE_SAFE_METHOD_API_PATHS,
  }))
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
  .use('/api/research', publicDiscoveryLimiter)
  .use('/api/opportunities', publicDiscoveryLimiter)
  .use('/api', (req, res, next) => {
    if (!shouldApplyWriteLimiter(req)) {
      return next();
    }
    return writeLimiter(req, res, next);
  })
  .use('/api', passportRoutes)
  .use('/api', routes);

app.use('/api', notFoundHandler);

const sendPublicResearchIndex = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  try {
    const indexHtml = await readFile(clientIndexPath, 'utf8');
    let researchEntity = null;

    if (req.params.slug) {
      try {
        researchEntity = await getResearchGroupBySlug(req.params.slug);
      } catch (error) {
        console.error('Unable to load public research SEO metadata:', error);
      }
    }

    const metadata = buildPublicResearchSeoMetadata({
      baseUrl: resolvePublicBaseUrl(req),
      path: req.path,
      researchEntity,
    });

    res.type('html').send(injectSeoMetadata(indexHtml, metadata));
  } catch (error) {
    next(error);
  }
};

app.use(blockSourceMapAssetRequests);
app.use(setOAuthCallbackAssetCacheHeaders);
app.use(
  express.static(clientDistPath, {
    dotfiles: 'ignore',
    fallthrough: true,
    index: false,
  }),
);

app.get('/research', sendPublicResearchIndex);
app.get('/research/:slug', sendPublicResearchIndex);

app.get('*', (req, res) => {
  if (!shouldServeSpaFallback(req)) {
    return sendStaticNotFound(res);
  }

  res.sendFile(clientIndexPath);
});

app.use(errorHandler);

export default app;
