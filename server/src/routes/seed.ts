/**
 * Development-only seed routes for the faculty scraper.
 * These routes have NO user auth — callers must present a matching SEED_TOKEN header.
 * Still only mounted in a local development runtime, but the token is the hard gate.
 */
import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { createUser, validateUser, updateUser } from '../services/userService';
import { updateListing, readAllListings } from '../services/listingService';
import { validateNetid, validateObjectId } from '../middleware/validation';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { isLocalDevelopmentRuntime } from '../utils/environment';
import { serializedDocumentId } from '../utils/idSerialization';

const router = Router();
const MIN_SEED_TOKEN_LENGTH = 16;
const MAX_SEED_TOKEN_LENGTH = 256;
const SEED_NETID_RE = /^[A-Za-z0-9]{2,12}$/;
const SEED_USER_FIELDS = [
  'netid',
  'email',
  'fname',
  'lname',
  'title',
  'userType',
  'userConfirmed',
  'profileVerified',
  'bio',
  'primaryDepartment',
  'secondaryDepartments',
  'departments',
  'researchInterests',
  'topics',
  'website',
  'imageUrl',
  'profileUrls',
  'orcid',
  'openAlexId',
  'hIndex',
] as const;

const seedUserSummary = (user: any) => ({
  _id: serializedDocumentId(user?._id) || '',
  netid: user?.netid,
  userType: user?.userType,
  userConfirmed: user?.userConfirmed,
  profileVerified: user?.profileVerified,
});

const seedListingSummary = (listing: any) => ({
  _id: serializedDocumentId(listing?._id) || '',
  departments: Array.isArray(listing?.departments) ? listing.departments : [],
});

function setPrivateSeedCacheHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

function requireLocalSeedRuntime(_req: Request, res: Response, next: NextFunction) {
  if (!isLocalDevelopmentRuntime()) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
}

// Constant-time, length-independent comparison so the seed token can't be recovered via a
// timing side-channel (SHA-256 both sides to a fixed length, then timingSafeEqual).
const tokensMatch = (provided: string, expected: string): boolean => {
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
};

const requireSeedToken = (req: Request, res: Response, next: NextFunction) => {
  const expected = process.env.SEED_TOKEN;
  if (
    !expected ||
    expected.length < MIN_SEED_TOKEN_LENGTH ||
    expected.length > MAX_SEED_TOKEN_LENGTH
  ) {
    return res.status(503).json({ error: 'Seed routes disabled' });
  }
  const provided = req.get('x-seed-token');
  if (
    !provided ||
    provided.length < MIN_SEED_TOKEN_LENGTH ||
    provided.length > MAX_SEED_TOKEN_LENGTH ||
    !tokensMatch(provided, expected)
  ) {
    return res.status(401).json({ error: 'Invalid seed token' });
  }
  next();
};

const normalizeSeedNetid = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const netid = value.trim();
  return SEED_NETID_RE.test(netid) ? netid : undefined;
};

const seedUserPayload = (
  value: unknown,
  options: { includeNetid: boolean },
): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const payload: Record<string, unknown> = {};

  for (const field of SEED_USER_FIELDS) {
    if (field === 'netid' && !options.includeNetid) continue;
    if (source[field] !== undefined) {
      payload[field] = source[field];
    }
  }

  if (options.includeNetid) {
    const netid = normalizeSeedNetid(payload.netid);
    if (!netid) return undefined;
    payload.netid = netid;
  } else {
    delete payload.netid;
  }

  return payload;
};

router.use(setPrivateSeedCacheHeaders, requireLocalSeedRuntime, requireSeedToken);

router.post('/users', async (req: Request, res: Response) => {
  try {
    const safeData = seedUserPayload(req.body, { includeNetid: true });
    const netid = normalizeSeedNetid(safeData?.netid);
    if (!safeData || !netid) {
      return res.status(400).json({ error: 'netid is required' });
    }

    const existing = await validateUser(netid);
    if (existing) {
      const updated = await updateUser(netid, safeData);
      return res.json({ action: 'updated', user: seedUserSummary(updated) });
    }

    const user = await createUser(safeData);
    res.status(201).json({ action: 'created', user: seedUserSummary(user) });
  } catch (error: any) {
    console.error('Seed: Error creating/updating user:', sanitizeLogValue(error));
    res.status(400).json({ error: 'Request failed' });
  }
});

router.put('/users/:netid', validateNetid('netid'), async (req: Request, res: Response) => {
  try {
    const existing = await validateUser(req.params.netid);
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    const safeData = seedUserPayload(req.body, { includeNetid: false });
    if (!safeData) {
      return res.status(400).json({ error: 'Request body is required' });
    }
    const updated = await updateUser(req.params.netid, safeData);
    res.json({ action: 'updated', user: seedUserSummary(updated) });
  } catch (error: any) {
    console.error('Seed: Error updating user:', sanitizeLogValue(error));
    res.status(400).json({ error: 'Request failed' });
  }
});

router.get('/listings', async (req: Request, res: Response) => {
  try {
    const listings = await readAllListings();
    res.json({ results: listings.map(seedListingSummary) });
  } catch (error: any) {
    console.error('Seed: Error fetching listings:', sanitizeLogValue(error));
    res.status(500).json({ error: 'Request failed' });
  }
});

router.put('/listings/:id', validateObjectId('id'), async (req: Request, res: Response) => {
  try {
    const { departments } = req.body;
    const listing = await updateListing(req.params.id, '' as string, { departments }, true);
    res.json({ listing: seedListingSummary(listing) });
  } catch (error: any) {
    console.error('Seed: Error updating listing:', sanitizeLogValue(error));
    res.status(400).json({ error: 'Request failed' });
  }
});

export default router;
