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

const NETID = 'aq6431';
const DIRECTORY_KEY = NETID;
const ROSTER_KEY = 'dept:fixture-studies:fixture-q-quillsby';
const LIST_NAME = 'Fixture Quillsby';
const STATED_NAME = 'Fixture Q. Quillsby';

describe('fill-only names and name-joined website fills (#6431, #6432)', () => {
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

  const clear = async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'researchers', 'accounts']) {
      await db.collection(name).deleteMany({});
    }
    resetOverSharedPersonWebsiteKeysCache();
  };

  beforeEach(clear);

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

  const seedDirectoryKey = () =>
    Observation.insertMany(
      [
        ['netid', NETID],
        ['fname', 'Fixture'],
        ['lname', 'Quillsby'],
        ['userType', 'professor'],
      ].map(([field, value]) =>
        observation(
          DIRECTORY_KEY,
          'yale-directory',
          'https://api.yalies.io/v2/people',
          field,
          value,
        ),
      ),
    );

  const seedRosterKey = (extra: Array<[string, unknown]> = []) =>
    Observation.insertMany(
      [['fname', 'Fixture Q.'] as [string, unknown], ['lname', 'Quillsby'], ...extra].map(
        ([field, value]) =>
          observation(
            ROSTER_KEY,
            'dept-faculty-roster',
            'https://fixture-studies.example.edu/faculty/',
            field,
            value,
          ),
      ),
    );

  const seedPersonHeldByDirectory = async () => {
    const person = await Researcher.create({
      displayName: LIST_NAME,
      identifiers: { netid: NETID },
      profile: {},
      profileLinks: [],
      status: 'UNKNOWN',
      archived: false,
    });
    await Researcher.updateOne(
      { _id: person._id },
      {
        $set: {
          profileFieldWriters: {
            displayName: { userKey: DIRECTORY_KEY, joinRank: 4, confidence: 1, fillOnly: true },
          },
        },
      },
    );
    return person;
  };

  const resolve = (key: string) => materializeEntity('user', { entityKey: key }, {});
  const stored = async (id: unknown) => Researcher.findById(id).lean<any>();

  it('settles on the fuller stated name over a directory list name in either order, then writes nothing', async () => {
    for (const order of [
      [DIRECTORY_KEY, ROSTER_KEY],
      [ROSTER_KEY, DIRECTORY_KEY],
    ]) {
      await clear();
      await seedDirectoryKey();
      await seedRosterKey();
      const person = await seedPersonHeldByDirectory();

      for (const key of order) await resolve(key);
      expect((await stored(person._id))?.displayName).toBe(STATED_NAME);

      const second = [];
      for (const key of order) second.push((await resolve(key)).fieldsWritten);
      expect(second).toEqual([0, 0]);
      expect((await stored(person._id))?.displayName).toBe(STATED_NAME);
    }
  });

  it('does not fill an empty website from a name-joined key with a site not named for the person', async () => {
    await seedDirectoryKey();
    await seedRosterKey([['website', 'https://lab.example.org/']]);
    const person = await seedPersonHeldByDirectory();

    await resolve(ROSTER_KEY);

    expect((await stored(person._id))?.profile?.websiteUrl).toBeUndefined();
  });

  it('fills an empty website from a name-joined key when the site carries the surname', async () => {
    await seedDirectoryKey();
    await seedRosterKey([['website', 'https://quillsby-lab.example.org/']]);
    const person = await seedPersonHeldByDirectory();

    await resolve(ROSTER_KEY);

    expect((await stored(person._id))?.profile?.websiteUrl).toBe(
      'https://quillsby-lab.example.org/',
    );
  });
});
