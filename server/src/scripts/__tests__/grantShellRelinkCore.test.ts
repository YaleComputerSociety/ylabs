import { describe, expect, it } from 'vitest';
import {
  classifyDisposition,
  isApplyable,
  tallyDispositions,
  type Disposition,
} from '../grantShellRelinkCore';

describe('classifyDisposition', () => {
  it('returns still-ambiguous when the matcher cannot disambiguate the PI', () => {
    expect(
      classifyDisposition({ matched: 'ambiguous', canonicalPersonId: null, activeLeadPersonIds: [] }),
    ).toBe('still-ambiguous');
  });

  it('returns still-unmatched when no user matches', () => {
    expect(
      classifyDisposition({ matched: null, canonicalPersonId: null, activeLeadPersonIds: [] }),
    ).toBe('still-unmatched');
  });

  it('returns newly-linked only when the shell has no active lead at all', () => {
    expect(
      classifyDisposition({ matched: 'user-1', canonicalPersonId: 'person-1', activeLeadPersonIds: [] }),
    ).toBe('newly-linked');
  });

  it('returns already-linked when an active lead exists under the canonical personId', () => {
    expect(
      classifyDisposition({
        matched: 'user-1',
        canonicalPersonId: 'person-1',
        activeLeadPersonIds: ['person-1'],
      }),
    ).toBe('already-linked');
  });

  it('returns personid-divergent when an active lead exists under a different personId', () => {
    expect(
      classifyDisposition({
        matched: 'user-1',
        canonicalPersonId: 'person-canonical',
        activeLeadPersonIds: ['person-divergent'],
      }),
    ).toBe('personid-divergent');
  });

  it('treats a resolved canonical lead as already-linked even when divergent leads coexist', () => {
    expect(
      classifyDisposition({
        matched: 'user-1',
        canonicalPersonId: 'person-canonical',
        activeLeadPersonIds: ['person-divergent', 'person-canonical'],
      }),
    ).toBe('already-linked');
  });

  it('does not re-link when the canonical researcher is unresolved but a lead already exists', () => {
    expect(
      classifyDisposition({
        matched: 'user-1',
        canonicalPersonId: null,
        activeLeadPersonIds: ['person-divergent'],
      }),
    ).toBe('personid-divergent');
  });

  it('does not classify a matched shell as newly-linked when a same-person lead is already current', () => {
    const disposition = classifyDisposition({
      matched: 'user-1',
      canonicalPersonId: 'person-1',
      activeLeadPersonIds: ['person-1'],
    });
    expect(isApplyable(disposition)).toBe(false);
  });
});

describe('isApplyable', () => {
  it('only newly-linked shells are materialized', () => {
    expect(isApplyable('newly-linked')).toBe(true);
    expect(isApplyable('personid-divergent')).toBe(false);
    expect(isApplyable('already-linked')).toBe(false);
    expect(isApplyable('still-ambiguous')).toBe(false);
    expect(isApplyable('still-unmatched')).toBe(false);
  });
});

describe('tallyDispositions', () => {
  it('counts every disposition and zero-fills absent ones', () => {
    const dispositions: Disposition[] = [
      'newly-linked',
      'newly-linked',
      'personid-divergent',
      'already-linked',
      'still-unmatched',
    ];
    expect(tallyDispositions(dispositions)).toEqual({
      'newly-linked': 2,
      'already-linked': 1,
      'personid-divergent': 1,
      'still-ambiguous': 0,
      'still-unmatched': 1,
    });
  });

  it('returns an all-zero tally for an empty plan set', () => {
    expect(tallyDispositions([])).toEqual({
      'newly-linked': 0,
      'already-linked': 0,
      'personid-divergent': 0,
      'still-ambiguous': 0,
      'still-unmatched': 0,
    });
  });
});
