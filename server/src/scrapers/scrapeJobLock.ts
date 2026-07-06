import { ScrapeJobLock } from '../models/scrapeJobLock';
import type { ScraperEnvironment } from './scraperEnvironment';

export const DEFAULT_SCRAPE_JOB_LOCK_LEASE_MS = 30 * 60 * 1000;

export type ScrapeJobLockReleaseReason = 'success' | 'failure' | 'manual';

export interface ScrapeJobLockInput {
  environment: ScraperEnvironment;
  sourceName: string;
  ownerId: string;
  now?: Date;
  leaseMs?: number;
}

export type AcquireScrapeJobLockResult =
  | {
      acquired: true;
      ownerId: string;
      lock: unknown;
    }
  | {
      acquired: false;
      ownerId: string;
      reason: 'lock-held';
    };

export async function acquireScrapeJobLock(
  input: ScrapeJobLockInput,
): Promise<AcquireScrapeJobLockResult> {
  const now = input.now || new Date();
  const leaseExpiresAt = leaseExpiry(now, input.leaseMs);
  const filter = {
    environment: input.environment,
    sourceName: input.sourceName,
    $or: [
      { locked: { $ne: true } },
      { leaseExpiresAt: { $lte: now } },
      { leaseExpiresAt: { $exists: false } },
    ],
  };
  const update = {
    $set: {
      locked: true,
      ownerId: input.ownerId,
      acquiredAt: now,
      heartbeatAt: now,
      leaseExpiresAt,
    },
    $unset: {
      releasedAt: '',
      releaseReason: '',
    },
  };

  const existing = await ScrapeJobLock.findOneAndUpdate(filter, update, { new: true });
  if (existing) {
    return {
      acquired: true,
      ownerId: input.ownerId,
      lock: existing,
    };
  }

  try {
    const created = await ScrapeJobLock.create({
      _id: scrapeJobLockId(input.environment, input.sourceName),
      environment: input.environment,
      sourceName: input.sourceName,
      locked: true,
      ownerId: input.ownerId,
      acquiredAt: now,
      heartbeatAt: now,
      leaseExpiresAt,
    });
    return {
      acquired: true,
      ownerId: input.ownerId,
      lock: created,
    };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return {
        acquired: false,
        ownerId: input.ownerId,
        reason: 'lock-held',
      };
    }
    throw error;
  }
}

export async function heartbeatScrapeJobLock(
  input: ScrapeJobLockInput,
): Promise<{ heartbeated: boolean }> {
  const now = input.now || new Date();
  const result = await ScrapeJobLock.updateOne(
    {
      environment: input.environment,
      sourceName: input.sourceName,
      ownerId: input.ownerId,
      locked: true,
    },
    {
      $set: {
        heartbeatAt: now,
        leaseExpiresAt: leaseExpiry(now, input.leaseMs),
      },
    },
  );

  return { heartbeated: (result.modifiedCount || 0) > 0 };
}

export async function releaseScrapeJobLock(
  input: ScrapeJobLockInput & {
    releaseReason: ScrapeJobLockReleaseReason;
    lastRunId?: string;
  },
): Promise<{ released: boolean }> {
  const now = input.now || new Date();
  const set: Record<string, unknown> = {
    locked: false,
    releasedAt: now,
    releaseReason: input.releaseReason,
  };
  if (input.lastRunId) set.lastRunId = input.lastRunId;

  const result = await ScrapeJobLock.updateOne(
    {
      environment: input.environment,
      sourceName: input.sourceName,
      ownerId: input.ownerId,
      locked: true,
    },
    {
      $set: set,
      $unset: {
        ownerId: '',
        leaseExpiresAt: '',
      },
    },
  );

  return { released: (result.modifiedCount || 0) > 0 };
}

function leaseExpiry(now: Date, leaseMs = DEFAULT_SCRAPE_JOB_LOCK_LEASE_MS): Date {
  return new Date(now.getTime() + leaseMs);
}

function scrapeJobLockId(environment: string, sourceName: string): string {
  return `${environment}:${sourceName}`;
}

function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000,
  );
}
