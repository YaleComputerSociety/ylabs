import { describe, expect, it } from 'vitest';
import { withoutGluedLeadingHeading } from '../gluedLeadingHeading';
import { sanitizeObservationField } from '../../scrapers/observationFieldSanitizer';

describe('withoutGluedLeadingHeading (#4660)', () => {
  it('drops a section heading glued onto a first-person opening sentence', () => {
    expect(
      withoutGluedLeadingHeading(
        'Flexible function of example circuits Our goal is to understand how example circuits adapt.',
      ),
    ).toBe('Our goal is to understand how example circuits adapt.');
  });

  it('drops a lab-name heading glued onto a titled name', () => {
    expect(
      withoutGluedLeadingHeading(
        'The Fixture Lab Dr Fixture’s research is focused on chronic example disease.',
      ),
    ).toBe('Dr Fixture’s research is focused on chronic example disease.');
  });

  it('strips a doubled heading run in one pass, so a second pass changes nothing', () => {
    const once = withoutGluedLeadingHeading(
      'Example Statement of Purpose Our Mission Our mission is to promote example research.',
    );
    expect(once).toBe('Our mission is to promote example research.');
    expect(withoutGluedLeadingHeading(once)).toBe(once);
  });

  it('leaves prose whose capitalised pronoun continues the sentence', () => {
    for (const text of [
      'Students and We the faculty study example systems together.',
      'In this group, We study example systems.',
      'The example author is known for the novel O My Example, set in a fictional town.',
      'Home / About Us / Who We Are / Example Person is a lecturer.',
      'This lab is where We study example systems.',
      'Our lab studies example systems.',
    ]) {
      expect(withoutGluedLeadingHeading(text)).toBe(text);
    }
  });

  it('is applied to description observations at ingest and on rematerialize', () => {
    const sanitized = sanitizeObservationField(
      'researchEntity',
      'shortDescription',
      'Example regulation of signalling We use model organisms to study signalling.',
    );
    expect(sanitized.value).toBe('We use model organisms to study signalling.');
  });
});
