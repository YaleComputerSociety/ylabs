import { format } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { MongoNetworkError } from 'mongodb';
import { retryTransientDatabaseWrite } from '../../scrapers/utils/databaseWriteRetry';
import { ScrapeRunStalledError } from '../../scrapers/scrapeRunProgress';
import {
  SCRAPER_SWEEP_DEADLINE_ENV,
  decideSweepSourceRetry,
  remainingSweepBudgetMs,
  type SweepSourceFailure,
} from '../sweepSourceRetry';

const TRANSIENT_TAIL =
  'MongoBulkWriteError: Error determining if update will go over space quota: Error computing current atlas size: internal atlas error';
const HOUR = 60 * 60 * 1000;

const childExit = (overrides: Partial<SweepSourceFailure> = {}): SweepSourceFailure => ({
  kind: 'child-exit',
  exitCode: 1,
  failureText: TRANSIENT_TAIL,
  ...overrides,
});

describe('decideSweepSourceRetry', () => {
  it('never re-runs a stalled child, even though its log carries the outage that hung it (#5086)', () => {
    const stall = new ScrapeRunStalledError({
      sourceName: 'fixture-source',
      lastProgressAt: new Date('2026-10-15T08:00:00Z'),
      detectedAt: new Date('2026-10-15T08:21:00Z'),
      stallWindowMs: 20 * 60 * 1000,
    });
    const failureText = [
      'Failed to heartbeat the ScrapeRun for fixture-source: MongoServerSelectionError: getaddrinfo ENOTFOUND',
      `${stall.name}: ${stall.message}`,
    ].join('\n');

    const decision = decideSweepSourceRetry({
      attempt: 1,
      failure: childExit({ failureText }),
      attemptDurationMs: HOUR,
      remainingBudgetMs: 5 * HOUR,
    });

    expect(decision).toEqual({
      retry: false,
      reason: expect.stringContaining('stalled'),
    });
  });

  it('re-runs a transient database failure once when the budget covers another attempt', () => {
    expect(
      decideSweepSourceRetry({
        attempt: 1,
        failure: childExit(),
        attemptDurationMs: 2 * HOUR,
        remainingBudgetMs: 5 * HOUR,
      }),
    ).toEqual({ retry: true });
    expect(
      decideSweepSourceRetry({
        attempt: 2,
        failure: childExit(),
        attemptDurationMs: 2 * HOUR,
        remainingBudgetMs: 5 * HOUR,
      }).retry,
    ).toBe(false);
  });

  it('never re-runs a deterministic failure', () => {
    const base = { attempt: 1, attemptDurationMs: HOUR, remainingBudgetMs: 10 * HOUR };
    for (const failure of [
      childExit({ failureText: 'TypeError: cannot read properties of undefined' }),
      childExit({ failureText: undefined }),
      childExit({ kind: 'artifact-contract' }),
      childExit({ kind: 'missing-artifact' }),
      childExit({ timedOut: true }),
      childExit({ signal: 'SIGKILL' }),
      childExit({ spawnError: true }),
      childExit({ failureText: 'MongoServerError: you are over your space quota' }),
    ]) {
      expect(decideSweepSourceRetry({ ...base, failure }).retry).toBe(false);
    }
  });

  it('does not re-run a crash whose tail only carries a database blip the write layer absorbed', async () => {
    const logged: string[] = [];
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation((...args: unknown[]) => void logged.push(format(...args)));
    try {
      let calls = 0;
      await retryTransientDatabaseWrite(
        async () => {
          calls += 1;
          if (calls === 1) throw new MongoNetworkError('internal atlas error');
          return 'ok';
        },
        { label: 'observation insert', backoffMs: [0], sleep: async () => undefined },
      );
    } finally {
      warn.mockRestore();
    }
    expect(logged.join('\n')).toMatch(/internal atlas error/);
    const failureText = [
      ...logged,
      "TypeError: Cannot read properties of undefined (reading 'name')",
      '    at resolveLane (lane.ts:12:3)',
    ].join('\n');
    expect(
      decideSweepSourceRetry({
        attempt: 1,
        failure: childExit({ failureText }),
        attemptDurationMs: HOUR,
        remainingBudgetMs: 10 * HOUR,
      }).retry,
    ).toBe(false);
  });

  it('does not re-run when the remaining run limit cannot cover another attempt', () => {
    const decision = decideSweepSourceRetry({
      attempt: 1,
      failure: childExit(),
      attemptDurationMs: 3 * HOUR,
      remainingBudgetMs: 2 * HOUR,
    });
    expect(decision.retry).toBe(false);
    expect(decision.retry === false && decision.reason).toContain('run limit');
  });

  it('re-runs a hand-run sweep that has no deadline', () => {
    expect(
      decideSweepSourceRetry({
        attempt: 1,
        failure: childExit(),
        attemptDurationMs: 3 * HOUR,
        remainingBudgetMs: undefined,
      }).retry,
    ).toBe(true);
  });
});

describe('remainingSweepBudgetMs', () => {
  it('reads the deadline the weekly wrapper passes down', () => {
    const now = Date.parse('2026-10-16T10:00:00.000Z');
    expect(
      remainingSweepBudgetMs({ [SCRAPER_SWEEP_DEADLINE_ENV]: '2026-10-16T15:00:00.000Z' }, now),
    ).toBe(5 * HOUR);
    expect(remainingSweepBudgetMs({}, now)).toBeUndefined();
    expect(
      remainingSweepBudgetMs({ [SCRAPER_SWEEP_DEADLINE_ENV]: 'not a date' }, now),
    ).toBeUndefined();
  });
});
