import { describe, expect, it } from 'vitest';
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
