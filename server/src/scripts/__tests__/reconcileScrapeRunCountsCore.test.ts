import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';

import {
  countCorrectionFor,
  needsCountCorrection,
  runRecordCountIsUnreliable,
  scrapeRunIdFilterValue,
  summarizeCountCorrections,
} from '../reconcileScrapeRunCountsCore';

const STALE_MS = 15 * 60 * 1000;
const NOW = new Date('2026-11-13T22:00:00Z').getTime();
const run = (facts: Record<string, unknown>) => ({
  _id: new mongoose.Types.ObjectId(),
  sourceName: 'dept-faculty-roster',
  startedAt: new Date(NOW - 60 * 60 * 1000),
  ...facts,
});

describe('a crashed run record cannot be trusted about what it wrote (#6269)', () => {
  it('distrusts an interrupted or failed record', () => {
    expect(runRecordCountIsUnreliable(run({ status: 'interrupted' }), NOW, STALE_MS)).toBe(true);
    expect(runRecordCountIsUnreliable(run({ status: 'failure' }), NOW, STALE_MS)).toBe(true);
  });

  it('distrusts a running record whose heartbeat went stale or never beat', () => {
    expect(
      runRecordCountIsUnreliable(
        run({ status: 'running', heartbeatAt: new Date(NOW - 30 * 60 * 1000) }),
        NOW,
        STALE_MS,
      ),
    ).toBe(true);
    expect(runRecordCountIsUnreliable(run({ status: 'running' }), NOW, STALE_MS)).toBe(true);
  });

  it('trusts a successful record and a running one still beating', () => {
    expect(runRecordCountIsUnreliable(run({ status: 'success' }), NOW, STALE_MS)).toBe(false);
    expect(
      runRecordCountIsUnreliable(
        run({ status: 'running', heartbeatAt: new Date(NOW - 60 * 1000) }),
        NOW,
        STALE_MS,
      ),
    ).toBe(false);
  });
});

describe('matching observations by scrapeRunId (#6269)', () => {
  it('casts a string run id, because a string match finds no observation at all', () => {
    const id = new mongoose.Types.ObjectId();
    expect(scrapeRunIdFilterValue(id.toString())).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(String(scrapeRunIdFilterValue(id.toString()))).toBe(id.toString());
    expect(scrapeRunIdFilterValue(id)).toBe(id);
  });

  it('refuses a value that is no run id rather than matching everything', () => {
    expect(scrapeRunIdFilterValue('not-an-id')).toBeNull();
    expect(scrapeRunIdFilterValue(undefined)).toBeNull();
  });
});

describe('which recounts correct the record (#6269)', () => {
  it('corrects a record claiming nothing, and one claiming less than it wrote', () => {
    expect(needsCountCorrection(0, 65237)).toBe(true);
    expect(needsCountCorrection(null, 2784)).toBe(true);
    expect(needsCountCorrection(105262, 105285)).toBe(true);
  });

  it('leaves a record that already matches, and one claiming more than remains', () => {
    expect(needsCountCorrection(5713, 5713)).toBe(false);
    expect(needsCountCorrection(4000, 100)).toBe(false);
  });

  it('never corrects from a recount of zero, which says nothing was written', () => {
    expect(needsCountCorrection(0, 0)).toBe(false);
    expect(needsCountCorrection(null, 0)).toBe(false);
  });

  it('records the run facts an operator needs to judge the correction', () => {
    const correction = countCorrectionFor(
      run({ status: 'interrupted', observationCount: 0, options: { dryRun: false, only: [] } }),
      65237,
    );
    expect(correction).toMatchObject({
      startedAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
      heartbeatAt: null,
      finishedAt: null,
      sourceName: 'dept-faculty-roster',
      status: 'interrupted',
      apply: true,
      scoped: false,
      reportedObservations: 0,
      actualObservations: 65237,
    });
  });

  it('separates a record claiming nothing from one merely behind', () => {
    const corrections = [
      countCorrectionFor(run({ status: 'interrupted', observationCount: 0 }), 65237),
      countCorrectionFor(run({ status: 'interrupted' }), 2784),
      countCorrectionFor(run({ status: 'failure', observationCount: 105262 }), 105285),
    ];
    expect(summarizeCountCorrections(corrections)).toEqual({
      falseGreens: 2,
      underReported: 1,
      observationsUnaccountedFor: 65237 + 2784 + 23,
    });
  });
});
