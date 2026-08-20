import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_ZERO_LEAD_RATIO,
  DEFAULT_MIN_LEAD_REQUIRING_ENTITIES,
  evaluateRosterLeadResolution,
} from '../rosterLeadResolutionGuard';

describe('evaluateRosterLeadResolution', () => {
  it('flags the empty-roster state where nearly every lead-requiring entity resolves zero leads', () => {
    const result = evaluateRosterLeadResolution({
      resolvedLeadEntityCount: 0,
      zeroLeadEntityCount: 2588,
    });

    expect(result.leadRequiringEntityCount).toBe(2588);
    expect(result.zeroLeadRatio).toBe(1);
    expect(result.enforced).toBe(true);
    expect(result.safe).toBe(false);
    expect(result.blocker).toContain('resolve zero leads');
    expect(result.blocker).toContain('populate canonical Researcher');
  });

  it('treats a healthy corpus with a small missing-lead tail as safe', () => {
    const result = evaluateRosterLeadResolution({
      resolvedLeadEntityCount: 2384,
      zeroLeadEntityCount: 134,
    });

    expect(result.leadRequiringEntityCount).toBe(2518);
    expect(result.zeroLeadRatio).toBeCloseTo(134 / 2518, 5);
    expect(result.safe).toBe(true);
    expect(result.blocker).toBeUndefined();
  });

  it('does not enforce below the minimum lead-requiring population', () => {
    const result = evaluateRosterLeadResolution({
      resolvedLeadEntityCount: 0,
      zeroLeadEntityCount: DEFAULT_MIN_LEAD_REQUIRING_ENTITIES - 1,
    });

    expect(result.enforced).toBe(false);
    expect(result.safe).toBe(true);
    expect(result.blocker).toBeUndefined();
  });

  it('treats the ratio ceiling as inclusive-safe and just above it as unsafe', () => {
    const atCeiling = evaluateRosterLeadResolution({
      resolvedLeadEntityCount: 10,
      zeroLeadEntityCount: 90,
      maxZeroLeadRatio: 0.9,
    });
    expect(atCeiling.zeroLeadRatio).toBe(0.9);
    expect(atCeiling.safe).toBe(true);

    const aboveCeiling = evaluateRosterLeadResolution({
      resolvedLeadEntityCount: 9,
      zeroLeadEntityCount: 91,
      maxZeroLeadRatio: 0.9,
    });
    expect(aboveCeiling.zeroLeadRatio).toBeGreaterThan(0.9);
    expect(aboveCeiling.safe).toBe(false);
  });

  it('is a no-op when there are no lead-requiring entities', () => {
    const result = evaluateRosterLeadResolution({
      resolvedLeadEntityCount: 0,
      zeroLeadEntityCount: 0,
    });

    expect(result.leadRequiringEntityCount).toBe(0);
    expect(result.zeroLeadRatio).toBe(0);
    expect(result.enforced).toBe(false);
    expect(result.safe).toBe(true);
  });

  it('exposes the resolved thresholds and defaults', () => {
    const result = evaluateRosterLeadResolution({
      resolvedLeadEntityCount: 1,
      zeroLeadEntityCount: 1,
    });
    expect(result.maxZeroLeadRatio).toBe(DEFAULT_MAX_ZERO_LEAD_RATIO);
    expect(result.minLeadRequiringEntities).toBe(DEFAULT_MIN_LEAD_REQUIRING_ENTITIES);
  });

  it('rejects invalid counts and thresholds', () => {
    expect(() =>
      evaluateRosterLeadResolution({ resolvedLeadEntityCount: -1, zeroLeadEntityCount: 0 }),
    ).toThrow(/resolvedLeadEntityCount/);
    expect(() =>
      evaluateRosterLeadResolution({ resolvedLeadEntityCount: 0, zeroLeadEntityCount: 1.5 }),
    ).toThrow(/zeroLeadEntityCount/);
    expect(() =>
      evaluateRosterLeadResolution({
        resolvedLeadEntityCount: 0,
        zeroLeadEntityCount: 0,
        maxZeroLeadRatio: 1.5,
      }),
    ).toThrow(/maxZeroLeadRatio/);
    expect(() =>
      evaluateRosterLeadResolution({
        resolvedLeadEntityCount: 0,
        zeroLeadEntityCount: 0,
        minLeadRequiringEntities: -3,
      }),
    ).toThrow(/minLeadRequiringEntities/);
  });
});
