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
import * as path from 'path';
import { fileURLToPath } from 'url';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { securityHeaders } from './middleware/securityHeaders';
import { sanitizeMongo } from './middleware/sanitizeMongo';
import { csrfOriginGuard } from './middleware/csrfOriginGuard';
import { createCorsOriginHandler } from './middleware/corsOrigin';
import { sessionCookieName } from './utils/sessionCookie';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config();

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  if (allowsNonProductionSecurityBypass()) {
    console.warn(
      '[security] SESSION_SECRET missing or <32 chars — acceptable only in local dev/test/ci.',
    );
  } else {
    throw new Error('SESSION_SECRET must be set to a string of at least 32 characters.');
  }
}

const bypassRuntimeSecurity = allowsNonProductionSecurityBypass();

const getRateLimitKey = (req: express.Request): string => {
  const user = req.user as { netId?: string } | undefined;
  if (user?.netId) {
    return `user:${user.netId}`;
  }

  return `ip:${ipKeyGenerator(req.ip || '')}`;
};

// General rate limiter: 200 requests per 15 minutes per user (falls back to IP for unauthenticated requests)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  keyGenerator: getRateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  skip: () => bypassRuntimeSecurity,
});

// Write limiter for API mutations
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  keyGenerator: getRateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many write requests, please try again later.' },
  skip: () => bypassRuntimeSecurity,
});

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

const app = express()
  .set('trust proxy', 1)
  .disable('x-powered-by')
  .use(securityHeaders)
  .use(cors(corsOptions))
  .use('/api', csrfOriginGuard(allowList))
  .use(express.json())
  .use(express.urlencoded({ extended: false }))
  .use(
    cookieSession({
      name: sessionCookieName(),
      keys: [process.env.SESSION_SECRET ?? ''],
      maxAge: 72 * 60 * 60 * 1000,
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
  .use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }
    return writeLimiter(req, res, next);
  })
  .use('/api', passportRoutes)
  .use('/api', routes);

app.use('/api', notFoundHandler);

app.use(express.static(path.join(__dirname, '../../client/dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
});

app.use(errorHandler);

export default app;
