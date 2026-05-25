import { describe, expect, it } from 'vitest';
import { isRepairableFundingOnlyShell } from '../repairFundingOnlyResearchEntitiesCore';

describe('repairFundingOnlyResearchEntitiesCore', () => {
  it('treats grant-url-only mismatched PI rows as repairable funding shells', () => {
    expect(
      isRepairableFundingOnlyShell({
        slug: 'nih-pi-juan-lopez-giraldez',
        sourceUrls: [
          'https://reporter.nih.gov/project-details/11175329',
          'https://reporter.nih.gov/project-details/10900474',
        ],
        websiteUrl: '',
        profileSynthesisDescription: '',
        descriptionSource: '',
        departments: ['Genetics'],
      }),
    ).toBe(true);
  });

  it('does not treat Yale-backed funding rows as repairable shells', () => {
    expect(
      isRepairableFundingOnlyShell({
        slug: 'nih-pi-hang-zhou',
        sourceUrls: [
          'https://reporter.nih.gov/project-details/11207285',
          'https://medicine.yale.edu/lab/hang-zhou/',
        ],
        websiteUrl: 'https://medicine.yale.edu/lab/hang-zhou/',
        departments: ['Biomedical Engineering'],
      }),
    ).toBe(false);
  });
});
