import { describe, expect, it } from 'vitest';
import {
  CANONICAL_FACULTY_RESEARCH_ENTITY_TYPE,
  CANONICAL_FACULTY_RESEARCH_KIND,
  isIndividualResearchKind,
  isLegacyFacultyResearchEntityType,
  planFacultyResearchTypeConsolidation,
  summarizeFacultyResearchTypeConsolidation,
} from '../consolidateFacultyResearchEntityTypeCore';

describe('consolidateFacultyResearchEntityTypeCore', () => {
  it('recognizes only the legacy faculty-research aliases', () => {
    expect(isLegacyFacultyResearchEntityType('INDIVIDUAL_RESEARCH')).toBe(true);
    expect(isLegacyFacultyResearchEntityType('FACULTY_RESEARCH')).toBe(true);
    expect(isLegacyFacultyResearchEntityType('FACULTY_RESEARCH_AREA')).toBe(false);
    expect(isLegacyFacultyResearchEntityType('LAB')).toBe(false);
    expect(isLegacyFacultyResearchEntityType(null)).toBe(false);
    expect(isLegacyFacultyResearchEntityType(undefined)).toBe(false);
  });

  it('treats individual and solo as individual-research kinds', () => {
    expect(isIndividualResearchKind('individual')).toBe(true);
    expect(isIndividualResearchKind('solo')).toBe(true);
    expect(isIndividualResearchKind('lab')).toBe(false);
    expect(isIndividualResearchKind(undefined)).toBe(false);
  });

  it('rewrites entityType and only realigns kind when it is not already an individual kind', () => {
    const plan = planFacultyResearchTypeConsolidation([
      { id: 1, slug: 'a', entityType: 'INDIVIDUAL_RESEARCH', kind: 'individual' },
      { id: 2, slug: 'b', entityType: 'FACULTY_RESEARCH', kind: 'lab' },
      { id: 3, slug: 'c', entityType: 'FACULTY_RESEARCH_AREA', kind: 'individual' },
      { id: 4, slug: 'd', entityType: 'LAB', kind: 'lab' },
    ]);

    expect(plan).toEqual([
      { id: 1, slug: 'a', from: 'INDIVIDUAL_RESEARCH', to: CANONICAL_FACULTY_RESEARCH_ENTITY_TYPE },
      {
        id: 2,
        slug: 'b',
        from: 'FACULTY_RESEARCH',
        to: CANONICAL_FACULTY_RESEARCH_ENTITY_TYPE,
        kindFrom: 'lab',
        kindTo: CANONICAL_FACULTY_RESEARCH_KIND,
      },
    ]);
  });

  it('summarizes plan counts including kind realignments', () => {
    const plan = planFacultyResearchTypeConsolidation([
      { id: 1, slug: 'a', entityType: 'INDIVIDUAL_RESEARCH', kind: 'individual' },
      { id: 2, slug: 'b', entityType: 'INDIVIDUAL_RESEARCH', kind: 'solo' },
      { id: 3, slug: 'c', entityType: 'FACULTY_RESEARCH', kind: 'lab' },
      { id: 4, slug: 'd', entityType: 'LAB', kind: 'lab' },
    ]);

    expect(summarizeFacultyResearchTypeConsolidation(4, plan)).toEqual({
      scanned: 4,
      planned: 3,
      kindRealigned: 1,
      byFrom: { INDIVIDUAL_RESEARCH: 2, FACULTY_RESEARCH: 1 },
    });
  });
});
