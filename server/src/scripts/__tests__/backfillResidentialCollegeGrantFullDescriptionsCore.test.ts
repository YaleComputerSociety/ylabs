import { describe, expect, it } from 'vitest';

import {
  buildResidentialCollegeGrantFullDescription,
  buildRichterFellowshipFullDescription,
  deriveResidentialCollegeName,
  deriveRichterFellowshipCollegeName,
  isResidentialCollegeGrantBoilerplateFullDescription,
  isRichterFellowshipFamilyDisplayName,
} from '../backfillResidentialCollegeGrantFullDescriptionsCore';

describe('backfillResidentialCollegeGrantFullDescriptionsCore (#1557 reopened)', () => {
  it('flags the shared Mellon funding-mechanics boilerplate', () => {
    expect(
      isResidentialCollegeGrantBoilerplateFullDescription(
        'To provide funding to off-set the costs associated with a senior research project or senior essay. For funding research which must take place during the academic year and awardees must present the result of their research either to the Senior Mellon Forum or another educational forum in the college by April.',
      ),
    ).toBe(true);
  });

  it('flags the boilerplate through its offset/essay wording variant', () => {
    expect(
      isResidentialCollegeGrantBoilerplateFullDescription(
        'To provide funding to offset the costs associated with a senior research project or essay. For funding, research must take place during the academic year, and awardees must present the result of their research either to the Senior Mellon Forum or another educational forum in the college by April.',
      ),
    ).toBe(true);
  });

  it('flags the boilerplate regardless of the trailing deadline clause wording', () => {
    expect(
      isResidentialCollegeGrantBoilerplateFullDescription(
        'To provide funding to off-set the costs associated with a senior research project or senior essay. For funding research which must take place during the academic year and awardees must present the result of their research either to the Senior Mellon Forum or another educational forum in the college by March 29, 2026.',
      ),
    ).toBe(true);
  });

  it('does not flag a genuine distinguishing fullDescription', () => {
    expect(
      isResidentialCollegeGrantBoilerplateFullDescription(
        'The Saybrook College Mellon Senior Research Grant funds a senior research project or senior essay for Saybrook College students.',
      ),
    ).toBe(false);
  });

  it('does not flag a non-string value', () => {
    expect(isResidentialCollegeGrantBoilerplateFullDescription(undefined)).toBe(false);
  });

  it('derives the college name (re-exported from the shortDescription core)', () => {
    expect(deriveResidentialCollegeName('Grace Hopper Mellon Senior Research Grant')).toBe(
      'Grace Hopper',
    );
  });

  it('builds a distinguishing fullDescription naming the college and stating the eligibility gate', () => {
    const result = buildResidentialCollegeGrantFullDescription('Saybrook');
    expect(result).toContain('Saybrook College students');
    expect(result).toContain('Only Saybrook College students are eligible');
    expect(result).not.toContain('off-set the costs associated with a senior research project or senior essay.');
  });

  it('never restates an exact program title, since family members carry different official titles', () => {
    const result = buildResidentialCollegeGrantFullDescription('Benjamin Franklin');
    expect(result).not.toContain('Mellon Senior Research Grant');
  });

  it('produces a distinct fullDescription per college', () => {
    expect(buildResidentialCollegeGrantFullDescription('Saybrook')).not.toBe(
      buildResidentialCollegeGrantFullDescription('Morse'),
    );
  });
});

describe('Richter Summer Fellowship family fullDescription (#1557 reopened)', () => {
  it('recognizes the family by displayName, mirroring the shortDescription fix', () => {
    expect(isRichterFellowshipFamilyDisplayName('Branford College Richter Summer Fellowship')).toBe(
      true,
    );
  });

  it('derives the college name (re-exported from the shortDescription core)', () => {
    expect(deriveRichterFellowshipCollegeName('Berkeley College Richter Summer Fellowship')).toBe(
      'Berkeley',
    );
  });

  it('builds a distinguishing fullDescription naming the college, retaining the award mechanics facts', () => {
    const result = buildRichterFellowshipFullDescription('Berkeley');
    expect(result).toContain('Richter Summer Fellowship');
    expect(result).toContain('Berkeley College students');
    expect(result).toContain('$1,500');
    expect(result).toContain('Head of Berkeley College');
    expect(result).toContain('Only Berkeley College students are eligible');
  });

  it('never restates an exact program title, since one family member is named "Richter Fellowship" without "Summer"', () => {
    const result = buildRichterFellowshipFullDescription('Benjamin Franklin');
    expect(result).not.toContain('Benjamin Franklin College Richter Summer Fellowship');
  });

  it('produces a distinct fullDescription per college', () => {
    expect(buildRichterFellowshipFullDescription('Berkeley')).not.toBe(
      buildRichterFellowshipFullDescription('Morse'),
    );
  });
});
