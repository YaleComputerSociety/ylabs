import { describe, it, expect } from 'vitest';
import { sanitizeObservationField } from '../observationFieldSanitizer';

describe('sanitizeObservationField', () => {
  describe('lost sentence-boundary space (#3096)', () => {
    it('separates a boundary the harvest glued in a description', () => {
      expect(
        sanitizeObservationField(
          'researchEntity',
          'fullDescription',
          'These account for 10% of all cancers in adults.To prevent harmful autoantibodies, the group maps tolerance.',
        ),
      ).toEqual({
        value:
          'These account for 10% of all cancers in adults. To prevent harmful autoantibodies, the group maps tolerance.',
        rejected: false,
      });
    });

    it('leaves a URL field alone even though it matches the same shape', () => {
      expect(
        sanitizeObservationField('researchEntity', 'websiteUrl', 'https://medicine.Yale.edu/lab/x'),
      ).toEqual({ value: 'https://medicine.Yale.edu/lab/x', rejected: false });
    });
  });

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
      expect(sanitizeObservationField('fellowship', 'topics', topics)).toEqual({
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

    // #2285: a faculty profile's link text became the entity name, so a student
    // searching a professor found a card titled "Lab website".
    it('rejects a link label offered as a research-entity name', () => {
      for (const label of [
        'Lab website',
        'Portfolio Website',
        'Website',
        'Lab Site',
        'My Research Page',
      ]) {
        expect(sanitizeObservationField('researchEntity', 'name', label)).toEqual({
          value: undefined,
          rejected: true,
          reason: 'entity-name-furniture',
        });
      }
    });

    // The same link-label class on a profile's scholarly links, including the shape
    // the bare-person-name derivation manufactures out of the brand once the brand
    // itself is refused ("Google Scholar" -> "Google Scholar Lab"). Refused at ingest
    // so a repaired row is not re-polluted by a scrape that harvests the suffixed
    // anchor text directly (#2285).
    it('rejects a scholarly-platform link label offered as a research-entity name', () => {
      for (const label of [
        'Google Scholar',
        'Google Scholar Lab',
        'ORCID Faculty Research',
        'ResearchGate Group',
      ]) {
        expect(sanitizeObservationField('researchEntity', 'name', label)).toEqual({
          value: undefined,
          rejected: true,
          reason: 'entity-name-furniture',
        });
      }
    });

    it('keeps a real name that merely cites where its output lives', () => {
      expect(sanitizeObservationField('researchEntity', 'name', 'Onofrey Lab GitHub')).toEqual({
        value: 'Onofrey Lab GitHub',
        rejected: false,
      });
    });

    // `ysm-faculty-jaspreet-loyal` reached student_ready storing name "n/a": the
    // per-source guard in the microsite extractor rejected it, but nothing did at
    // the all-source ingest choke point (#2367).
    it('rejects a placeholder offered as a research-entity name', () => {
      for (const placeholder of ['n/a', 'N/A', 'none', 'unknown', 'TBD', 'untitled']) {
        expect(sanitizeObservationField('researchEntity', 'name', placeholder)).toEqual({
          value: undefined,
          rejected: true,
          reason: 'entity-name-furniture',
        });
      }
    });

    it('keeps a real name that merely contains a placeholder word', () => {
      expect(
        sanitizeObservationField('researchEntity', 'name', 'Unknown Pathogens Laboratory'),
      ).toEqual({ value: 'Unknown Pathogens Laboratory', rejected: false });
    });

    it('keeps the name a link label wraps instead of adopting the wrapper', () => {
      expect(sanitizeObservationField('researchEntity', 'name', 'Link to Boggon Lab')).toEqual({
        value: 'Boggon Lab',
        rejected: false,
      });
      expect(
        sanitizeObservationField(
          'researchEntity',
          'displayName',
          'Visit the Geha Research Group »',
        ),
      ).toEqual({
        value: 'Geha Research Group',
        rejected: false,
      });
    });

    it('leaves a legitimately named research home untouched', () => {
      for (const name of [
        'Geha Research Group',
        'Vanderlick Lab',
        'The Zimmerman Lab',
        'Belief Lab',
        'Vasiliou Laboratory (V-Lab)',
        'Yale Center for Emotional Intelligence',
      ]) {
        expect(sanitizeObservationField('researchEntity', 'name', name)).toEqual({
          value: name,
          rejected: false,
        });
      }
    });

    it('leaves source URLs, enum kinds, and non-string values alone', () => {
      expect(
        sanitizeObservationField('researchEntity', 'sourceUrls', ['https://x.example.edu']),
      ).toEqual({ value: ['https://x.example.edu'], rejected: false });
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

  describe('invisible format characters (leak class: text that reads correctly and matches nothing)', () => {
    it('strips a soft hyphen out of a person title so the role class test matches again', () => {
      const dirty = 'Assis\u00adtant Pro\u00adfes\u00adsor of Eco\u00adnom\u00adics';
      expect(/professor/i.test(dirty)).toBe(false);
      expect(sanitizeObservationField('user', 'title', dirty)).toEqual({
        value: 'Assistant Professor of Economics',
        rejected: false,
      });
    });

    it('strips a zero-width space out of a research entity name', () => {
      expect(
        sanitizeObservationField('researchEntity', 'name', 'Chen\u200b Neuroscience Laboratory'),
      ).toEqual({ value: 'Chen Neuroscience Laboratory', rejected: false });
    });

    it('strips a word joiner out of a description', () => {
      const result = sanitizeObservationField(
        'researchEntity',
        'fullDescription',
        'The lab studies neu\u2060ral circuits underlying memory using two-photon imaging.',
      );
      expect(result.rejected).toBe(false);
      expect(String(result.value)).toContain('neural circuits');
    });

    it('strips them from a list field, element by element', () => {
      expect(
        sanitizeObservationField('researchEntity', 'researchAreas', [
          'Neu\u200broscience',
          'Com\u00adputational Biology',
        ]),
      ).toEqual({ value: ['Neuroscience', 'Computational Biology'], rejected: false });
    });

    it('strips them from a field with no leak class of its own, such as a department', () => {
      expect(
        sanitizeObservationField('user', 'primaryDepartment', 'Eco\u00adnom\u00adics'),
      ).toEqual({ value: 'Economics', rejected: false });
    });

    it('strips them from prose nested inside a structured field, such as a grant abstract', () => {
      const result = sanitizeObservationField('researchEntity', 'recentGrants', [
        {
          id: 'R01-000000',
          title: 'Structural basis of RNA catalysis',
          abstract: 'The project studies cata\u00adlytic RNA fold\u200bing.',
        },
      ]);
      expect(result.rejected).toBe(false);
      expect(result.value).toEqual([
        {
          id: 'R01-000000',
          title: 'Structural basis of RNA catalysis',
          abstract: 'The project studies catalytic RNA folding.',
        },
      ]);
    });

    it('leaves a Date inside a structured field intact rather than rebuilding it', () => {
      const observedAt = new Date('2026-02-01T00:00:00Z');
      const result = sanitizeObservationField('researchEntity', 'rosterEnrichment', {
        fetchedAt: observedAt,
        note: 'Ros\u200bter fetched',
      });
      expect(result.rejected).toBe(false);
      expect(result.value).toEqual({ fetchedAt: observedAt, note: 'Roster fetched' });
      expect((result.value as { fetchedAt: unknown }).fetchedAt).toBeInstanceOf(Date);
    });

    it('folds a no-break space in a title to a plain space', () => {
      expect(sanitizeObservationField('user', 'title', 'Professor\u00a0of Economics')).toEqual({
        value: 'Professor of Economics',
        rejected: false,
      });
    });

    it('strips scraped furniture from a person name at ingest', () => {
      expect(sanitizeObservationField('user', 'displayName', 'Photo of Ada Byron.')).toEqual({
        value: 'Ada Byron',
        rejected: false,
      });
      expect(sanitizeObservationField('user', 'displayName', 'Ada Byron, PhD, MPH')).toEqual({
        value: 'Ada Byron',
        rejected: false,
      });
      expect(sanitizeObservationField('user', 'lname', 'BYRON')).toEqual({
        value: 'Byron',
        rejected: false,
      });
    });

    it('rejects a person name that is a directory slug rather than a name', () => {
      expect(sanitizeObservationField('user', 'displayName', 'byron_ada').rejected).toBe(true);
      expect(sanitizeObservationField('user', 'displayName', 'ada.byron').rejected).toBe(true);
    });

    it('keeps a person name that is legitimately punctuated or suffixed', () => {
      expect(sanitizeObservationField('user', 'displayName', "Gail D'Onofrio")).toEqual({
        value: "Gail D'Onofrio",
        rejected: false,
      });
      expect(sanitizeObservationField('user', 'displayName', 'Ada Byron Jr.')).toEqual({
        value: 'Ada Byron Jr.',
        rejected: false,
      });
    });

    it('strips furniture from the roster member name that becomes a stored person', () => {
      expect(
        sanitizeObservationField('researchGroupMember', 'name', 'Photo of Ada Byron.'),
      ).toEqual({ value: 'Ada Byron', rejected: false });
      expect(
        sanitizeObservationField('researchGroupMember', 'name', 'Ada Byron, PhD, MPH'),
      ).toEqual({ value: 'Ada Byron', rejected: false });
    });

    it('keeps an unrepairable roster member name rather than dropping the member', () => {
      expect(sanitizeObservationField('researchGroupMember', 'name', 'byron_ada')).toEqual({
        value: 'byron_ada',
        rejected: false,
      });
    });

    it('leaves a research-entity name field to the entity-name rules', () => {
      expect(
        sanitizeObservationField('researchEntity', 'displayName', 'Byron Lab, PhD').value,
      ).toBe('Byron Lab, PhD');
    });
  });
});
