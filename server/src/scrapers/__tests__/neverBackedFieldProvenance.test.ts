import { describe, expect, it, vi } from 'vitest';
import { DERIVED_RESEARCH_AREA_SOURCE_NAME } from '../../models/fieldProvenanceBacking';
import { planNeverBackedFieldProvenanceRetirement } from '../neverBackedFieldProvenance';

const lane = { sourceName: 'synthetic-retired-repair', sourceUrl: 'https://example.org/' };

const plan = (
  fieldProvenance: Record<string, unknown>,
  overrides: Partial<Parameters<typeof planNeverBackedFieldProvenanceRetirement>[0]> = {},
  observed = false,
) => {
  const sourceObservedField = vi.fn().mockResolvedValue(observed);
  return {
    sourceObservedField,
    result: planNeverBackedFieldProvenanceRetirement({
      stored: { _id: 'synthetic-id', slug: 'synthetic-row', fieldProvenance },
      set: {},
      unset: {},
      lockedFields: [],
      sourceObservedField,
      ...overrides,
    }),
  };
};

describe('planNeverBackedFieldProvenanceRetirement', () => {
  it('retires only an entry whose lane never observed the field on this row', async () => {
    expect(await plan({ entityType: lane }).result).toEqual(['entityType']);
    expect(await plan({ entityType: lane }, {}, true).result).toEqual([]);
  });

  it('asks about the row by both identifiers and about the field and lane the entry names', async () => {
    const { sourceObservedField, result } = plan({ school: lane });
    await result;
    expect(sourceObservedField).toHaveBeenCalledWith({
      entityKey: 'synthetic-row',
      entityId: 'synthetic-id',
      field: 'school',
      sourceName: 'synthetic-retired-repair',
    });
  });

  it('never asks the observation log about an entry it would keep anyway', async () => {
    const { sourceObservedField, result } = plan({
      researchAreas: { sourceName: DERIVED_RESEARCH_AREA_SOURCE_NAME, sourceUrl: '' },
      name: { ...lane, observationId: 'synthetic-observation' },
      departments: { ...lane, sourceId: 'synthetic-source' },
      website: { sourceUrl: 'https://example.org/' },
    });
    expect(await result).toEqual([]);
    expect(sourceObservedField).not.toHaveBeenCalled();
  });

  it('defers to the pass itself, to a lock, and to a scope', async () => {
    const provenance = { entityType: lane, school: lane, departments: lane, name: lane };
    expect(
      await plan(provenance, {
        set: { 'fieldProvenance.entityType': { ...lane, observationId: 'x' } },
        unset: { 'fieldProvenance.school': '' },
        lockedFields: ['departments'],
      }).result,
    ).toEqual(['name']);
    expect(await plan(provenance, { scopedFields: ['school'] }).result).toEqual(['school']);
  });

  it('reads a Mongoose Map as well as a plain object', async () => {
    expect(
      await plan(new Map([['entityType', lane]]) as unknown as Record<string, unknown>).result,
    ).toEqual(['entityType']);
  });
});
