import { describe, expect, it } from 'vitest';
import { sanitizeProjectedField, materializedFieldValue } from '../entityMaterializer';
import { sanitizeResearchEntityDescription } from '../../utils/descriptionHygiene';
import { sanitizeObservationField } from '../observationFieldSanitizer';

const RESEARCH_ENTITY = 'researchEntity' as const;

const CLEAN_FIXTURES: Array<{ field: string; value: unknown }> = [
  {
    field: 'fullDescription',
    value:
      'The lab studies neural circuits underlying memory using two-photon imaging and computational modeling.',
  },
  { field: 'shortDescription', value: 'Studies neural circuits underlying memory formation.' },
  { field: 'name', value: 'Chen Neuroscience Laboratory' },
  { field: 'displayName', value: 'Chen Neuroscience Laboratory' },
];

describe('sanitizeProjectedField parity with materializedFieldValue', () => {
  it('is byte-identical to the prior materialize path on already-clean input', () => {
    for (const { field, value } of CLEAN_FIXTURES) {
      expect(sanitizeProjectedField(RESEARCH_ENTITY, field, value)).toEqual(
        materializedFieldValue(RESEARCH_ENTITY, field, value),
      );
    }
  });

  it('passes structured non-string fields through unchanged, matching materialize', () => {
    const kind = sanitizeProjectedField(RESEARCH_ENTITY, 'kind', 'lab', 'lab');
    expect(kind).toEqual(materializedFieldValue(RESEARCH_ENTITY, 'kind', 'lab', 'lab'));
  });
});

describe('sanitizeProjectedField cleans values that bypassed ingest', () => {
  it('redacts a raw email that reached the projection uncleaned', () => {
    const dirty =
      'Reach the team at contact@synthetic-lab.test for details. The lab studies protein folding.';
    const cleaned = sanitizeProjectedField(RESEARCH_ENTITY, 'fullDescription', dirty);
    expect(String(cleaned)).not.toContain('contact@synthetic-lab.test');
  });
});

describe('sanitizeProjectedField is idempotent', () => {
  it('applying twice equals applying once', () => {
    const dirty =
      'Reach the team at contact@synthetic-lab.test. The lab studies protein folding and dynamics.';
    const once = sanitizeProjectedField(RESEARCH_ENTITY, 'fullDescription', dirty);
    const twice = sanitizeProjectedField(RESEARCH_ENTITY, 'fullDescription', once);
    expect(twice).toEqual(once);
  });
});

describe('serve-time prose sanitize is a no-op on projected output', () => {
  it('sanitizeResearchEntityDescription does not change projected description text', () => {
    for (const field of ['fullDescription', 'shortDescription']) {
      const projected = sanitizeProjectedField(
        RESEARCH_ENTITY,
        field,
        'The lab studies neural circuits underlying memory using two-photon imaging.',
      );
      expect(sanitizeResearchEntityDescription(String(projected))).toEqual(String(projected));
    }
  });
});

describe('sanitizeProjectedField strips invisible format characters (#2874)', () => {
  it('cleans a soft hyphen out of a stored name, so a rematerialize corrects the row', () => {
    const dirty = 'Chen\u00ad Neuro\u00adscience Labora\u00adtory';
    expect(/laboratory/i.test(dirty)).toBe(false);
    expect(sanitizeProjectedField(RESEARCH_ENTITY, 'name', dirty)).toBe(
      'Chen Neuroscience Laboratory',
    );
  });

  it('cleans a zero-width space out of a stored description', () => {
    const dirty =
      'The lab studies neu\u200bral circuits underlying memory using two-photon imaging.';
    expect(String(sanitizeProjectedField(RESEARCH_ENTITY, 'fullDescription', dirty))).toContain(
      'neural circuits',
    );
  });

  it('cleans them even when the ingest step rejects the value it is asked to keep', () => {
    const furniture = 'Home\u00adAbout\u00adPeople\u00adContact';
    expect(sanitizeObservationField('user', 'title', furniture).rejected).toBe(true);
    expect(String(sanitizeProjectedField('user', 'title', furniture))).toBe(
      'HomeAboutPeopleContact',
    );
  });
});
