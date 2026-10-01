/**
 * Graceful shutdown for the serving process.
 *
 * The hosting platform stops an instance by sending SIGTERM and killing it 30 s
 * later, and Node's default action for SIGTERM is to exit at once, so every request
 * in flight during a deploy was cut with an empty reply (#4189). The drain window
 * below has to stay under that 30 s kill timeout, because a drain the platform
 * interrupts is the same failure wearing a different name.
 */
import type { Server } from 'node:http';

import mongoose from 'mongoose';

import { stopMongoKeepAlive } from './db/connections';
import { stopGateRefreshScheduler } from './scripts/gateRefreshScheduler';
import { stopCorpusQualitySnapshotScheduler } from './services/corpusQualitySnapshotScheduler';
import { sanitizeLogValue } from './utils/logSanitizer';

export const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
export const PLATFORM_KILL_TIMEOUT_MS = 30000;
export const DRAIN_TIMEOUT_MS = 20000;

export type ShutdownOutcome = 'drained' | 'drain_timed_out';

export interface ShutdownRequest {
  server: Server;
  signal: NodeJS.Signals;
  drainTimeoutMs?: number;
}

/**
 * Stops accepting connections and resolves once the in-flight requests have
 * finished, or once the drain window expires, whichever comes first. Idle
 * keep-alive sockets are closed immediately, because a browser holding one open
 * would otherwise keep the drain waiting for a request that is never coming.
 */
export async function drainHttpServer(
  server: Server,
  drainTimeoutMs = DRAIN_TIMEOUT_MS,
): Promise<ShutdownOutcome> {
  let drainTimer: NodeJS.Timeout | undefined;
  const finished = new Promise<ShutdownOutcome>((resolve) => {
    server.close(() => resolve('drained'));
  });
  const expired = new Promise<ShutdownOutcome>((resolve) => {
    drainTimer = setTimeout(() => resolve('drain_timed_out'), drainTimeoutMs);
  });

  server.closeIdleConnections();

  try {
    const outcome = await Promise.race([finished, expired]);
    if (outcome === 'drain_timed_out') server.closeAllConnections();
    return outcome;
  } finally {
    if (drainTimer) clearTimeout(drainTimer);
  }
}

export async function shutdownServer({
  server,
  signal,
  drainTimeoutMs = DRAIN_TIMEOUT_MS,
}: ShutdownRequest): Promise<ShutdownOutcome> {
  console.log(`[shutdown] ${signal}: refusing new connections, finishing requests in flight`);

  // Before the disconnect below, because the keep-alive pass reconnects a
  // connection it finds down (#4186) and would re-open this one.
  stopMongoKeepAlive();
  stopGateRefreshScheduler();
  stopCorpusQualitySnapshotScheduler();

  const outcome = await drainHttpServer(server, drainTimeoutMs);

  try {
    await mongoose.disconnect();
  } catch (error) {
    console.error('[shutdown] disconnecting from MongoDB failed:', sanitizeLogValue(error));
  }

  console.log(
    outcome === 'drained'
      ? '[shutdown] every request in flight finished'
      : `[shutdown] requests were still in flight after ${drainTimeoutMs} ms, so they were cut`,
  );
  return outcome;
}

export function registerGracefulShutdown(server: Server, drainTimeoutMs = DRAIN_TIMEOUT_MS): void {
  let shutdown: Promise<ShutdownOutcome> | undefined;
  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      if (shutdown) return;
      shutdown = shutdownServer({ server, signal, drainTimeoutMs });
      void shutdown.then((outcome) => {
        process.exit(outcome === 'drained' ? 0 : 1);
      });
    });
  }
}
