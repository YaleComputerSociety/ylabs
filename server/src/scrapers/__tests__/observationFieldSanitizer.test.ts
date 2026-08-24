import { describe, it, expect } from 'vitest';
import { sanitizeObservationField } from '../observationFieldSanitizer';

describe('sanitizeObservationField', () => {
  describe('person title (leak class A: page chrome in person title)', () => {
    it('rejects a nav/menu chrome title lifted into a person title', () => {
      const result = sanitizeObservationField('user', 'title', 'HomeAboutPeopleContact');
      expect(result.rejected).toBe(true);
      expect(result.reason).toBe('person-title-furniture');
    });

    it('rejects a site section/directory label lifted into a person title', () => {
      expect(sanitizeObservationField('user', 'title', 'Faculty Directory').rejected).toBe(true);
    });

    it('rejects a person title carrying a raw contact email', () => {
      expect(
        sanitizeObservationField('user', 'title', 'Professor of Biology jdoe@example.edu').rejected,
      ).toBe(true);
    });

    it('keeps a genuine role string unchanged', () => {
      expect(sanitizeObservationField('user', 'title', 'Professor of Chemistry')).toEqual({
        value: 'Professor of Chemistry',
        rejected: false,
      });
    });

    it('does not apply the person-title cap to a non-user title (fellowship name)', () => {
      const fellowshipName =
        'The Combined Interdisciplinary Undergraduate Summer Research Fellowship in Environmental and Computational Sciences Program';
      expect(sanitizeObservationField('fellowship', 'title', fellowshipName)).toEqual({
        value: fellowshipName,
        rejected: false,
      });
    });
  });

  describe('entity name (leak class A: glued residue / governance-org / chrome as lab name)', () => {
    it('strips a glued trailing description off a research-home name', () => {
      const result = sanitizeObservationField(
        'researchEntity',
        'name',
        'Smith Lab We study quantum materials and develop new measurement methods',
      );
      expect(result).toEqual({ value: 'Smith Lab', rejected: false });
    });

    it('rejects a nav-chrome run lifted into a lab name', () => {
      expect(
        sanitizeObservationField('researchEntity', 'name', 'ResearchPeopleAboutEvents').rejected,
      ).toBe(true);
    });

    it('rejects a glued street-address fragment in an entity name', () => {
      expect(
        sanitizeObservationField(
          'researchEntity',
          'displayName',
          'Chemistry Research Group 123 Science Avenue',
        ).rejected,
      ).toBe(true);
    });

    it('rejects literal HTML markup left in an entity name', () => {
      expect(
        sanitizeObservationField('researchEntity', 'name', 'Smith Lab <span class="title">')
          .rejected,
      ).toBe(true);
    });

    it('keeps a clean research-home name unchanged', () => {
      expect(sanitizeObservationField('researchEntity', 'name', 'Zhang Laboratory')).toEqual({
        value: 'Zhang Laboratory',
        rejected: false,
      });
    });

    it('does not treat a plain user name as a research-home name', () => {
      expect(sanitizeObservationField('user', 'name', 'Ada Lovelace')).toEqual({
        value: 'Ada Lovelace',
        rejected: false,
      });
    });
  });

  describe('research-area list (leak class A: section labels as research areas)', () => {
    it('drops leaked section labels but keeps genuine topics', () => {
      const result = sanitizeObservationField('researchEntity', 'researchAreas', [
        'Research Areas',
        'Immunology',
        'Fields of Interest',
        'Genomics',
      ]);
      expect(result.rejected).toBe(false);
      expect(result.value).toEqual(['Immunology', 'Genomics']);
    });

    it('rejects the observation when every element is label leakage', () => {
      const result = sanitizeObservationField('researchEntity', 'researchInterests', [
        'Research Areas:',
        'Fields of Interest',
      ]);
      expect(result.rejected).toBe(true);
      expect(result.reason).toBe('research-area-label-leakage');
    });

    it('keeps a clean topic list intact', () => {
      const topics = ['Cancer Biology', 'Structural Biology'];
      expect(sanitizeObservationField('researchEntity', 'topics', topics).value).toEqual(topics);
    });

    it('does not sanitize topics on a non-research-entity observation', () => {
      const topics = ['Research Areas', 'Something'];
      expect(sanitizeObservationField('paper', 'topics', topics)).toEqual({
        value: topics,
        rejected: false,
      });
    });
  });

  describe('description prose (leak class A: script/style chrome + contact in writes)', () => {
    it('strips page chrome and redacts a raw email from a description', () => {
      const result = sanitizeObservationField(
        'researchEntity',
        'fullDescription',
        'Skip to main content The lab studies protein folding. Contact us at jdoe@example.edu.',
      );
      expect(result.rejected).toBe(false);
      const value = String(result.value);
      expect(value).not.toContain('Skip to main content');
      expect(value).not.toContain('@');
      expect(value).toContain('protein folding');
    });

    it('rejects a chrome-only description that collapses to nothing', () => {
      const result = sanitizeObservationField(
        'researchEntity',
        'shortDescription',
        'Skip to main content Toggle navigation Main menu',
      );
      expect(result.rejected).toBe(true);
      expect(result.reason).toBe('prose-chrome-only');
    });

    it('rejects the contentless research-projects boilerplate so it never wins a description (#1636)', () => {
      const result = sanitizeObservationField(
        'researchEntity',
        'fullDescription',
        'I have 3 research projects that are focused on fabrication, measurement, and/or theory, depending on student interest and experience.',
      );
      expect(result.rejected).toBe(true);
      expect(result.reason).toBe('contentless-research-projects-boilerplate');
    });

    it('keeps a specific research description that mentions projects', () => {
      const result = sanitizeObservationField(
        'researchEntity',
        'fullDescription',
        'The lab has three research projects on quantum optics, circuit QED, and superconducting qubits.',
      );
      expect(result.rejected).toBe(false);
      expect(String(result.value)).toContain('quantum optics');
    });
  });

  describe('evidence quotes (leak class A: never store a raw contact detail)', () => {
    it('redacts a raw email from a stored evidence quote', () => {
      const result = sanitizeObservationField(
        'researchEntity',
        'undergradEvidenceQuote',
        'Interested students should email the lab at jdoe@example.edu to apply.',
      );
      expect(result.rejected).toBe(false);
      expect(String(result.value)).not.toContain('@');
    });
  });

  describe('structured fields pass through untouched', () => {
    it('never redacts a structured email field kept for internal contact derivation', () => {
      expect(sanitizeObservationField('user', 'email', 'jdoe@example.edu')).toEqual({
        value: 'jdoe@example.edu',
        rejected: false,
      });
    });

    it('leaves source URLs, enum kinds, and non-string values alone', () => {
      expect(sanitizeObservationField('researchEntity', 'sourceUrls', ['https://x.example.edu']))
        .toEqual({ value: ['https://x.example.edu'], rejected: false });
      expect(sanitizeObservationField('researchEntity', 'kind', 'LAB')).toEqual({
        value: 'LAB',
        rejected: false,
      });
      expect(sanitizeObservationField('researchEntity', 'recentGrantCount', 3)).toEqual({
        value: 3,
        rejected: false,
      });
    });
  });
});
