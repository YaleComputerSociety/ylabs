import { sanitizeLogValue } from '../utils/logSanitizer';

export type InterruptCleanup = (signal: NodeJS.Signals) => Promise<unknown> | unknown;

export const INTERRUPT_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

// The sweep sends SIGKILL 10 seconds after its SIGTERM, so every cleanup has to
// settle well inside that grace or the process dies with its records still open.
export const INTERRUPT_CLEANUP_TIMEOUT_MS = 5_000;

const pendingCleanups = new Set<InterruptCleanup>();
let installedHandlers: { signal: NodeJS.Signals; handler: () => void }[] = [];

function uninstallHandlers(): void {
  for (const { signal, handler } of installedHandlers) process.removeListener(signal, handler);
  installedHandlers = [];
}

async function settleWithin(promises: Promise<unknown>[], timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([Promise.allSettled(promises).then(() => undefined), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runCleanupsThenReraise(signal: NodeJS.Signals): Promise<void> {
  const cleanups = [...pendingCleanups];
  pendingCleanups.clear();
  await settleWithin(
    cleanups.map((cleanup) =>
      Promise.resolve()
        .then(() => cleanup(signal))
        .catch((error) => {
          console.error(`Cleanup after ${signal} failed:`, sanitizeLogValue(error));
        }),
    ),
    INTERRUPT_CLEANUP_TIMEOUT_MS,
  );
  uninstallHandlers();
  process.kill(process.pid, signal);
}

function installHandlers(): void {
  if (installedHandlers.length > 0) return;
  for (const signal of INTERRUPT_SIGNALS) {
    const handler = (): void => {
      void runCleanupsThenReraise(signal);
    };
    installedHandlers.push({ signal, handler });
    process.once(signal, handler);
  }
}

// One handler per signal runs every registered cleanup before the signal is
// re-raised. Separate handlers that each re-raise would race: the first to
// finish kills the process while the others are still writing.
export function onInterrupt(cleanup: InterruptCleanup): () => void {
  pendingCleanups.add(cleanup);
  installHandlers();
  return () => {
    pendingCleanups.delete(cleanup);
    if (pendingCleanups.size === 0) uninstallHandlers();
  };
}
