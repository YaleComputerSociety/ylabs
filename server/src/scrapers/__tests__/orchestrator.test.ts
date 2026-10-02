import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IScraper } from '../types';

const mocks = vi.hoisted(() => ({
  scrapeRunCreate: vi.fn(),
  scrapeRunUpdateOne: vi.fn(),
  scrapeRunFind: vi.fn(),
  getSourceByName: vi.fn(),
  appendObservations: vi.fn(),
  buildEvidenceCoverageImpactReportForObservations: vi.fn(),
}));

vi.mock('../../models/scrapeRun', () => ({
  ScrapeRun: {
    create: mocks.scrapeRunCreate,
    updateOne: mocks.scrapeRunUpdateOne,
    find: mocks.scrapeRunFind,
  },
}));

vi.mock('../observationStore', () => ({
  getSourceByName: mocks.getSourceByName,
  appendObservations: mocks.appendObservations,
}));

vi.mock('../../services/researchEntityEvidenceCoverage', () => ({
  buildEvidenceCoverageImpactReportForObservations:
    mocks.buildEvidenceCoverageImpactReportForObservations,
}));

import { ScraperOrchestrator } from '../orchestrator';
import { INTERRUPT_CLEANUP_TIMEOUT_MS } from '../interruptCleanup';
import { currentProcessCodeSha } from '../scrapeRunCodeIdentity';
import {
  SCRAPE_RUN_INTERRUPT_WRITE_DEADLINE_MS,
  ScrapeRunTerminalWriteError,
} from '../scrapeRunTerminalWrite';

function priorRuns(rows: Array<Record<string, unknown>>) {
  return {
    select: () => ({
      sort: () => ({
        limit: () => ({
          lean: () => Promise.resolve(rows),
        }),
      }),
    }),
  };
}

describe('ScraperOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scrapeRunCreate.mockResolvedValue({ _id: 'run-1' });
    mocks.scrapeRunUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    mocks.scrapeRunFind.mockReturnValue(priorRuns([]));
    mocks.getSourceByName.mockResolvedValue({
      _id: 'source-1',
      name: 'fixture-source',
      defaultWeight: 0.8,
      enabled: true,
      coverage: { tier: 'THIRD_PARTY_ENRICHMENT' },
    });
    mocks.appendObservations.mockResolvedValue({ inserted: 0, skipped: 2, superseded: 0 });
    mocks.buildEvidenceCoverageImpactReportForObservations.mockResolvedValue({
      assessed: 0,
      improved: 0,
      rows: [],
    });
  });

  it('persists dry-run emitted observation counts even when observations are not inserted', async () => {
    const scraper: IScraper = {
      name: 'fixture-source',
      displayName: 'Fixture source',
      async run(ctx) {
        await ctx.emit([
          {
            entityType: 'researchEntity',
            entityKey: 'fixture-lab',
            field: 'shortDescription',
            value: 'Fixture lab studies source-backed research.',
          },
          {
            entityType: 'researchEntity',
            entityKey: 'fixture-lab',
            field: 'accessEvidence',
            value: { type: 'EXPLORATORY_CONTACT' },
          },
        ]);
        return { observationCount: 2, entitiesObserved: 1 };
      },
    };
    const orchestrator = new ScraperOrchestrator();
    orchestrator.register(scraper);

    const result = await orchestrator.run('fixture-source', {
      dryRun: true,
      dbReview: true,
      useCache: false,
      release: false,
    });

    expect(result.runId).toBe('run-1');
    expect(mocks.appendObservations).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ dryRun: true }),
    );
    expect(mocks.scrapeRunUpdateOne).toHaveBeenCalledWith(
      { _id: 'run-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'success',
          observationCount: 2,
          entitiesObserved: 1,
        }),
      }),
    );
  });

  it('creates a benchmark run already invalidated and a live run valid', async () => {
    const orchestrator = new ScraperOrchestrator();
    orchestrator.register({
      name: 'fixture-source',
      displayName: 'Fixture source',
      run: async () => ({ observationCount: 0, entitiesObserved: 0 }),
    });
    const options = { dryRun: true, useCache: true, release: false };

    await orchestrator.run('fixture-source', { ...options, benchmarkRun: true });
    await orchestrator.run('fixture-source', options);

    expect(mocks.scrapeRunCreate.mock.calls.map(([row]) => row.invalidated)).toEqual([true, false]);
  });

  it('records the commit this process runs on the run it opens', async () => {
    const orchestrator = new ScraperOrchestrator();
    orchestrator.register({
      name: 'fixture-source',
      displayName: 'Fixture source',
      run: async () => ({ observationCount: 0, entitiesObserved: 0 }),
    });

    await orchestrator.run('fixture-source', { dryRun: true, useCache: true, release: false });

    const [row] = mocks.scrapeRunCreate.mock.calls[0];
    expect(row).toHaveProperty('codeSha', currentProcessCodeSha());
    expect(currentProcessCodeSha()).toMatch(/^[0-9a-f]{40}$/);
  });

  it('fails a run whose source has now emitted nothing on three consecutive runs', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.scrapeRunFind.mockReturnValue(
      priorRuns([
        { status: 'success', observationCount: 0 },
        { status: 'success', observationCount: 0 },
        { status: 'success', observationCount: 120 },
      ]),
    );
    const orchestrator = new ScraperOrchestrator();
    orchestrator.register({
      name: 'fixture-source',
      displayName: 'Fixture source',
      async run() {
        return { observationCount: 0, entitiesObserved: 0 };
      },
    });

    const returned = await orchestrator.run('fixture-source', {
      dryRun: false,
      dbReview: false,
      useCache: false,
      release: true,
    });

    const persisted = mocks.scrapeRunUpdateOne.mock.calls.at(-1)?.[1] as {
      $set?: { status?: string; errors?: Array<{ message?: string }> };
    };
    expect(persisted.$set?.status).toBe('failure');
    expect(returned.status).toBe('failure');
    expect(persisted.$set?.errors?.at(-1)?.message).toContain('3 consecutive runs');
    expect(consoleError.mock.calls.flat().join(' ')).toContain('fixture-source');
    consoleError.mockRestore();
  });

  it('fails a productive run whose one unit has yielded nothing on three consecutive runs', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Every run here is productive at source level, which is the whole point: the
    // per-source check sees a healthy lane and only the per-unit arm can fail it (#3876).
    mocks.scrapeRunFind.mockReturnValue(
      priorRuns([
        {
          status: 'success',
          observationCount: 431,
          metrics: { unitYields: { dead: 0, alive: 120 } },
        },
        {
          status: 'success',
          observationCount: 420,
          metrics: { unitYields: { dead: 0, alive: 118 } },
        },
      ]),
    );
    mocks.appendObservations.mockResolvedValue({ inserted: 1, skipped: 0, superseded: 0 });
    const orchestrator = new ScraperOrchestrator();
    orchestrator.register({
      name: 'fixture-source',
      displayName: 'Fixture source',
      async run(ctx) {
        await ctx.emit({
          entityType: 'researchEntity',
          entityKey: 'fixture-row',
          field: 'name',
          value: 'Fixture Lab',
        });
        return {
          observationCount: 1,
          entitiesObserved: 1,
          metrics: { unitYields: { dead: 0, alive: 120 } },
        };
      },
    });

    await orchestrator.run('fixture-source', {
      dryRun: false,
      dbReview: false,
      useCache: false,
      release: true,
    });

    const persisted = mocks.scrapeRunUpdateOne.mock.calls.at(-1)?.[1] as {
      $set?: { status?: string; errors?: Array<{ message?: string }> };
    };
    expect(persisted.$set?.status).toBe('failure');
    const messages = (persisted.$set?.errors ?? []).map((error) => error.message ?? '').join(' ');
    expect(messages).toContain('"dead"');
    expect(messages).not.toContain('"alive"');
    expect(consoleError.mock.calls.flat().join(' ')).toContain('fixture-source');
    consoleError.mockRestore();
  });

  it('keeps a productive run successful while one unit is barren but short of the streak', async () => {
    mocks.scrapeRunFind.mockReturnValue(
      priorRuns([
        {
          status: 'success',
          observationCount: 431,
          metrics: { unitYields: { dead: 12, alive: 120 } },
        },
      ]),
    );
    mocks.appendObservations.mockResolvedValue({ inserted: 1, skipped: 0, superseded: 0 });
    const orchestrator = new ScraperOrchestrator();
    orchestrator.register({
      name: 'fixture-source',
      displayName: 'Fixture source',
      async run(ctx) {
        await ctx.emit({
          entityType: 'researchEntity',
          entityKey: 'fixture-row',
          field: 'name',
          value: 'Fixture Lab',
        });
        return {
          observationCount: 1,
          entitiesObserved: 1,
          metrics: { unitYields: { dead: 0, alive: 120 } },
        };
      },
    });

    await orchestrator.run('fixture-source', {
      dryRun: false,
      dbReview: false,
      useCache: false,
      release: true,
    });

    const persisted = mocks.scrapeRunUpdateOne.mock.calls.at(-1)?.[1] as {
      $set?: { status?: string };
    };
    expect(persisted.$set?.status).toBe('success');
  });

  describe('a run keeps what it measured (#3890)', () => {
    const persistedSet = () =>
      (
        mocks.scrapeRunUpdateOne.mock.calls.at(-1)?.[1] as {
          $set?: { status?: string; metrics?: Record<string, unknown> };
        }
      ).$set;

    it('always supplies the reporting channel, which is why the lane may call it', async () => {
      let channel: unknown = 'absent';
      const orchestrator = new ScraperOrchestrator();
      orchestrator.register({
        name: 'fixture-source',
        displayName: 'Fixture source',
        async run(ctx) {
          channel = typeof ctx.reportMetrics;
          return { observationCount: 0, entitiesObserved: 0 };
        },
      });

      await orchestrator.run('fixture-source', {
        dryRun: false,
        dbReview: false,
        useCache: false,
        release: true,
      });

      expect(channel).toBe('function');
    });

    it('stores what a lane reported mid-run even when the lane then throws', async () => {
      const orchestrator = new ScraperOrchestrator();
      orchestrator.register({
        name: 'fixture-source',
        displayName: 'Fixture source',
        async run(ctx) {
          ctx.reportMetrics?.({ unitYields: { alive: 12 } });
          throw new Error('Maximum call stack size exceeded');
        },
      });

      await expect(
        orchestrator.run('fixture-source', {
          dryRun: false,
          dbReview: false,
          useCache: false,
          release: true,
        }),
      ).rejects.toThrow('Maximum call stack size exceeded');

      const set = persistedSet();
      expect(set?.status).toBe('failure');
      expect(set?.metrics).toEqual({ unitYields: { alive: 12 } });
    });

    it('lets the returned object win key by key, and keeps a key only reported mid-run', async () => {
      const orchestrator = new ScraperOrchestrator();
      orchestrator.register({
        name: 'fixture-source',
        displayName: 'Fixture source',
        async run(ctx) {
          ctx.reportMetrics?.({ unitYields: { alive: 1 }, quotesNotOnPage: 7 });
          return {
            observationCount: 0,
            entitiesObserved: 0,
            metrics: { unitYields: { alive: 12, dead: 0 } },
          };
        },
      });

      await orchestrator.run('fixture-source', {
        dryRun: false,
        dbReview: false,
        useCache: false,
        release: true,
      });

      expect(persistedSet()?.metrics).toEqual({
        unitYields: { alive: 12, dead: 0 },
        quotesNotOnPage: 7,
      });
    });

    it('stores no metrics at all for a lane that reports none, rather than an empty object', async () => {
      const orchestrator = new ScraperOrchestrator();
      orchestrator.register({
        name: 'fixture-source',
        displayName: 'Fixture source',
        async run() {
          return { observationCount: 0, entitiesObserved: 0 };
        },
      });

      await orchestrator.run('fixture-source', {
        dryRun: false,
        dbReview: false,
        useCache: false,
        release: true,
      });

      expect(persistedSet()?.metrics).toBeUndefined();
    });
  });

  it('records the frame a crash came from, not only its message (#3891)', async () => {
    const orchestrator = new ScraperOrchestrator();
    orchestrator.register({
      name: 'fixture-source',
      displayName: 'Fixture source',
      async run() {
        throw new Error('Maximum call stack size exceeded');
      },
    });

    await expect(
      orchestrator.run('fixture-source', {
        dryRun: false,
        dbReview: false,
        useCache: false,
        release: true,
      }),
    ).rejects.toThrow('Maximum call stack size exceeded');

    const persisted = mocks.scrapeRunUpdateOne.mock.calls.at(-1)?.[1] as {
      $set?: { errors?: Array<{ message?: string; stack?: string }> };
    };
    const recorded = persisted.$set?.errors?.at(-1);
    expect(recorded?.message).toContain('Maximum call stack size exceeded');
    expect(recorded?.stack).toContain('Maximum call stack size exceeded');
    // A frame, which is the whole point: the message alone is what made #3891
    // answerable only by elimination over the lane's source.
    expect(recorded?.stack).toMatch(/\bat\b/);
  });

  it('records a thrown non-Error without inventing a stack', async () => {
    const orchestrator = new ScraperOrchestrator();
    orchestrator.register({
      name: 'fixture-source',
      displayName: 'Fixture source',
      async run() {
        throw 'a bare string';
      },
    });

    await expect(
      orchestrator.run('fixture-source', {
        dryRun: false,
        dbReview: false,
        useCache: false,
        release: true,
      }),
    ).rejects.toBe('a bare string');

    const persisted = mocks.scrapeRunUpdateOne.mock.calls.at(-1)?.[1] as {
      $set?: { errors?: Array<{ message?: string; stack?: string }> };
    };
    const recorded = persisted.$set?.errors?.at(-1);
    expect(recorded?.message).toContain('a bare string');
    expect(recorded && 'stack' in recorded).toBe(false);
  });

  it('marks a run partial and records why when the scraper reports incomplete coverage', async () => {
    mocks.appendObservations.mockResolvedValue({ inserted: 1, skipped: 0, superseded: 0 });
    const orchestrator = new ScraperOrchestrator();
    orchestrator.register({
      name: 'fixture-source',
      displayName: 'Fixture source',
      async run(ctx) {
        await ctx.emit({
          entityType: 'researchEntity',
          entityKey: 'fixture-lab',
          field: 'name',
          value: 'Fixture Lab',
        });
        return {
          observationCount: 1,
          entitiesObserved: 1,
          partialFailures: ['listing page 2 failed: HTTP 401'],
        };
      },
    });

    await orchestrator.run('fixture-source', {
      dryRun: false,
      dbReview: false,
      useCache: false,
      release: true,
    });

    const persisted = mocks.scrapeRunUpdateOne.mock.calls.at(-1)?.[1] as {
      $set?: { status?: string; errors?: Array<{ message?: string }> };
    };
    expect(persisted.$set?.status).toBe('partial');
    expect(persisted.$set?.errors?.map((error) => error.message)).toEqual([
      'listing page 2 failed: HTTP 401',
    ]);
  });

  it('keeps a run successful while the barren streak is still short', async () => {
    mocks.scrapeRunFind.mockReturnValue(priorRuns([{ status: 'success', observationCount: 0 }]));
    const orchestrator = new ScraperOrchestrator();
    orchestrator.register({
      name: 'fixture-source',
      displayName: 'Fixture source',
      async run() {
        return { observationCount: 0, entitiesObserved: 0 };
      },
    });

    await orchestrator.run('fixture-source', {
      dryRun: false,
      dbReview: false,
      useCache: false,
      release: true,
    });

    const persisted = mocks.scrapeRunUpdateOne.mock.calls.at(-1)?.[1] as {
      $set?: { status?: string; errors?: unknown[] };
    };
    expect(persisted.$set?.status).toBe('success');
    expect(persisted.$set?.errors).toEqual([]);
  });

  it('keeps a productive run successful however barren the source history is', async () => {
    mocks.scrapeRunFind.mockReturnValue(
      priorRuns([
        { status: 'success', observationCount: 0 },
        { status: 'success', observationCount: 0 },
        { status: 'success', observationCount: 0 },
      ]),
    );
    mocks.appendObservations.mockResolvedValue({ inserted: 1, skipped: 0, superseded: 0 });
    const orchestrator = new ScraperOrchestrator();
    orchestrator.register({
      name: 'fixture-source',
      displayName: 'Fixture source',
      async run(ctx) {
        await ctx.emit({
          entityType: 'researchEntity',
          entityKey: 'fixture-lab',
          field: 'shortDescription',
          value: 'Fixture lab studies source-backed research.',
        });
        return { observationCount: 1, entitiesObserved: 1 };
      },
    });

    await orchestrator.run('fixture-source', {
      dryRun: false,
      dbReview: false,
      useCache: false,
      release: true,
    });

    const persisted = mocks.scrapeRunUpdateOne.mock.calls.at(-1)?.[1] as {
      $set?: { status?: string };
    };
    expect(persisted.$set?.status).toBe('success');
  });

  it('sanitizes scraper failure details before persisting run errors', async () => {
    const scraper: IScraper = {
      name: 'fixture-source',
      displayName: 'Fixture source',
      async run() {
        throw new Error(
          'Failed https://user:pass@example.test/source?access_token=secret-token for ada@example.edu',
        );
      },
    };
    const orchestrator = new ScraperOrchestrator();
    orchestrator.register(scraper);

    await expect(
      orchestrator.run('fixture-source', {
        dryRun: false,
        dbReview: false,
        useCache: false,
        release: true,
      }),
    ).rejects.toThrow('Failed https://user:pass@example.test/source');

    const failureUpdate = mocks.scrapeRunUpdateOne.mock.calls.at(-1)?.[1] as {
      $set?: { errors?: Array<{ message?: string; stack?: string }> };
    };
    const persistedError = failureUpdate.$set?.errors?.at(-1);

    expect(persistedError?.message).toContain('https://[credentials-redacted]@example.test');
    expect(persistedError?.message).toContain('access_token=[secret-redacted]');
    expect(persistedError?.message).toContain('[email redacted]');
    expect(persistedError?.message).not.toContain('user:pass');
    expect(persistedError?.message).not.toContain('secret-token');
    expect(persistedError?.message).not.toContain('ada@example.edu');

    // The stack is stored too, and every redaction the message gets applies to it.
    // This asserted the absence of a stack, which came in with the June 2026 bulk
    // rewrite rather than from a reasoned position, and cost #3891 its only frame.
    // A sanitized stack is a stronger guarantee than no stack (#3891).
    expect(persistedError?.stack).toBeTruthy();
    expect(persistedError?.stack).toContain('https://[credentials-redacted]@example.test');
    expect(persistedError?.stack).toContain('access_token=[secret-redacted]');
    expect(persistedError?.stack).toContain('[email redacted]');
    expect(persistedError?.stack).not.toContain('user:pass');
    expect(persistedError?.stack).not.toContain('secret-token');
    expect(persistedError?.stack).not.toContain('ada@example.edu');
  });

  it('sanitizes scraper log messages and metadata before console output', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const scraper: IScraper = {
      name: 'fixture-source',
      displayName: 'Fixture source',
      async run(ctx) {
        ctx.log('Fetch failed for https://user:pass@example.test?access_token=secret-token', {
          Authorization: 'Bearer source-access-token',
          cookie: 'session=abc123; Path=/; HttpOnly',
          contact: 'ada@example.edu',
        });
        return { observationCount: 0, entitiesObserved: 0 };
      },
    };
    const orchestrator = new ScraperOrchestrator();
    orchestrator.register(scraper);

    await orchestrator.run('fixture-source', {
      dryRun: false,
      dbReview: false,
      useCache: false,
      release: true,
    });

    const logged = consoleLog.mock.calls.flat().join(' ');
    expect(logged).toContain('https://[credentials-redacted]@example.test');
    expect(logged).toContain('access_token=[secret-redacted]');
    expect(logged).toContain('Authorization":"[secret-redacted]"');
    expect(logged).toContain('cookie":"[secret-redacted]"');
    expect(logged).toContain('[email redacted]');
    expect(logged).not.toContain('user:pass');
    expect(logged).not.toContain('secret-token');
    expect(logged).not.toContain('source-access-token');
    expect(logged).not.toContain('abc123');
    expect(logged).not.toContain('ada@example.edu');

    consoleLog.mockRestore();
  });
  describe('run lifecycle (#3595)', () => {
    const OPTIONS = { dryRun: false, dbReview: false, useCache: false, release: true };

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    function statusWrites(): string[] {
      return mocks.scrapeRunUpdateOne.mock.calls
        .map(([, update]) => (update as { $set?: { status?: string } }).$set?.status)
        .filter((status): status is string => typeof status === 'string');
    }

    it('opens a run with a heartbeat and the owning host, pid and lock owner', async () => {
      const orchestrator = new ScraperOrchestrator();
      orchestrator.register({
        name: 'fixture-source',
        displayName: 'Fixture source',
        run: async () => ({ observationCount: 0, entitiesObserved: 0 }),
      });

      await orchestrator.run('fixture-source', OPTIONS, { lockOwnerId: 'scrape-cli-run:host:1:x' });

      const created = mocks.scrapeRunCreate.mock.calls[0]?.[0];
      expect(created.status).toBe('running');
      expect(created.heartbeatAt).toEqual(created.startedAt);
      expect(created.owner).toEqual({
        host: expect.any(String),
        pid: process.pid,
        lockOwnerId: 'scrape-cli-run:host:1:x',
      });
    });

    it('heartbeats a long run and stops once the run is terminal', async () => {
      vi.useFakeTimers();
      let finish: () => void = () => undefined;
      const orchestrator = new ScraperOrchestrator({ runHeartbeatIntervalMs: 1_000 });
      orchestrator.register({
        name: 'fixture-source',
        displayName: 'Fixture source',
        run: () =>
          new Promise((resolve) => {
            finish = () => resolve({ observationCount: 0, entitiesObserved: 0 });
          }),
      });

      const running = orchestrator.run('fixture-source', OPTIONS);
      await vi.advanceTimersByTimeAsync(3_500);
      const beats = () =>
        mocks.scrapeRunUpdateOne.mock.calls.filter(
          ([filter, update]) =>
            (filter as { status?: string }).status === 'running' &&
            (update as { $set?: { heartbeatAt?: Date } }).$set?.heartbeatAt instanceof Date,
        ).length;
      expect(beats()).toBe(3);

      finish();
      await running;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(beats()).toBe(3);
      expect(statusWrites()).toEqual(['success']);
    });

    it('marks an interrupted run interrupted before the signal is re-raised', async () => {
      const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
      const listenersBefore = process.listeners('SIGTERM').length;
      const orchestrator = new ScraperOrchestrator();
      orchestrator.register({
        name: 'fixture-source',
        displayName: 'Fixture source',
        async run(ctx) {
          await ctx.emit({
            entityType: 'researchEntity',
            entityKey: 'fixture-lab',
            field: 'shortDescription',
            value: 'Fixture lab studies source-backed research.',
          });
          const handler = process.listeners('SIGTERM').at(-1) as () => void;
          handler();
          await new Promise((resolve) => setImmediate(resolve));
          return { observationCount: 1, entitiesObserved: 1 };
        },
      });

      await orchestrator.run('fixture-source', OPTIONS);

      const interruptedWrite = mocks.scrapeRunUpdateOne.mock.calls.find(
        ([, update]) => (update as { $set?: { status?: string } }).$set?.status === 'interrupted',
      );
      expect(interruptedWrite?.[0]).toEqual({ _id: 'run-1', status: 'running' });
      expect(interruptedWrite?.[1]).toMatchObject({
        $set: {
          status: 'interrupted',
          finishedAt: expect.any(Date),
          interruption: { reason: 'signal', signal: 'SIGTERM' },
        },
      });
      expect(statusWrites()).toEqual(['interrupted']);
      expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
      expect(process.listeners('SIGTERM').length).toBe(listenersBefore);
    });

    it('detaches its signal handlers when the run finishes normally', async () => {
      const listenersBefore = process.listeners('SIGINT').length;
      const orchestrator = new ScraperOrchestrator();
      orchestrator.register({
        name: 'fixture-source',
        displayName: 'Fixture source',
        async run() {
          expect(process.listeners('SIGINT').length).toBe(listenersBefore + 1);
          return { observationCount: 0, entitiesObserved: 0 };
        },
      });

      await orchestrator.run('fixture-source', OPTIONS);

      expect(process.listeners('SIGINT').length).toBe(listenersBefore);
    });

    it('keeps the scrape error when every failure write attempt fails', async () => {
      vi.useFakeTimers();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      mocks.scrapeRunUpdateOne.mockRejectedValue(new Error('write refused'));
      const orchestrator = new ScraperOrchestrator();
      orchestrator.register({
        name: 'fixture-source',
        displayName: 'Fixture source',
        async run() {
          throw new Error('the lane broke');
        },
      });

      const running = expect(orchestrator.run('fixture-source', OPTIONS)).rejects.toThrow(
        'the lane broke',
      );
      await vi.advanceTimersByTimeAsync(5_000);
      await running;
      expect(statusWrites()).toEqual(['failure', 'failure', 'failure']);
      const logged = consoleError.mock.calls.flat().join(' ');
      expect(logged).toContain('after 3 attempt(s)');
      expect(logged).toContain('write refused');
    });

    it('retries a failed failure write and still surfaces the scrape error', async () => {
      vi.useFakeTimers();
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      mocks.scrapeRunUpdateOne
        .mockRejectedValueOnce(new Error('transient DNS failure'))
        .mockResolvedValue({ modifiedCount: 1 });
      const orchestrator = new ScraperOrchestrator();
      orchestrator.register({
        name: 'fixture-source',
        displayName: 'Fixture source',
        async run() {
          throw new Error('the lane broke');
        },
      });

      const running = expect(orchestrator.run('fixture-source', OPTIONS)).rejects.toThrow(
        'the lane broke',
      );
      await vi.advanceTimersByTimeAsync(1_000);
      await running;
      expect(statusWrites()).toEqual(['failure', 'failure']);
    });

    it('records success when the terminal success write succeeds on a retry', async () => {
      vi.useFakeTimers();
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      mocks.scrapeRunUpdateOne
        .mockRejectedValueOnce(new Error('success write lost'))
        .mockResolvedValue({ modifiedCount: 1 });
      const orchestrator = new ScraperOrchestrator();
      orchestrator.register({
        name: 'fixture-source',
        displayName: 'Fixture source',
        run: async () => ({ observationCount: 0, entitiesObserved: 0 }),
      });

      const running = orchestrator.run('fixture-source', OPTIONS);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(running).resolves.toMatchObject({ runId: 'run-1' });
      expect(statusWrites()).toEqual(['success', 'success']);
    });

    it('never rewrites a successful scrape as a failure when its success write is exhausted', async () => {
      vi.useFakeTimers();
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mocks.scrapeRunUpdateOne.mockRejectedValue(new Error('success write lost'));
      const orchestrator = new ScraperOrchestrator();
      orchestrator.register({
        name: 'fixture-source',
        displayName: 'Fixture source',
        run: async () => ({ observationCount: 0, entitiesObserved: 0 }),
      });

      const running = expect(orchestrator.run('fixture-source', OPTIONS)).rejects.toThrow(
        ScrapeRunTerminalWriteError,
      );
      await vi.advanceTimersByTimeAsync(5_000);
      await running;
      expect(statusWrites()).toEqual(['success', 'success', 'success']);
      expect(consoleError.mock.calls.flat().join(' ')).toContain('stays running');
    });

    it('retries the interrupted write and re-raises the signal inside the cleanup budget', async () => {
      vi.useFakeTimers();
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
      let interruptedAttempts = 0;
      mocks.scrapeRunUpdateOne.mockImplementation((_filter: unknown, update: any) => {
        if (update.$set?.status !== 'interrupted') return Promise.resolve({ modifiedCount: 1 });
        interruptedAttempts += 1;
        return interruptedAttempts === 1
          ? Promise.reject(new Error('transient DNS failure'))
          : Promise.resolve({ modifiedCount: 1 });
      });
      let release: () => void = () => undefined;
      const orchestrator = new ScraperOrchestrator();
      orchestrator.register({
        name: 'fixture-source',
        displayName: 'Fixture source',
        run: () =>
          new Promise((resolve) => {
            release = () => resolve({ observationCount: 0, entitiesObserved: 0 });
          }),
      });

      const running = orchestrator.run('fixture-source', OPTIONS);
      await vi.advanceTimersByTimeAsync(0);
      (process.listeners('SIGTERM').at(-1) as () => void)();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(statusWrites()).toEqual(['interrupted', 'interrupted']);
      expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
      release();
      await running;
      expect(statusWrites()).toEqual(['interrupted', 'interrupted']);
    });

    it('gives up on a hung interrupted write before the cleanup budget runs out', async () => {
      vi.useFakeTimers();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
      mocks.scrapeRunUpdateOne.mockImplementation((_filter: unknown, update: any) =>
        update.$set?.status === 'interrupted'
          ? new Promise(() => undefined)
          : Promise.resolve({ modifiedCount: 1 }),
      );
      let release: () => void = () => undefined;
      const orchestrator = new ScraperOrchestrator();
      orchestrator.register({
        name: 'fixture-source',
        displayName: 'Fixture source',
        run: () =>
          new Promise((resolve) => {
            release = () => resolve({ observationCount: 0, entitiesObserved: 0 });
          }),
      });

      const running = orchestrator.run('fixture-source', OPTIONS);
      await vi.advanceTimersByTimeAsync(0);
      (process.listeners('SIGTERM').at(-1) as () => void)();
      await vi.advanceTimersByTimeAsync(SCRAPE_RUN_INTERRUPT_WRITE_DEADLINE_MS - 1);
      expect(kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
      expect(SCRAPE_RUN_INTERRUPT_WRITE_DEADLINE_MS).toBeLessThan(INTERRUPT_CLEANUP_TIMEOUT_MS);
      expect(consoleError.mock.calls.flat().join(' ')).toContain('interrupted status');
      release();
      await running;
    });
  });
});
