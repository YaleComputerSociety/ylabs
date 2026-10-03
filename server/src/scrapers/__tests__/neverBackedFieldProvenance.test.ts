import mongoose from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { DERIVED_RESEARCH_AREA_SOURCE_NAME } from '../../models/fieldProvenanceBacking';
import {
  lockedNeverBackedProvenanceFields,
  planNeverBackedFieldProvenanceRetirement,
  planUnrecordedProvenanceObservationRelink,
} from '../neverBackedFieldProvenance';

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
      entityKeys: ['synthetic-row'],
      entityIds: ['synthetic-id'],
      field: 'school',
      sourceName: 'synthetic-retired-repair',
    });
  });

  it('asks about every merged-in row too, because a lane that read a merged-in key backs the value', async () => {
    const mergedInId = new mongoose.Types.ObjectId();
    const { sourceObservedField, result } = plan(
      { school: lane },
      { mergedInRows: [{ _id: mergedInId, slug: 'synthetic-merged-row' }] },
    );
    await result;
    expect(sourceObservedField).toHaveBeenCalledWith({
      entityKeys: ['synthetic-row', 'synthetic-merged-row'],
      entityIds: ['synthetic-id', mergedInId.toHexString()],
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

describe('planUnrecordedProvenanceObservationRelink (#3788)', () => {
  const entry = {
    sourceName: 'synthetic-inheriting-lane',
    sourceUrl: '',
    observedAt: new Date('2026-09-01T00:00:00Z'),
    confidence: 0.5,
  };
  const observation = {
    _id: 'synthetic-observation',
    sourceId: 'synthetic-source',
    value: ['Synthetic Department'],
  };

  const relink = (
    overrides: Partial<Parameters<typeof planUnrecordedProvenanceObservationRelink>[0]> = {},
    live: unknown[] = [observation],
  ) => {
    const liveObservations = vi.fn().mockResolvedValue(live);
    return {
      liveObservations,
      result: planUnrecordedProvenanceObservationRelink({
        stored: {
          _id: 'synthetic-id',
          slug: 'synthetic-row',
          departments: ['Synthetic Department'],
          fieldProvenance: { departments: entry },
        },
        set: {},
        unset: {},
        lockedFields: [],
        liveObservations,
        ...overrides,
      }),
    };
  };

  it('cites the one live observation of the lane that states the stored value, in schema key order', async () => {
    const { liveObservations, result } = relink();
    const planned = await result;
    expect(planned).toEqual({
      departments: {
        sourceId: 'synthetic-source',
        sourceName: 'synthetic-inheriting-lane',
        sourceUrl: '',
        observationId: 'synthetic-observation',
        observedAt: entry.observedAt,
        confidence: 0.5,
      },
    });
    expect(Object.keys(planned.departments)).toEqual([
      'sourceId',
      'sourceName',
      'sourceUrl',
      'observationId',
      'observedAt',
      'confidence',
    ]);
    expect(liveObservations).toHaveBeenCalledWith({
      entityKeys: ['synthetic-row'],
      entityIds: ['synthetic-id'],
      field: 'departments',
      sourceName: 'synthetic-inheriting-lane',
    });
  });

  it('leaves an ambiguous or unmatched entry alone rather than guessing', async () => {
    expect(await relink({}, [observation, { ...observation, _id: 'another' }]).result).toEqual({});
    expect(await relink({}, [{ ...observation, value: ['Another Department'] }]).result).toEqual(
      {},
    );
    expect(await relink({}, []).result).toEqual({});
  });

  it('compares against the value the row will hold after this pass', async () => {
    expect(await relink({ set: { departments: ['Another Department'] } }).result).toEqual({});
    expect(await relink({ unset: { departments: '' } }).result).toEqual({});
  });

  it('defers to the pass itself, to a lock, and to a scope, and never asks about an entry that carries evidence', async () => {
    const { liveObservations, result } = relink({
      stored: {
        _id: 'synthetic-id',
        slug: 'synthetic-row',
        departments: ['Synthetic Department'],
        school: 'Synthetic School',
        name: 'Synthetic Name',
        entityType: 'LAB',
        fieldProvenance: {
          departments: entry,
          school: entry,
          name: entry,
          entityType: { ...entry, observationId: 'already-recorded' },
        },
      },
      set: { 'fieldProvenance.departments': { ...entry, observationId: 'written-this-pass' } },
      lockedFields: ['school'],
      scopedFields: ['departments', 'school', 'entityType'],
    });
    expect(await result).toEqual({});
    expect(liveObservations).not.toHaveBeenCalled();
  });
});

describe('lockedNeverBackedProvenanceFields', () => {
  it('names only a locked field whose entry cites no evidence and whose lane never observed it', async () => {
    const sourceObservedField = vi.fn(async ({ field }: { field: string }) => field === 'name');
    const fields = await lockedNeverBackedProvenanceFields({
      stored: {
        _id: 'synthetic-id',
        slug: 'synthetic-row',
        manuallyLockedFields: ['shortDescription', 'name', 'researchAreas', 'displayName'],
        fieldProvenance: {
          shortDescription: lane,
          name: lane,
          researchAreas: { ...lane, observationId: 'synthetic-observation' },
          fullDescription: lane,
          displayName: { sourceName: DERIVED_RESEARCH_AREA_SOURCE_NAME },
        },
      },
      sourceObservedField,
    });
    expect(fields).toEqual(['shortDescription']);
  });
});
