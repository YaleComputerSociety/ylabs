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
const KEY = NETID;

describe('a stored or stated directory export code resolves to a catalog department (#5796)', () => {
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
    for (const name of ['observations', 'researchers', 'accounts', 'org_units']) {
      await db.collection(name).deleteMany({});
    }
    const arts = await OrgUnit.create({
      slug: 'faculty-of-arts-and-sciences',
      name: 'Faculty of Arts and Sciences',
      kind: 'SCHOOL',
      status: 'ACTIVE',
    });
    const medicine = await OrgUnit.create({
      slug: 'yale-school-of-medicine',
      name: 'School of Medicine',
      kind: 'SCHOOL',
      status: 'ACTIVE',
    });
    for (const [slug, name, parent] of [
      ['history', 'History', arts],
      ['neurology', 'Neurology', medicine],
      ['fixture-studies', 'Fixture Studies', arts],
    ] as const) {
      await OrgUnit.create({
        slug,
        name,
        kind: 'DEPARTMENT',
        status: 'ACTIVE',
        parentOrgUnitId: parent._id,
      });
    }
    resetOrgUnitCanonicalizerCache();
    resetOverSharedPersonWebsiteKeysCache();
  });

  const seedKey = (sourceName: string, department?: string) => {
    const at = (field: string, value: unknown) => ({
      entityType: 'user',
      entityKey: KEY,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl:
        sourceName === 'yale-directory-csv'
          ? 'file:fixture_directory.csv'
          : 'https://api.yalies.io/v2/people',
      confidence: 1,
      observedAt: new Date('2026-05-15T00:00:00Z'),
      superseded: false,
      field,
      value,
    });
    return Observation.insertMany([
      at('netid', NETID),
      at('fname', 'Fixture'),
      at('lname', 'Quillsby'),
      ...(department ? [at('primaryDepartment', department)] : []),
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

  it('decodes a stored export code, and a second resolve writes nothing', async () => {
    const person = await seedPerson({ primaryDepartment: 'FASHIS History' });
    await seedKey('yale-directory');

    await resolve();
    expect(await departmentOf(person._id)).toBe('History');

    expect((await resolve()).fieldsWritten).toBe(0);
    expect(await departmentOf(person._id)).toBe('History');
  });

  it('clears a stored code that maps to no department, so the directory can fill it', async () => {
    const person = await seedPerson({ primaryDepartment: 'ENVOTH Other Units' });
    await seedKey('yale-directory', 'Fixture Studies');

    await resolve();
    expect(await departmentOf(person._id)).toBe('Fixture Studies');

    expect((await resolve()).fieldsWritten).toBe(0);
  });

  it('reads a stated export code as its parent department', async () => {
    const person = await seedPerson();
    await seedKey('yale-directory-csv', 'MEDNEU Multiple Sclerosis');

    await resolve();
    expect(await departmentOf(person._id)).toBe('Neurology');

    expect((await resolve()).fieldsWritten).toBe(0);
  });

  it('leaves a stored code alone when the department catalog is unavailable', async () => {
    await OrgUnit.deleteMany({ kind: 'DEPARTMENT' });
    resetOrgUnitCanonicalizerCache();
    const person = await seedPerson({ primaryDepartment: 'ENVOTH Other Units' });
    await seedKey('yale-directory');

    await resolve();
    expect(await departmentOf(person._id)).toBe('ENVOTH Other Units');
  });
});
