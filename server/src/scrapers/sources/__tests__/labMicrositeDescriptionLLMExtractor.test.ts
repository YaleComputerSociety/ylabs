import { describe, it, expect } from 'vitest';
import { isRejectedDescriptionSourceUrl } from '../labMicrositeDescriptionLLMExtractor';

describe('isRejectedDescriptionSourceUrl', () => {
  it('rejects the YSM A–Z index landing page so its boilerplate is never a lab description', () => {
    expect(
      isRejectedDescriptionSourceUrl('https://medicine.yale.edu/about/a-to-z-index/lab-websites/'),
    ).toBe(true);
    expect(
      isRejectedDescriptionSourceUrl(
        'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/',
      ),
    ).toBe(true);
  });

  it('accepts a genuine per-lab microsite page', () => {
    expect(isRejectedDescriptionSourceUrl('https://medicine.yale.edu/lab/chupp/')).toBe(false);
    expect(isRejectedDescriptionSourceUrl('https://zimmermanlab.yale.edu/')).toBe(false);
  });

  it('still rejects directory and non-descriptive source pages', () => {
    expect(isRejectedDescriptionSourceUrl('https://medicine.yale.edu/people/')).toBe(true);
    expect(isRejectedDescriptionSourceUrl('https://reporter.nih.gov/project-details/123')).toBe(true);
    expect(isRejectedDescriptionSourceUrl('not-a-url')).toBe(true);
  });

  it('rejects a department-wide undergrad research opportunities hub page (#1716)', () => {
    expect(
      isRejectedDescriptionSourceUrl(
        'https://mcdb.yale.edu/undergraduate/undergraduate-research-opportunities',
      ),
    ).toBe(true);
    expect(
      isRejectedDescriptionSourceUrl('https://mcdb.yale.edu/undergraduate/undergrad-degree-programs'),
    ).toBe(true);
  });
});
