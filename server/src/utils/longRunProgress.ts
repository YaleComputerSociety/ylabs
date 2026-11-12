export const LONG_RUN_PROGRESS_EVERY_KEYS = 250;
export const LONG_RUN_PROGRESS_EVERY_MS = 60_000;
const HEARTBEAT_CHECK_MS = 1_000;

export interface LongRunProgressOptions {
  everyKeys?: number;
  everyMs?: number;
  now?: () => number;
  log?: (line: string) => void;
  setInterval?: (callback: () => void, ms: number) => { unref?: () => unknown };
  clearInterval?: (timer: unknown) => void;
}

export interface LongRunProgress {
  tick(errored: boolean): void;
  stop(): void;
}

export function startLongRunProgress(
  label: string,
  totalKeys: number,
  {
    everyKeys = LONG_RUN_PROGRESS_EVERY_KEYS,
    everyMs = LONG_RUN_PROGRESS_EVERY_MS,
    now = Date.now,
    log = (line) => console.info(line),
    setInterval: arm = (callback, ms) => setInterval(callback, ms),
    clearInterval: disarm = (timer) => clearInterval(timer as NodeJS.Timeout),
  }: LongRunProgressOptions = {},
): LongRunProgress {
  const startedAt = now();
  let lastLoggedAt = startedAt;
  let lastKeyAt = startedAt;
  let done = 0;
  let errors = 0;
  const seconds = (ms: number) => Math.round(ms / 1000);
  log(`[${label}] starting: ${totalKeys} keys`);
  const heartbeat = arm(
    () => {
      const at = now();
      if (done >= totalKeys || at - lastLoggedAt < everyMs) return;
      lastLoggedAt = at;
      log(
        `[${label}] still working: ${done}/${totalKeys} keys, ${seconds(at - lastKeyAt)} s since the last key, ${seconds(at - startedAt)} s elapsed`,
      );
    },
    Math.min(everyMs, HEARTBEAT_CHECK_MS),
  );
  heartbeat.unref?.();
  return {
    tick(errored) {
      done += 1;
      if (errored) errors += 1;
      const at = now();
      lastKeyAt = at;
      const finished = done === totalKeys;
      if (!finished && done % everyKeys !== 0 && at - lastLoggedAt < everyMs) return;
      lastLoggedAt = at;
      log(
        `[${label}] ${done}/${totalKeys} keys, ${errors} error(s), ${seconds(at - startedAt)} s elapsed`,
      );
    },
    stop() {
      disarm(heartbeat);
    },
  };
}
