import { describe, expect, it } from 'vitest';

import { sanitizeResearchEntityPublicDescriptionFields } from '../researchEntityDescriptionText';

const served = (fullDescription: string, leadMemberNames: string[], extra = {}) =>
  sanitizeResearchEntityPublicDescriptionFields(
    {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      name: 'Robin Fixture Faculty Research',
      fullDescription,
      ...extra,
    },
    leadMemberNames,
  ).fullDescription;

describe('a body whose opening subject is another titled person', () => {
  it('is withheld from a person-scoped row whose lead it does not name', () => {
    expect(
      served(
        'Example Professor of Religious Studies Professor Sample directs the documentation of a fifth-century church near an example town. Professor Fixture collaborates on the project.',
        ['Robin Fixture'],
      ),
    ).toBe('');
  });

  it('keeps a body whose titled subject is the lead, including possessive and glued forms', () => {
    for (const body of [
      "Professor Fixture's research examines how coastal towns adapt to repeated flooding.",
      "Dr. Fixture's' research focuses on how coastal towns adapt to repeated flooding.",
      'Dr. Fixture’sarchival research centers on how coastal towns adapt to repeated flooding.',
    ]) {
      expect(served(body, ['Robin Fixture'])).not.toBe('');
    }
  });

  it('keeps a body naming a lead by one part of a compound or apostrophe surname', () => {
    expect(
      served('Dr. Sample-Fixture studies how coastal towns adapt to repeated flooding.', [
        'Robin Fixture',
      ]),
    ).not.toBe('');
    expect(
      served('Dr. O’Fixture studies how coastal towns adapt to repeated flooding.', [
        "Robin O'Fixture",
      ]),
    ).not.toBe('');
  });

  it('does not judge an organization, whose page names its staff in subject position', () => {
    expect(
      served(
        'Dr. Sample is an expert in quantitative analysis of experimental density maps and runs consultations for the facility.',
        ['Robin Fixture'],
        { entityType: 'CORE_FACILITY', kind: 'core', name: 'Example Structure Core' },
      ),
    ).not.toBe('');
  });
});
