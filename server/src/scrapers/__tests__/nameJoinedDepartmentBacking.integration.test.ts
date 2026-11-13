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
import { materializeEntity, userIdentityJoinForKey } from '../entityMaterializer';
import { resetOrgUnitCanonicalizerCache } from '../orgUnitCanonicalization';
import { resetOverSharedPersonWebsiteKeysCache } from '../overSharedPersonWebsite';
import {
  primaryDepartmentStatingKeysForMaterialization,
  resetPrimaryDepartmentStatingKeysCache,
} from '../primaryDepartmentStatingKeys';

const NETID = 'fz123';
const KEY = `netid:${NETID}`;
const ROSTER_KEY = 'dept:fixture-legacy-studies:fixture-zellner';
const LEGACY = 'Fixture Legacy Studies';
const DIRECTORY = 'Fixture Directory Studies';

describe('a person-name-joined roster key backs a stored department (#5741, #6049)', () => {
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
    resetPrimaryDepartmentStatingKeysCache();
  });

  const reading = (field: string, value: unknown, sourceName: string, entityKey = KEY) => ({
    entityType: 'user',
    entityKey,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName,
    sourceUrl: 'https://fixture-school.example.edu/profile/fixture-zellner/',
    confidence: 0.9,
    observedAt: new Date('2026-10-01T00:00:00Z'),
    superseded: false,
    field,
    value,
  });

  const seedDirectoryKey = () =>
    Observation.insertMany([
      reading('netid', NETID, 'yale-directory'),
      reading('fname', 'Fixture', 'yale-directory'),
      reading('lname', 'Zellner', 'yale-directory'),
      reading('primaryDepartment', DIRECTORY, 'yale-directory'),
    ]);

  const rosterKey = (key: string, lname: string) => [
    reading('fname', 'Fixture', 'dept-faculty-roster', key),
    reading('lname', lname, 'dept-faculty-roster', key),
    reading('primaryDepartment', LEGACY, 'dept-faculty-roster', key),
  ];

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

  it('is reached from the roster key by the engine join alone', async () => {
    const person = await seedPerson();
    await Observation.insertMany(rosterKey(ROSTER_KEY, 'Zellner'));
    const join = await userIdentityJoinForKey(ROSTER_KEY);
    expect(String(join?.join?.researcher?._id)).toBe(String(person._id));
  });

  it('keeps the department a person-name-joined roster key states against a directory fill', async () => {
    const person = await seedPerson();
    await seedDirectoryKey();
    await Observation.insertMany(rosterKey(ROSTER_KEY, 'Zellner'));

    await resolve();
    expect(await departmentOf(person._id)).toBe(LEGACY);
    expect((await resolve()).fieldsWritten).toBe(0);
  });

  it('keeps a never-backed department many other people state against a directory fill', async () => {
    const person = await seedPerson();
    await seedDirectoryKey();
    await Observation.insertMany(
      Array.from({ length: 30 }, (_, index) =>
        rosterKey(`dept:fixture-legacy-studies:fixture-other-${index}`, `Otherperson${index}`),
      ).flat(),
    );

    await resolve();
    expect(await departmentOf(person._id)).toBe(LEGACY);
  });

  it('reads the value-to-keys map once per batch and afresh after a reset', async () => {
    await seedDirectoryKey();
    const first = await primaryDepartmentStatingKeysForMaterialization();
    expect([...(first.get(DIRECTORY) ?? [])]).toEqual([KEY]);
    await Observation.insertMany(rosterKey(ROSTER_KEY, 'Zellner'));
    expect(await primaryDepartmentStatingKeysForMaterialization()).toBe(first);
    resetPrimaryDepartmentStatingKeysCache();
    const fresh = await primaryDepartmentStatingKeysForMaterialization();
    expect([...(fresh.get(LEGACY) ?? [])]).toEqual([ROSTER_KEY]);
  });
});
