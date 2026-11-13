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

const NETID = 'aq6035';
const DIRECTORY_KEY = NETID;
const ROSTER_KEY = 'dept:fixture-studies:fixture-quillsby-marlow';
const FULL_NAME = 'Fixture Q. Quillsby-Marlow';
const DIRECTORY_NAME = 'Fixture Quillsby';

describe('a directory name never replaces a page name (#6035)', () => {
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
    ]);
  };

  const seedRosterKey = () => {
    const at = (field: string, value: unknown) =>
      observation(
        ROSTER_KEY,
        'dept-faculty-roster',
        'https://fixture-studies.example.edu/faculty/',
        field,
        value,
      );
    return Observation.insertMany([at('fname', 'Fixture Q.'), at('lname', 'Quillsby-Marlow')]);
  };

  const seedPerson = (displayName = FULL_NAME) =>
    Researcher.create({
      displayName,
      identifiers: { netid: NETID },
      profile: {},
      profileLinks: [],
      status: 'UNKNOWN',
      archived: false,
    });

  const resolve = (key: string) => materializeEntity('user', { entityKey: key }, {});
  const nameOf = async (id: unknown) => (await Researcher.findById(id).lean<any>())?.displayName;

  it('never replaces a roster name, whichever key resolves first', async () => {
    for (const order of [
      [DIRECTORY_KEY, ROSTER_KEY],
      [ROSTER_KEY, DIRECTORY_KEY],
    ]) {
      const db = mongoose.connection.db!;
      for (const name of ['observations', 'researchers']) await db.collection(name).deleteMany({});
      await seedDirectoryKey();
      await seedRosterKey();
      const person = await seedPerson();

      const joined = [];
      for (const key of order) joined.push(String((await resolve(key)).entityId));
      expect(joined).toEqual([String(person._id), String(person._id)]);
      expect(await nameOf(person._id)).toBe(FULL_NAME);

      const second = [];
      for (const key of order) second.push((await resolve(key)).fieldsWritten);
      expect(second).toEqual([0, 0]);
      expect(await nameOf(person._id)).toBe(FULL_NAME);
    }
  });

  it('leaves a stored name no writer is recorded for', async () => {
    await seedDirectoryKey();
    const person = await seedPerson();

    const result = await resolve(DIRECTORY_KEY);

    expect(String(result.entityId)).toBe(String(person._id));
    expect(await nameOf(person._id)).toBe(FULL_NAME);
    expect((await resolve(DIRECTORY_KEY)).fieldsWritten).toBe(0);
  });

  it('gives a name the directory key already writes up to a page name that arrives later', async () => {
    await seedDirectoryKey();
    const person = await seedPerson(DIRECTORY_NAME);
    await Researcher.updateOne(
      { _id: person._id },
      {
        $set: {
          profileFieldWriters: {
            displayName: { userKey: DIRECTORY_KEY, joinRank: 4, confidence: 1 },
          },
        },
      },
    );
    await resolve(DIRECTORY_KEY);
    expect(await nameOf(person._id)).toBe(DIRECTORY_NAME);

    await Observation.insertMany(
      [
        ['netid', NETID],
        ['fname', 'Fixture Q.'],
        ['lname', 'Quillsby-Marlow'],
      ].map(([field, value]) =>
        observation(
          ROSTER_KEY,
          'dept-faculty-roster',
          'https://fixture-studies.example.edu/faculty/',
          field,
          value,
        ),
      ),
    );
    await resolve(ROSTER_KEY);
    await resolve(DIRECTORY_KEY);

    expect(await nameOf(person._id)).toBe(FULL_NAME);
    expect((await resolve(DIRECTORY_KEY)).fieldsWritten).toBe(0);
    expect((await resolve(ROSTER_KEY)).fieldsWritten).toBe(0);
  });

  const seedKey = (entityKey: string, sourceName: string, fields: Record<string, string>) =>
    Observation.insertMany(
      Object.entries(fields).map(([field, value]) =>
        observation(
          entityKey,
          sourceName,
          'https://fixture-studies.example.edu/people/',
          field,
          value,
        ),
      ),
    );

  const settledInEitherOrder = async (
    seed: () => Promise<unknown>,
    storedName: string,
    keys: [string, string],
  ) => {
    const names = [];
    for (const order of [keys, [keys[1], keys[0]]]) {
      const db = mongoose.connection.db!;
      for (const name of ['observations', 'researchers']) await db.collection(name).deleteMany({});
      await seed();
      const person = await seedPerson(storedName);
      const joined = [];
      for (const key of order) joined.push(String((await resolve(key)).entityId));
      expect(joined).toEqual([String(person._id), String(person._id)]);
      const second = [];
      for (const key of order) second.push((await resolve(key)).fieldsWritten);
      expect(second).toEqual([0, 0]);
      names.push(await nameOf(person._id));
    }
    return names;
  };

  it('never lets a key joined on the name alone replace a stored name, in either order', async () => {
    const nameKey = 'dept:fixture-studies:fixture-quillsby';
    const names = await settledInEitherOrder(
      async () => {
        await seedDirectoryKey();
        await seedKey(nameKey, 'dept-faculty-roster', { fname: 'Fixture', lname: 'Quillsby' });
      },
      'Fixture Q. Quillsby',
      [DIRECTORY_KEY, nameKey],
    );
    expect(names).toEqual(['Fixture Q. Quillsby', 'Fixture Q. Quillsby']);
  });

  it('still lets a netid-joined profile key replace a shorter directory name, in either order', async () => {
    const profileKey = 'official-profile:fixture-quillsby-marlow';
    const names = await settledInEitherOrder(
      async () => {
        await seedDirectoryKey();
        await seedKey(profileKey, 'official-profile-pi-backfill', {
          netid: NETID,
          displayName: FULL_NAME,
        });
      },
      DIRECTORY_NAME,
      [DIRECTORY_KEY, profileKey],
    );
    expect(names).toEqual([FULL_NAME, FULL_NAME]);
  });
});
