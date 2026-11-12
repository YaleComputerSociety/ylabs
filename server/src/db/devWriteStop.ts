import { AsyncLocalStorage } from 'async_hooks';

/**
 * The stopped state a Development write lease holder enters the moment it stops itself (#6020),
 * and the one bounded path that may still write while it is in it.
 *
 * Stopped mode refuses every further Mongoose model write (through `db/devWriteGuard`) and every
 * scraper fetch (through `scrapers/utils/scraperFetchDeadlines`). The only writes it admits are the
 * cleanups registered here, run by `runDevWriteStopCleanups` inside a scope that only that runner
 * enters, and only against `DEV_WRITE_STOP_CLEANUP_COLLECTIONS`.
 */
export type DevWriteStopReason = 'lost' | 'renewal-failed' | 'no-progress';

/** Changing what a stop cleanup writes also requires updating this set and the guard test. */
export const DEV_WRITE_STOP_CLEANUP_COLLECTIONS: ReadonlySet<string> = new Set([
  'scrape_runs',
  'scrape_job_locks',
]);

export const DEV_WRITE_STOP_CLEANUP_WINDOW_MS = 3 * 60_000;
export const DEV_WRITE_STOP_CLEANUP_ATTEMPT_TIMEOUT_MS = 10_000;
export const DEV_WRITE_STOP_CLEANUP_FIRST_BACKOFF_MS = 1_000;
export const DEV_WRITE_STOP_CLEANUP_MAX_BACKOFF_MS = 15_000;

export interface DevWriteStopCleanup {
  description: string;
  run: (reason: DevWriteStopReason) => Promise<string>;
}

export interface DevWriteStopCleanupOutcome {
  description: string;
  cleaned: boolean;
  detail: string;
  attempts: number;
}

export interface DevWriteStopCleanupClock {
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  windowMs?: number;
  attemptTimeoutMs?: number;
}

// Kept on globalThis because a suite that resets its module registry evaluates this module again
// while an adapter or guard from the first evaluation is still installed.
const STOPPED = Symbol.for('ylabs.devWriteStop.reason');
type StoppedHolder = { [STOPPED]?: DevWriteStopReason };
const stoppedHolder = globalThis as StoppedHolder;

const registeredCleanups = new Set<DevWriteStopCleanup>();
let cleanupsAtStop: DevWriteStopCleanup[] | undefined;
const cleanupScope = new AsyncLocalStorage<true>();

export class DevWriteStoppedError extends Error {
  constructor(action: string) {
    super(
      `Refused ${action}: this process stopped itself (${devWriteStopReason() ?? 'stopped'}) because its Development write lease is no longer confirmed, so nothing more is written or fetched before it exits.`,
    );
    this.name = 'DevWriteStoppedError';
  }
}

export function registerDevWriteStopCleanup(cleanup: DevWriteStopCleanup): () => void {
  registeredCleanups.add(cleanup);
  return () => {
    registeredCleanups.delete(cleanup);
  };
}

/**
 * Synchronous, so nothing can be written or fetched between the stop decision and the refusal.
 * The cleanups registered at this instant are the ones that run: a caller that unwinds after the
 * stop and detaches its cleanup does not take it out of the stop.
 */
export function enterDevWriteStoppedMode(reason: DevWriteStopReason): void {
  if (stoppedHolder[STOPPED]) return;
  stoppedHolder[STOPPED] = reason;
  cleanupsAtStop = [...registeredCleanups];
}

export const devWriteStopReason = (): DevWriteStopReason | undefined => stoppedHolder[STOPPED];

export const devWriteStopped = (): boolean => stoppedHolder[STOPPED] !== undefined;

export function devWriteStopCleanupMayWrite(collectionName: string): boolean {
  return (
    devWriteStopped() &&
    cleanupScope.getStore() === true &&
    DEV_WRITE_STOP_CLEANUP_COLLECTIONS.has(collectionName)
  );
}

class DevWriteStopCleanupTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`timed out after ${timeoutMs} ms`);
    this.name = 'DevWriteStopCleanupTimeoutError';
  }
}

async function withinTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DevWriteStopCleanupTimeoutError(timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const errorMessage = (error: unknown) => (error as Error)?.message ?? String(error);

/**
 * Runs each cleanup registered at the stop, retrying the ones that fail with backoff, and returns
 * once all succeeded or `windowMs` has passed, whichever is first. Every attempt is bounded by the
 * time left in the window, so a database that never answers cannot hold the exit past it. It runs
 * once per stop.
 */
export async function runDevWriteStopCleanups(
  clock: DevWriteStopCleanupClock,
): Promise<DevWriteStopCleanupOutcome[]> {
  const reason = devWriteStopReason();
  const cleanups = cleanupsAtStop ?? [];
  cleanupsAtStop = [];
  if (!reason || cleanups.length === 0) return [];
  const windowMs = clock.windowMs ?? DEV_WRITE_STOP_CLEANUP_WINDOW_MS;
  const attemptTimeoutMs = clock.attemptTimeoutMs ?? DEV_WRITE_STOP_CLEANUP_ATTEMPT_TIMEOUT_MS;
  const startedAt = clock.now().getTime();
  const remainingMs = () => windowMs - (clock.now().getTime() - startedAt);
  const outcomes = new Map<DevWriteStopCleanup, DevWriteStopCleanupOutcome>(
    cleanups.map((cleanup) => [
      cleanup,
      { description: cleanup.description, cleaned: false, detail: 'not attempted', attempts: 0 },
    ]),
  );
  let backoffMs = DEV_WRITE_STOP_CLEANUP_FIRST_BACKOFF_MS;
  for (;;) {
    const budgetMs = Math.min(attemptTimeoutMs, remainingMs());
    if (budgetMs <= 0) break;
    const pending = cleanups.filter((cleanup) => !outcomes.get(cleanup)!.cleaned);
    await Promise.all(
      pending.map(async (cleanup) => {
        const outcome = outcomes.get(cleanup)!;
        outcome.attempts += 1;
        try {
          outcome.detail = await cleanupScope.run(true, () =>
            withinTimeout(cleanup.run(reason), budgetMs),
          );
          outcome.cleaned = true;
        } catch (error) {
          outcome.detail = `last error: ${errorMessage(error)}`;
        }
      }),
    );
    if ([...outcomes.values()].every(({ cleaned }) => cleaned)) break;
    const sleepMs = Math.min(backoffMs, remainingMs());
    if (sleepMs <= 0) break;
    await clock.sleep(sleepMs);
    backoffMs = Math.min(backoffMs * 2, DEV_WRITE_STOP_CLEANUP_MAX_BACKOFF_MS);
  }
  return [...outcomes.values()];
}

export function resetDevWriteStopForTests(): void {
  delete stoppedHolder[STOPPED];
  registeredCleanups.clear();
  cleanupsAtStop = undefined;
}
