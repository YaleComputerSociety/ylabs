/**
 * Optional in-process scheduler that keeps the canonical gate scorecards fresh by periodically
 * running gates:refresh. This is what makes the operator board "real-time" on a single-instance
 * deploy: the same process that serves /api/admin/operator-board also regenerates the /tmp
 * artifacts it reads, so the board reflects live DB state within one interval.
 *
 * Disabled unless GATE_REFRESH_INTERVAL_MINUTES is a positive number (default off, so dev/CI/tests
 * are unaffected). Set GATE_REFRESH_SKIP_HEAVY=true to skip the ~3.5min data-quality audit on the
 * frequent cadence (run it on a separate, slower schedule).
 *
 * NOTE: relies on `yarn gates:refresh` (tsx + src/), which suits beta/staging — the environments
 * the gate exists for. A pure production build (tsup → build/, no tsx) should drive refresh via an
 * external scheduler hitting a trigger, or persist scorecards to Mongo (the multi-instance fix).
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filenameLocal = fileURLToPath(import.meta.url);
const SERVER_ROOT = path.resolve(path.dirname(__filenameLocal), '../..');

let running = false;
let timer: NodeJS.Timeout | undefined;

/** Resolve the refresh interval in ms from env; 0 means disabled. */
export function gateRefreshIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const minutes = Number(env.GATE_REFRESH_INTERVAL_MINUTES);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : 0;
}

function triggerRefresh(): void {
  if (running) {
    console.log('[gate-refresh] previous cycle still running; skipping this tick');
    return;
  }
  running = true;
  const args = ['gates:refresh'];
  if (process.env.GATE_REFRESH_SKIP_HEAVY === 'true') args.push('--skip-heavy');
  const child = spawn('yarn', args, { cwd: SERVER_ROOT, env: process.env, stdio: 'inherit' });
  child.on('close', (code) => {
    running = false;
    console.log(`[gate-refresh] cycle finished (exit ${code})`);
  });
  child.on('error', (err) => {
    running = false;
    console.error('[gate-refresh] failed to spawn gates:refresh:', err);
  });
}

/** Start the scheduler if enabled via env. Returns true if started. Safe to call once at boot. */
export function startGateRefreshScheduler(env: NodeJS.ProcessEnv = process.env): boolean {
  const intervalMs = gateRefreshIntervalMs(env);
  if (!intervalMs) return false;
  console.log(
    `[gate-refresh] scheduler enabled: every ${intervalMs / 60_000} min` +
      (env.GATE_REFRESH_SKIP_HEAVY === 'true' ? ' (skip-heavy)' : ''),
  );
  // Kick one off shortly after boot so the board is fresh without waiting a full interval.
  setTimeout(triggerRefresh, 15_000).unref?.();
  timer = setInterval(triggerRefresh, intervalMs);
  timer.unref?.();
  return true;
}

export function stopGateRefreshScheduler(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  running = false;
}
