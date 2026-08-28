import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ResearchEntity } from '../researchEntity';

describe('research entity grant cache remains writable by the v4 grant backfill (#2145)', () => {
  let mongo: MongoMemoryServer;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
    await mongoose.connect(mongo.getUri(), { autoIndex: false });
  }, 90000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await ResearchEntity.deleteMany({});
  });

  it('persists lastGrantAtCache alongside recentGrantCount through a strict-mode update', async () => {
    const entity = await ResearchEntity.create({
      slug: 'grant-cache-lab',
      name: 'Grant Cache Lab',
      kind: 'lab',
    } as Record<string, unknown>);
    const lastGrantAt = new Date('2026-03-01T00:00:00.000Z');

    await ResearchEntity.updateOne(
      { _id: entity._id },
      { $set: { recentGrantCount: 2, lastGrantAtCache: lastGrantAt } },
    );

    const persisted = (await ResearchEntity.collection.findOne({ _id: entity._id })) as Record<
      string,
      unknown
    > | null;
    expect(persisted?.recentGrantCount).toBe(2);
    expect(persisted?.lastGrantAtCache).toEqual(lastGrantAt);
  });
});
