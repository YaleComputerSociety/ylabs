import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Observation } from '../../models/observation';
import { retireObservations } from '../observationStore';
import { entityIdAnchoredObservationsExcludedByEntityKeyScope } from '../entityMaterializer';

let memoryReplSet: MongoMemoryReplSet | undefined;

async function seedObservation(overrides: Record<string, unknown>) {
  return Observation.create({
    entityType: 'researchEntity',
    field: 'fullDescription',
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: 'synthetic-source',
    confidence: 0.5,
    superseded: false,
    observedAt: new Date(2026, 0, 1),
    ...overrides,
  });
}

describe('lossless full-log read excludes rollback-retired observations', () => {
  beforeAll(async () => {
    memoryReplSet = await MongoMemoryReplSet.create({
      binary: { version: '8.0.12' },
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await mongoose.connect(memoryReplSet.getUri('lossless_rollback_scope_test'));
  }, 120_000);

  beforeEach(async () => {
    await Observation.deleteMany({});
  });

  afterEach(() => {
    delete process.env.C4_LOSSLESS_INGEST;
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryReplSet?.stop();
  });

  it('flag ON: reads latest-wins-superseded rows but not rollback-retired ones', async () => {
    process.env.C4_LOSSLESS_INGEST = 'true';
    const entityId = new mongoose.Types.ObjectId();

    const live = await seedObservation({ entityId, value: 'live description' });
    const latestWinsSuperseded = await seedObservation({
      entityId,
      value: 'earlier description',
      superseded: true,
      supersededBy: live._id,
    });
    const retiredTarget = await seedObservation({ entityId, value: 'purged bad description' });
    await retireObservations(
      { entityType: 'researchEntity', entityId, field: 'fullDescription', _id: retiredTarget._id },
      'purge-bad-graft',
    );

    const included = await entityIdAnchoredObservationsExcludedByEntityKeyScope(
      'researchEntity',
      String(entityId),
      [],
    );

    const includedIds = included.map((observation: any) => String(observation._id));
    expect(includedIds).toContain(String(live._id));
    expect(includedIds).toContain(String(latestWinsSuperseded._id));
    expect(includedIds).not.toContain(String(retiredTarget._id));
  });

  it('flag OFF: reads only the single active row', async () => {
    delete process.env.C4_LOSSLESS_INGEST;
    const entityId = new mongoose.Types.ObjectId();

    const live = await seedObservation({ entityId, value: 'live description' });
    await seedObservation({
      entityId,
      value: 'earlier description',
      superseded: true,
      supersededBy: live._id,
    });
    const retiredTarget = await seedObservation({ entityId, value: 'purged bad description' });
    await retireObservations(
      { entityType: 'researchEntity', entityId, field: 'fullDescription', _id: retiredTarget._id },
      'purge-bad-graft',
    );

    const included = await entityIdAnchoredObservationsExcludedByEntityKeyScope(
      'researchEntity',
      String(entityId),
      [],
    );

    const includedIds = included.map((observation: any) => String(observation._id));
    expect(includedIds).toEqual([String(live._id)]);
  });
});
