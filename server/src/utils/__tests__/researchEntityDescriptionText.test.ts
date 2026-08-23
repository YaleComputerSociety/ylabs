import { describe, expect, it } from 'vitest';

import {
  isDirectoryIndexChromeText,
  publicResearchEntityDescriptionText,
  sanitizeFacultyResearchEntityText,
  sanitizeResearchEntityPublicDescriptionFields,
  sanitizeResearchHomeSelfReferenceCopyFields,
  sanitizeResearchHomeSelfReferenceText,
} from '../researchEntityDescriptionText';

describe('isDirectoryIndexChromeText', () => {
  it('flags YSM A-Z lab-website index directory boilerplate (#517)', () => {
    expect(
      isDirectoryIndexChromeText(
        'This A–Z index lists Yale School of Medicine lab websites in one place. Browse alphabetically or use your browser search.',
      ),
    ).toBe(true);
    expect(
      isDirectoryIndexChromeText('This A-Z index lists Yale School of Medicine lab websites.'),
    ).toBe(true);
  });

  it('does not flag a real lab research description', () => {
    expect(
      isDirectoryIndexChromeText('Studies chromatin dynamics and nuclear envelope assembly.'),
    ).toBe(false);
    expect(isDirectoryIndexChromeText('')).toBe(false);
    expect(isDirectoryIndexChromeText(undefined)).toBe(false);
  });
});

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
        'Contact: Dana Fixture ( dana.c.fixture@yale.edu) Website: https://campuspress.yale.edu/moorelab/ We have projects aiming to test fundamental physics.',
      ),
    ).toBe('');
  });

  it('suppresses A-Z directory-index boilerplate that leaked into a stored description (#535)', () => {
    expect(
      publicResearchEntityDescriptionText(
        'This A–Z index lists Yale School of Medicine lab websites in one place, making it easy to find a specific lab, research group, or program site.',
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

  it('strips a trailing "Research" suffix (with or without a dash separator) from the possessive name', () => {
    const dashSuffixEntity = {
      name: 'Tara Boroushaki - Research',
      kind: 'individual',
      entityType: 'INDIVIDUAL_RESEARCH',
    };
    expect(
      sanitizeFacultyResearchEntityText(
        'The Boroushaki Lab investigates sensing and mobile technologies.',
        dashSuffixEntity,
      ),
    ).toBe("Tara Boroushaki's research investigates sensing and mobile technologies.");

    const bareSuffixEntity = {
      name: 'Ada Lovelace Research',
      kind: 'individual',
      entityType: 'INDIVIDUAL_RESEARCH',
    };
    expect(
      sanitizeFacultyResearchEntityText(
        'The Lovelace Lab focuses on analytical engines.',
        bareSuffixEntity,
      ),
    ).toBe("Ada Lovelace's research focuses on analytical engines.");
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

describe('sanitizeResearchHomeSelfReferenceText', () => {
  it('rewrites stray "the lab" body copy to the center noun for CENTER entities (#807)', () => {
    const center = { name: 'Yale Center for Genome Analysis', entityType: 'CENTER', kind: 'center' };
    expect(
      sanitizeResearchHomeSelfReferenceText(
        'The Yale Center for Genome Analysis specializes in genomics. The lab offers DNA sequencing services.',
        center,
      ),
    ).toBe(
      'The Yale Center for Genome Analysis specializes in genomics. The center offers DNA sequencing services.',
    );
    expect(
      sanitizeResearchHomeSelfReferenceText('this lab provides research opportunities.', center),
    ).toBe('this center provides research opportunities.');
    expect(
      sanitizeResearchHomeSelfReferenceText("the lab's members present findings.", center),
    ).toBe("the center's members present findings.");
  });

  it('uses the correct noun for other non-lab entity types', () => {
    expect(
      sanitizeResearchHomeSelfReferenceText('The lab convenes annually.', {
        name: 'Some Institute',
        entityType: 'INSTITUTE',
        kind: 'institute',
      }),
    ).toBe('The institute convenes annually.');
    expect(
      sanitizeResearchHomeSelfReferenceText('The lab trains fellows.', {
        name: 'Some Program',
        entityType: 'PROGRAM',
        kind: 'program',
      }),
    ).toBe('The program trains fellows.');
    expect(
      sanitizeResearchHomeSelfReferenceText('The lab runs shared instruments.', {
        name: 'Some Core',
        entityType: 'CORE_FACILITY',
      }),
    ).toBe('The core facility runs shared instruments.');
  });

  it('leaves LAB and faculty-research entities untouched', () => {
    const labText = 'The lab studies neurons. The lab offers rotations.';
    expect(
      sanitizeResearchHomeSelfReferenceText(labText, { name: 'Smith Lab', entityType: 'LAB', kind: 'lab' }),
    ).toBe(labText);
    expect(
      sanitizeResearchHomeSelfReferenceText(labText, {
        name: 'Jane Doe Faculty Research',
        entityType: 'FACULTY_RESEARCH_AREA',
        kind: 'individual',
      }),
    ).toBe(labText);
  });

  it('does not rewrite a named lab embedded inside a center description', () => {
    const center = { name: 'A Center', entityType: 'CENTER', kind: 'center' };
    expect(
      sanitizeResearchHomeSelfReferenceText('The center collaborates with the Smith Lab.', center),
    ).toBe('The center collaborates with the Smith Lab.');
  });
});

describe('sanitizeResearchHomeSelfReferenceCopyFields', () => {
  it('normalizes shortDescription and fullDescription for CENTER entities', () => {
    const sanitized = sanitizeResearchHomeSelfReferenceCopyFields({
      entityType: 'CENTER',
      kind: 'center',
      shortDescription: 'The lab offers sequencing.',
      fullDescription: 'Yale Forests manages forestland. The lab provides educational opportunities.',
    });
    expect(sanitized.shortDescription).toBe('The center offers sequencing.');
    expect(sanitized.fullDescription).toBe(
      'Yale Forests manages forestland. The center provides educational opportunities.',
    );
  });

  it('returns the entity unchanged for LAB entities', () => {
    const entity = {
      entityType: 'LAB',
      kind: 'lab',
      fullDescription: 'The lab studies neurons.',
    };
    expect(sanitizeResearchHomeSelfReferenceCopyFields(entity)).toBe(entity);
  });
});
