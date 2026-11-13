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
const KEY = `netid:${NETID}`;
const LEGACY = 'Fixture Legacy Studies';

describe('a stored backfill home department the catalog does not name never resolves (#6074)', () => {
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
    sourceName: 'official-profile-pi-backfill',
    sourceUrl: 'https://fixture-school.example.edu/profile/fixture-zellner/',
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

  it('clears a stored heading only a backfill reading backs, and a second resolve writes nothing', async () => {
    const person = await seedPerson('Current Full Time Faculty');
    await seed('Current Full Time Faculty');

    await resolve();
    expect(await departmentOf(person._id)).toBeUndefined();
    expect((await resolve()).fieldsWritten).toBe(0);
  });

  it('keeps a backfill home department the catalog names', async () => {
    const person = await seedPerson('Biostatistics');
    await seed('Biostatistics');

    await resolve();
    expect(await departmentOf(person._id)).toBe('Biostatistics');
  });

  it('leaves a backfill-backed stored value untouched while the catalog is unavailable', async () => {
    await OrgUnit.deleteMany({ kind: 'DEPARTMENT' });
    resetOrgUnitCanonicalizerCache();
    const person = await seedPerson('Current Full Time Faculty');
    await seed('Current Full Time Faculty');

    await resolve();
    expect(await departmentOf(person._id)).toBe('Current Full Time Faculty');
    expect((await resolve()).fieldsWritten).toBe(0);
  });
});
