/**
 * Persistent fetch cache backed by the ScrapeSnapshot collection.
 *
 * Used by scrapers when --use-cache is passed. Idempotent reruns won't re-hit external APIs
 * during dev. Production runs (--release) bypass the cache by default.
 */
import { ScrapeSnapshot } from '../models/scrapeSnapshot';
import { escapeRegex } from '../utils/regex';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_REQUEST_KEY_PREFIX_LENGTH = 512;

export async function getCached<T = unknown>(
  sourceName: string,
  requestKey: string,
): Promise<T | null> {
  const row = await ScrapeSnapshot.findOne({ sourceName, requestKey }).lean();
  if (!row) return null;
  if ((row as any).expiresAt && new Date((row as any).expiresAt).getTime() < Date.now()) {
    await ScrapeSnapshot.deleteOne({ _id: (row as any)._id });
    return null;
  }
  return (row as any).payload as T;
}

export async function setCached<T = unknown>(
  sourceName: string,
  requestKey: string,
  payload: T,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlMs);
  await ScrapeSnapshot.updateOne(
    { sourceName, requestKey },
    { $set: { sourceName, requestKey, payload, fetchedAt: new Date(), expiresAt } },
    { upsert: true },
  );
}

export async function invalidateCache(sourceName: string, requestKeyPrefix?: string): Promise<number> {
  const filter: any = { sourceName };
  if (requestKeyPrefix) {
    if (requestKeyPrefix.length > MAX_REQUEST_KEY_PREFIX_LENGTH) {
      throw new Error('Cache request key prefix is too long');
    }
    filter.requestKey = { $regex: `^${escapeRegex(requestKeyPrefix)}` };
  }
  const res = await ScrapeSnapshot.deleteMany(filter);
  return res.deletedCount || 0;
}
