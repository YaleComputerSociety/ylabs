/**
 * Express application setup with middleware, routes, and CORS configuration.
 */
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import { ipKeyGenerator } from "express-rate-limit";
import { isCI, isDevelopment, isTest } from "./utils/environment";
import passport, { passportRoutes } from "./passport";
import routes from "./routes";
import cookieSession from "cookie-session";
import dotenv from "dotenv";
import * as path from 'path';

dotenv.config();

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

// Listing search limiter (OpenAI embedding cost path)
const listingSearchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  keyGenerator: getRateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many listing search requests, please try again later.' },
  skip: () => isCI() || isDevelopment() || isTest(),
});

// Fellowship search limiter (non-OpenAI path)
const fellowshipSearchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  keyGenerator: getRateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many fellowship search requests, please try again later.' },
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

const allowList = new Set(["http://localhost:3000", "https://yalelabs.onrender.com", "https://ylabs-dev.onrender.com", "https://yalelabs.io", "https://www.yalelabs.io"]);

const corsOptions = {
  origin: (origin: string, callback: any) => {
    if (origin === undefined || bypassCors || allowList.has(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
};

const app = express()
.set('trust proxy', 1)
.use(cors(corsOptions))
.use(express.json())
.use(express.urlencoded({ extended: true }))
.use(cookieSession({
  name: "session",
  keys: [process.env.SESSION_SECRET],
  maxAge: 365 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax'
}))
.use(passport.initialize())
.use(passport.session())
.use('/api', apiLimiter)
.use('/api/listings/search', listingSearchLimiter)
.use('/api/fellowships/search', fellowshipSearchLimiter)
.use('/api/listings', writeLimiter)
.use('/api/fellowships', writeLimiter)
.use('/api', passportRoutes)
.use('/api', routes);

app.use(express.static(path.join(__dirname, '../../client/dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
});

export default app;
