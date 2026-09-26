import { describe, it, expect } from 'vitest';
import { buildResearchGroupFilterString } from '../researchGroupFilters';

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
