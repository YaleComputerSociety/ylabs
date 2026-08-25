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
        entityType: ['PROGRAM', 'COURSE_SEQUENCE', 'CENTER'],
      });
      expect(filter).toBe(
        'archived = false AND (entityType = "PROGRAM" OR entityType = "COURSE_SEQUENCE" OR entityType = "CENTER")',
      );
    });

    it('places the entityType clause right after kind and ANDs with other fields', () => {
      const filter = buildResearchGroupFilterString({
        kind: ['lab'],
        entityType: ['LAB', 'GROUP'],
        departments: ['Genetics'],
      });
      expect(filter).toBe(
        [
          'archived = false',
          '(kind = "lab")',
          '(entityType = "LAB" OR entityType = "GROUP")',
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

  describe('hasDocumentedWayIn filter', () => {
    it('true → filters on the documented-way-in projection', () => {
      const filter = buildResearchGroupFilterString({ hasDocumentedWayIn: true });
      expect(filter).toBe('archived = false AND hasDocumentedWayIn = true');
    });

    it('false or unset → no extra clause', () => {
      expect(buildResearchGroupFilterString({ hasDocumentedWayIn: false })).toBe(
        'archived = false',
      );
      expect(buildResearchGroupFilterString({})).toBe('archived = false');
    });

    it('is independent of the hosts-undergrads filter and combines via AND', () => {
      const filter = buildResearchGroupFilterString({
        hostsUndergrads: true,
        hasDocumentedWayIn: true,
      });
      expect(filter).toBe(
        'archived = false AND hasUndergradHostingEvidence = true AND hasDocumentedWayIn = true',
      );
    });
  });

  describe('currentAvailability filter', () => {
    it('single value → filters the current-availability field', () => {
      const filter = buildResearchGroupFilterString({ currentAvailability: ['OPEN'] });
      expect(filter).toBe(
        'archived = false AND (undergraduateCurrentAvailability = "OPEN")',
      );
    });

    it('two values → ORs them within the field', () => {
      const filter = buildResearchGroupFilterString({
        currentAvailability: ['OPEN', 'ROLLING'],
      });
      expect(filter).toBe(
        'archived = false AND (undergraduateCurrentAvailability = "OPEN" OR undergraduateCurrentAvailability = "ROLLING")',
      );
    });

    it('unset → no extra clause', () => {
      expect(buildResearchGroupFilterString({})).toBe('archived = false');
    });

    it('combines with other filters via AND', () => {
      const filter = buildResearchGroupFilterString({
        departments: ['Genetics'],
        currentAvailability: ['OPEN'],
      });
      expect(filter).toBe(
        'archived = false AND (departments = "Genetics") AND (undergraduateCurrentAvailability = "OPEN")',
      );
    });
  });

  describe('compensation filter', () => {
    it('single value → filters the compensation-model field', () => {
      const filter = buildResearchGroupFilterString({ compensation: ['PAID_OR_STIPEND'] });
      expect(filter).toBe(
        'archived = false AND (undergraduateCompensationModel = "PAID_OR_STIPEND")',
      );
    });

    it('two values → ORs them within the field', () => {
      const filter = buildResearchGroupFilterString({
        compensation: ['PAID_OR_STIPEND', 'COURSE_CREDIT'],
      });
      expect(filter).toBe(
        'archived = false AND (undergraduateCompensationModel = "PAID_OR_STIPEND" OR undergraduateCompensationModel = "COURSE_CREDIT")',
      );
    });

    it('unset → no extra clause', () => {
      expect(buildResearchGroupFilterString({})).toBe('archived = false');
    });

    it('is droppable via excludeField for disjunctive faceting (#1080)', () => {
      const filter = buildResearchGroupFilterString(
        { compensation: ['PAID_OR_STIPEND'], departments: ['Genetics'] },
        { excludeField: 'compensation' },
      );
      expect(filter).toBe('archived = false AND (departments = "Genetics")');
    });

    it('combines with current availability and other filters via AND', () => {
      const filter = buildResearchGroupFilterString({
        departments: ['Genetics'],
        currentAvailability: ['OPEN'],
        compensation: ['PAID_OR_STIPEND'],
      });
      expect(filter).toBe(
        [
          'archived = false',
          '(departments = "Genetics")',
          '(undergraduateCurrentAvailability = "OPEN")',
          '(undergraduateCompensationModel = "PAID_OR_STIPEND")',
        ].join(' AND '),
      );
    });
  });

  describe('eligibleStudentLevels filter', () => {
    it('single value → filters the eligible-student-levels field', () => {
      const filter = buildResearchGroupFilterString({ eligibleStudentLevels: ['FIRST_YEAR'] });
      expect(filter).toBe(
        'archived = false AND (undergraduateEligibleStudentLevels = "FIRST_YEAR")',
      );
    });

    it('two values → ORs them within the field', () => {
      const filter = buildResearchGroupFilterString({
        eligibleStudentLevels: ['FIRST_YEAR', 'SOPHOMORE'],
      });
      expect(filter).toBe(
        'archived = false AND (undergraduateEligibleStudentLevels = "FIRST_YEAR" OR undergraduateEligibleStudentLevels = "SOPHOMORE")',
      );
    });

    it('unset → no extra clause', () => {
      expect(buildResearchGroupFilterString({})).toBe('archived = false');
    });

    it('is droppable via excludeField for disjunctive faceting (#1080)', () => {
      const filter = buildResearchGroupFilterString(
        { eligibleStudentLevels: ['FIRST_YEAR'], departments: ['Genetics'] },
        { excludeField: 'eligibleStudentLevels' },
      );
      expect(filter).toBe('archived = false AND (departments = "Genetics")');
    });

    it('combines with compensation and other filters via AND', () => {
      const filter = buildResearchGroupFilterString({
        departments: ['Genetics'],
        compensation: ['PAID_OR_STIPEND'],
        eligibleStudentLevels: ['FIRST_YEAR', 'SOPHOMORE'],
      });
      expect(filter).toBe(
        [
          'archived = false',
          '(departments = "Genetics")',
          '(undergraduateCompensationModel = "PAID_OR_STIPEND")',
          '(undergraduateEligibleStudentLevels = "FIRST_YEAR" OR undergraduateEligibleStudentLevels = "SOPHOMORE")',
        ].join(' AND '),
      );
    });
  });
});
