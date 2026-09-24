import { describe, expect, it } from 'vitest';
import {
  assertNotACompleteRestatement,
  COMPLETE_RESTATEMENT_FIELDS,
  planUnbackedFundingRevocation,
} from '../unionStrandedMergeFundingCore';
import {
  assertUnionStrandedMergeFundingApplyAllowed,
  parseUnionStrandedMergeFundingArgs,
  RELINK_STRANDED_OBSERVATIONS_FLAG,
} from '../unionStrandedMergeFunding';

describe('union-stranded-merge-funding apply guard', () => {
  it('refuses an apply without its confirmation flag', () => {
    expect(() =>
      assertUnionStrandedMergeFundingApplyAllowed({
        apply: true,
        confirm: false,
        plannedRows: 1,
        maxApply: 400,
      }),
    ).toThrow(/--confirm-union-stranded-merge-funding/);
  });

  it('refuses an apply wider than its budget', () => {
    expect(() =>
      assertUnionStrandedMergeFundingApplyAllowed({
        apply: true,
        confirm: true,
        plannedRows: 401,
        maxApply: 400,
      }),
    ).toThrow(/above --max-apply/);
  });

  it('never gates a dry-run', () => {
    expect(() =>
      assertUnionStrandedMergeFundingApplyAllowed({
        apply: false,
        confirm: false,
        plannedRows: 99999,
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

describe('the stranded-observation relink arm', () => {
  it('re-keys observations only on a named opt-in flag, never by default (#3145)', () => {
    expect(RELINK_STRANDED_OBSERVATIONS_FLAG).toBe('--relink-stranded-observations');
    expect(parseUnionStrandedMergeFundingArgs([]).relinkStrandedObservations).toBe(false);
    expect(parseUnionStrandedMergeFundingArgs(['--apply']).relinkStrandedObservations).toBe(false);
    expect(
      parseUnionStrandedMergeFundingArgs(['--apply', RELINK_STRANDED_OBSERVATIONS_FLAG])
        .relinkStrandedObservations,
    ).toBe(true);
  });

  it('rejects a flag that only looks like the opt-in, so it cannot be set by accident', () => {
    expect(() => parseUnionStrandedMergeFundingArgs(['--relink-observations'])).toThrow();
    expect(() => parseUnionStrandedMergeFundingArgs(['--relink-stranded'])).toThrow();
  });
});

describe('a complete-restatement field may not be unioned (#3242)', () => {
  it('names the three funding fields and refuses each by name', () => {
    expect([...COMPLETE_RESTATEMENT_FIELDS]).toEqual([
      'recentGrants',
      'recentGrantCount',
      'fundingAgencies',
    ]);
    for (const field of COMPLETE_RESTATEMENT_FIELDS) {
      expect(() => assertNotACompleteRestatement(field)).toThrow(/complete restatement/);
    }
  });

  it('permits a field that is genuinely a set', () => {
    expect(() => assertNotACompleteRestatement('sourceUrls')).not.toThrow();
    expect(() => assertNotACompleteRestatement('departments')).not.toThrow();
  });
});

describe('planUnbackedFundingRevocation', () => {
  const award = (id: string, agency = 'NIH') => ({ id, agency, title: `Award ${id}` });

  it('drops an award no live observation asserts, and the agency it was the last of', () => {
    const plan = planUnbackedFundingRevocation(
      {
        recentGrants: [award('KEPT-1', 'NIH'), award('WITHDRAWN-1', 'NSF')],
        recentGrantCount: 2,
        fundingAgencies: ['NIH', 'NSF'],
      },
      new Set(['kept-1']),
    );
    expect(plan).not.toBeNull();
    expect(plan!.revokedAwards).toBe(1);
    expect(plan!.recentGrantCount).toBe(1);
    expect(plan!.fundingAgencies).toEqual(['NIH']);
  });

  it('keeps an agency another surviving award still names', () => {
    const plan = planUnbackedFundingRevocation(
      {
        recentGrants: [award('KEPT-1', 'NIH'), award('WITHDRAWN-1', 'NIH')],
        recentGrantCount: 2,
        fundingAgencies: ['NIH'],
      },
      new Set(['kept-1']),
    );
    expect(plan!.fundingAgencies).toEqual(['NIH']);
  });

  it('returns null when every stored award is observed, so a clean row is never rewritten', () => {
    expect(
      planUnbackedFundingRevocation(
        { recentGrants: [award('A'), award('B')], recentGrantCount: 2, fundingAgencies: ['NIH'] },
        new Set(['a', 'b']),
      ),
    ).toBeNull();
    expect(
      planUnbackedFundingRevocation({ recentGrants: [], fundingAgencies: [] }, new Set()),
    ).toBeNull();
  });

  it('revokes every award when the row has no funding observation at all', () => {
    const plan = planUnbackedFundingRevocation(
      { recentGrants: [award('A'), award('B')], recentGrantCount: 2, fundingAgencies: ['NIH'] },
      new Set(),
    );
    expect(plan!.revokedAwards).toBe(2);
    expect(plan!.recentGrants).toEqual([]);
    expect(plan!.fundingAgencies).toEqual([]);
  });
});
