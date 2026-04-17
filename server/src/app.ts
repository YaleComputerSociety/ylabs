/**
 * Express application setup with middleware, routes, and CORS configuration.
 */
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import { ipKeyGenerator } from "express-rate-limit";
import { isCI, isDevelopment, isTest } from "./utils/environment";
import passport, { passportRoutes } from "./passport";
import routes from "./routes/index";
import cookieSession from "cookie-session";
import dotenv from "dotenv";
import * as path from 'path';
import { fileURLToPath } from 'url';
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { securityHeaders } from "./middleware/securityHeaders";
import { sanitizeMongo } from "./middleware/sanitizeMongo";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config();

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  if (isCI() || isDevelopment() || isTest()) {
    console.warn('[security] SESSION_SECRET missing or <32 chars — acceptable only in dev/test/ci.');
  } else {
    throw new Error('SESSION_SECRET must be set to a string of at least 32 characters.');
  }
}

const bypassCors = isCI() || isDevelopment() || isTest();

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
  skip: () => isCI() || isDevelopment() || isTest(),
});

// Write limiter for listing/fellowship mutations
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  keyGenerator: getRateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many write requests, please try again later.' },
  skip: () => isCI() || isDevelopment() || isTest(),
});

const allowList = new Set(["http://localhost:3000", "https://yalelabs.onrender.com", "https://ylabs-gr4v.onrender.com", "https://yalelabs.io", "https://www.yalelabs.io"]);

const corsOptions = {
  origin: (origin: string | undefined, callback: any) => {
    if (origin === undefined) {
      callback(null, bypassCors);
      return;
    }
    if (bypassCors || allowList.has(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
};

const app = express()
.set('trust proxy', 1)
.disable('x-powered-by')
.use(securityHeaders)
.use(cors(corsOptions))
.use(express.json())
.use(express.urlencoded({ extended: false }))
.use(cookieSession({
  name: "session",
  keys: [process.env.SESSION_SECRET ?? ''],
  maxAge: 72 * 60 * 60 * 1000,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax'
}))
.use(passport.initialize())
.use(passport.session())
.use('/api', sanitizeMongo)
.use('/api', apiLimiter)
.use('/api/listings', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  return writeLimiter(req, res, next);
})
.use('/api/fellowships', (req, res, next) => {
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
