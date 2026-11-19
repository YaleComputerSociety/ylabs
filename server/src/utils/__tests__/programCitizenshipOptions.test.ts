import { describe, expect, it } from 'vitest';

import {
  NON_US_CITIZENS_ELIGIBLE as NON_US,
  US_CITIZENS_ELIGIBLE as US,
  US_PERMANENT_RESIDENTS_ELIGIBLE as PERMANENT_RESIDENTS,
} from '../../scrapers/utils/programCitizenship';
import { rowCarriesFilterValue } from '../../scripts/journeyEval/journeyEvalProgramCases';
import { programSatisfiesCitizenshipOption } from '../programCitizenshipOptions';

describe('which stated citizenship satisfies a citizenship option (#6092)', () => {
  it.each([
    ['the literal permanent-resident value', [US, PERMANENT_RESIDENTS], true],
    ['a program open to both U.S. and non-U.S. citizens', [US, NON_US], true],
    ['a program open to non-U.S. citizens only', [NON_US], false],
    ['a program open to U.S. citizens only', [US], false],
    ['a program that states nothing', [], false],
  ])('the permanent-resident option and %s', (_label, stated, expected) => {
    expect(programSatisfiesCitizenshipOption(stated, PERMANENT_RESIDENTS)).toBe(expected);
  });

  it('keeps the U.S. and non-U.S. options to their own stated value', () => {
    expect(programSatisfiesCitizenshipOption([US, PERMANENT_RESIDENTS], NON_US)).toBe(false);
    expect(programSatisfiesCitizenshipOption([NON_US], US)).toBe(false);
    expect(programSatisfiesCitizenshipOption([US, NON_US], US)).toBe(true);
    expect(programSatisfiesCitizenshipOption([US, NON_US], NON_US)).toBe(true);
  });

  it('lets the journey harness read a program open to both groups as carrying the option', () => {
    const openToBoth = { citizenshipStatus: [US, NON_US] };
    const nonUsOnly = { citizenshipStatus: [NON_US] };
    expect(rowCarriesFilterValue(openToBoth, 'citizenshipStatus', PERMANENT_RESIDENTS)).toBe(true);
    expect(rowCarriesFilterValue(nonUsOnly, 'citizenshipStatus', PERMANENT_RESIDENTS)).toBe(false);
  });
});
