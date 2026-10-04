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

  it('keeps a body whose lead is named before a titled collaborator', () => {
    for (const body of [
      "Robin Fixture's research with Professor Sample examines how coastal towns adapt to repeated flooding.",
      'The lab of Robin Fixture and Professor Sample studies how coastal towns adapt to repeated flooding.',
    ]) {
      expect(served(body, ['Robin Fixture'])).not.toBe('');
    }
  });

  it('does not let a one-letter surname prefix vouch for another titled person', () => {
    expect(
      served('Dr. O’Sample directs a survey of how coastal towns adapt to repeated flooding.', [
        "Robin O'Fixture",
      ]),
    ).toBe('');
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
