import { describe, expect, it } from 'vitest';
import {
  NON_US_CITIZENS_ELIGIBLE,
  programCitizenshipStatement,
  US_CITIZENS_ELIGIBLE,
  US_PERMANENT_RESIDENTS_ELIGIBLE,
} from '../programCitizenship';

describe('programCitizenshipStatement (#5129)', () => {
  it.each([
    'US citizenship [or permanent residency] is required.',
    'Applicants must be U.S. citizens or permanent resident aliens.',
    'Eligible are US citizens, permanent residents (Green Card holders), or US nationals.',
    'Applicants must be enrolled in college and be a US citizen or permanent resident.',
    'Applicants must be U.S. citizens or U.S. Permanent Residents.',
  ])('reads a restriction that admits permanent residents: %s', (text) => {
    expect(programCitizenshipStatement([text])).toEqual({
      kind: 'us-only',
      values: [US_CITIZENS_ELIGIBLE, US_PERMANENT_RESIDENTS_ELIGIBLE],
    });
  });

  it.each([
    'This fellowship is open only to US citizens.',
    'Applicants must be citizens of the United States.',
    'All first years, sophomores and juniors who are U.S. citizens are eligible to apply.',
    'Students eligible to apply: Must be a U.S. citizen.',
    'Applicants must be U.S. Citizens.',
    'Proof of U.S. citizenship is required at the time of award.',
  ])('reads a restriction to U.S. citizens: %s', (text) => {
    expect(programCitizenshipStatement([text])).toEqual({
      kind: 'us-only',
      values: [US_CITIZENS_ELIGIBLE],
    });
  });

  it.each([
    'Candidates may apply without regard to nationality or citizenship status.',
    'There are no citizenship requirements.',
    'U.S. citizens and students of any nationality currently studying in a U.S. college or university.',
    'Stipends will be provided to US citizens, permanent residents, and international students with qualifying visas.',
    'US and non-US citizens are eligible to apply.',
  ])('reads a program open to every nationality: %s', (text) => {
    expect(programCitizenshipStatement([text])).toEqual({
      kind: 'open',
      values: [US_CITIZENS_ELIGIBLE, NON_US_CITIZENS_ELIGIBLE],
    });
  });

  it('reads a program that excludes U.S. citizens as open to non-U.S. citizens only', () => {
    expect(
      programCitizenshipStatement([
        'The fellowship is intended for Yale international undergraduate students only. U.S. citizens and U.S. Permanent Residents are ineligible for this fellowship.',
      ]),
    ).toEqual({ kind: 'non-us-only', values: [NON_US_CITIZENS_ELIGIBLE] });
  });

  it('reads an exclusion of U.S. citizens that names U.S. permanent residents in the same clause', () => {
    expect(
      programCitizenshipStatement([
        'U.S. citizens and U.S. Permanent Residents are ineligible for this fellowship.',
      ]),
    ).toEqual({ kind: 'non-us-only', values: [NON_US_CITIZENS_ELIGIBLE] });
  });

  it.each([
    'Preference for applicants who are U.S. citizens whose studies have demonstrated an interest in the region.',
    'In general, applications from international students proposing research projects in their country of origin are ineligible.',
    'International student applicants should inform the Office of International Students and Scholars of their plans.',
    'Submit a budget and a one-page statement.',
    'You do not need to be a U.S. citizen to apply.',
    'Applicants do not need to be U.S. citizens.',
    'An applicant does not have to be a U.S. citizen.',
    'International students must provide proof of citizenship and a valid visa.',
    'Students who are U.S. citizens apply through FAFSA; others apply directly.',
    'U.S. citizens are eligible, but international students are not eligible.',
  ])('states nothing for a preference, a condition on one group, or silence: %s', (text) => {
    expect(programCitizenshipStatement([text])).toBeUndefined();
  });

  it('states nothing when one page both restricts and opens', () => {
    expect(
      programCitizenshipStatement([
        'Applicants must be U.S. citizens.',
        'There are no citizenship requirements.',
      ]),
    ).toBeUndefined();
  });

  it('judges each sentence alone, so permanent residents in another sentence are not admitted', () => {
    expect(
      programCitizenshipStatement([
        'Applicants must be U.S. citizens. Permanent residents should contact the office first.',
      ]),
    ).toEqual({ kind: 'us-only', values: [US_CITIZENS_ELIGIBLE] });
  });
});
