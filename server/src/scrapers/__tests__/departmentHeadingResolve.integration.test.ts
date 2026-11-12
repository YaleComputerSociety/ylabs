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
const KEY = `netid:${NETID}`;
const HEADING = 'Other Departments & Organizations';

describe('a stored affiliation group heading never resolves as a department (#5795)', () => {
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
    const db = mongoose.connection.db!;
    for (const name of ['observations', 'researchers', 'accounts']) {
      await db.collection(name).deleteMany({});
    }
    resetOverSharedPersonWebsiteKeysCache();
  });

  const seedHeadingKey = (directoryDepartment?: string) => {
    const at = (field: string, value: unknown, sourceName = 'official-profile-pi-backfill') => ({
      entityType: 'user',
      entityKey: KEY,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: 'https://fixture-school.example.edu/profile/fixture-quillsby/',
      confidence: 1,
      observedAt: new Date('2026-05-26T00:00:00Z'),
      superseded: false,
      field,
      value,
    });
    return Observation.insertMany([
      at('netid', NETID),
      at('fname', 'Fixture'),
      at('lname', 'Quillsby'),
      at('primaryDepartment', HEADING),
      at('departments', [HEADING, 'Fixture Center']),
      ...(directoryDepartment
        ? [at('primaryDepartment', directoryDepartment, 'yale-directory')]
        : []),
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

  const resolve = () => materializeEntity('user', { entityKey: KEY }, {});
  const departmentOf = async (id: unknown) =>
    (await Researcher.findById(id).lean<any>())?.profile?.primaryDepartment;

  it('resolves no department from the heading, and a second resolve writes nothing', async () => {
    const person = await seedPerson();
    await seedHeadingKey();

    await resolve();
    expect(await departmentOf(person._id)).toBeUndefined();

    expect((await resolve()).fieldsWritten).toBe(0);
    expect(await departmentOf(person._id)).toBeUndefined();
  });

  it('clears a stored heading department, and a second resolve writes nothing', async () => {
    const person = await seedPerson({ primaryDepartment: HEADING });
    await seedHeadingKey();

    await resolve();
    expect(await departmentOf(person._id)).toBeUndefined();

    expect((await resolve()).fieldsWritten).toBe(0);
  });

  it('fills a stored heading department from a fill-only directory value, and a second resolve writes nothing', async () => {
    const person = await seedPerson({ primaryDepartment: HEADING });
    await seedHeadingKey('Fixture Directory Studies');

    await resolve();
    expect(await departmentOf(person._id)).toBe('Fixture Directory Studies');

    expect((await resolve()).fieldsWritten).toBe(0);
    expect(await departmentOf(person._id)).toBe('Fixture Directory Studies');
  });

  it('never writes the heading over a stored department', async () => {
    const person = await seedPerson({ primaryDepartment: 'Fixture Studies' });
    await seedHeadingKey();

    await resolve();
    await resolve();

    expect(await departmentOf(person._id)).toBe('Fixture Studies');
  });
});
