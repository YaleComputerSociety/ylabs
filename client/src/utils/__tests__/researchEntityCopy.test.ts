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
