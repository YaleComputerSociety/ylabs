import { describe, expect, it } from 'vitest';
import {
  BARREN_RUN_STREAK_FAILURE_THRESHOLD,
  barrenRunStreak,
  classifyRunYield,
  resolveBarrenStreakFailure,
  sourceIsExpectedToYield,
  workPlannerSkippedEveryTarget,
  type RunYieldFacts,
} from '../sourceYieldGuard';

const enabledSource = { enabled: true, coverage: { tier: 'THIRD_PARTY_ENRICHMENT' } };
const barrenRun: RunYieldFacts = { status: 'success', observationCount: 0 };
const productiveRun: RunYieldFacts = { status: 'success', observationCount: 4 };

function barrenRuns(count: number): RunYieldFacts[] {
  return Array.from({ length: count }, () => ({ ...barrenRun }));
}

describe('classifyRunYield', () => {
  it('calls a completed run that emitted nothing barren', () => {
    expect(classifyRunYield(barrenRun)).toBe('barren');
  });

  it('calls a run that emitted something productive', () => {
    expect(classifyRunYield(productiveRun)).toBe('productive');
  });

  it('does not require recorded fetch metrics, because the dead lanes record none', () => {
    expect(classifyRunYield({ status: 'success', observationCount: 0, metrics: undefined })).toBe(
      'barren',
    );
  });

  it('treats a still-running or invalidated run as inconclusive', () => {
    expect(classifyRunYield({ status: 'running', observationCount: 0 })).toBe('inconclusive');
    expect(classifyRunYield({ status: 'success', observationCount: 9, invalidated: true })).toBe(
      'inconclusive',
    );
  });

  it('treats an entity-scoped run as inconclusive, since its silence is about those entities', () => {
    expect(
      classifyRunYield({ status: 'success', observationCount: 0, options: { only: ['one-lab'] } }),
    ).toBe('inconclusive');
  });

  it('treats a run whose work planner skipped every target as inconclusive', () => {
    expect(
      classifyRunYield({
        status: 'success',
        observationCount: 0,
        metrics: {
          workPlanner: {
            planned: 6,
            fetched: 0,
            skippedFresh: 6,
            skippedManualLock: 0,
            skippedNoIdentifier: 0,
          },
        },
      }),
    ).toBe('inconclusive');
  });
});

describe('workPlannerSkippedEveryTarget', () => {
  it('is false when the planner fetched anything, and false with no planner at all', () => {
    expect(workPlannerSkippedEveryTarget(undefined)).toBe(false);
    expect(
      workPlannerSkippedEveryTarget({
        workPlanner: {
          planned: 4,
          fetched: 1,
          skippedFresh: 3,
          skippedManualLock: 0,
          skippedNoIdentifier: 0,
        },
      }),
    ).toBe(false);
  });
});

describe('barrenRunStreak', () => {
  it('stops counting at the newest productive run', () => {
    expect(barrenRunStreak([...barrenRuns(2), productiveRun, ...barrenRuns(5)])).toBe(2);
  });

  it('steps over an inconclusive run instead of letting it break the streak', () => {
    expect(
      barrenRunStreak([
        barrenRun,
        { status: 'running', observationCount: 0 },
        barrenRun,
        productiveRun,
      ]),
    ).toBe(2);
  });
});

describe('sourceIsExpectedToYield', () => {
  it('exempts a disabled source and a manual-override channel', () => {
    expect(sourceIsExpectedToYield({ enabled: false, coverage: { tier: 'OFFICIAL_INDEX' } })).toBe(
      false,
    );
    expect(sourceIsExpectedToYield({ enabled: true, coverage: { tier: 'MANUAL_OVERRIDE' } })).toBe(
      false,
    );
    expect(sourceIsExpectedToYield(enabledSource)).toBe(true);
  });
});

describe('resolveBarrenStreakFailure', () => {
  it('fails the run once the barren streak reaches the threshold', () => {
    const failure = resolveBarrenStreakFailure({
      sourceName: 'fixture-funding-lane',
      source: enabledSource,
      currentRun: barrenRun,
      priorRunsNewestFirst: barrenRuns(BARREN_RUN_STREAK_FAILURE_THRESHOLD - 1),
    });

    expect(failure?.barrenRunStreak).toBe(BARREN_RUN_STREAK_FAILURE_THRESHOLD);
    expect(failure?.message).toContain('fixture-funding-lane');
    expect(failure?.message).toContain('zero observations');
  });

  it('leaves a shorter streak alone, because one quiet run can be legitimate', () => {
    expect(
      resolveBarrenStreakFailure({
        sourceName: 'fixture-funding-lane',
        source: enabledSource,
        currentRun: barrenRun,
        priorRunsNewestFirst: barrenRuns(BARREN_RUN_STREAK_FAILURE_THRESHOLD - 2),
      }),
    ).toBeUndefined();
  });

  it('never fails a run that emitted observations, however barren its history', () => {
    expect(
      resolveBarrenStreakFailure({
        sourceName: 'fixture-funding-lane',
        source: enabledSource,
        currentRun: productiveRun,
        priorRunsNewestFirst: barrenRuns(10),
      }),
    ).toBeUndefined();
  });

  it('never fails a source with no yield expectation', () => {
    expect(
      resolveBarrenStreakFailure({
        sourceName: 'fixture-manual-channel',
        source: { enabled: true, coverage: { tier: 'MANUAL_OVERRIDE' } },
        priorRunsNewestFirst: barrenRuns(10),
        currentRun: barrenRun,
      }),
    ).toBeUndefined();
  });
});
