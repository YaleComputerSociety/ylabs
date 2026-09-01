import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Observation } from '../../models/observation';
import { retireObservations } from '../observationStore';

let memoryReplSet: MongoMemoryReplSet | undefined;

async function seedObservation(overrides: Record<string, unknown>) {
  return Observation.create({
    entityType: 'researchEntity',
    field: 'methods',
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: 'synthetic-source',
    confidence: 0.5,
    superseded: false,
    ...overrides,
  });
}

describe('retireObservations against a real Observation store', () => {
  beforeAll(async () => {
    memoryReplSet = await MongoMemoryReplSet.create({
      binary: { version: '8.0.12' },
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await mongoose.connect(memoryReplSet.getUri('retire_observations_test'));
  }, 120_000);

  beforeEach(async () => {
    await Observation.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryReplSet?.stop();
  });

  it('supersedes matching live observations with a rollback reason and leaves others intact', async () => {
    const entityId = new mongoose.Types.ObjectId();

    const liveTargetA = await seedObservation({ entityId, field: 'methods', value: 'assay A' });
    const liveTargetB = await seedObservation({ entityId, field: 'methods', value: 'assay B' });
    const otherField = await seedObservation({ entityId, field: 'researchAreas', value: 'neuro' });
    const alreadySuperseded = await seedObservation({
      entityId,
      field: 'methods',
      value: 'old assay',
      superseded: true,
      supersededBy: liveTargetA._id,
    });

    const result = await retireObservations(
      { entityType: 'researchEntity', entityId, field: 'methods' },
      'orphaned-after-rename',
    );

    expect(result).toEqual({ retired: 2 });

    for (const doc of [liveTargetA, liveTargetB]) {
      const reloaded = await Observation.findById(doc._id).lean();
      expect(reloaded?.superseded).toBe(true);
      expect((reloaded as any)?.rollback?.reason).toBe('orphaned-after-rename');
      expect((reloaded as any)?.rollback?.rolledBackAt).toBeInstanceOf(Date);
    }

    const untouchedField = await Observation.findById(otherField._id).lean();
    expect(untouchedField?.superseded).toBe(false);
    expect((untouchedField as any)?.rollback).toBeUndefined();

    const priorSupersede = await Observation.findById(alreadySuperseded._id).lean();
    expect(priorSupersede?.superseded).toBe(true);
    expect((priorSupersede as any)?.rollback).toBeUndefined();
    expect((priorSupersede as any)?.supersededBy?.toString()).toBe(liveTargetA._id.toString());
  });

  it('reports zero retired and writes nothing when no live observation matches', async () => {
    await seedObservation({ entityKey: 'smith-lab', superseded: true });

    const result = await retireObservations({ entityKey: 'smith-lab' }, 'test');

    expect(result).toEqual({ retired: 0 });
    const stillSingle = await Observation.countDocuments({});
    expect(stillSingle).toBe(1);
    const doc = await Observation.findOne({ entityKey: 'smith-lab' }).lean();
    expect((doc as any)?.rollback).toBeUndefined();
  });
});
