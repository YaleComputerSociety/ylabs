import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { StudentOutreach } from '../studentOutreach';
import { StudentEngagementEvent } from '../studentEngagementEvent';
import { StudentTracking } from '../studentTracking';
import { Grant } from '../grant';

const oid = () => new mongoose.Types.ObjectId();

const rawDoc = (model: mongoose.Model<unknown>, id: mongoose.Types.ObjectId) =>
  model.collection.findOne({ _id: id });

describe('legacy researchGroupId/researchGroupIds residue removed from schemas (#210)', () => {
  let mongo: MongoMemoryServer;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
    await mongoose.connect(mongo.getUri());
    await Promise.all([
      StudentOutreach.syncIndexes(),
      StudentEngagementEvent.syncIndexes(),
      StudentTracking.syncIndexes(),
      Grant.syncIndexes(),
    ]);
  }, 90000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      StudentOutreach.deleteMany({}),
      StudentEngagementEvent.deleteMany({}),
      StudentTracking.deleteMany({}),
      Grant.deleteMany({}),
    ]);
  });

  it('drops single-value researchGroupId while persisting the canonical researchEntityId', async () => {
    const legacyId = oid();
    const canonicalId = oid();
    const studentProfileId = oid();
    const trackingId = oid();

    const outreach = await StudentOutreach.create({
      studentProfileId,
      researchEntityId: canonicalId,
      trackingId,
      researchGroupId: legacyId,
    } as Record<string, unknown>);

    const tracking = await StudentTracking.create({
      studentProfileId,
      researchEntityId: canonicalId,
      researchGroupId: legacyId,
    } as Record<string, unknown>);

    const event = await StudentEngagementEvent.create({
      researchEntityId: canonicalId,
      eventType: 'view',
      researchGroupId: legacyId,
    } as Record<string, unknown>);

    for (const [model, id] of [
      [StudentOutreach, outreach._id],
      [StudentTracking, tracking._id],
      [StudentEngagementEvent, event._id],
    ] as const) {
      const persisted = (await rawDoc(model as mongoose.Model<unknown>, id)) as Record<
        string,
        unknown
      > | null;
      expect(persisted).not.toBeNull();
      expect(persisted).not.toHaveProperty('researchGroupId');
      expect(String(persisted?.researchEntityId)).toBe(canonicalId.toHexString());
    }
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

  it('preserves the canonical (studentProfileId, researchEntityId) uniqueness guarantee on trackings', async () => {
    const studentProfileId = oid();
    const researchEntityId = oid();

    await StudentTracking.create({ studentProfileId, researchEntityId });

    await expect(
      StudentTracking.create({ studentProfileId, researchEntityId }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});
