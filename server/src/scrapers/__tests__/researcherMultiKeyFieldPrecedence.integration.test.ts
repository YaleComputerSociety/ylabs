import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(undefined),
    deleteFromIndex: vi.fn().mockResolvedValue(undefined),
  };
});

import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { materializeEntity } from '../entityMaterializer';
import { resetOverSharedPersonWebsiteKeysCache } from '../overSharedPersonWebsite';

const KEY_A = 'dept:fixture-a:fixture-person';
const KEY_B = 'dept:fixture-b:fixture-person';

describe('several user keys joining one researcher settle on one value (#5706)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'researchers', 'accounts']) {
      await db.collection(name).deleteMany({});
    }
    resetOverSharedPersonWebsiteKeysCache();
  });

  const observation = (entityKey: string, field: string, value: unknown) => ({
    entityType: 'user',
    entityKey,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: 'dept-faculty-roster',
    sourceUrl: `https://${entityKey.split(':')[1]}.example.edu/faculty/`,
    confidence: 1,
    observedAt: new Date('2026-03-01T00:00:00Z'),
    superseded: false,
    field,
    value,
  });

  const seedKey = (key: string, department: string, title: string) =>
    Observation.insertMany([
      observation(key, 'fname', 'Fixture'),
      observation(key, 'lname', 'Quillsby'),
      observation(key, 'primaryDepartment', department),
      observation(key, 'title', title),
    ]);

  const seed = async () => {
    await seedKey(KEY_A, 'Fixture Studies', 'Professor of Fixture Studies');
    await seedKey(KEY_B, 'Applied Fixtures', 'Professor of Applied Fixtures');
    return Researcher.create({
      displayName: 'Fixture Quillsby',
      profileLinks: [],
      status: 'UNKNOWN',
      archived: false,
    });
  };

  const resolve = (key: string) => materializeEntity('user', { entityKey: key }, {});
  const profileOf = async (id: unknown) =>
    (await Researcher.findById(id).lean<any>())?.profile ?? {};

  it('writes nothing on a second full pass', async () => {
    const person = await seed();

    const first = [await resolve(KEY_A), await resolve(KEY_B)];
    expect(first.map((result) => String(result.entityId))).toEqual([
      String(person._id),
      String(person._id),
    ]);
    const settled = await profileOf(person._id);

    const second = [await resolve(KEY_A), await resolve(KEY_B)];
    expect(second.map((result) => result.fieldsWritten)).toEqual([0, 0]);
    expect(await profileOf(person._id)).toEqual(settled);
  });

  it('settles on the same values whichever key resolves first', async () => {
    const forward = await seed();
    await resolve(KEY_A);
    await resolve(KEY_B);
    const forwardProfile = await profileOf(forward._id);

    const db = mongoose.connection.db!;
    for (const name of ['observations', 'researchers']) await db.collection(name).deleteMany({});
    const backward = await seed();
    await resolve(KEY_B);
    await resolve(KEY_A);

    expect(await profileOf(backward._id)).toEqual(forwardProfile);
  });
});
