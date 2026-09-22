import { randomUUID } from 'crypto';
import { hostname } from 'os';

import { ScrapeJobLock } from '../models/scrapeJobLock';
import { sanitizeLogValue } from '../utils/logSanitizer';
import type { ScraperEnvironment } from './scraperEnvironment';

export const DEFAULT_SCRAPE_JOB_LOCK_LEASE_MS = 30 * 60 * 1000;
export const DEFAULT_SCRAPE_JOB_LOCK_HEARTBEAT_MS = 60 * 1000;

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

export interface HeldScrapeJobLock {
  ownerId?: string;
  acquiredAt?: Date;
  leaseExpiresAt?: Date;
}

// Reports a live holder without competing for the lock, so a read-only command
// can say that the corpus is moving under it. An expired lease is not a holder:
// `acquireScrapeJobLock` would take it, so reporting it would be a false alarm.
export async function findHeldScrapeJobLock(input: {
  environment: ScraperEnvironment;
  sourceName: string;
  now?: Date;
}): Promise<HeldScrapeJobLock | null> {
  const now = input.now || new Date();
  const held = await ScrapeJobLock.findOne({
    environment: input.environment,
    sourceName: input.sourceName,
    locked: true,
    leaseExpiresAt: { $gt: now },
  })
    .select('ownerId acquiredAt leaseExpiresAt')
    .lean();

  if (!held) return null;
  const record = held as unknown as HeldScrapeJobLock;
  return {
    ownerId: record.ownerId,
    acquiredAt: record.acquiredAt,
    leaseExpiresAt: record.leaseExpiresAt,
  };
}

export interface ScrapeJobLockHeartbeatDependencies {
  heartbeatScrapeJobLock: typeof heartbeatScrapeJobLock;
}

export interface ScrapeJobLockHeartbeatInput extends ScrapeJobLockInput {
  heartbeatIntervalMs?: number;
  label?: string;
  onLockLost?: () => void;
}

// A lease that is never renewed expires mid-run, which lets a second writer
// steal the lock while the first is still writing. The renewal interval has to
// stay well under DEFAULT_SCRAPE_JOB_LOCK_LEASE_MS for that reason.
export function startScrapeJobLockHeartbeat(
  input: ScrapeJobLockHeartbeatInput,
  deps: ScrapeJobLockHeartbeatDependencies,
): { stop: () => void } {
  const intervalMs = input.heartbeatIntervalMs ?? DEFAULT_SCRAPE_JOB_LOCK_HEARTBEAT_MS;
  if (intervalMs <= 0) return { stop: () => undefined };

  const timer = setInterval(() => {
    deps
      .heartbeatScrapeJobLock({
        environment: input.environment,
        sourceName: input.sourceName,
        ownerId: input.ownerId,
        leaseMs: input.leaseMs,
      })
      // A renewal that matches no row means the row no longer belongs to this
      // owner, so a second writer can already be writing the same source. Staying
      // silent about that would leave the "one writer per source" guarantee
      // unenforced for the rest of the run.
      .then(({ heartbeated }) => {
        if (heartbeated) return;
        console.error(
          `Lost the ${input.label ?? 'scrape'} job lock for ${input.sourceName}: the lease is no longer held by this process, so another writer may be writing the same source.`,
        );
        input.onLockLost?.();
      })
      .catch((error) => {
        console.error(
          `Failed to heartbeat ${input.label ?? 'scrape'} job lock for ${input.sourceName}:`,
          sanitizeLogValue(error),
        );
      });
  }, intervalMs);
  timer.unref?.();

  return { stop: () => clearInterval(timer) };
}

export function createScrapeJobLockOwnerId(label: string): string {
  return `${label}:${hostname()}:${process.pid}:${randomUUID()}`;
}

export interface WithScrapeJobLockDependencies extends ScrapeJobLockHeartbeatDependencies {
  acquireScrapeJobLock: typeof acquireScrapeJobLock;
  releaseScrapeJobLock: typeof releaseScrapeJobLock;
  startScrapeJobLockHeartbeat: typeof startScrapeJobLockHeartbeat;
}

export type WithScrapeJobLockResult<T> =
  | { acquired: true; ownerId: string; value: T; lockLost: boolean }
  | { acquired: false; ownerId: string; reason: 'lock-held' };

export interface ScrapeJobLockReleaseMetadata {
  releaseReason?: ScrapeJobLockReleaseReason;
  lastRunId?: string;
}

export interface WithScrapeJobLockInput<T> extends ScrapeJobLockHeartbeatInput {
  describeRelease?: (value: T) => ScrapeJobLockReleaseMetadata;
}

const SCRAPE_JOB_LOCK_INTERRUPT_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

export function createWithScrapeJobLockDependencies(): WithScrapeJobLockDependencies {
  return {
    acquireScrapeJobLock,
    heartbeatScrapeJobLock,
    releaseScrapeJobLock,
    startScrapeJobLockHeartbeat,
  };
}

// Serializes writers for one `environment:sourceName` pair. The lock is keyed
// per source, so two writers on different sources still run in parallel; only a
// second writer against the SAME source is refused.
//
// A held lock is reported rather than thrown, because refusing to start is a
// normal outcome the caller has to describe to an operator, not a fault.
export async function withScrapeJobLock<T>(
  input: WithScrapeJobLockInput<T>,
  run: () => Promise<T>,
  deps: WithScrapeJobLockDependencies = createWithScrapeJobLockDependencies(),
): Promise<WithScrapeJobLockResult<T>> {
  const lock = await deps.acquireScrapeJobLock({
    environment: input.environment,
    sourceName: input.sourceName,
    ownerId: input.ownerId,
    now: input.now,
    leaseMs: input.leaseMs,
  });

  if (!lock.acquired) {
    return { acquired: false, ownerId: input.ownerId, reason: 'lock-held' };
  }

  let lockLost = false;
  let released = false;
  // A failing release must not rewrite the job's outcome: swallowing it keeps a
  // completed write reported as completed, and keeps the original error visible
  // instead of replacing it with a Mongo error from the cleanup.
  const releaseOnce = async (metadata: ScrapeJobLockReleaseMetadata): Promise<void> => {
    if (released) return;
    released = true;
    try {
      await deps.releaseScrapeJobLock({
        environment: input.environment,
        sourceName: input.sourceName,
        ownerId: input.ownerId,
        leaseMs: input.leaseMs,
        releaseReason: metadata.releaseReason ?? 'success',
        lastRunId: metadata.lastRunId,
      });
    } catch (releaseError) {
      console.error(
        `Failed to release the ${input.label ?? 'scrape'} job lock for ${input.sourceName}; it stays held until its lease expires:`,
        sanitizeLogValue(releaseError),
      );
    }
  };

  const heartbeat = deps.startScrapeJobLockHeartbeat(
    {
      ...input,
      onLockLost: () => {
        lockLost = true;
        input.onLockLost?.();
      },
    },
    deps,
  );

  // Without this, Ctrl-C or a `kill` leaves the row locked for the rest of the
  // lease and the operator's immediate retry is refused for up to 30 minutes.
  // The signal is re-raised after the release so the exit status still reads as
  // a signal death rather than a normal exit.
  function attachInterruptRelease(): () => void {
    const attached: { signal: NodeJS.Signals; handler: () => void }[] = [];
    const detach = (): void => {
      while (attached.length) {
        const entry = attached.pop();
        if (entry) process.removeListener(entry.signal, entry.handler);
      }
    };
    for (const signal of SCRAPE_JOB_LOCK_INTERRUPT_SIGNALS) {
      const handler = (): void => {
        console.error(
          `Interrupted by ${signal} while holding the ${input.label ?? 'scrape'} job lock for ${input.sourceName}; releasing it so the next writer is not blocked for the rest of the lease.`,
        );
        void releaseOnce({ releaseReason: 'manual' }).finally(() => {
          heartbeat.stop();
          detach();
          process.kill(process.pid, signal);
        });
      };
      attached.push({ signal, handler });
      process.once(signal, handler);
    }
    return detach;
  }

  const detachInterruptRelease = attachInterruptRelease();
  try {
    const value = await run();
    await releaseOnce(input.describeRelease?.(value) ?? { releaseReason: 'success' });
    return { acquired: true, ownerId: input.ownerId, value, lockLost };
  } catch (error) {
    await releaseOnce({ releaseReason: 'failure' });
    throw error;
  } finally {
    detachInterruptRelease();
    heartbeat.stop();
  }
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
