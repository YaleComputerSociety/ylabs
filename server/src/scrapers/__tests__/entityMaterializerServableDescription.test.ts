import { describe, expect, it } from 'vitest';

import { sanitizeServedResearchEntityCopyFields } from '../../utils/researchEntityDescriptionText';

const personRow = {
  slug: 'faculty-research-area-fixture-scholar',
  name: 'Fixture Scholar Faculty Research',
  displayName: 'Fixture Scholar Faculty Research',
  entityType: 'FACULTY_RESEARCH_AREA',
  kind: 'individual',
  researchAreas: ['Imaging'],
};

const FACILITY_GRAFT =
  'Yale Translational Research Imaging Center was founded in 2010 to facilitate translational animal research. The facility centralizes imaging instrumentation and provides services to investigators across the university.';
const PERSON_RESEARCH =
  'Fixture Scholar studies how ion mobility separates high molecular weight species, and develops calibration methods that make those measurements comparable across instruments.';

const serves = (value: string): boolean => {
  const out = sanitizeServedResearchEntityCopyFields({ ...personRow, fullDescription: value });
  return String((out as { fullDescription?: unknown }).fullDescription ?? '').trim().length > 0;
};

/**
 * Pins the premise the materializer's servable-description fall-through depends on.
 * If the sanitizer ever started serving an organization graft on a person row, the
 * fall-through would silently stop firing and the rows would go back to serving
 * nothing, with no test failing.
 */
describe('servable-description premise', () => {
  it('does not serve an affiliated organization description on a person row', () => {
    expect(serves(FACILITY_GRAFT)).toBe(false);
  });

  it("serves the person's own research description", () => {
    expect(serves(PERSON_RESEARCH)).toBe(true);
  });

  it('treats an empty value as unservable rather than throwing', () => {
    expect(serves('')).toBe(false);
  });
});
