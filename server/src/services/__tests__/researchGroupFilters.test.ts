import { describe, it, expect } from 'vitest';
import {
  buildResearchGroupFilterString,
  candidateMatchesStudentFilters,
  tallyCandidateFacetDistribution,
} from '../researchGroupFilters';

describe('buildResearchGroupFilterString', () => {
  it('always pins archived = false when no filters are supplied', () => {
    expect(buildResearchGroupFilterString()).toBe('archived = false');
    expect(buildResearchGroupFilterString({})).toBe('archived = false');
  });

  it('combines a single multi-value filter with OR within the field', () => {
    const filter = buildResearchGroupFilterString({
      kind: ['lab', 'center'],
    });
    expect(filter).toBe('archived = false AND (kind = "lab" OR kind = "center")');
  });

  it('combines multiple filter fields with AND between fields', () => {
    const filter = buildResearchGroupFilterString({
      school: ['School of Medicine'],
      departments: ['Genetics', 'Neurology'],
    });
    expect(filter).toBe(
      'archived = false AND (schools = "School of Medicine") AND (departments = "Genetics" OR departments = "Neurology")',
    );
  });

  it('escapes quotes and backslashes inside filter values', () => {
    const filter = buildResearchGroupFilterString({
      departments: ['He said "hi"', 'C:\\path'],
    });
    expect(filter).toBe(
      'archived = false AND (departments = "He said \\"hi\\"" OR departments = "C:\\\\path")',
    );
  });

  it('drops empty / whitespace-only values inside an array filter', () => {
    expect(
      buildResearchGroupFilterString({
        researchAreas: ['', '  ', 'Genomics'],
      }),
    ).toBe('archived = false AND (researchAreas = "Genomics")');
  });

  it('omits the clause entirely if the filter array is empty after trimming', () => {
    expect(buildResearchGroupFilterString({ kind: ['', '  '] })).toBe('archived = false');
  });

  it('drops non-string filter values without coercion', () => {
    const badFilter = {
      toString() {
        throw new Error('should not stringify filter objects');
      },
    };

    expect(
      buildResearchGroupFilterString({ departments: [badFilter, 'Computer Science'] as any }),
    ).toBe('archived = false AND (departments = "Computer Science")');
  });

  it('handles a fully populated filter set', () => {
    const filter = buildResearchGroupFilterString({
      kind: ['lab'],
      school: ['School of Medicine'],
      departments: ['Genetics'],
      researchAreas: ['Genomics'],
    });
    expect(filter).toBe(
      [
        'archived = false',
        '(kind = "lab")',
        '(schools = "School of Medicine")',
        '(departments = "Genetics")',
        '(researchAreas = "Genomics")',
      ].join(' AND '),
    );
  });

  describe('entityType filter', () => {
    it('ORs multiple entityType enum values within the field', () => {
      const filter = buildResearchGroupFilterString({
        entityType: ['INITIATIVE', 'CORE_FACILITY', 'CENTER'],
      });
      expect(filter).toBe(
        'archived = false AND (entityType = "INITIATIVE" OR entityType = "CORE_FACILITY" OR entityType = "CENTER")',
      );
    });

    it('places the entityType clause right after kind and ANDs with other fields', () => {
      const filter = buildResearchGroupFilterString({
        kind: ['lab'],
        entityType: ['LAB', 'INITIATIVE'],
        departments: ['Genetics'],
      });
      expect(filter).toBe(
        [
          'archived = false',
          '(kind = "lab")',
          '(entityType = "LAB" OR entityType = "INITIATIVE")',
          '(departments = "Genetics")',
        ].join(' AND '),
      );
    });

    it('omits the clause when the entityType array is empty after trimming', () => {
      expect(buildResearchGroupFilterString({ entityType: ['', '  '] })).toBe('archived = false');
    });

    it('is droppable via excludeField for disjunctive faceting (#1080)', () => {
      const filter = buildResearchGroupFilterString(
        { entityType: ['LAB'], departments: ['Genetics'] },
        { excludeField: 'entityType' },
      );
      expect(filter).toBe('archived = false AND (departments = "Genetics")');
    });
  });

  describe('excludeField option', () => {
    it('omits the excluded field clause while keeping all other filters (#1080)', () => {
      const filter = buildResearchGroupFilterString(
        { school: ['Law School'], departments: ['Genetics'] },
        { excludeField: 'school' },
      );
      expect(filter).toBe('archived = false AND (departments = "Genetics")');
    });

    it('has no effect when the excluded field was not set', () => {
      const filter = buildResearchGroupFilterString(
        { departments: ['Genetics'] },
        { excludeField: 'school' },
      );
      expect(filter).toBe('archived = false AND (departments = "Genetics")');
    });
  });

  describe('hostsUndergrads filter', () => {
    it('true → filters on undergrad-specific hosting evidence, not the broad acceptance tier', () => {
      const filter = buildResearchGroupFilterString({ hostsUndergrads: true });
      expect(filter).toBe('archived = false AND hasUndergradHostingEvidence = true');
    });

    it('false or unset → no extra clause', () => {
      expect(buildResearchGroupFilterString({ hostsUndergrads: false })).toBe('archived = false');
      expect(buildResearchGroupFilterString({})).toBe('archived = false');
    });

    it('combines with other filters via AND', () => {
      const filter = buildResearchGroupFilterString({
        departments: ['Genetics'],
        hostsUndergrads: true,
      });
      expect(filter).toBe(
        'archived = false AND (departments = "Genetics") AND hasUndergradHostingEvidence = true',
      );
    });
  });
});

describe('candidateMatchesStudentFilters', () => {
  const candidate = {
    kind: 'lab',
    entityType: 'LAB',
    schools: ['School of Medicine', 'Faculty of Arts and Sciences'],
    departments: ['Genetics'],
    researchAreas: ['Genomics'],
    hasUndergradHostingEvidence: true,
  };

  it('ORs values within a field and ANDs fields, as the filter string does', () => {
    expect(
      candidateMatchesStudentFilters(candidate, {
        school: ['Law School', 'Faculty of Arts and Sciences'],
        departments: ['Genetics'],
      }),
    ).toBe(true);
    expect(
      candidateMatchesStudentFilters(candidate, {
        school: ['Faculty of Arts and Sciences'],
        departments: ['Neurology'],
      }),
    ).toBe(false);
  });

  it('compares case-insensitively and ignores the visibility scope the pool query pins', () => {
    expect(
      candidateMatchesStudentFilters(candidate, {
        entityType: ['lab'],
        studentVisibilityTier: ['operator_review'],
      }),
    ).toBe(true);
  });

  it('reads the hosted-undergraduates flag only when that filter is on', () => {
    const withoutEvidence = { ...candidate, hasUndergradHostingEvidence: false };
    expect(candidateMatchesStudentFilters(withoutEvidence, {})).toBe(true);
    expect(candidateMatchesStudentFilters(withoutEvidence, { hostsUndergrads: true })).toBe(false);
  });

  it('drops only the excluded field, so a facet can be counted disjunctively', () => {
    expect(
      candidateMatchesStudentFilters(
        candidate,
        { departments: ['Neurology'], entityType: ['LAB'] },
        { excludeField: 'departments' },
      ),
    ).toBe(true);
  });
});

describe('tallyCandidateFacetDistribution', () => {
  const candidates = [
    { entityType: 'LAB', departments: ['Genetics', 'Genetics'], schools: ['School of Medicine'] },
    { entityType: 'LAB', departments: ['Chemistry'], schools: ['Faculty of Arts and Sciences'] },
    { entityType: 'CENTER', departments: ['Genetics'], schools: ['School of Medicine'] },
  ];

  it('counts each row once per value over the rows the other filters admit', () => {
    expect(
      tallyCandidateFacetDistribution(candidates, { entityType: ['LAB'] }, [
        { filterKey: 'departments', indexField: 'departments' },
        { filterKey: 'entityType', indexField: 'entityType' },
      ]),
    ).toEqual({
      departments: { Genetics: 1, Chemistry: 1 },
      entityType: { LAB: 2, CENTER: 1 },
    });
  });
});
