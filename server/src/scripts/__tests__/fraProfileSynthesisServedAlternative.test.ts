import { describe, expect, it } from 'vitest';

import { wouldServeAsFullDescription } from '../fraProfileSynthesisLane';

const entity = {
  slug: 'faculty-research-area-fixture-scholar',
  name: 'Fixture Scholar Faculty Research',
  displayName: 'Fixture Scholar Faculty Research',
  entityType: 'FACULTY_RESEARCH_AREA',
  kind: 'individual',
  researchAreas: ['Imaging'],
} as const;

/**
 * A grafted organization description reads as useful research prose and passes the
 * quality bar, but the served-copy sanitizer strips it, so the student sees nothing.
 * Counting it as a better-sourced alternative made the graft self-perpetuating: it
 * blocked the only lane that could give the row its own description (#2721 class).
 */
describe('wouldServeAsFullDescription', () => {
  it('rejects an empty or non-string value', () => {
    expect(wouldServeAsFullDescription(entity, '')).toBe(false);
    expect(wouldServeAsFullDescription(entity, undefined)).toBe(false);
    expect(wouldServeAsFullDescription(entity, 42)).toBe(false);
  });

  it("accepts prose that describes this person's own research", () => {
    const value =
      'Fixture Scholar studies how ion mobility separates high molecular weight species, and develops calibration methods that make those measurements comparable across instruments.';
    expect(wouldServeAsFullDescription(entity, value)).toBe(true);
  });

  it('rejects a facility description grafted onto a person row', () => {
    const value =
      'Yale Translational Research Imaging Center was founded in 2010 to facilitate translational animal research. The facility centralizes imaging instrumentation and provides services to investigators across the university.';
    expect(wouldServeAsFullDescription(entity, value)).toBe(false);
  });

  it('rejects a school description grafted onto a person row', () => {
    const value =
      'Yale University Divinity School is a graduate professional school within a world-class research university and is both a rigorous academic institution and a community of faith.';
    expect(wouldServeAsFullDescription(entity, value)).toBe(false);
  });

  it('rejects a department-level programme blurb grafted onto a person row', () => {
    const value =
      'The department supports undergraduate research through paid research assistantships and summer research programs that provide training in econometric methods.';
    expect(wouldServeAsFullDescription(entity, value)).toBe(false);
  });
});
