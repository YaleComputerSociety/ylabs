import { describe, expect, it } from 'vitest';

import { effectiveObservationCount } from '../effectiveObservationCount';

describe('effectiveObservationCount (#6291)', () => {
  it('reads the reconciled count when the run recorded fewer writes than it made', () => {
    expect(
      effectiveObservationCount({ observationCount: 0, storedObservationCountAtReconcile: 65237 }),
    ).toBe(65237);
  });

  it('never reads lower than the run claimed, because the stored count is only a floor', () => {
    expect(
      effectiveObservationCount({ observationCount: 400, storedObservationCountAtReconcile: 12 }),
    ).toBe(400);
  });

  it('reads the run claim when nothing was reconciled', () => {
    expect(effectiveObservationCount({ observationCount: 5713 })).toBe(5713);
  });

  it('reads zero for a missing run or unusable values', () => {
    expect(effectiveObservationCount(null)).toBe(0);
    expect(effectiveObservationCount(undefined)).toBe(0);
    expect(
      effectiveObservationCount({
        observationCount: Number.NaN,
        storedObservationCountAtReconcile: -3,
      }),
    ).toBe(0);
  });
});
