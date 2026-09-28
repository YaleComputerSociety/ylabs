import { describe, expect, it } from 'vitest';
import {
  formatCountDelta,
  formatPointDelta,
  formatRate,
  goldRateDelta,
  knownWrongRateDelta,
  pagesMissedDelta,
} from '../laneBenchmarkMetrics';
import type { LaneBenchmarkRun } from '../laneBenchmarkTypes';

const gold = (precision: number | null, recall: number | null) => [
  {
    field: 'undergradEvidenceQuote',
    labeled: 37,
    truePositive: 9,
    falsePositive: 0,
    falseNegative: 2,
    trueNegative: 26,
    precision,
    recall,
  },
];

describe('lane benchmark metrics', () => {
  it('reports the change in a gold rate in percentage points', () => {
    expect(
      goldRateDelta('undergradEvidenceQuote', 'precision', gold(1, 0.82), gold(0.875, 0.64)),
    ).toBe(12.5);
    expect(formatPointDelta(12.5)).toBe('+12.5 pts');
    expect(formatPointDelta(-3)).toBe('-3.0 pts');
  });

  it('has no change when either side had no rate, rather than reading it as flat', () => {
    expect(goldRateDelta('undergradEvidenceQuote', 'precision', gold(1, 1), undefined)).toBeNull();
    expect(
      goldRateDelta('undergradEvidenceQuote', 'precision', gold(1, 1), gold(null, 1)),
    ).toBeNull();
    expect(formatRate(null)).toBe('n/a');
  });

  it('compares known wrong over its labeled population and pages missed with the previous replay', () => {
    const run = (knownWrong: number, labeledEntityEmitted: number, pagesMissed: number) =>
      ({
        measuredAt: null,
        codeSha: 'aaa',
        pagesServed: 10,
        pagesMissed,
        emitted: 10,
        knownWrong,
        labeledEntityEmitted,
        outputFingerprint: 'fp',
        gold: [],
      }) satisfies LaneBenchmarkRun;
    expect(knownWrongRateDelta(run(1, 10, 0), run(2, 10, 0))).toBe(-10);
    expect(knownWrongRateDelta(run(1, 10, 0), run(0, 0, 0))).toBeNull();
    expect(knownWrongRateDelta(run(1, 10, 0), null)).toBeNull();
    expect(pagesMissedDelta(run(0, 0, 3), run(0, 0, 1))).toBe(2);
    expect(pagesMissedDelta(run(0, 0, 3), null)).toBeNull();
    expect(formatCountDelta(2)).toBe('+2');
    expect(formatCountDelta(-1)).toBe('-1');
  });
});
