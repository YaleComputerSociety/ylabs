import fs from 'fs';
import { randomUUID } from 'crypto';

export interface FileLockRead {
  raw: string;
  pid?: number;
  ageMs: number;
}

/**
 * A lock file's contents and age. Age comes from the `at` the holder wrote with the caller's clock,
 * so a test's injected clock decides staleness (#6227); a lock written before `at` existed falls
 * back to the file's modification time against the wall clock.
 */
export function readFileLock(lockPath: string, now: () => number): FileLockRead | null {
  let raw: string;
  let mtimeMs: number;
  try {
    raw = fs.readFileSync(lockPath, 'utf8');
    mtimeMs = fs.statSync(lockPath).mtimeMs;
  } catch {
    return null;
  }
  let record: { pid?: unknown; at?: unknown } = {};
  try {
    record = (JSON.parse(raw) as typeof record) ?? {};
  } catch {
    record = {};
  }
  const at = typeof record.at === 'number' && Number.isFinite(record.at) ? record.at : undefined;
  return {
    raw,
    ...(Number.isInteger(record.pid) ? { pid: record.pid as number } : {}),
    ageMs: at !== undefined ? now() - at : Date.now() - mtimeMs,
  };
}

export interface StaleLockBreakOptions {
  now: () => number;
  pid: number;
  guardStaleMs: number;
}

function releaseGuard(guardPath: string, token: string): void {
  try {
    if ((JSON.parse(fs.readFileSync(guardPath, 'utf8')) as { token?: unknown }).token === token) {
      fs.rmSync(guardPath, { force: true });
    }
  } catch {
    // The guard was already cleared as stale; nothing of ours is left to remove.
  }
}

function clearStaleGuard(guardPath: string, options: StaleLockBreakOptions): void {
  const guard = readFileLock(guardPath, options.now);
  if (!guard || guard.ageMs <= options.guardStaleMs) return;
  const again = readFileLock(guardPath, options.now);
  if (again?.raw === guard.raw) fs.rmSync(guardPath, { force: true });
}

/**
 * Removes the lock at `lockPath` only while it is still the exact lock the caller judged stale.
 * One breaker at a time holds the `.break` guard, and it re-reads the lock under the guard before
 * removing it, so a fresh lock another process took after the judgement is never removed. A guard
 * left by a breaker that died is itself cleared once it is older than `guardStaleMs`.
 * Returns true when the judged lock is gone, false when the caller should keep waiting.
 */
export function breakFileLockIfUnchanged(
  lockPath: string,
  observedRaw: string,
  options: StaleLockBreakOptions,
): boolean {
  const guardPath = `${lockPath}.break`;
  const token = `${options.pid}-${randomUUID()}`;
  try {
    fs.writeFileSync(guardPath, JSON.stringify({ pid: options.pid, token, at: options.now() }), {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    clearStaleGuard(guardPath, options);
    return false;
  }
  try {
    let current: string;
    try {
      current = fs.readFileSync(lockPath, 'utf8');
    } catch {
      return true;
    }
    if (current !== observedRaw) return false;
    fs.rmSync(lockPath, { force: true });
    return true;
  } finally {
    releaseGuard(guardPath, token);
  }
}
