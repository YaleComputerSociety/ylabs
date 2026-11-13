import { hostPauseInErrorChain } from './hostPause';
import { hostPausedUntil } from './hostPauseState';

/**
 * The run-level rule for tier-2 host pauses (#6168): a host never gives up for good, but a run never
 * sits idle. Rows on a paused host go to the back of the queue; once only paused rows remain the run
 * waits for the earliest pause if it ends soon, and otherwise defers those rows untouched (no write,
 * no retraction) for the next run, which picks them up after the pause.
 */
export const HOST_PAUSE_END_OF_RUN_WAIT_MS = 300_000;

export interface HostPauseDeferral {
  host: string;
  pausedUntil: Date;
  count: number;
}

export interface HostPausePartition<T> {
  ready: T[];
  paused: T[];
  deferred: HostPauseDeferral[];
}

export interface HostPauseReader {
  now?: () => number;
  pausedUntil?: (host: string) => Date | undefined;
}

function summarise<T>(
  rows: Array<{ item: T; host: string; pausedUntil: Date }>,
): HostPauseDeferral[] {
  const byHost = new Map<string, HostPauseDeferral>();
  for (const { host, pausedUntil } of rows) {
    const known = byHost.get(host);
    if (!known) byHost.set(host, { host, pausedUntil, count: 1 });
    else {
      known.count += 1;
      if (pausedUntil > known.pausedUntil) known.pausedUntil = pausedUntil;
    }
  }
  return [...byHost.values()].sort((a, b) => a.host.localeCompare(b.host));
}

export function partitionByHostPause<T>(
  items: readonly T[],
  hostOf: (item: T) => string | undefined,
  reader: HostPauseReader = {},
): HostPausePartition<T> {
  const now = (reader.now ?? Date.now)();
  const pausedUntil = reader.pausedUntil ?? hostPausedUntil;
  const ready: T[] = [];
  const paused: Array<{ item: T; host: string; pausedUntil: Date }> = [];
  for (const item of items) {
    const host = hostOf(item);
    const until = host ? pausedUntil(host) : undefined;
    if (host && until && until.getTime() > now) paused.push({ item, host, pausedUntil: until });
    else ready.push(item);
  }
  return { ready, paused: paused.map((row) => row.item), deferred: summarise(paused) };
}

export function describeHostPauseDeferrals(deferred: readonly HostPauseDeferral[]): string {
  return deferred
    .map(
      ({ host, count, pausedUntil }) =>
        `${host}: ${count} row${count === 1 ? '' : 's'} deferred, resumes at ${pausedUntil.toISOString()}`,
    )
    .join('; ');
}

export interface RunDeferringPausedHostsOptions extends HostPauseReader {
  concurrency?: number;
  endOfRunWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

export interface RunDeferringPausedHostsResult {
  processed: number;
  deferred: HostPauseDeferral[];
}

const realSleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

/**
 * Runs `work` over every row whose host is not paused, re-queueing paused rows (and rows whose fetch
 * met a pause recorded mid-run) behind the rest. Deferred rows are never handed to `work`.
 */
export async function runDeferringPausedHosts<T>(
  items: readonly T[],
  hostOf: (item: T) => string | undefined,
  work: (item: T) => Promise<void>,
  options: RunDeferringPausedHostsOptions = {},
): Promise<RunDeferringPausedHostsResult> {
  const now = options.now ?? Date.now;
  const storedPause = options.pausedUntil ?? hostPausedUntil;
  const metPause = new Map<string, Date>();
  const reader: HostPauseReader = {
    now,
    pausedUntil: (host) => {
      const stored = storedPause(host);
      const met = metPause.get(host);
      return !met || (stored && stored > met) ? stored : met;
    },
  };
  const sleep = options.sleep ?? realSleep;
  const endOfRunWaitMs = options.endOfRunWaitMs ?? HOST_PAUSE_END_OF_RUN_WAIT_MS;
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));
  let pending = [...items];
  let processed = 0;
  for (;;) {
    const requeued: T[] = [];
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < pending.length) {
        const item = pending[cursor++];
        if (partitionByHostPause([item], hostOf, reader).paused.length > 0) {
          requeued.push(item);
          continue;
        }
        try {
          await work(item);
          processed += 1;
        } catch (error) {
          const until = hostPauseInErrorChain(error)?.pause.until;
          if (!until) throw error;
          const host = hostOf(item);
          // A pause the store does not hold for this row's host (a redirect hop's) must still
          // defer the row, or the loop would hand it straight back to work.
          if (host && until > (metPause.get(host) ?? new Date(0))) metPause.set(host, until);
          requeued.push(item);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
    if (requeued.length === 0) return { processed, deferred: [] };
    const { ready, deferred } = partitionByHostPause(requeued, hostOf, reader);
    if (ready.length > 0) {
      pending = requeued;
      continue;
    }
    const earliest = Math.min(...deferred.map((entry) => entry.pausedUntil.getTime()));
    const waitMs = earliest - now();
    if (waitMs <= endOfRunWaitMs) {
      await sleep(waitMs);
      pending = requeued;
      continue;
    }
    options.log?.(`host pause: ${describeHostPauseDeferrals(deferred)}`);
    return { processed, deferred };
  }
}
