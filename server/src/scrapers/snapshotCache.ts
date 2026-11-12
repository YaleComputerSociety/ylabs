/**
 * Persistent fetch cache backed by the ScrapeSnapshot collection.
 *
 * Used by scrapers when --use-cache is passed. Idempotent reruns won't re-hit external APIs
 * during dev. Production runs (--release) bypass the cache by default.
 */
import { DevWriteRefusedError } from '../db/devWriteGuard';
import { ScrapeSnapshot } from '../models/scrapeSnapshot';
import { escapeRegex } from '../utils/regex';
import {
  benchmarkCacheRead,
  benchmarkCacheWrite,
  isLiveModelReplayActive,
} from './snapshotBenchmarkMode';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_REQUEST_KEY_PREFIX_LENGTH = 512;

export async function getCached<T = unknown>(
  sourceName: string,
  requestKey: string,
): Promise<T | null> {
  const benchmark = benchmarkCacheRead(sourceName, requestKey);
  if (benchmark.handled) return benchmark.payload as T | null;
  const row = await ScrapeSnapshot.findOne({ sourceName, requestKey }).lean();
  if (!row) return null;
  // An expired row is a miss and is left for the expiresAt TTL index to remove, because an
  // unleased lane run may only insert into this collection (#5871).
  if ((row as any).expiresAt && new Date((row as any).expiresAt).getTime() < Date.now()) {
    return null;
  }
  return (row as any).payload as T;
}

/**
 * A lane's own cache of a model's answer. A live-model replay reads past it, because serving
 * the frozen answer would measure the capture's model run rather than a new one.
 */
export async function getCachedModelAnswer<T = unknown>(
  sourceName: string,
  requestKey: string,
): Promise<T | null> {
  if (isLiveModelReplayActive()) return null;
  return getCached<T>(sourceName, requestKey);
}

export async function setCached<T = unknown>(
  sourceName: string,
  requestKey: string,
  payload: T,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<void> {
  if (benchmarkCacheWrite(sourceName, requestKey, payload)) return;
  const entry = {
    sourceName,
    requestKey,
    payload,
    fetchedAt: new Date(),
    expiresAt: new Date(Date.now() + ttlMs),
  };
  if (!(await ScrapeSnapshot.exists({ sourceName, requestKey }))) {
    try {
      await ScrapeSnapshot.create(entry);
      return;
    } catch (error) {
      if ((error as { code?: number })?.code !== DUPLICATE_KEY) throw error;
    }
  }
  try {
    await ScrapeSnapshot.updateOne({ sourceName, requestKey }, { $set: entry });
  } catch (error) {
    if (!(error instanceof DevWriteRefusedError)) throw error;
    warnRefreshRefusedOnce(sourceName);
  }
}

const DUPLICATE_KEY = 11000;
let refreshRefusedWarned = false;

function warnRefreshRefusedOnce(sourceName: string) {
  if (refreshRefusedWarned) return;
  refreshRefusedWarned = true;
  console.warn(
    `[snapshot-cache] ${sourceName}: an existing cache entry was kept, because a run without the Development apply lease may only insert fetch cache rows (#5871).`,
  );
}

export async function invalidateCache(
  sourceName: string,
  requestKeyPrefix?: string,
): Promise<number> {
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
