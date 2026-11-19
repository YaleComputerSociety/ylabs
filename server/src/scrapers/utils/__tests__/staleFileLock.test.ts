import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { breakFileLockIfUnchanged, readFileLock } from '../staleFileLock';

let directory: string;
let lockPath: string;
let clock: number;
const options = () => ({ now: () => clock, pid: 101, guardStaleMs: 2_000 });
const lockOf = (holder: string, at = clock) =>
  JSON.stringify({ pid: 4_000_001, token: holder, at });

beforeEach(() => {
  directory = fs.mkdtempSync('/tmp/ylsfl-unit-');
  lockPath = path.join(directory, 'state.lock');
  clock = 1_000_000;
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('breakFileLockIfUnchanged (#6227)', () => {
  it('removes the lock it judged stale and nothing else', () => {
    const dead = lockOf('dead');
    fs.writeFileSync(lockPath, dead);

    expect(breakFileLockIfUnchanged(lockPath, dead, options())).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(fs.existsSync(`${lockPath}.break`)).toBe(false);
  });

  it('never lets a third process slip in while a late breaker handles a fresh lock', () => {
    const dead = lockOf('dead');
    const fresh = lockOf('first-taker');
    const intruder = lockOf('third-process');
    fs.writeFileSync(lockPath, fresh);
    const takeIfFree = () => {
      try {
        fs.writeFileSync(lockPath, intruder, { flag: 'wx' });
      } catch {
        return;
      }
    };
    const rename = fs.renameSync.bind(fs);
    const remove = fs.rmSync.bind(fs);
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      rename(from, to);
      if (from === lockPath) takeIfFree();
    });
    vi.spyOn(fs, 'rmSync').mockImplementation((target, opts) => {
      remove(target, opts);
      if (target === lockPath) takeIfFree();
    });

    expect(breakFileLockIfUnchanged(lockPath, dead, options())).toBe(false);
    expect(fs.readFileSync(lockPath, 'utf8')).toBe(fresh);
  });

  it('lets only one breaker work at a time, and waits rather than removes', () => {
    const dead = lockOf('dead');
    fs.writeFileSync(lockPath, dead);
    fs.writeFileSync(`${lockPath}.break`, JSON.stringify({ pid: 202, token: 'other', at: clock }));

    expect(breakFileLockIfUnchanged(lockPath, dead, options())).toBe(false);
    expect(fs.readFileSync(lockPath, 'utf8')).toBe(dead);
  });

  it('clears a guard left by a breaker that died, so the next attempt can break', () => {
    const dead = lockOf('dead');
    fs.writeFileSync(lockPath, dead);
    fs.writeFileSync(
      `${lockPath}.break`,
      JSON.stringify({ pid: 202, token: 'crashed', at: clock - 2_001 }),
    );

    expect(breakFileLockIfUnchanged(lockPath, dead, options())).toBe(false);
    expect(fs.existsSync(`${lockPath}.break`)).toBe(false);
    expect(breakFileLockIfUnchanged(lockPath, dead, options())).toBe(true);
  });

  it('reads lock age from the injected clock, with the file time only for an older lock', () => {
    fs.writeFileSync(lockPath, lockOf('timed', clock - 5_000));
    expect(readFileLock(lockPath, () => clock)?.ageMs).toBe(5_000);

    fs.writeFileSync(lockPath, JSON.stringify({ pid: 7, token: 'legacy' }));
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lockPath, old, old);
    expect(readFileLock(lockPath, () => clock)?.ageMs).toBeGreaterThanOrEqual(59_000);
  });
});
