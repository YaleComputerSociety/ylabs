import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { Observation } from '../../models/observation';
import { observationStoreIsPopulated } from '../observationStoreAvailability';

describe('observationStoreIsPopulated', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
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
});
