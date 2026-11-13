import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadLaneTitledPersonKeys } from '../utils/laneTitledPersonKeys';

const LANE = 'ysm-faculty-directory';

const titleRead = (entityKey: string, extra: Record<string, unknown> = {}) => ({
  entityType: 'user',
  entityKey,
  field: 'title',
  value: 'Postdoctoral Associate',
  sourceId: new mongoose.Types.ObjectId(),
  sourceName: LANE,
  sourceUrl: `https://medicine.yale.edu/profile/${entityKey.replace(/\W+/g, '-')}/`,
  confidence: 0.8,
  observedAt: new Date('2026-08-29T00:00:00Z'),
  superseded: false,
  ...extra,
});

describe('loadLaneTitledPersonKeys (#5801)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    await mongoose.connection.db!.collection('observations').deleteMany({});
  });

  it('returns only keys with a live, not rolled back title read from the lane', async () => {
    await mongoose.connection.db!.collection('observations').insertMany([
      titleRead('ysm:live-title'),
      titleRead('ysm:superseded-title', { superseded: true }),
      titleRead('ysm:rolled-back-title', {
        rollback: { rolledBackAt: new Date('2026-11-01T00:00:00Z') },
      }),
      titleRead('ysm:other-lane-title', { sourceName: 'dept-faculty-roster' }),
      titleRead('ysm:other-field', { field: 'bio' }),
      titleRead('ysm:research-row', { entityType: 'researchEntity' }),
    ]);
    expect([...(await loadLaneTitledPersonKeys(LANE))]).toEqual(['ysm:live-title']);
  });
});
