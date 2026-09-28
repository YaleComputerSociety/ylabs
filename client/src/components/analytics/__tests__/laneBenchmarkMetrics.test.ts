import { describe, expect, it } from 'vitest';
import { formatPointDelta, formatRate, goldRateDelta } from '../laneBenchmarkMetrics';

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
});
