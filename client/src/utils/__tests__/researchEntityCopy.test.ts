import { describe, expect, it } from 'vitest';

import {
  entityKindLabel,
  isFacultyResearchEntity,
  researchWebsiteLabel,
  researchWebsiteCtaLabel,
  researchStructureLabel,
  decisionHeadingLabel,
  approachHeadingLabel,
  relationshipTypeLabel,
  researchEntityTitle,
  sanitizeFacultyResearchCopy,
  sanitizeResearchHomeSelfReferenceCopy,
  stripLeadingPageChrome,
  stripLeadingGreeting,
  neutralizeFirstPersonResearchCopy,
  sanitizeResearchEntityCopy,
} from '../researchEntityCopy';

describe('researchEntityCopy', () => {
  it('uses faculty research labels for individual research entities', () => {
    const entity = {
      name: 'Example Faculty Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
    };

    expect(isFacultyResearchEntity(entity)).toBe(true);
    expect(entityKindLabel(entity)).toBe('Faculty Research');
    expect(researchWebsiteLabel(entity)).toBe('research website');
  });

  it('uses faculty research labels for FACULTY_RESEARCH entities despite stale lab kind', () => {
    const entity = {
      name: 'Example Researcher Faculty Research',
      kind: 'lab',
      entityType: 'FACULTY_RESEARCH',
    };

    expect(isFacultyResearchEntity(entity)).toBe(true);
    expect(entityKindLabel(entity)).toBe('Faculty Research');
    expect(researchWebsiteLabel(entity)).toBe('research website');
    expect(researchWebsiteCtaLabel(entity)).toBe('Visit research website');
  });

  it('strips synthesized research-echo suffixes from faculty research titles', () => {
    expect(
      researchEntityTitle({
        name: 'Diana Qiu Faculty Research',
        entityType: 'FACULTY_RESEARCH_AREA',
      }),
    ).toBe('Diana Qiu');
    expect(
      researchEntityTitle({ name: 'Scott Miller Research', entityType: 'FACULTY_RESEARCH_AREA' }),
    ).toBe('Scott Miller');
    expect(
      researchEntityTitle({ name: 'Claudia Valeggia - Research', entityType: 'INDIVIDUAL_RESEARCH' }),
    ).toBe('Claudia Valeggia');
  });

  it('prefers displayName and keeps natural lab titles for faculty research entities', () => {
    expect(
      researchEntityTitle({
        displayName: 'Robert J. Schoelkopf Lab',
        name: 'Robert J. Schoelkopf Faculty Research',
        entityType: 'INDIVIDUAL_RESEARCH',
      }),
    ).toBe('Robert J. Schoelkopf Lab');
  });

  it('leaves non-faculty research-home titles untouched', () => {
    expect(
      researchEntityTitle({ name: 'Center for Genomic Research', entityType: 'CENTER' }),
    ).toBe('Center for Genomic Research');
  });

  it('keeps lab labels for real lab entities', () => {
    const entity = {
      name: 'Example Lab',
      kind: 'lab',
      entityType: 'LAB',
    };

    expect(isFacultyResearchEntity(entity)).toBe(false);
    expect(entityKindLabel(entity)).toBe('Lab');
    expect(researchWebsiteLabel(entity)).toBe('lab website');
  });

  it('uses research-home wording for programs', () => {
    const entity = {
      name: 'Department Undergraduate Research',
      kind: 'program',
      entityType: 'PROGRAM',
    };

    expect(entityKindLabel(entity)).toBe('Program');
    expect(researchWebsiteLabel(entity)).toBe('program website');
    expect(researchWebsiteCtaLabel(entity)).toBe('Visit program website');
    expect(researchStructureLabel(entity)).toBe('program');
    expect(decisionHeadingLabel(entity)).toBe('What this program focuses on');
    expect(approachHeadingLabel(entity)).toBe('Ways to approach this program');
  });

  it('derives the badge and copy from canonical entityType when kind is stale', () => {
    const staleCenter = {
      name: 'Alison Galvani Lab',
      displayName: 'Center for Infectious Disease Modeling and Analysis (CIDMA)',
      kind: 'lab',
      entityType: 'CENTER',
    };

    expect(entityKindLabel(staleCenter)).toBe('Center');
    expect(researchWebsiteLabel(staleCenter)).toBe('center website');
    expect(researchStructureLabel(staleCenter)).toBe('center');
    expect(decisionHeadingLabel(staleCenter)).toBe('What this center focuses on');
    expect(approachHeadingLabel(staleCenter)).toBe('Ways to approach this center');
  });

  it('derives Faculty Research badge and copy from entityType FACULTY_RESEARCH when kind is stale (#833)', () => {
    const staleFacultyResearch = {
      name: 'Nicha Dvornek Faculty Research',
      kind: 'lab',
      entityType: 'FACULTY_RESEARCH',
    };

    expect(isFacultyResearchEntity(staleFacultyResearch)).toBe(true);
    expect(entityKindLabel(staleFacultyResearch)).toBe('Faculty Research');
    expect(researchWebsiteLabel(staleFacultyResearch)).toBe('research website');
    expect(researchWebsiteCtaLabel(staleFacultyResearch)).toBe('Visit research website');
  });

  it('derives group labels from entityType for the project entityTypes when kind is stale', () => {
    for (const entityType of ['FACULTY_PROJECT', 'DIGITAL_HUMANITIES_PROJECT', 'ARCHIVE_OR_MUSEUM_PROJECT']) {
      const staleProject = { name: 'Example Project', kind: 'lab', entityType };

      expect(isFacultyResearchEntity(staleProject)).toBe(false);
      expect(entityKindLabel(staleProject)).toBe('Group');
      expect(researchWebsiteLabel(staleProject)).toBe('group website');
    }
  });

  it('falls back to kind when entityType is absent', () => {
    const legacy = { name: 'Example Institute', kind: 'institute' };

    expect(entityKindLabel(legacy)).toBe('Institute');
    expect(researchWebsiteLabel(legacy)).toBe('institute website');
  });

  it('sanitizes faculty research copy without changing real lab copy', () => {
    const facultyResearch = {
      name: 'Charles Bailyn Faculty Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
    };
    const lab = { name: 'Example Lab', kind: 'lab', entityType: 'LAB' };
    const copy =
      'The Charles Bailyn Lab conducts research focused on black holes. this research uses telescope observations. Review the lab site before contacting this lab.';

    expect(sanitizeFacultyResearchCopy(copy, facultyResearch)).toBe(
      "Charles Bailyn's research focuses on black holes. This research uses telescope observations. Review the research website before contacting this research profile.",
    );
    expect(sanitizeFacultyResearchCopy(copy, lab)).toBe(copy);
  });

  it('sanitizes possessive faculty lab phrasing', () => {
    const facultyResearch = {
      name: 'David Breslow Faculty Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
    };

    expect(
      sanitizeFacultyResearchCopy(
        "David Breslow's lab studies ciliary signaling. His lab uses genomic tools.",
        facultyResearch,
      ),
    ).toBe("David Breslow's research studies ciliary signaling. His research uses genomic tools.");
    expect(
      sanitizeFacultyResearchCopy(
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
      sanitizeFacultyResearchCopy(
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
      sanitizeFacultyResearchCopy(
        'The Lovelace Lab focuses on analytical engines.',
        bareSuffixEntity,
      ),
    ).toBe("Ada Lovelace's research focuses on analytical engines.");
  });
});

describe('sanitizeResearchHomeSelfReferenceCopy', () => {
  it('rewrites stray "the lab" body copy to the center noun for CENTER entities (#807)', () => {
    const center = {
      name: 'Yale Center for Genome Analysis',
      kind: 'center',
      entityType: 'CENTER',
    };
    expect(
      sanitizeResearchHomeSelfReferenceCopy('The lab offers DNA sequencing services.', center),
    ).toBe('The center offers DNA sequencing services.');
    expect(
      sanitizeResearchHomeSelfReferenceCopy("the lab's members present findings.", center),
    ).toBe("the center's members present findings.");
  });

  it('resolves the noun from canonical entityType even when kind is stale', () => {
    const staleCenter = { name: 'A Center', kind: 'lab', entityType: 'CENTER' };
    expect(sanitizeResearchHomeSelfReferenceCopy('The lab convenes yearly.', staleCenter)).toBe(
      'The center convenes yearly.',
    );
  });

  it('leaves real lab and faculty-research copy untouched', () => {
    const copy = 'The lab studies neurons. The lab offers rotations.';
    expect(
      sanitizeResearchHomeSelfReferenceCopy(copy, { name: 'Smith Lab', kind: 'lab', entityType: 'LAB' }),
    ).toBe(copy);
    expect(
      sanitizeResearchHomeSelfReferenceCopy(copy, {
        name: 'Jane Doe Faculty Research',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
      }),
    ).toBe(copy);
  });
});

describe('stripLeadingPageChrome', () => {
  it('drops leading page-navigation chrome tokens (#1077)', () => {
    expect(stripLeadingPageChrome('Bio Website I am a chemist.')).toBe('I am a chemist.');
    expect(stripLeadingPageChrome('Bio Stable isotope geochemistry, astrobiology.')).toBe(
      'Stable isotope geochemistry, astrobiology.',
    );
    expect(stripLeadingPageChrome('Home Studies neurons.')).toBe('Studies neurons.');
    expect(stripLeadingPageChrome('Website Studies cells.')).toBe('Studies cells.');
  });

  it('leaves real words that merely start with a chrome token untouched', () => {
    expect(stripLeadingPageChrome('Biology of marine ecosystems.')).toBe(
      'Biology of marine ecosystems.',
    );
    expect(stripLeadingPageChrome('Bioinformatics pipelines for genomics.')).toBe(
      'Bioinformatics pipelines for genomics.',
    );
    expect(stripLeadingPageChrome('Studies systems neuroscience.')).toBe(
      'Studies systems neuroscience.',
    );
  });
});

describe('neutralizeFirstPersonResearchCopy', () => {
  it('re-voices first-person bio openers to neutral third person (#1077)', () => {
    expect(
      neutralizeFirstPersonResearchCopy('I am an isotope geochemist who models climate.'),
    ).toBe('This researcher is an isotope geochemist who models climate.');
    expect(
      neutralizeFirstPersonResearchCopy('Broadly, I am a modeler interested in oceans.'),
    ).toBe('Broadly, this researcher is a modeler interested in oceans.');
    expect(neutralizeFirstPersonResearchCopy('I study aesthetic objects.')).toBe(
      'This research studies aesthetic objects.',
    );
    expect(neutralizeFirstPersonResearchCopy('My research examines networks.')).toBe(
      'This research examines networks.',
    );
  });

  it('re-voices first-person lab phrasing to neutral third person (#1077)', () => {
    expect(neutralizeFirstPersonResearchCopy('In the laboratory we study lung cancer.')).toBe(
      'This research studies lung cancer.',
    );
    expect(neutralizeFirstPersonResearchCopy('Research in our lab is focused on DNA repair.')).toBe(
      'This research is focused on DNA repair.',
    );
    expect(
      neutralizeFirstPersonResearchCopy('The projects in our lab have focused on genetic risks.'),
    ).toBe('This research has focused on genetic risks.');
    expect(
      neutralizeFirstPersonResearchCopy('Our lab studies protein folding, and we use imaging.'),
    ).toBe('This research studies protein folding, and this research uses imaging.');
  });

  it('leaves clean third-person copy untouched', () => {
    expect(neutralizeFirstPersonResearchCopy('Studies systems neuroscience.')).toBe(
      'Studies systems neuroscience.',
    );
  });

  it('re-voices first-person PI-bio prose served as a lab description (#964)', () => {
    expect(
      neutralizeFirstPersonResearchCopy(
        'I am a physician-scientist with specialized training in immunology. My career is dedicated to integrating immunology with dermatology.',
      ),
    ).toBe(
      "This researcher is a physician-scientist with specialized training in immunology. This researcher's career is dedicated to integrating immunology with dermatology.",
    );
    expect(
      neutralizeFirstPersonResearchCopy(
        'I founded the field of Gerontological Biostatistics. I lead the Design and Statistics Core. I co-authored a paper on health disparities.',
      ),
    ).toBe(
      'This researcher founded the field of Gerontological Biostatistics. This researcher leads the Design and Statistics Core. This researcher co-authored a paper on health disparities.',
    );
    expect(
      neutralizeFirstPersonResearchCopy(
        'I teach and research on comparative politics, where I’m also associated with the MacMillan Center. This is where you can find out about my research and my graduate teaching.',
      ),
    ).toBe(
      "This researcher teaches and researches on comparative politics, where this researcher is also associated with the MacMillan Center. This is where you can find out about this research and this researcher's graduate teaching.",
    );
  });
});

describe('stripLeadingGreeting', () => {
  it('drops a leading page-greeting sentence (#964)', () => {
    expect(stripLeadingGreeting('Welcome to my web page! Studies neurons.')).toBe(
      'Studies neurons.',
    );
    expect(stripLeadingGreeting('Welcome to the Smith Lab website. Studies cells.')).toBe(
      'Studies cells.',
    );
  });

  it('leaves a greeting that is real research content untouched', () => {
    expect(stripLeadingGreeting('Welcome to a new era of genomics.')).toBe(
      'Welcome to a new era of genomics.',
    );
  });
});

describe('sanitizeResearchEntityCopy', () => {
  const faculty = {
    name: 'Example Faculty Research',
    kind: 'individual',
    entityType: 'FACULTY_RESEARCH_AREA',
  };
  const lab = { name: 'Example Lab', kind: 'lab', entityType: 'LAB' };

  it('strips chrome and re-voices first person for faculty cards (#1077)', () => {
    expect(sanitizeResearchEntityCopy('Bio Website I study aesthetic objects.', faculty)).toBe(
      'This research studies aesthetic objects.',
    );
  });

  it('re-voices first-person lab cards that the faculty sanitizer skips (#1077)', () => {
    expect(sanitizeResearchEntityCopy('In the laboratory we study lung cancer.', lab)).toBe(
      'This research studies lung cancer.',
    );
  });

  it('keeps the existing faculty lab-name re-voicing in the composed pipeline', () => {
    expect(sanitizeResearchEntityCopy('The Example Lab studies cells.', faculty)).toBe(
      "Example's research studies cells.",
    );
  });

  it('leaves clean third-person copy unchanged', () => {
    expect(sanitizeResearchEntityCopy('Studies systems neuroscience.', lab)).toBe(
      'Studies systems neuroscience.',
    );
  });

  it('strips a leading web-page greeting and re-voices the remaining first-person body (#964)', () => {
    expect(
      sanitizeResearchEntityCopy('Welcome to my web page! I teach comparative politics.', lab),
    ).toBe('This researcher teaches comparative politics.');
  });
});

describe('relationshipTypeLabel', () => {
  it('maps known relationship types', () => {
    expect(relationshipTypeLabel('AFFILIATED_LAB')).toBe('Affiliated lab');
    expect(relationshipTypeLabel('MEMBER_RESEARCH_AREA')).toBe('Member');
    expect(relationshipTypeLabel('HOSTED_PROGRAM')).toBe('Hosted program');
  });

  it('returns empty string for unknown/missing types so the tag is dropped', () => {
    expect(relationshipTypeLabel('WHATEVER')).toBe('');
    expect(relationshipTypeLabel(undefined)).toBe('');
    expect(relationshipTypeLabel(null)).toBe('');
  });
});
