import { describe, expect, it } from 'vitest';
import {
  planPersonNameRepair,
  summarizePersonNameRefusals,
  summarizePersonNameShapes,
} from '../repairPersonNameNoiseCore';

describe('planPersonNameRepair', () => {
  it('rewrites each noisy shape to the name underneath it', () => {
    const plan = planPersonNameRepair([
      { id: 'a', displayName: 'Photo of Ada Byron.' },
      { id: 'b', displayName: 'Ada Byron, PhD, MPH, FACE' },
      { id: 'c', displayName: 'ADA BYRON' },
      { id: 'd', displayName: 'Ada Lovelace f.k.a. Byron' },
    ]);
    expect(plan.rewrite.map((row) => [row.id, row.to])).toEqual([
      ['a', 'Ada Byron'],
      ['b', 'Ada Byron'],
      ['c', 'Ada Byron'],
      ['d', 'Ada Lovelace'],
    ]);
    expect(summarizePersonNameShapes(plan.rewrite)).toEqual({
      'caption-wrapper': 1,
      'credential-list': 1,
      'shouty-casing': 1,
      'former-name-annotation': 1,
    });
  });

  it('refuses a value that is an identifier instead of blanking the name', () => {
    const plan = planPersonNameRepair([
      { id: 'a', displayName: 'byron_ada' },
      { id: 'b', displayName: 'ada.byron' },
    ]);
    expect(plan.rewrite).toEqual([]);
    expect(summarizePersonNameRefusals(plan.refused)).toEqual({
      'already-clean': 0,
      'not-a-name': 2,
      'would-empty-the-name': 0,
    });
  });

  it('leaves a clean name and a legitimate suffix alone', () => {
    const plan = planPersonNameRepair([
      { id: 'a', displayName: 'Ada Byron' },
      { id: 'b', displayName: 'Ada Byron Jr.' },
      { id: 'c', displayName: "Gail D'Onofrio" },
      { id: 'd', displayName: 'Juan Fernandez de la Mora' },
      { id: 'e', displayName: 'Byron, Ada' },
    ]);
    expect(plan.rewrite).toEqual([]);
    expect(summarizePersonNameRefusals(plan.refused)['already-clean']).toBe(5);
  });
});
