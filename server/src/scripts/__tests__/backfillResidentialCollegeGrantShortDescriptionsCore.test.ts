import { describe, expect, it } from 'vitest';

import {
  buildResidentialCollegeGrantShortDescription,
  deriveResidentialCollegeName,
  isResidentialCollegeGrantBoilerplateShortDescription,
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
