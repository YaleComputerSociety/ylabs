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
  sanitizeFacultyResearchCopy,
  sanitizeResearchHomeSelfReferenceCopy,
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
