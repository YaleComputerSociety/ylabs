import { describe, expect, it } from 'vitest';
import {
  normalizableStoredTextFields,
  planStoredTextNormalization,
} from '../storedTextNormalization';

const SOFT_HYPHEN = '­';

const GLUED_PROSE =
  'The Synthetic Laboratory studies epithelial repair.To do so it combines live imaging with organoid systems.';
const SEPARATED_PROSE =
  'The Synthetic Laboratory studies epithelial repair. To do so it combines live imaging with organoid systems.';

const plan = (
  stored: Record<string, unknown>,
  overrides: Partial<Parameters<typeof planStoredTextNormalization>[0]> = {},
) =>
  planStoredTextNormalization({
    entityType: 'researchEntity',
    stored,
    lockedFields: [],
    ...overrides,
  });

describe('planStoredTextNormalization', () => {
  it('corrects a stored prose boundary no observation asserts', () => {
    expect(plan({ fullDescription: GLUED_PROSE }).set).toEqual({
      fullDescription: SEPARATED_PROSE,
    });
  });

  it('strips an invisible format character from a stored name', () => {
    expect(plan({ name: `Synthetic${SOFT_HYPHEN} Imaging Core` }).set).toEqual({
      name: 'Synthetic Imaging Core',
    });
  });

  it('corrects a staged value too, because staging a field does not imply it was sanitized', () => {
    const result = plan(
      { fullDescription: SEPARATED_PROSE },
      { staged: { fullDescription: GLUED_PROSE } },
    );
    expect(result.set).toEqual({ fullDescription: SEPARATED_PROSE });
  });

  it('leaves an already-clean staged value alone', () => {
    const result = plan(
      { fullDescription: GLUED_PROSE },
      { staged: { fullDescription: SEPARATED_PROSE } },
    );
    expect(result.set).toEqual({});
    expect(result.refused).toEqual([]);
  });

  it('plans nothing on a second run, because the corpus is clean rather than marked', () => {
    const first = plan({ fullDescription: GLUED_PROSE });
    const second = plan({ fullDescription: first.set.fullDescription });
    expect(second.set).toEqual({});
  });

  it('skips a locked field and counts it, rather than writing over an operator value', () => {
    const result = plan({ fullDescription: GLUED_PROSE }, { lockedFields: ['fullDescription'] });
    expect(result.set).toEqual({});
    expect(result.refused).toEqual([{ field: 'fullDescription', reason: 'field-is-locked' }]);
  });

  it('refuses a correction that would empty the field', () => {
    const result = plan({ name: `${SOFT_HYPHEN}${SOFT_HYPHEN}` });
    expect(result.set).toEqual({});
    expect(result.refused).toEqual([{ field: 'name', reason: 'would-empty-the-field' }]);
  });

  it('never rewrites an identity field, because correcting a slug moves the page', () => {
    expect(normalizableStoredTextFields('researchEntity')).not.toContain('slug');
    expect(plan({ slug: `synthetic${SOFT_HYPHEN}lab` }).set).toEqual({});
  });

  it('restores a boundary only in prose, so a name keeping a period is left whole', () => {
    expect(plan({ name: 'Synthetic Inc.Group' }).set).toEqual({});
  });

  it('plans nothing for a row it has never seen', () => {
    expect(
      planStoredTextNormalization({
        entityType: 'researchEntity',
        stored: null,
        lockedFields: [],
      }),
    ).toEqual({ set: {}, refused: [] });
  });

  it('corrects a fellowship summary, which is the second collection the script swept', () => {
    expect(plan({ summary: GLUED_PROSE }, { entityType: 'fellowship' }).set).toEqual({
      summary: SEPARATED_PROSE,
    });
  });

  it('strips an invisible character from a researcher title, the third collection', () => {
    expect(
      plan({ title: `Senior Research${SOFT_HYPHEN} Scientist` }, { entityType: 'user' }).set,
    ).toEqual({ title: 'Senior Research Scientist' });
  });

  it('leaves a researcher name period alone, because a person name is not prose', () => {
    expect(plan({ displayName: 'Ada Synthetic Jr.Ph' }, { entityType: 'user' }).set).toEqual({});
  });

  it('plans nothing for an entity type with no normalizable stored text', () => {
    expect(normalizableStoredTextFields('researchGroupMember')).toEqual([]);
  });
});
