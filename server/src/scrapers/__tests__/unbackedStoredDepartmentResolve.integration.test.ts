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

const NETID = 'fz123';
const KEY = `netid:${NETID}`;
const LEGACY = 'Fixture Legacy Studies';
const DIRECTORY = 'Fixture Directory Studies';

describe('a fill-only department replaces a stored one no observation ever stated (#6049)', () => {
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
    const school = await OrgUnit.create({
      slug: 'fixture-school',
      name: 'Fixture School',
      kind: 'SCHOOL',
      status: 'ACTIVE',
    });
    for (const [slug, name] of [
      ['fixture-legacy-studies', LEGACY],
      ['fixture-directory-studies', DIRECTORY],
    ] as const) {
      await OrgUnit.create({
        slug,
        name,
        kind: 'DEPARTMENT',
        status: 'ACTIVE',
        parentOrgUnitId: school._id,
      });
    }
    resetOrgUnitCanonicalizerCache();
    resetOverSharedPersonWebsiteKeysCache();
  });

  const reading = (
    field: string,
    value: unknown,
    sourceName = 'official-profile-pi-backfill',
    superseded = false,
  ) => ({
    entityType: 'user',
    entityKey: KEY,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName,
    sourceUrl: 'https://fixture-school.example.edu/profile/fixture-zellner/',
    confidence: 1,
    observedAt: new Date('2026-05-26T00:00:00Z'),
    superseded,
    field,
    value,
  });

  const seedKey = (extra: ReturnType<typeof reading>[] = []) =>
    Observation.insertMany([
      reading('netid', NETID),
      reading('fname', 'Fixture'),
      reading('lname', 'Zellner'),
      ...extra,
    ]);

  const seedPerson = () =>
    Researcher.create({
      displayName: 'Fixture Zellner',
      identifiers: { netid: NETID },
      profile: { primaryDepartment: LEGACY },
      profileLinks: [],
      status: 'UNKNOWN',
      archived: false,
    });

  const resolve = () => materializeEntity('user', { entityKey: KEY }, {});
  const departmentOf = async (id: unknown) =>
    (await Researcher.findById(id).lean<any>())?.profile?.primaryDepartment;

  it('lands a fill-only directory department on it, and a second resolve writes nothing', async () => {
    const person = await seedPerson();
    await seedKey([reading('primaryDepartment', DIRECTORY, 'yale-directory')]);

    await resolve();
    expect(await departmentOf(person._id)).toBe(DIRECTORY);

    expect((await resolve()).fieldsWritten).toBe(0);
    expect(await departmentOf(person._id)).toBe(DIRECTORY);
  });

  it('keeps it when no evidence states a department, and a second resolve writes nothing', async () => {
    const person = await seedPerson();
    await seedKey();

    await resolve();
    expect(await departmentOf(person._id)).toBe(LEGACY);

    expect((await resolve()).fieldsWritten).toBe(0);
    expect(await departmentOf(person._id)).toBe(LEGACY);
  });

  it('lets a department another source states replace it, as before (#6049)', async () => {
    const person = await seedPerson();
    await seedKey([reading('primaryDepartment', DIRECTORY, 'dept-faculty-roster')]);

    await resolve();
    expect(await departmentOf(person._id)).toBe(DIRECTORY);
  });

  it('keeps a stored department a superseded reading once stated, against a fill-only value', async () => {
    const person = await seedPerson();
    await seedKey([
      reading('primaryDepartment', LEGACY, 'dept-faculty-roster', true),
      reading('primaryDepartment', DIRECTORY, 'yale-directory'),
    ]);

    await resolve();
    await resolve();
    expect(await departmentOf(person._id)).toBe(LEGACY);
  });

  it('keeps a never-backed stored department against a fill-only value when the catalog is unavailable', async () => {
    await mongoose.connection.db!.collection('org_units').deleteMany({});
    resetOrgUnitCanonicalizerCache();
    const person = await seedPerson();
    await seedKey([reading('primaryDepartment', DIRECTORY, 'yale-directory')]);

    await resolve();
    expect(await departmentOf(person._id)).toBe(LEGACY);
  });

  it('keeps a stored department a reading on another key of the same person states', async () => {
    const person = await seedPerson();
    await seedKey([reading('primaryDepartment', DIRECTORY, 'yale-directory')]);
    await Observation.insertMany([
      { ...reading('primaryDepartment', LEGACY, 'yale-directory-csv', true), entityKey: NETID },
    ]);

    await resolve();
    expect(await departmentOf(person._id)).toBe(LEGACY);
  });
});
