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
import { OrgUnit } from '../../models/orgUnit';
import { Researcher } from '../../models/researcher';
import { materializeEntity } from '../entityMaterializer';
import { resetOrgUnitCanonicalizerCache } from '../orgUnitCanonicalization';
import { resetOverSharedPersonWebsiteKeysCache } from '../overSharedPersonWebsite';

const NETID = 'fq123';
const KEY = `netid:${NETID}`;

describe('a YSM home department the catalog does not name never resolves', () => {
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
    const db = mongoose.connection.db!;
    for (const name of ['observations', 'researchers', 'accounts', 'org_units']) {
      await db.collection(name).deleteMany({});
    }
    const school = await OrgUnit.create({
      slug: 'fixture-school',
      name: 'Fixture School',
      kind: 'SCHOOL',
      status: 'ACTIVE',
    });
    await OrgUnit.create({
      slug: 'surgery',
      name: 'Surgery',
      kind: 'DEPARTMENT',
      status: 'ACTIVE',
      parentOrgUnitId: school._id,
    });
    resetOrgUnitCanonicalizerCache();
    resetOverSharedPersonWebsiteKeysCache();
  });

  const reading = (field: string, value: unknown, sourceName = 'ysm-faculty-directory') => ({
    entityType: 'user',
    entityKey: KEY,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName,
    sourceUrl: 'https://medicine.yale.edu/profile/fixture-quillsby/',
    confidence: 0.9,
    observedAt: new Date('2026-10-01T00:00:00Z'),
    superseded: false,
    field,
    value,
  });

  const seed = (primaryDepartment: string, ...extra: ReturnType<typeof reading>[]) =>
    Observation.insertMany([
      reading('netid', NETID),
      reading('fname', 'Fixture'),
      reading('lname', 'Quillsby'),
      reading('primaryDepartment', primaryDepartment),
      ...extra,
    ]);

  const seedPerson = (primaryDepartment?: string) =>
    Researcher.create({
      displayName: 'Fixture Quillsby',
      identifiers: { netid: NETID },
      profile: primaryDepartment ? { primaryDepartment } : {},
      ...(primaryDepartment
        ? {
            profileFieldWriters: {
              primaryDepartment: { userKey: KEY, joinRank: 3, confidence: 0.9 },
            },
          }
        : {}),
      profileLinks: [],
      status: 'UNKNOWN',
      archived: false,
    });

  const resolve = () => materializeEntity('user', { entityKey: KEY }, {});
  const departmentOf = async (id: unknown) =>
    (await Researcher.findById(id).lean<any>())?.profile?.primaryDepartment;

  it('clears a stored center the lane wrote, and a second resolve writes nothing', async () => {
    const person = await seedPerson('Fixture Center');
    await seed('Fixture Center');

    await resolve();
    expect(await departmentOf(person._id)).toBeUndefined();
    expect((await resolve()).fieldsWritten).toBe(0);
  });

  it('lets a fill-only directory department replace it in the same resolve', async () => {
    const person = await seedPerson('Fixture Center');
    await seed('Fixture Center', reading('primaryDepartment', 'Surgery', 'yale-directory'));

    await resolve();
    expect(await departmentOf(person._id)).toBe('Surgery');
    expect((await resolve()).fieldsWritten).toBe(0);
  });

  it('keeps a YSM home department the catalog names', async () => {
    const person = await seedPerson('Surgery');
    await seed('Surgery');

    await resolve();
    expect(await departmentOf(person._id)).toBe('Surgery');
  });
});
