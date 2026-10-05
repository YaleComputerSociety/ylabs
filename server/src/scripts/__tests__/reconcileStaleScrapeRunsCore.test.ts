import { describe, expect, it } from 'vitest';
import {
  assertReconcileStaleScrapeRunsApplyAllowed,
  planStaleScrapeRunReconciliation,
  resolveStaleScrapeRunThresholds,
  staleScrapeRunUpdate,
  summarizeStaleScrapeRunPlan,
  type RunningScrapeRunFacts,
} from '../reconcileStaleScrapeRunsCore';
import { parseReconcileStaleScrapeRunsArgs } from '../reconcileStaleScrapeRuns';

const NOW = new Date('2026-09-27T12:00:00Z');
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function run(overrides: Partial<RunningScrapeRunFacts> & { id: string }): RunningScrapeRunFacts {
  return { sourceName: 'fixture-source', startedAt: ago(200 * HOUR), ...overrides };
}

function plan(runs: RunningScrapeRunFacts[], extra: { held?: string[]; alive?: number[] } = {}) {
  return planStaleScrapeRunReconciliation({
    runs,
    heldLockSourceNames: new Set(extra.held ?? []),
    now: NOW,
    localHost: 'this-host',
    isLocalProcessAlive: (pid) => (extra.alive ?? []).includes(pid),
  });
}

describe('planStaleScrapeRunReconciliation (#3595)', () => {
  it('never closes a run whose heartbeat is fresh, even with no lock and a dead owner', () => {
    const outcome = plan([
      run({ id: 'fresh', heartbeatAt: ago(2 * MINUTE), owner: { host: 'this-host', pid: 7 } }),
    ]);
    expect(outcome.reap).toEqual([]);
    expect(outcome.keep).toEqual([
      expect.objectContaining({ id: 'fresh', reason: 'heartbeat_fresh' }),
    ]);
  });

  it('never closes a run whose source lock is held, however old it is', () => {
    const outcome = plan(
      [
        run({ id: 'stale-under-lock', heartbeatAt: ago(5 * HOUR) }),
        run({ id: 'legacy-under-lock' }),
      ],
      { held: ['fixture-source'] },
    );
    expect(outcome.reap).toEqual([]);
    expect(outcome.keep.map((entry) => entry.reason)).toEqual([
      'source_lock_held',
      'source_lock_held',
    ]);
  });

  it('never closes a run whose owner process is still alive on this host', () => {
    const outcome = plan(
      [
        run({
          id: 'blocked-loop',
          heartbeatAt: ago(5 * HOUR),
          owner: { host: 'this-host', pid: 42 },
        }),
      ],
      { alive: [42] },
    );
    expect(outcome.keep).toEqual([
      expect.objectContaining({ id: 'blocked-loop', reason: 'owner_process_alive' }),
    ]);
  });

  it('closes a run whose heartbeat went stale, dated at its last beat', () => {
    const heartbeatAt = ago(20 * MINUTE);
    const outcome = plan([
      run({ id: 'crashed', heartbeatAt, owner: { host: 'other-host', pid: 42 } }),
    ]);
    expect(outcome.reap).toEqual([
      expect.objectContaining({
        id: 'crashed',
        reason: 'heartbeat_stale',
        lastSignOfLifeAt: heartbeatAt,
      }),
    ]);
  });

  it('closes a run that predates heartbeats only past the conservative age bound', () => {
    const outcome = plan([
      run({ id: 'ancient', startedAt: ago(73 * HOUR) }),
      run({ id: 'recent', startedAt: ago(71 * HOUR) }),
    ]);
    expect(outcome.reap.map((entry) => [entry.id, entry.reason])).toEqual([
      ['ancient', 'legacy_abandoned'],
    ]);
    expect(outcome.keep.map((entry) => [entry.id, entry.reason])).toEqual([
      ['recent', 'legacy_too_recent'],
    ]);
    expect(summarizeStaleScrapeRunPlan(outcome)).toEqual({
      running: 2,
      planned: 1,
      plannedByReason: { legacy_abandoned: 1 },
      keptByReason: { legacy_too_recent: 1 },
    });
  });
});

describe('the sweep stage scope: heartbeat-stale only, started before the sweep (#3595)', () => {
  const SWEEP_STARTED_AT = ago(3 * HOUR);

  function sweepPlan(runs: RunningScrapeRunFacts[], extra: { held?: string[]; alive?: number[] }) {
    return planStaleScrapeRunReconciliation({
      runs,
      heldLockSourceNames: new Set(extra.held ?? []),
      now: NOW,
      localHost: 'this-host',
      isLocalProcessAlive: (pid) => (extra.alive ?? []).includes(pid),
      heartbeatStaleOnly: true,
      startedBefore: SWEEP_STARTED_AT,
    });
  }

  it('closes only the heartbeat-stale rows in a mixed population', () => {
    const outcome = sweepPlan(
      [
        run({ id: 'crashed', heartbeatAt: ago(5 * HOUR), owner: { host: 'this-host', pid: 11 } }),
        run({
          id: 'crashed-elsewhere',
          heartbeatAt: ago(4 * HOUR),
          owner: { host: 'other-host', pid: 12 },
        }),
        run({ id: 'fresh', startedAt: ago(4 * HOUR), heartbeatAt: ago(1 * MINUTE) }),
        run({ id: 'alive', heartbeatAt: ago(5 * HOUR), owner: { host: 'this-host', pid: 13 } }),
        run({ id: 'locked', sourceName: 'locked-source', heartbeatAt: ago(5 * HOUR) }),
        run({ id: 'legacy-old', startedAt: ago(200 * HOUR) }),
        run({ id: 'legacy-recent', startedAt: ago(10 * HOUR) }),
      ],
      { held: ['locked-source'], alive: [13] },
    );

    expect(outcome.reap.map((entry) => [entry.id, entry.reason])).toEqual([
      ['crashed', 'heartbeat_stale'],
      ['crashed-elsewhere', 'heartbeat_stale'],
    ]);
    expect(outcome.keep.map((entry) => [entry.id, entry.reason])).toEqual([
      ['fresh', 'heartbeat_fresh'],
      ['alive', 'owner_process_alive'],
      ['locked', 'source_lock_held'],
      ['legacy-old', 'legacy_operator_only'],
      ['legacy-recent', 'legacy_too_recent'],
    ]);
  });

  it("leaves the sweep's own runs alone, even a dead one with a stale heartbeat", () => {
    const outcome = sweepPlan(
      [
        run({
          id: 'sweep-live',
          startedAt: ago(2 * HOUR),
          heartbeatAt: ago(1 * MINUTE),
          owner: { host: 'this-host', pid: 21 },
        }),
        run({
          id: 'sweep-crashed',
          startedAt: SWEEP_STARTED_AT,
          heartbeatAt: ago(2 * HOUR),
          owner: { host: 'this-host', pid: 22 },
        }),
      ],
      { alive: [21] },
    );

    expect(outcome.reap).toEqual([]);
    expect(outcome.keep.map((entry) => [entry.id, entry.reason])).toEqual([
      ['sweep-live', 'started_at_or_after_cutoff'],
      ['sweep-crashed', 'started_at_or_after_cutoff'],
    ]);
  });
});

describe('resolveStaleScrapeRunThresholds (#3595)', () => {
  it('lets an operator raise the bounds', () => {
    expect(
      resolveStaleScrapeRunThresholds({ staleAfterMinutes: 60, legacyOlderThanHours: 240 }),
    ).toEqual({
      staleHeartbeatMs: 60 * MINUTE,
      legacyAbandonedAfterMs: 240 * HOUR,
    });
  });

  it('refuses to lower either bound, which would let it close a live run', () => {
    expect(() => resolveStaleScrapeRunThresholds({ staleAfterMinutes: 2 })).toThrow(/only raise/);
    expect(() => resolveStaleScrapeRunThresholds({ legacyOlderThanHours: 1 })).toThrow(
      /only raise/,
    );
  });
});

describe('staleScrapeRunUpdate (#3595)', () => {
  it('pins the heartbeat it read, so a run that beat since is left alone', () => {
    const heartbeatAt = ago(20 * MINUTE);
    const [reap] = plan([run({ id: 'crashed', heartbeatAt })]).reap;
    const { filter, update } = staleScrapeRunUpdate(reap, {
      now: NOW,
      detectedBy: 'scrape-runs:reconcile-stale',
    });
    expect(filter).toEqual({ _id: 'crashed', status: 'running', heartbeatAt });
    expect(update).toMatchObject({
      $set: {
        status: 'interrupted',
        finishedAt: heartbeatAt,
        interruption: {
          reason: 'heartbeat_stale',
          detectedAt: NOW,
          detectedBy: 'scrape-runs:reconcile-stale',
        },
      },
      $push: { errors: { message: expect.stringContaining('heartbeat stopped'), at: NOW } },
    });
  });

  it('matches a legacy run only while it still has no heartbeat', () => {
    const [reap] = plan([run({ id: 'ancient' })]).reap;
    const { filter } = staleScrapeRunUpdate(reap, { now: NOW, detectedBy: 'x' });
    expect(filter).toEqual({ _id: 'ancient', status: 'running', heartbeatAt: { $exists: false } });
  });
});

describe('assertReconcileStaleScrapeRunsApplyAllowed (#3595)', () => {
  const allow = (mongoUrl: string, env: NodeJS.ProcessEnv = {}, apply = true) =>
    assertReconcileStaleScrapeRunsApplyAllowed({ apply, scriptName: 'x', mongoUrl, env });

  it('allows an apply against Development', () => {
    expect(allow('mongodb://localhost:27017/Development').environment).toBe('development');
  });

  it('refuses an apply against Beta or Production however the environment is declared', () => {
    expect(() => allow('mongodb://localhost:27017/Beta')).toThrow(/only to Development/);
    expect(() => allow('mongodb://localhost:27017/Beta', { SCRAPER_ENV: 'beta' })).toThrow(
      /only to Development/,
    );
    expect(() => allow('mongodb://localhost:27017/Prod')).toThrow(/production/);
    expect(() =>
      allow('mongodb://localhost:27017/Prod', {
        SCRAPER_ENV: 'production',
        CONFIRM_PROD_SCRAPE: 'true',
      }),
    ).toThrow(/only to Development/);
  });

  it('refuses an apply whose target cannot be identified', () => {
    expect(() => allow('mongodb://localhost:27017/')).toThrow(/only to Development/);
  });

  it('lets a dry run read any environment', () => {
    expect(
      allow('mongodb://localhost:27017/Beta', { SCRAPER_ENV: 'beta' }, false).environment,
    ).toBe('beta');
  });
});

describe('parseReconcileStaleScrapeRunsArgs (#3595)', () => {
  it('defaults to a dry run', () => {
    expect(parseReconcileStaleScrapeRunsArgs([])).toMatchObject({ apply: false });
  });

  it('requires the confirm flag to apply', () => {
    expect(() => parseReconcileStaleScrapeRunsArgs(['--apply'])).toThrow(
      /--confirm-reconcile-stale-scrape-runs/,
    );
    expect(
      parseReconcileStaleScrapeRunsArgs(['--apply', '--confirm-reconcile-stale-scrape-runs']),
    ).toMatchObject({ apply: true, confirmed: true });
  });

  it('rejects an unknown flag', () => {
    expect(() => parseReconcileStaleScrapeRunsArgs(['--force'])).toThrow(/Unknown/);
  });

  it('parses the sweep stage scope flags', () => {
    expect(parseReconcileStaleScrapeRunsArgs([])).toMatchObject({ heartbeatStaleOnly: false });
    expect(
      parseReconcileStaleScrapeRunsArgs([
        '--heartbeat-stale-only',
        '--started-before',
        '2026-09-28T01:00:00.000Z',
      ]),
    ).toMatchObject({
      heartbeatStaleOnly: true,
      startedBefore: new Date('2026-09-28T01:00:00.000Z'),
    });
    expect(() => parseReconcileStaleScrapeRunsArgs(['--started-before', 'yesterday'])).toThrow(
      /ISO timestamp/,
    );
    expect(() => parseReconcileStaleScrapeRunsArgs(['--started-before'])).toThrow(/ISO timestamp/);
  });
});
