import { describe, expect, it } from 'vitest';
import {
  assertRepairAccountLinkedResearcherDisplayNamesApplyAllowed,
  buildAccountLinkedResearcherDisplayNamePlan,
  composeResearcherDisplayName,
  parseRepairAccountLinkedResearcherDisplayNamesArgs,
  RESEARCHER_DISPLAY_NAME_MAX_LENGTH,
} from '../repairAccountLinkedResearcherDisplayNamesCore';

describe('repairAccountLinkedResearcherDisplayNamesCore', () => {
  it('defaults to a dry run and requires explicit apply confirmation', () => {
    expect(parseRepairAccountLinkedResearcherDisplayNamesArgs([])).toEqual({
      apply: false,
      confirmDisplayNameRepair: false,
    });
    expect(parseRepairAccountLinkedResearcherDisplayNamesArgs(['--apply'])).toMatchObject({
      apply: true,
      confirmDisplayNameRepair: false,
    });
    expect(() =>
      assertRepairAccountLinkedResearcherDisplayNamesApplyAllowed({
        apply: true,
        confirmDisplayNameRepair: false,
      }),
    ).toThrow(/--confirm-researcher-display-name-repair is required/);
    expect(() =>
      assertRepairAccountLinkedResearcherDisplayNamesApplyAllowed({
        apply: true,
        confirmDisplayNameRepair: true,
      }),
    ).not.toThrow();
  });

  it('rejects unknown arguments and a value on the confirmation flag', () => {
    expect(() => parseRepairAccountLinkedResearcherDisplayNamesArgs(['--nope'])).toThrow(
      /Unknown repair:researcher-display-names argument/,
    );
    expect(() =>
      parseRepairAccountLinkedResearcherDisplayNamesArgs([
        '--confirm-researcher-display-name-repair=yes',
      ]),
    ).toThrow(/does not accept a value/);
  });

  it('composes a canonical display name from legacy first and last names', () => {
    expect(
      composeResearcherDisplayName({ legacyFirstName: 'ADA', legacyLastName: 'LOVELACE' }),
    ).toBe('Ada Lovelace');
    expect(
      composeResearcherDisplayName({ legacyFirstName: '  Grace  ', legacyLastName: 'Hopper' }),
    ).toBe('Grace Hopper');
    expect(composeResearcherDisplayName({ legacyFirstName: 'Katherine' })).toBe('Katherine');
    expect(composeResearcherDisplayName({ legacyFirstName: '   ', legacyLastName: '' })).toBeUndefined();
    expect(composeResearcherDisplayName({})).toBeUndefined();
  });

  it('bounds the composed display name to the schema maximum length', () => {
    const longFirst = 'a'.repeat(300);
    const composed = composeResearcherDisplayName({ legacyFirstName: longFirst });
    expect(composed).toHaveLength(RESEARCHER_DISPLAY_NAME_MAX_LENGTH);
  });

  it('plans repairs for account-linked researchers with a legacy name and skips the rest', () => {
    const plan = buildAccountLinkedResearcherDisplayNamePlan([
      { researcherId: 'r1', netid: 'al123', legacyFirstName: 'Ada', legacyLastName: 'Lovelace' },
      { researcherId: 'r2', netid: '  ', legacyFirstName: 'Grace', legacyLastName: 'Hopper' },
      { researcherId: 'r3', netid: 'kj999' },
    ]);

    expect(plan.candidates).toBe(3);
    expect(plan.repairs).toEqual([
      { researcherId: 'r1', netid: 'al123', displayName: 'Ada Lovelace' },
    ]);
    expect(plan.skipped).toEqual([
      { researcherId: 'r2', reason: 'missing-account-netid' },
      { researcherId: 'r3', reason: 'no-legacy-name-source' },
    ]);
  });
});
