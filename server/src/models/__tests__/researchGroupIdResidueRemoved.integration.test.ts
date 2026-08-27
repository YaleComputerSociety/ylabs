import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Grant } from '../grant';

const oid = () => new mongoose.Types.ObjectId();

const rawDoc = (model: mongoose.Model<unknown>, id: mongoose.Types.ObjectId) =>
  model.collection.findOne({ _id: id });

describe('legacy researchGroupId/researchGroupIds residue removed from schemas (#210)', () => {
  let mongo: MongoMemoryServer;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
    await mongoose.connect(mongo.getUri());
    await Grant.syncIndexes();
  }, 90000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Grant.deleteMany({});
  });

  it('drops array researchGroupIds while persisting the canonical researchEntityIds on grants', async () => {
    const legacyIds = [oid(), oid()];
    const canonicalIds = [oid(), oid()];

    const grant = await Grant.create({
      externalId: 'GRANT-1',
      agency: 'NIH',
      title: 'A grant',
      researchEntityIds: canonicalIds,
      researchGroupIds: legacyIds,
    } as Record<string, unknown>);

    const persisted = (await rawDoc(Grant as mongoose.Model<unknown>, grant._id)) as Record<
      string,
      unknown
    > | null;
    expect(persisted).not.toBeNull();
    expect(persisted).not.toHaveProperty('researchGroupIds');
    expect((persisted?.researchEntityIds as mongoose.Types.ObjectId[]).map(String)).toEqual(
      canonicalIds.map((id) => id.toHexString()),
    );
  });
});
