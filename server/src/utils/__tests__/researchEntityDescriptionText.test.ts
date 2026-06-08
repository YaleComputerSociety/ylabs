import { describe, expect, it } from 'vitest';

import {
  publicResearchEntityDescriptionText,
  sanitizeFacultyResearchEntityText,
  sanitizeResearchEntityPublicDescriptionFields,
} from '../researchEntityDescriptionText';

describe('publicResearchEntityDescriptionText', () => {
  it('suppresses scraped sentence fragments that should not display as descriptions', () => {
    expect(
      publicResearchEntityDescriptionText(
        'focuses in identifying ecological thresholds beyond which global changes cause abrupt ecosystem degradation.',
      ),
    ).toBe('');
    expect(
      publicResearchEntityDescriptionText(
        'of post-colonialism, South Asian cultural studies, mobility and modernity.',
      ),
    ).toBe('');
    expect(
      publicResearchEntityDescriptionText(
        'is in experimental particle physics: The energy frontier at the Large Hadron Collider.',
      ),
    ).toBe('');
  });

  it('suppresses incomplete source snippets that end mid-name or mid-title', () => {
    expect(
      publicResearchEntityDescriptionText(
        'A Comment on descriptive statistics by Isaiah Andrews, Matthew Gentzkow, and Jesse M.',
      ),
    ).toBe('');
    expect(
      publicResearchEntityDescriptionText(
        'Two primary projects use MRI images in collaboration with Dr.',
      ),
    ).toBe('');
  });

  it('suppresses copied profile contact chrome', () => {
    expect(
      publicResearchEntityDescriptionText(
        'eduHQ 323203-432-4669 Zareena Grewal is a historical anthropologist.',
      ),
    ).toBe('');
  });

  it('suppresses contact-route snippets materialized as descriptions', () => {
    expect(
      publicResearchEntityDescriptionText(
        'Contact: David Moore ( david.c.moore@yale.edu) Website: https://campuspress.yale.edu/moorelab/ We have projects aiming to test fundamental physics.',
      ),
    ).toBe('');
  });

  it('keeps complete research descriptions with abbreviations', () => {
    expect(
      publicResearchEntityDescriptionText(
        'Dr. Jones studies U.S. health policy and vaccination programs.',
      ),
    ).toBe('Dr. Jones studies U.S. health policy and vaccination programs.');
  });
});

describe('sanitizeFacultyResearchEntityText', () => {
  it('rephrases lab-only copy for faculty research entities only', () => {
    const facultyResearch = {
      name: 'Charles Bailyn Faculty Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
    };
    const lab = { name: 'Example Lab', kind: 'lab', entityType: 'LAB' };
    const copy =
      'The Charles Bailyn Lab conducts research focused on black holes. this research uses telescopes. Review the lab site before contacting this lab.';

    expect(sanitizeFacultyResearchEntityText(copy, facultyResearch)).toBe(
      "Charles Bailyn's research focuses on black holes. This research uses telescopes. Review the research website before contacting this research profile.",
    );
    expect(sanitizeFacultyResearchEntityText(copy, lab)).toBe(copy);
  });

  it('rephrases possessive faculty lab copy', () => {
    const facultyResearch = {
      name: 'David Breslow Faculty Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
    };

    expect(
      sanitizeFacultyResearchEntityText(
        "David Breslow's lab studies ciliary signaling. His lab uses genomic tools.",
        facultyResearch,
      ),
    ).toBe("David Breslow's research studies ciliary signaling. His research uses genomic tools.");
    expect(
      sanitizeFacultyResearchEntityText(
        "The lab's work includes genomic screening. The lab's research addresses cilia.",
        facultyResearch,
      ),
    ).toBe('This research includes genomic screening. This research addresses cilia.');
  });
});

describe('sanitizeResearchEntityPublicDescriptionFields', () => {
  it('drops PI profile synthesis summaries that are not research-focused', () => {
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(
      {
        descriptionSource: 'PI_PROFILE_SYNTHESIS',
        profileSynthesisDescription:
          'David Lang has been performed by major music, dance, and theater organizations throughout the world, and in the most renowned concert halls and festivals in the United States and Europe. His works have been performed many times on Yale concert series.',
      },
      ['David Glahn'],
    );

    expect(sanitized).toEqual({
      descriptionSource: 'PI_PROFILE_SYNTHESIS',
      profileSynthesisDescription: '',
    });
  });

  it('preserves PI profile synthesis summaries that stay research-focused after correction', () => {
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(
      {
        descriptionSource: 'PI_PROFILE_SYNTHESIS',
        profileSynthesisDescription:
          "David Lang's lab studies how humans process complex sound patterns.",
      },
      ['David Glahn'],
    );

    expect(sanitized.profileSynthesisDescription).toBe(
      'This lab studies how humans process complex sound patterns.',
    );
  });
});
