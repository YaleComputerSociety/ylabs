import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runScraperCron } from '../cronRunner';
import type { CronRunnerDependencies } from '../cronRunner';

const NOW = new Date('2026-05-14T12:00:00Z');

function makeDeps(overrides: Partial<CronRunnerDependencies> = {}): CronRunnerDependencies {
  return {
    loadSource: vi.fn().mockResolvedValue({ name: 'openalex', enabled: true }),
    orchestrator: {
      run: vi.fn().mockResolvedValue({
        runId: 'run-1',
        result: { observationCount: 10, entitiesObserved: 3 },
      }),
    },
    materializeFromRun: vi.fn().mockResolvedValue({
      materialized: 3,
      created: 1,
      updated: 2,
      conflicts: 0,
      skipped: 0,
      errors: 0,
    }),
    getScrapeRunReport: vi.fn().mockResolvedValue({ run: { id: 'run-1' } }),
    acquireScrapeJobLock: vi.fn().mockResolvedValue({
      acquired: true,
      ownerId: 'owner-1',
      lock: {},
    }),
    heartbeatScrapeJobLock: vi.fn().mockResolvedValue({ heartbeated: true }),
    releaseScrapeJobLock: vi.fn().mockResolvedValue({ released: true }),
    ...overrides,
  };
}

describe('runScraperCron', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('refuses disabled sources unless forced for manual recovery', async () => {
    const deps = makeDeps({
      loadSource: vi.fn().mockResolvedValue({ name: 'openalex', enabled: false }),
    });

    await expect(
      runScraperCron(
        {
          sourceName: 'openalex',
          environment: 'production',
          options: { dryRun: false, useCache: false, release: true },
          ownerId: 'owner-1',
          now: NOW,
          heartbeatIntervalMs: 0,
        },
        deps,
      ),
    ).rejects.toThrow('Source "openalex" is disabled');
    expect(deps.acquireScrapeJobLock).not.toHaveBeenCalled();
  });

  it('skips cleanly when another cron owns the source lock', async () => {
    const deps = makeDeps({
      acquireScrapeJobLock: vi.fn().mockResolvedValue({
        acquired: false,
        ownerId: 'owner-1',
        reason: 'lock-held',
      }),
    });

    const result = await runScraperCron(
      {
        sourceName: 'openalex',
        environment: 'production',
        options: { dryRun: false, useCache: false, release: true },
        ownerId: 'owner-1',
        now: NOW,
        heartbeatIntervalMs: 0,
      },
      deps,
    );

    expect(result).toEqual({
      status: 'skipped-lock-held',
      sourceName: 'openalex',
      exitCode: 0,
      ownerId: 'owner-1',
    });
    expect(deps.orchestrator.run).not.toHaveBeenCalled();
    expect(deps.releaseScrapeJobLock).not.toHaveBeenCalled();
  });

  it('runs, materializes, reports, and marks cron metadata under a lock', async () => {
    const deps = makeDeps();

    const result = await runScraperCron(
      {
        sourceName: 'openalex',
        environment: 'production',
        options: { dryRun: false, useCache: false, release: true },
        ownerId: 'owner-1',
        now: NOW,
        heartbeatIntervalMs: 0,
      },
      deps,
    );

    expect(deps.orchestrator.run).toHaveBeenCalledWith('openalex', {
      dryRun: false,
      useCache: false,
      release: true,
      triggeredBy: 'cron',
    });
    expect(deps.materializeFromRun).toHaveBeenCalledWith('run-1', { dryRun: false });
    expect(deps.getScrapeRunReport).toHaveBeenCalledWith('run-1');
    expect(deps.releaseScrapeJobLock).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: 'production',
        sourceName: 'openalex',
        ownerId: 'owner-1',
        releaseReason: 'success',
        lastRunId: 'run-1',
      }),
    );
    expect(result).toMatchObject({
      status: 'completed',
      sourceName: 'openalex',
      runId: 'run-1',
      exitCode: 0,
    });
  });

  it('exits nonzero and releases as failure when materialization reports errors', async () => {
    const deps = makeDeps({
      materializeFromRun: vi.fn().mockResolvedValue({
        materialized: 3,
        created: 1,
        updated: 2,
        conflicts: 0,
        skipped: 0,
        errors: 2,
      }),
    });

    const result = await runScraperCron(
      {
        sourceName: 'openalex',
        environment: 'production',
        options: { dryRun: false, useCache: false, release: true },
        ownerId: 'owner-1',
        now: NOW,
        heartbeatIntervalMs: 0,
      },
      deps,
    );

    expect(result.exitCode).toBe(1);
    expect(deps.releaseScrapeJobLock).toHaveBeenCalledWith(
      expect.objectContaining({
        releaseReason: 'failure',
        lastRunId: 'run-1',
      }),
    );
  });
});
