import { describe, expect, it } from 'vitest';

import {
  buildResidentialCollegeGrantShortDescription,
  buildRichterFellowshipShortDescription,
  deriveResidentialCollegeName,
  deriveRichterFellowshipCollegeName,
  isResidentialCollegeGrantBoilerplateShortDescription,
  isRichterFellowshipFamilyDisplayName,
} from '../backfillResidentialCollegeGrantShortDescriptionsCore';

describe('backfillResidentialCollegeGrantShortDescriptionsCore (#1557)', () => {
  it('flags the shared "off-set ... senior essay" boilerplate', () => {
    expect(
      isResidentialCollegeGrantBoilerplateShortDescription(
        'To provide funding to off-set the costs associated with a senior research project or senior essay.',
      ),
    ).toBe(true);
  });

  it('flags the shared boilerplate through its offset/essay wording variant', () => {
    expect(
      isResidentialCollegeGrantBoilerplateShortDescription(
        'To provide funding to offset the costs associated with a senior research project or essay.',
      ),
    ).toBe(true);
  });

  it('does not flag a genuine distinguishing shortDescription', () => {
    expect(
      isResidentialCollegeGrantBoilerplateShortDescription(
        'Funds a senior research project or senior essay for Saybrook College students.',
      ),
    ).toBe(false);
  });

  it('does not flag a non-string value', () => {
    expect(isResidentialCollegeGrantBoilerplateShortDescription(undefined)).toBe(false);
  });

  it('derives the college name when displayName omits the "College" token', () => {
    expect(deriveResidentialCollegeName('Grace Hopper Mellon Senior Research Grant')).toBe(
      'Grace Hopper',
    );
  });

  it('derives the college name when displayName includes the "College" token', () => {
    expect(
      deriveResidentialCollegeName('Benjamin Franklin College Mellon Research Fellowship for Seniors'),
    ).toBe('Benjamin Franklin');
  });

  it('derives a single-word college name', () => {
    expect(deriveResidentialCollegeName('Saybrook College Mellon Senior Research Grant')).toBe(
      'Saybrook',
    );
  });

  it('returns empty for a displayName outside the family naming shape', () => {
    expect(deriveResidentialCollegeName('Leitner International Research and Internship Fellowship')).toBe(
      '',
    );
  });

  it('builds a distinguishing shortDescription naming the college', () => {
    expect(buildResidentialCollegeGrantShortDescription('Saybrook')).toBe(
      'Funds a senior research project or senior essay for Saybrook College students.',
    );
  });
});

describe('Richter Summer Fellowship family (#1557)', () => {
  it('recognizes a displayName with the "College" token and "Summer"', () => {
    expect(isRichterFellowshipFamilyDisplayName('Branford College Richter Summer Fellowship')).toBe(
      true,
    );
  });

  it('recognizes a displayName without the "College" token', () => {
    expect(isRichterFellowshipFamilyDisplayName('Ezra Stiles Richter Summer Fellowship')).toBe(true);
  });

  it('recognizes a displayName without "Summer"', () => {
    expect(isRichterFellowshipFamilyDisplayName('Benjamin Franklin College Richter Fellowship')).toBe(
      true,
    );
  });

  it('does not recognize an unrelated displayName', () => {
    expect(isRichterFellowshipFamilyDisplayName('Grace Hopper Mellon Senior Research Grant')).toBe(
      false,
    );
  });

  it('derives the college name from a Richter family displayName', () => {
    expect(deriveRichterFellowshipCollegeName('Berkeley College Richter Summer Fellowship')).toBe(
      'Berkeley',
    );
    expect(deriveRichterFellowshipCollegeName('Ezra Stiles Richter Summer Fellowship')).toBe(
      'Ezra Stiles',
    );
    expect(
      deriveRichterFellowshipCollegeName('Benjamin Franklin College Richter Fellowship'),
    ).toBe('Benjamin Franklin');
  });

  it('builds a distinguishing shortDescription naming the college', () => {
    expect(buildRichterFellowshipShortDescription('Berkeley')).toBe(
      'Funds a Richter Summer Fellowship for independent study and research by Berkeley College students.',
    );
  });
});
