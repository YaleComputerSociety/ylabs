import { describe, expect, it } from 'vitest';
import {
  planStrandedFundingUnion,
  unionKeepsEveryCanonicalGrant,
} from '../unionStrandedMergeFundingCore';
import {
  assertUnionStrandedMergeFundingApplyAllowed,
  parseUnionStrandedMergeFundingArgs,
} from '../unionStrandedMergeFunding';

const grant = (id: string, startDate = '2024-01-01') => ({
  id,
  agency: 'NIH',
  title: `Award ${id}`,
  startDate,
});

describe('planStrandedFundingUnion', () => {
  it('carries an award the survivor does not hold', () => {
    const plan = planStrandedFundingUnion({ recentGrants: [], fundingAgencies: [] }, [
      { recentGrants: [grant('R01-1')], fundingAgencies: ['NIH'] },
    ]);
    expect(plan).toMatchObject({ addedGrants: 1, addedAgencies: 1, recentGrantCount: 1 });
    expect(plan?.fundingAgencies).toEqual(['NIH']);
  });

  it('plans nothing when the survivor already holds every award and agency', () => {
    expect(
      planStrandedFundingUnion({ recentGrants: [grant('R01-1')], fundingAgencies: ['NIH'] }, [
        { recentGrants: [grant('R01-1')], fundingAgencies: ['nih'] },
      ]),
    ).toBeNull();
  });

  it('plans nothing when no duplicate points at the survivor', () => {
    expect(planStrandedFundingUnion({ recentGrants: [grant('R01-1')] }, [])).toBeNull();
  });

  it('keeps the survivor own awards alongside the carried ones', () => {
    const plan = planStrandedFundingUnion({ recentGrants: [grant('OWN-1')] }, [
      { recentGrants: [grant('DUP-1')] },
    ]);
    expect(plan?.recentGrants).toHaveLength(2);
    expect(unionKeepsEveryCanonicalGrant({ recentGrants: [grant('OWN-1')] }, plan!)).toBe(true);
  });

  it('counts the union rather than summing stored counts, so a second pass is a no-op', () => {
    const canonical = { recentGrants: [] as unknown[], recentGrantCount: 4, fundingAgencies: [] };
    const duplicates = [{ recentGrants: [grant('R01-1')], recentGrantCount: 9 }];
    const first = planStrandedFundingUnion(canonical, duplicates);
    expect(first?.recentGrantCount).toBe(1);
    const repaired = {
      recentGrants: first!.recentGrants,
      recentGrantCount: first!.recentGrantCount,
      fundingAgencies: first!.fundingAgencies,
    };
    expect(planStrandedFundingUnion(repaired, duplicates)).toBeNull();
  });

  it('refuses a union that would drop an award the survivor already serves', () => {
    const canonicalGrants = Array.from({ length: 4 }, (_, index) =>
      grant(`OWN-${index}`, '2010-01-01'),
    );
    const duplicateGrants = Array.from({ length: 10 }, (_, index) =>
      grant(`DUP-${index}`, '2025-01-01'),
    );
    const canonical = { recentGrants: canonicalGrants };
    const plan = planStrandedFundingUnion(canonical, [{ recentGrants: duplicateGrants }]);
    expect(plan).not.toBeNull();
    expect(unionKeepsEveryCanonicalGrant(canonical, plan!)).toBe(false);
  });
});

describe('union-stranded-merge-funding apply guard', () => {
  it('refuses an apply without its confirmation flag', () => {
    expect(() =>
      assertUnionStrandedMergeFundingApplyAllowed({
        apply: true,
        confirm: false,
        plannedCanonicals: 1,
        maxApply: 400,
      }),
    ).toThrow(/--confirm-union-stranded-merge-funding/);
  });

  it('refuses an apply wider than its budget', () => {
    expect(() =>
      assertUnionStrandedMergeFundingApplyAllowed({
        apply: true,
        confirm: true,
        plannedCanonicals: 401,
        maxApply: 400,
      }),
    ).toThrow(/above --max-apply/);
  });

  it('never gates a dry-run', () => {
    expect(() =>
      assertUnionStrandedMergeFundingApplyAllowed({
        apply: false,
        confirm: false,
        plannedCanonicals: 99999,
        maxApply: 1,
      }),
    ).not.toThrow();
  });
});

describe('parseUnionStrandedMergeFundingArgs', () => {
  it('defaults to a dry-run', () => {
    expect(parseUnionStrandedMergeFundingArgs([])).toMatchObject({ apply: false, confirm: false });
  });

  it('refuses an argument it does not recognise rather than ignoring it', () => {
    expect(() => parseUnionStrandedMergeFundingArgs(['--confirm'])).toThrow(/Unknown/);
  });
});
