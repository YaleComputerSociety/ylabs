import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SCRAPE_JOB_LOCK_HEARTBEAT_MS,
  createScrapeJobLockOwnerId,
  withScrapeJobLock,
  type WithScrapeJobLockDependencies,
} from '../scrapeJobLock';

const INPUT = {
  environment: 'development' as const,
  sourceName: 'dept-faculty-roster',
  ownerId: 'owner-under-test',
};

const buildDeps = (
  overrides: Partial<WithScrapeJobLockDependencies> = {},
): WithScrapeJobLockDependencies => ({
  acquireScrapeJobLock: vi
    .fn()
    .mockResolvedValue({ acquired: true, ownerId: INPUT.ownerId, lock: {} }),
  heartbeatScrapeJobLock: vi.fn().mockResolvedValue({ heartbeated: true }),
  releaseScrapeJobLock: vi.fn().mockResolvedValue({ released: true }),
  startScrapeJobLockHeartbeat: vi.fn().mockReturnValue({ stop: vi.fn() }),
  ...overrides,
});

describe('withScrapeJobLock (#2498)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs the work and releases the lock as a success', async () => {
    const deps = buildDeps();
    const run = vi.fn().mockResolvedValue('done');

    const result = await withScrapeJobLock(INPUT, run, deps);

    expect(result).toEqual({ acquired: true, ownerId: INPUT.ownerId, value: 'done' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(deps.releaseScrapeJobLock).toHaveBeenCalledWith(
      expect.objectContaining({ ...INPUT, releaseReason: 'success' }),
    );
  });

  it('does not run the work when another writer holds the lock', async () => {
    const deps = buildDeps({
      acquireScrapeJobLock: vi
        .fn()
        .mockResolvedValue({ acquired: false, ownerId: INPUT.ownerId, reason: 'lock-held' }),
    });
    const run = vi.fn();

    const result = await withScrapeJobLock(INPUT, run, deps);

    expect(result).toEqual({ acquired: false, ownerId: INPUT.ownerId, reason: 'lock-held' });
    expect(run).not.toHaveBeenCalled();
    // Releasing a lock this process never holds would hand the source to a third
    // writer while the real holder is mid-write.
    expect(deps.releaseScrapeJobLock).not.toHaveBeenCalled();
    expect(deps.startScrapeJobLockHeartbeat).not.toHaveBeenCalled();
  });

  it('releases the lock as a failure and rethrows when the work throws', async () => {
    const deps = buildDeps();
    const failure = new Error('scrape blew up');

    await expect(withScrapeJobLock(INPUT, () => Promise.reject(failure), deps)).rejects.toThrow(
      failure,
    );

    expect(deps.releaseScrapeJobLock).toHaveBeenCalledWith(
      expect.objectContaining({ ...INPUT, releaseReason: 'failure' }),
    );
  });

  it('stops the heartbeat whether the work succeeds or throws', async () => {
    const succeedStop = vi.fn();
    const succeedDeps = buildDeps({
      startScrapeJobLockHeartbeat: vi.fn().mockReturnValue({ stop: succeedStop }),
    });
    await withScrapeJobLock(INPUT, () => Promise.resolve(1), succeedDeps);
    expect(succeedStop).toHaveBeenCalledTimes(1);

    const failStop = vi.fn();
    const failDeps = buildDeps({
      startScrapeJobLockHeartbeat: vi.fn().mockReturnValue({ stop: failStop }),
    });
    await expect(
      withScrapeJobLock(INPUT, () => Promise.reject(new Error('nope')), failDeps),
    ).rejects.toThrow('nope');
    expect(failStop).toHaveBeenCalledTimes(1);
  });

  // A lease that outlives its renewal interval is the difference between a long
  // run keeping its lock and a second writer stealing it mid-write.
  it('renews the lease far more often than the lease lasts', async () => {
    const { DEFAULT_SCRAPE_JOB_LOCK_LEASE_MS } = await import('../scrapeJobLock');
    expect(DEFAULT_SCRAPE_JOB_LOCK_HEARTBEAT_MS).toBeLessThan(DEFAULT_SCRAPE_JOB_LOCK_LEASE_MS / 5);
  });

  it('mints an owner id that distinguishes two concurrent processes', () => {
    const first = createScrapeJobLockOwnerId('scrape-cli-run');
    const second = createScrapeJobLockOwnerId('scrape-cli-run');

    expect(first).not.toBe(second);
    expect(first).toContain('scrape-cli-run');
    expect(first).toContain(String(process.pid));
  });
});
