import { hostname } from 'os';

import { ScrapeRun } from '../models/scrapeRun';
import { sanitizeLogValue } from '../utils/logSanitizer';

export const SCRAPE_RUN_HEARTBEAT_INTERVAL_MS = 60 * 1000;

// Fifteen missed beats. A lane can hold the event loop for minutes on one huge
// page, so a tighter bound would call a slow live run dead.
export const SCRAPE_RUN_STALE_HEARTBEAT_MS = 15 * 60 * 1000;

// A run that predates heartbeats carries no sign of life except its start, so
// only an age far past any real run lets it be called abandoned.
export const SCRAPE_RUN_LEGACY_ABANDONED_AFTER_MS = 72 * 60 * 60 * 1000;

export type ScrapeRunLiveness = 'finished' | 'live' | 'stale' | 'unverifiable';

export interface ScrapeRunLivenessFacts {
  status?: unknown;
  startedAt?: Date | string;
  heartbeatAt?: Date | string;
}

function timeOf(value: Date | string | undefined): number | undefined {
  if (value === undefined || value === null) return undefined;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : undefined;
}

export function classifyScrapeRunLiveness(
  run: ScrapeRunLivenessFacts,
  now: Date = new Date(),
  staleHeartbeatMs: number = SCRAPE_RUN_STALE_HEARTBEAT_MS,
): ScrapeRunLiveness {
  if (run.status !== 'running') return 'finished';
  const heartbeat = timeOf(run.heartbeatAt);
  if (heartbeat === undefined) return 'unverifiable';
  return now.getTime() - heartbeat <= staleHeartbeatMs ? 'live' : 'stale';
}

export function isAbandonedScrapeRun(run: ScrapeRunLivenessFacts, now: Date = new Date()): boolean {
  const liveness = classifyScrapeRunLiveness(run, now);
  if (liveness === 'stale') return true;
  if (liveness !== 'unverifiable') return false;
  const started = timeOf(run.startedAt);
  return started !== undefined && now.getTime() - started > SCRAPE_RUN_LEGACY_ABANDONED_AFTER_MS;
}

export interface ScrapeRunOwner {
  host: string;
  pid: number;
  lockOwnerId?: string;
}

export function currentScrapeRunOwner(lockOwnerId?: string): ScrapeRunOwner {
  return { host: hostname(), pid: process.pid, ...(lockOwnerId ? { lockOwnerId } : {}) };
}

export function isLocalProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

export interface ScrapeRunHeartbeatDependencies {
  beat: (runId: unknown, at: Date) => Promise<{ matched: boolean }>;
}

export async function writeScrapeRunHeartbeat(
  runId: unknown,
  at: Date,
): Promise<{ matched: boolean }> {
  const result = await ScrapeRun.updateOne(
    { _id: runId, status: 'running' },
    { $set: { heartbeatAt: at } },
  );
  return { matched: (result.matchedCount ?? 0) > 0 };
}

export function startScrapeRunHeartbeat(
  input: { runId: unknown; sourceName: string; intervalMs?: number },
  deps: ScrapeRunHeartbeatDependencies = { beat: writeScrapeRunHeartbeat },
): { stop: () => void } {
  const intervalMs = input.intervalMs ?? SCRAPE_RUN_HEARTBEAT_INTERVAL_MS;
  if (intervalMs <= 0) return { stop: () => undefined };

  let stopped = false;
  let reportedClosed = false;
  const timer = setInterval(() => {
    deps
      .beat(input.runId, new Date())
      .then(({ matched }) => {
        if (matched || stopped || reportedClosed) return;
        reportedClosed = true;
        console.error(
          `The ScrapeRun for ${input.sourceName} is no longer running in the database, so something else closed it while this process is still working.`,
        );
      })
      .catch((error) => {
        console.error(
          `Failed to heartbeat the ScrapeRun for ${input.sourceName}:`,
          sanitizeLogValue(error),
        );
      });
  }, intervalMs);
  timer.unref?.();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
