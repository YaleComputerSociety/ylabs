import { describe, expect, it } from 'vitest';
import { WEEKLY_SWEEP_RUN_COLLECTION, WeeklySweepRun } from '../weeklySweepRun';
import {
  buildWeeklySweepRunRecord,
  buildWeeklySweepRunStartRecord,
} from '../../scripts/weeklyDevelopmentSweepCore';
import { NEVER_COPY_COLLECTIONS } from '../../scripts/mirrorCollectionPolicy';
import { sweepSummaryFixture } from '../../scripts/__tests__/fixtures/weeklySweepSummaryFixture';

const record = () =>
  buildWeeklySweepRunRecord({
    startedAt: new Date('2026-10-04T07:00:00Z'),
    finishedAt: new Date('2026-10-04T15:00:00Z'),
    databaseName: 'Development',
    codeSha: 'abc123',
    exitCode: 0,
    requestedModes: ['development-full', 'fellowship-development-full'],
    preflight: { ok: true, heldLockSources: [], snapshotCacheDropped: false },
    outcomes: [
      { mode: 'development-full', exitCode: 0, summaryFound: true, summary: sweepSummaryFixture() },
      { mode: 'fellowship-development-full', exitCode: 1, summaryFound: false },
    ],
    corpusSnapshot: { status: 'written', exitCode: 0 },
  });

describe('WeeklySweepRun', () => {
  it('accepts the record the weekly job builds and keeps its per-source rows queryable', () => {
    const run = new WeeklySweepRun(record());
    expect(run.validateSync()).toBeUndefined();
    expect(run.sources.map((source) => source.sourceName)).toEqual(['source-a', 'source-b']);
    expect(run.stages[0]?.durationMs).toBe(900_000);
  });

  it('accepts the row a job inserts as it starts, before any outcome exists', () => {
    const run = new WeeklySweepRun(
      buildWeeklySweepRunStartRecord({
        startedAt: new Date('2026-10-04T07:00:00Z'),
        databaseName: 'Development',
        codeSha: 'abc123',
        requestedModes: ['fellowship-development-full'],
      }),
    );
    expect(run.validateSync()).toBeUndefined();
    expect(run.status).toBe('running');
    expect([...run.requestedModes]).toEqual(['fellowship-development-full']);
  });

  it('refuses a finished row that is missing its end time and outcome', () => {
    const error = new WeeklySweepRun({
      ...record(),
      finishedAt: undefined,
      durationMs: undefined,
      exitCode: undefined,
    }).validateSync();
    expect(Object.keys(error?.errors ?? {})).toEqual(
      expect.arrayContaining(['finishedAt', 'durationMs', 'exitCode']),
    );
  });

  it('indexes runs by start time for the newest-first read', () => {
    expect(WeeklySweepRun.schema.indexes()).toContainEqual([{ startedAt: -1 }, expect.anything()]);
  });

  it('refuses a status outside the stored vocabulary', () => {
    const error = new WeeklySweepRun({ ...record(), status: 'partial' }).validateSync();
    expect(error?.errors.status).toBeDefined();
  });

  it('stays environment-local so a promotion cannot erase or misdate the history', () => {
    expect(WeeklySweepRun.collection.collectionName).toBe(WEEKLY_SWEEP_RUN_COLLECTION);
    expect(NEVER_COPY_COLLECTIONS).toContain(WEEKLY_SWEEP_RUN_COLLECTION);
  });
});
