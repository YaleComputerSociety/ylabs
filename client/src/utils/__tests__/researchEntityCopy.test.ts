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
      researchEntityTitle({
        name: 'Claudia Valeggia - Research',
        entityType: 'INDIVIDUAL_RESEARCH',
      }),
    ).toBe('Claudia Valeggia');
  });

  it('keeps a natural lab title when the entity name corroborates the lab', () => {
    expect(
      researchEntityTitle({
        displayName: 'Caccone Lab',
        name: 'Caccone Lab',
        entityType: 'FACULTY_RESEARCH_AREA',
      }),
    ).toBe('Caccone Lab');
    expect(
      researchEntityTitle({
        displayName: 'The PECIL Lab',
        name: 'The PECIL Laboratory',
        entityType: 'FACULTY_RESEARCH_AREA',
      }),
    ).toBe('The PECIL Lab');
  });

  it('falls back to name when displayName grafts a lab the name does not claim', () => {
    expect(
      researchEntityTitle({
        displayName: 'Robert J. Schoelkopf Lab',
        name: 'Robert Schoelkopf Faculty Research',
        entityType: 'FACULTY_RESEARCH_AREA',
      }),
    ).toBe('Robert Schoelkopf');
    expect(
      researchEntityTitle({
        displayName: 'Yung-Chi Cheng Lab',
        name: 'Yung-Chi Cheng Faculty Research',
        entityType: 'FACULTY_RESEARCH_AREA',
      }),
    ).toBe('Yung-Chi Cheng');
  });

  it('recovers the initial the grafted displayName dropped', () => {
    expect(
      researchEntityTitle({
        displayName: 'I George Miller Lab',
        name: 'I. George Miller Faculty Research',
        entityType: 'FACULTY_RESEARCH_AREA',
      }),
    ).toBe('I. George Miller');
  });

  it('leaves a grafted-looking lab displayName alone on a real lab entity', () => {
    expect(
      researchEntityTitle({
        displayName: 'Steitz Lab',
        name: 'Joan Steitz Research Group',
        entityType: 'LAB',
      }),
    ).toBe('Steitz Lab');
  });

  it('leaves non-faculty research-home titles untouched', () => {
    expect(researchEntityTitle({ name: 'Center for Genomic Research', entityType: 'CENTER' })).toBe(
      'Center for Genomic Research',
    );
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

  it('derives group labels from entityType for the project entityType when kind is stale', () => {
    const staleProject = { name: 'Example Project', kind: 'lab', entityType: 'FACULTY_PROJECT' };

    expect(isFacultyResearchEntity(staleProject)).toBe(false);
    expect(entityKindLabel(staleProject)).toBe('Group');
    expect(researchWebsiteLabel(staleProject)).toBe('group website');
  });

  it('falls back to the stored kind for a retired entityType', () => {
    const retired = {
      name: 'Example Collections Program',
      kind: 'initiative',
      entityType: 'COLLECTIONS_INITIATIVE',
    };

    expect(entityKindLabel(retired)).toBe('Initiative');
    expect(researchWebsiteLabel(retired)).toBe('initiative website');
  });

  it('labels a core facility as a core facility rather than a generic research home', () => {
    const coreFacility = {
      name: 'Example Imaging Core',
      kind: 'core_facility',
      entityType: 'CORE_FACILITY',
    };

    expect(entityKindLabel(coreFacility)).toBe('Core Facility');
    expect(researchWebsiteLabel(coreFacility)).toBe('core facility website');
    expect(researchWebsiteCtaLabel(coreFacility)).toBe('Visit core facility website');
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
      sanitizeResearchHomeSelfReferenceCopy(copy, {
        name: 'Smith Lab',
        kind: 'lab',
        entityType: 'LAB',
      }),
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
    expect(neutralizeFirstPersonResearchCopy('Broadly, I am a modeler interested in oceans.')).toBe(
      'Broadly, this researcher is a modeler interested in oceans.',
    );
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

  it('conjugates every verb in a compound predicate, not just the first (#1292)', () => {
    expect(
      neutralizeFirstPersonResearchCopy('We develop and apply electronic structure methods.'),
    ).toBe('This research develops and applies electronic structure methods.');
    expect(
      neutralizeFirstPersonResearchCopy('We investigate and characterize novel materials.'),
    ).toBe('This research investigates and characterizes novel materials.');
    expect(neutralizeFirstPersonResearchCopy('I design, build, and test robotic systems.')).toBe(
      'This research designs, builds, and tests robotic systems.',
    );
    expect(neutralizeFirstPersonResearchCopy('We study and characterize protein structures.')).toBe(
      'This research studies and characterizes protein structures.',
    );
  });

  it('leaves clean third-person copy untouched', () => {
    expect(neutralizeFirstPersonResearchCopy('Studies systems neuroscience.')).toBe(
      'Studies systems neuroscience.',
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
});

describe('relationshipTypeLabel', () => {
  it('maps known relationship types', () => {
    expect(relationshipTypeLabel('AFFILIATED_LAB')).toBe('Affiliated lab');
    expect(relationshipTypeLabel('MEMBER_RESEARCH_AREA')).toBe('Member');
  });

  it('drops the tag for the relationship types retired in #2213', () => {
    expect(relationshipTypeLabel('HOSTED_PROGRAM')).toBe('');
    expect(relationshipTypeLabel('AFFILIATED_RESEARCH_GROUP')).toBe('');
  });

  it('returns empty string for unknown/missing types so the tag is dropped', () => {
    expect(relationshipTypeLabel('WHATEVER')).toBe('');
    expect(relationshipTypeLabel(undefined)).toBe('');
    expect(relationshipTypeLabel(null)).toBe('');
  });
});
