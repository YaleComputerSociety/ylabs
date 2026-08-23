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
    reclaimInferredPiLeads: vi.fn().mockResolvedValue({
      scanned: 5,
      lagging: 1,
      rows: [{ entityId: 'e1', entityKey: 'lab-a', disposition: 'materialized-lead' }],
      tally: {
        'materialized-lead': 1,
        'already-linked': 0,
        'still-unresolved': 0,
        'pending-apply': 0,
      },
    }),
    getScrapeRunReport: vi.fn().mockResolvedValue({ run: { id: 'run-1' } }),
    runStudentVisibilityGate: vi.fn().mockResolvedValue({
      counts: { scanned: 3, promoted: 2, held: 1, resolved: 2, changed: 2 },
    }),
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

  it('points missing source rows at the reviewed source seed workflow', async () => {
    const deps = makeDeps({
      loadSource: vi.fn().mockResolvedValue(null),
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
    ).rejects.toThrow(
      'Run "yarn --cwd server scrape:seed-sources --dry-run --output /tmp/ylabs-seed-sources-dry-run.json" first, then review and apply with "--apply --confirm-seed-apply".',
    );
    expect(deps.acquireScrapeJobLock).not.toHaveBeenCalled();
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
    expect(deps.reclaimInferredPiLeads).toHaveBeenCalledWith({ apply: true, scope: 'all' });
    expect(deps.runStudentVisibilityGate).toHaveBeenCalledWith({
      collection: 'all',
      mode: 'apply',
      sourceName: 'openalex',
    });
    expect(
      (deps.reclaimInferredPiLeads as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    ).toBeLessThan(
      (deps.runStudentVisibilityGate as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    );
    expect(result).toMatchObject({
      inferredPiLeadReclaimResult: { tally: { 'materialized-lead': 1 } },
    });
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
    expect(deps.reclaimInferredPiLeads).not.toHaveBeenCalled();
    expect(deps.runStudentVisibilityGate).not.toHaveBeenCalled();
    expect(deps.releaseScrapeJobLock).toHaveBeenCalledWith(
      expect.objectContaining({
        releaseReason: 'failure',
        lastRunId: 'run-1',
      }),
    );
  });

  it('completes the run when the inferred-PI lead reclaim throws', async () => {
    const deps = makeDeps({
      reclaimInferredPiLeads: vi.fn().mockRejectedValue(new Error('reclaim boom')),
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

    expect(result).toMatchObject({
      status: 'completed',
      exitCode: 0,
      inferredPiLeadReclaimResult: undefined,
    });
    expect(deps.runStudentVisibilityGate).toHaveBeenCalledOnce();
    expect(deps.releaseScrapeJobLock).toHaveBeenCalledWith(
      expect.objectContaining({ releaseReason: 'success', lastRunId: 'run-1' }),
    );
  });
});
