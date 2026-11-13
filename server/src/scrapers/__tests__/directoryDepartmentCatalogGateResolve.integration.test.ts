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
import { resetPrimaryDepartmentStatingKeysCache } from '../primaryDepartmentStatingKeys';

const NETID = 'fz123';
const KEY = NETID;
const LEGACY = 'Fixture Legacy Studies';

describe('a directory department fills only when the catalog names it (#6129)', () => {
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
      slug: 'biostatistics',
      name: 'Biostatistics',
      aliases: ['BIS'],
      kind: 'DEPARTMENT',
      status: 'ACTIVE',
      parentOrgUnitId: school._id,
    });
    resetOrgUnitCanonicalizerCache();
    resetOverSharedPersonWebsiteKeysCache();
    resetPrimaryDepartmentStatingKeysCache();
  });

  const reading = (field: string, value: unknown) => ({
    entityType: 'user',
    entityKey: KEY,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: 'yale-directory',
    sourceUrl: 'https://api.yalies.io/v2/people',
    confidence: 0.9,
    observedAt: new Date('2026-10-01T00:00:00Z'),
    superseded: false,
    field,
    value,
  });

  const seed = (department: string) =>
    Observation.insertMany([
      reading('netid', NETID),
      reading('fname', 'Fixture'),
      reading('lname', 'Zellner'),
      reading('primaryDepartment', department),
    ]);

  const seedPerson = (primaryDepartment?: string) =>
    Researcher.create({
      displayName: 'Fixture Zellner',
      identifiers: { netid: NETID },
      profile: primaryDepartment ? { primaryDepartment } : {},
      profileLinks: [],
      status: 'UNKNOWN',
      archived: false,
    });

  const resolve = () => materializeEntity('user', { entityKey: KEY }, {});
  const departmentOf = async (id: unknown) =>
    (await Researcher.findById(id).lean<any>())?.profile?.primaryDepartment;

  it('never lets a center replace a never-backed stored department', async () => {
    const person = await seedPerson(LEGACY);
    await seed('Council on Fixture Studies');

    await resolve();
    expect(await departmentOf(person._id)).toBe(LEGACY);
  });

  it('never fills an empty department with a center', async () => {
    const person = await seedPerson();
    await seed('Council on Fixture Studies');

    await resolve();
    expect(await departmentOf(person._id)).toBeUndefined();
  });

  it('fills the catalog name an acronym-suffixed unit decodes to, and a second resolve writes nothing', async () => {
    const person = await seedPerson(LEGACY);
    await seed('Biostatistics (BIS)');

    await resolve();
    expect(await departmentOf(person._id)).toBe('Biostatistics');
    expect((await resolve()).fieldsWritten).toBe(0);
  });
});
