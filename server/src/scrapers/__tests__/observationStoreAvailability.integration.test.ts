import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { Observation } from '../../models/observation';
import { observationStoreIsPopulated } from '../observationStoreAvailability';
import { assertObservationStoreAvailableForReconcile } from '../../scripts/reconcileNotCurrentlyAvailableAccessSignals';

describe('observationStoreIsPopulated', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(async () => {
    await mongoose.connection.db?.collection('observations').deleteMany({});
  });

  const seedObservation = () =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: 'fixture-entity',
      field: 'name',
      value: 'Fixture Entity',
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'fixture-source',
      confidence: 0.9,
      scrapeRunId: new mongoose.Types.ObjectId(),
      observedAt: new Date(),
    });

  it('reports an existing-but-empty collection as unpopulated', async () => {
    // The collection exists here because importing the model creates it, which is
    // exactly the Beta/Production shape: presence proves nothing about population.
    await mongoose.connection.db?.createCollection('observations').catch(() => undefined);
    expect(await observationStoreIsPopulated()).toBe(false);
  });

  it('reports a store holding at least one document as populated', async () => {
    await seedObservation();
    expect(await observationStoreIsPopulated()).toBe(true);
  });

  it('refuses the NOT_CURRENTLY_AVAILABLE reconcile when the store is empty', async () => {
    await expect(assertObservationStoreAvailableForReconcile()).rejects.toThrow(
      /observation store holds no documents/,
    );
  });

  it('allows the reconcile once the store holds observations', async () => {
    await seedObservation();
    await expect(assertObservationStoreAvailableForReconcile()).resolves.toBeUndefined();
  });
});
