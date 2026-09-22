import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SCRAPE_JOB_LOCK_HEARTBEAT_MS,
  createScrapeJobLockOwnerId,
  startScrapeJobLockHeartbeat,
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

    expect(result).toEqual({
      acquired: true,
      ownerId: INPUT.ownerId,
      value: 'done',
      lockLost: false,
    });
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

  it('records the outcome the work reports, so a failed run is not stamped as a success', async () => {
    const deps = buildDeps();

    const result = await withScrapeJobLock<{ runId: string; failed: boolean }>(
      {
        ...INPUT,
        describeRelease: (outcome) => ({
          releaseReason: outcome.failed ? 'failure' : 'success',
          lastRunId: outcome.runId,
        }),
      },
      () => Promise.resolve({ runId: 'run-9', failed: true }),
      deps,
    );

    expect(result.acquired).toBe(true);
    expect(deps.releaseScrapeJobLock).toHaveBeenCalledWith(
      expect.objectContaining({ releaseReason: 'failure', lastRunId: 'run-9' }),
    );
  });

  // A release that cannot be written must not rewrite the job's outcome in either
  // direction: a completed write stays completed, and a failed one still reports
  // the error that actually failed it.
  it('keeps the work outcome when the release itself fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const succeedDeps = buildDeps({
      releaseScrapeJobLock: vi.fn().mockRejectedValue(new Error('mongo went away')),
    });

    const result = await withScrapeJobLock(INPUT, () => Promise.resolve('written'), succeedDeps);
    expect(result).toMatchObject({ acquired: true, value: 'written' });

    const failDeps = buildDeps({
      releaseScrapeJobLock: vi.fn().mockRejectedValue(new Error('mongo went away')),
    });
    await expect(
      withScrapeJobLock(INPUT, () => Promise.reject(new Error('parse blew up')), failDeps),
    ).rejects.toThrow('parse blew up');

    expect(consoleError).toHaveBeenCalled();
  });

  // Losing the lease mid-run means a second writer can be writing the same
  // source, so the run cannot be reported as a clean exclusive write.
  it('reports a lock lost mid-run instead of finishing silently', async () => {
    const deps = buildDeps({
      startScrapeJobLockHeartbeat: vi.fn().mockImplementation((input) => {
        input.onLockLost?.();
        return { stop: vi.fn() };
      }),
    });

    const result = await withScrapeJobLock(INPUT, () => Promise.resolve('done'), deps);

    expect(result).toMatchObject({ acquired: true, lockLost: true });
  });

  // An interrupted write used to leave the row locked for the rest of the lease,
  // so the operator's immediate retry was refused for up to 30 minutes.
  it('releases the lock when the process is interrupted mid-run', async () => {
    const deps = buildDeps();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const listenersBefore = process.listeners('SIGINT').length;

    await withScrapeJobLock(
      INPUT,
      async () => {
        const handler = process.listeners('SIGINT').at(-1) as () => void;
        expect(process.listeners('SIGINT').length).toBe(listenersBefore + 1);
        handler();
        await new Promise((resolve) => setImmediate(resolve));
        return 'interrupted';
      },
      deps,
    );

    expect(deps.releaseScrapeJobLock).toHaveBeenCalledTimes(1);
    expect(deps.releaseScrapeJobLock).toHaveBeenCalledWith(
      expect.objectContaining({ ...INPUT, releaseReason: 'manual' }),
    );
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGINT');
    expect(consoleError).toHaveBeenCalled();
    expect(process.listeners('SIGINT').length).toBe(listenersBefore);
  });

  it('mints an owner id that distinguishes two concurrent processes', () => {
    const first = createScrapeJobLockOwnerId('scrape-cli-run');
    const second = createScrapeJobLockOwnerId('scrape-cli-run');

    expect(first).not.toBe(second);
    expect(first).toContain('scrape-cli-run');
    expect(first).toContain(String(process.pid));
  });
});

describe('startScrapeJobLockHeartbeat (#2498)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reports a renewal that matches no row as a lost lock', async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onLockLost = vi.fn();
    const heartbeat = startScrapeJobLockHeartbeat(
      { ...INPUT, heartbeatIntervalMs: 50, onLockLost },
      { heartbeatScrapeJobLock: vi.fn().mockResolvedValue({ heartbeated: false }) },
    );

    await vi.advanceTimersByTimeAsync(60);
    heartbeat.stop();

    expect(onLockLost).toHaveBeenCalled();
    expect(consoleError.mock.calls[0]?.[0]).toContain(INPUT.sourceName);
  });

  it('logs a sanitized value when the renewal itself rejects', async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onLockLost = vi.fn();
    const heartbeat = startScrapeJobLockHeartbeat(
      { ...INPUT, heartbeatIntervalMs: 50, onLockLost },
      {
        heartbeatScrapeJobLock: vi
          .fn()
          .mockRejectedValue(new Error('renewal rejected for operator@example.edu')),
      },
    );

    await vi.advanceTimersByTimeAsync(60);
    heartbeat.stop();

    expect(onLockLost).not.toHaveBeenCalled();
    const logged = String(consoleError.mock.calls[0]?.[1]);
    expect(logged).toContain('[email redacted]');
    expect(logged).not.toContain('operator@example.edu');
  });
});
