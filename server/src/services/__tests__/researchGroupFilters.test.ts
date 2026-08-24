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
      acceptanceLevel: 'verified',
    });
    expect(filter).toBe(
      [
        'archived = false',
        '(kind = "lab")',
        '(schools = "School of Medicine")',
        '(departments = "Genetics")',
        '(researchAreas = "Genomics")',
        'accessAcceptanceLevel = "verified"',
      ].join(' AND '),
    );
  });

  describe('acceptanceLevel filter', () => {
    it('"all" or unset → no extra clause', () => {
      expect(buildResearchGroupFilterString({ acceptanceLevel: 'all' })).toBe('archived = false');
      expect(buildResearchGroupFilterString({})).toBe('archived = false');
    });

    it('"verified" → filters the canonical Signal-derived acceptance level', () => {
      const filter = buildResearchGroupFilterString({ acceptanceLevel: 'verified' });
      expect(filter).toBe('archived = false AND accessAcceptanceLevel = "verified"');
    });

    it('"verified-or-likely" → accepts either verified or likely', () => {
      const filter = buildResearchGroupFilterString({
        acceptanceLevel: 'verified-or-likely',
      });
      expect(filter).toBe(
        'archived = false AND (accessAcceptanceLevel = "verified" OR accessAcceptanceLevel = "likely")',
      );
    });

    it('combines acceptanceLevel with other filters via AND', () => {
      const filter = buildResearchGroupFilterString({
        kind: ['lab'],
        acceptanceLevel: 'verified',
      });
      expect(filter).toBe(
        'archived = false AND (kind = "lab") AND accessAcceptanceLevel = "verified"',
      );
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
});
