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

const NETID = 'fq123';
const DIRECTORY_KEY = NETID;
const OFFICIAL_KEY = 'dept:fixture-studies:fixture-quillsby';
const OFFICIAL_DEPARTMENT = 'Fixture Studies';
const DIRECTORY_DEPARTMENT = 'Applied Fixtures';

describe('a directory department only fills an empty field (#5741)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Observation.syncIndexes();
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

  const observation = (
    entityKey: string,
    sourceName: string,
    sourceUrl: string,
    field: string,
    value: unknown,
  ) => ({
    entityType: 'user',
    entityKey,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName,
    sourceUrl,
    confidence: 1,
    observedAt: new Date('2026-03-01T00:00:00Z'),
    superseded: false,
    field,
    value,
  });

  const seedDirectoryKey = () => {
    const at = (field: string, value: unknown) =>
      observation(DIRECTORY_KEY, 'yale-directory', 'https://api.yalies.io/v2/people', field, value);
    return Observation.insertMany([
      at('netid', NETID),
      at('fname', 'Fixture'),
      at('lname', 'Quillsby'),
      at('userType', 'professor'),
      at('primaryDepartment', DIRECTORY_DEPARTMENT),
    ]);
  };

  const seedOfficialKey = () => {
    const at = (field: string, value: unknown) =>
      observation(
        OFFICIAL_KEY,
        'dept-faculty-roster',
        'https://fixture-studies.example.edu/faculty/',
        field,
        value,
      );
    return Observation.insertMany([
      at('fname', 'Fixture'),
      at('lname', 'Quillsby'),
      at('primaryDepartment', OFFICIAL_DEPARTMENT),
    ]);
  };

  const seedPerson = (profile: Record<string, string> = {}) =>
    Researcher.create({
      displayName: 'Fixture Quillsby',
      identifiers: { netid: NETID },
      profile,
      profileLinks: [],
      status: 'UNKNOWN',
      archived: false,
    });

  const resolve = (key: string) => materializeEntity('user', { entityKey: key }, {});
  const departmentOf = async (id: unknown) =>
    (await Researcher.findById(id).lean<any>())?.profile?.primaryDepartment;

  it('never outranks or ties an official department, whichever key resolves first', async () => {
    for (const order of [
      [DIRECTORY_KEY, OFFICIAL_KEY],
      [OFFICIAL_KEY, DIRECTORY_KEY],
    ]) {
      const db = mongoose.connection.db!;
      for (const name of ['observations', 'researchers']) await db.collection(name).deleteMany({});
      await seedDirectoryKey();
      await seedOfficialKey();
      const person = await seedPerson();

      const joined = [];
      for (const key of order) joined.push(String((await resolve(key)).entityId));
      expect(joined).toEqual([String(person._id), String(person._id)]);
      expect(await departmentOf(person._id)).toBe(OFFICIAL_DEPARTMENT);

      const second = [];
      for (const key of order) second.push((await resolve(key)).fieldsWritten);
      expect(second).toEqual([0, 0]);
      expect(await departmentOf(person._id)).toBe(OFFICIAL_DEPARTMENT);
    }
  });

  it('fills an empty department, and the same value is re-derived on a second resolve', async () => {
    await seedDirectoryKey();
    const person = await seedPerson();

    await resolve(DIRECTORY_KEY);
    expect(await departmentOf(person._id)).toBe(DIRECTORY_DEPARTMENT);

    expect((await resolve(DIRECTORY_KEY)).fieldsWritten).toBe(0);
    expect(await departmentOf(person._id)).toBe(DIRECTORY_DEPARTMENT);
  });

  it('gives a filled department up to an official one that arrives later', async () => {
    await seedDirectoryKey();
    const person = await seedPerson();
    await resolve(DIRECTORY_KEY);

    await seedOfficialKey();
    await resolve(OFFICIAL_KEY);
    await resolve(DIRECTORY_KEY);

    expect(await departmentOf(person._id)).toBe(OFFICIAL_DEPARTMENT);
  });

  it('leaves a stored department no writer is recorded for', async () => {
    await seedDirectoryKey();
    const person = await seedPerson({ primaryDepartment: OFFICIAL_DEPARTMENT });

    await resolve(DIRECTORY_KEY);

    expect(await departmentOf(person._id)).toBe(OFFICIAL_DEPARTMENT);
  });
});
