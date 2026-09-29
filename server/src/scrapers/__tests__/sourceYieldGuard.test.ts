import { describe, expect, it } from 'vitest';
import {
  BARREN_RUN_STREAK_FAILURE_THRESHOLD,
  barrenRunStreak,
  barrenUnitStreak,
  classifyRunYield,
  classifyUnitYield,
  resolveBarrenStreakFailure,
  resolveBarrenUnitStreakFailures,
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
    expect(classifyRunYield({ status: 'interrupted', observationCount: 0 })).toBe('inconclusive');
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

const THRESHOLD = BARREN_RUN_STREAK_FAILURE_THRESHOLD;

function unitRun(unitYields: Record<string, number>, overrides: Partial<RunYieldFacts> = {}) {
  return {
    status: 'success',
    // The whole point of the per-unit arm: the source total stays healthy, so the
    // per-source check sees nothing wrong (#3876).
    observationCount: 431,
    metrics: { unitYields },
    ...overrides,
  } as RunYieldFacts;
}

describe('classifyUnitYield', () => {
  it('calls a unit that yielded nothing barren and one that yielded productive', () => {
    const run = unitRun({ dead: 0, alive: 120 });
    expect(classifyUnitYield(run, 'dead')).toBe('barren');
    expect(classifyUnitYield(run, 'alive')).toBe('productive');
  });

  it('calls a unit the run never reported inconclusive, never barren', () => {
    expect(classifyUnitYield(unitRun({ alive: 120 }), 'dead')).toBe('inconclusive');
    expect(classifyUnitYield({ status: 'success', observationCount: 431 }, 'dead')).toBe(
      'inconclusive',
    );
  });

  it('calls every unit of an inconclusive run inconclusive', () => {
    expect(classifyUnitYield(unitRun({ dead: 0 }, { invalidated: true }), 'dead')).toBe(
      'inconclusive',
    );
    expect(classifyUnitYield(unitRun({ dead: 0 }, { status: 'interrupted' }), 'dead')).toBe(
      'inconclusive',
    );
    expect(classifyUnitYield(unitRun({ dead: 0 }, { options: { only: ['alive'] } }), 'dead')).toBe(
      'inconclusive',
    );
  });
});

describe('barrenUnitStreak', () => {
  it('counts consecutive barren runs for one unit and stops at its own productive run', () => {
    const runs = [
      unitRun({ dead: 0 }),
      unitRun({ dead: 0 }),
      unitRun({ dead: 7 }),
      unitRun({ dead: 0 }),
    ];
    expect(barrenUnitStreak(runs, 'dead')).toBe(2);
  });

  it('counts a unit separately from the lane and from its siblings', () => {
    const runs = [unitRun({ dead: 0, alive: 120 }), unitRun({ dead: 0, alive: 118 })];
    expect(barrenUnitStreak(runs, 'dead')).toBe(2);
    expect(barrenUnitStreak(runs, 'alive')).toBe(0);
  });

  it('steps over an inconclusive run without resetting or counting it', () => {
    const runs = [
      unitRun({ dead: 0 }),
      unitRun({ dead: 0 }, { invalidated: true }),
      unitRun({ dead: 0 }),
    ];
    expect(barrenUnitStreak(runs, 'dead')).toBe(2);
  });
});

describe('resolveBarrenUnitStreakFailures', () => {
  const args = (currentRun: RunYieldFacts, priorRunsNewestFirst: RunYieldFacts[]) => ({
    sourceName: 'fixture-track-lane',
    source: enabledSource,
    currentRun,
    priorRunsNewestFirst,
  });

  it('fails a unit at the threshold even though the lane itself is productive', () => {
    const failures = resolveBarrenUnitStreakFailures(
      args(
        unitRun({ dead: 0, alive: 120 }),
        Array.from({ length: THRESHOLD - 1 }, () => unitRun({ dead: 0, alive: 118 })),
      ),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].barrenRunStreak).toBe(THRESHOLD);
    expect(failures[0].message).toContain('"dead"');
    expect(failures[0].message).not.toContain('"alive"');
  });

  it('is silent one run short of the threshold', () => {
    expect(
      resolveBarrenUnitStreakFailures(
        args(
          unitRun({ dead: 0 }),
          Array.from({ length: THRESHOLD - 2 }, () => unitRun({ dead: 0 })),
        ),
      ),
    ).toEqual([]);
  });

  it('reports one failure per dead unit', () => {
    const failures = resolveBarrenUnitStreakFailures(
      args(
        unitRun({ deadA: 0, deadB: 0, alive: 12 }),
        Array.from({ length: THRESHOLD - 1 }, () => unitRun({ deadA: 0, deadB: 0, alive: 12 })),
      ),
    );
    expect(failures.map((failure) => failure.barrenRunStreak)).toEqual([THRESHOLD, THRESHOLD]);
    expect(failures[0].message).toContain('"deadA"');
    expect(failures[1].message).toContain('"deadB"');
  });

  it('cannot fire on history it does not have, so a lane that has only just started reporting is silent', () => {
    expect(
      resolveBarrenUnitStreakFailures(
        args(unitRun({ dead: 0 }), [
          { status: 'success', observationCount: 431 },
          { status: 'success', observationCount: 420 },
          { status: 'success', observationCount: 430 },
        ]),
      ),
    ).toEqual([]);
  });

  it('is silent for a lane that reports no unit counts at all', () => {
    expect(
      resolveBarrenUnitStreakFailures(
        args({ status: 'success', observationCount: 0 }, barrenRuns(10)),
      ),
    ).toEqual([]);
  });

  it('never fails a source with no yield expectation', () => {
    expect(
      resolveBarrenUnitStreakFailures({
        sourceName: 'fixture-manual-channel',
        source: { enabled: true, coverage: { tier: 'MANUAL_OVERRIDE' } },
        currentRun: unitRun({ dead: 0 }),
        priorRunsNewestFirst: Array.from({ length: 10 }, () => unitRun({ dead: 0 })),
      }),
    ).toEqual([]);
  });
});
