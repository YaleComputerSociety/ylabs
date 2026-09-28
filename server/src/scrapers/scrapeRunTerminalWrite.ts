import { sanitizeLogValue } from '../utils/logSanitizer';
import { INTERRUPT_CLEANUP_TIMEOUT_MS } from './interruptCleanup';

export const SCRAPE_RUN_TERMINAL_WRITE_BACKOFF_MS: readonly number[] = [500, 1_500];

// Leaves headroom inside the shared interrupt budget for the other cleanups and the
// re-raise, because the sweep sends SIGKILL 10 seconds after its SIGTERM.
export const SCRAPE_RUN_INTERRUPT_WRITE_DEADLINE_MS = INTERRUPT_CLEANUP_TIMEOUT_MS - 1_000;

export class ScrapeRunTerminalWriteError extends Error {
  constructor(
    readonly status: string,
    readonly attempts: number,
    readonly lastError: unknown,
  ) {
    super(
      `Failed to record the ScrapeRun ${status} status after ${attempts} attempt(s): ${sanitizeLogValue(
        lastError instanceof Error ? lastError.message : lastError,
      )}`,
    );
    this.name = 'ScrapeRunTerminalWriteError';
  }
}

export interface ScrapeRunTerminalWriteOptions {
  status: string;
  sourceName: string;
  backoffMs?: readonly number[];
  deadlineMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

class AttemptDeadlineExceeded extends Error {
  constructor(deadlineMs: number) {
    super(`the write did not settle within the ${deadlineMs}ms interrupt deadline`);
  }
}

function raceDeadline<T>(attempt: Promise<T>, remainingMs: number, deadlineMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AttemptDeadlineExceeded(deadlineMs)), remainingMs);
  });
  return Promise.race([attempt, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function writeScrapeRunTerminalStatus<T>(
  write: () => Promise<T>,
  options: ScrapeRunTerminalWriteOptions,
): Promise<T> {
  const backoffMs = options.backoffMs ?? SCRAPE_RUN_TERMINAL_WRITE_BACKOFF_MS;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const remaining = () =>
    options.deadlineMs === undefined ? Infinity : options.deadlineMs - (now() - startedAt);

  let attempts = 0;
  let lastError: unknown;
  for (;;) {
    attempts += 1;
    try {
      const attempt = Promise.resolve().then(write);
      return options.deadlineMs === undefined
        ? await attempt
        : await raceDeadline(attempt, Math.max(remaining(), 0), options.deadlineMs);
    } catch (error) {
      lastError = error;
    }
    const delay = backoffMs[attempts - 1];
    if (delay === undefined || lastError instanceof AttemptDeadlineExceeded) break;
    if (remaining() <= delay) break;
    console.warn(
      `Retrying the ScrapeRun ${options.status} write for ${options.sourceName} in ${delay}ms after attempt ${attempts} failed:`,
      sanitizeLogValue(lastError),
    );
    await sleep(delay);
  }

  const failure = new ScrapeRunTerminalWriteError(options.status, attempts, lastError);
  console.error(
    `${failure.message}. The ScrapeRun for ${options.sourceName} stays running with a stopped heartbeat until the sweep's stale-run stage or scrape-runs:reconcile-stale closes it.`,
  );
  throw failure;
}
