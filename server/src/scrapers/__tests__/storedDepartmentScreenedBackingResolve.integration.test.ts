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

vi.mock('../userDepartmentObservationScreens', async () => {
  const actual = await vi.importActual<typeof import('../userDepartmentObservationScreens')>(
    '../userDepartmentObservationScreens',
  );
  const screens: typeof actual.USER_DEPARTMENT_OBSERVATION_SCREENS = [
    ...actual.USER_DEPARTMENT_OBSERVATION_SCREENS,
    (observations) =>
      observations.filter(
        (observation) =>
          observation.field !== 'primaryDepartment' ||
          observation.sourceName !== 'fixture-screened-lane',
      ),
  ];
  return {
    ...actual,
    USER_DEPARTMENT_OBSERVATION_SCREENS: screens,
    withUserDepartmentObservationsScreened: (
      observations: Parameters<typeof actual.withUserDepartmentObservationsScreened>[0],
      context: Parameters<typeof actual.withUserDepartmentObservationsScreened>[1],
      chosen = screens,
    ) => actual.withUserDepartmentObservationsScreened(observations, context, chosen),
  };
});

import { Observation } from '../../models/observation';
import { OrgUnit } from '../../models/orgUnit';
import { Researcher } from '../../models/researcher';
import { materializeEntity } from '../entityMaterializer';
import { resetOrgUnitCanonicalizerCache } from '../orgUnitCanonicalization';
import { resetOverSharedPersonWebsiteKeysCache } from '../overSharedPersonWebsite';
import { resetPrimaryDepartmentStatingKeysCache } from '../primaryDepartmentStatingKeys';

const NETID = 'fq123';
const KEY = `netid:${NETID}`;
const SCREENED = 'Fixture Center';
const ROSTER_KEY = 'dept:fixture-studies:fixture-quillsby';

describe('a stored department only screened readings back is cleared on resolve', () => {
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
      slug: 'fixture-studies',
      name: 'Fixture Studies',
      kind: 'DEPARTMENT',
      status: 'ACTIVE',
      parentOrgUnitId: school._id,
    });
    resetOrgUnitCanonicalizerCache();
    resetOverSharedPersonWebsiteKeysCache();
    resetPrimaryDepartmentStatingKeysCache();
  });

  const reading = (
    field: string,
    value: unknown,
    sourceName = 'fixture-screened-lane',
    entityKey = KEY,
    superseded = false,
  ) => ({
    entityType: 'user',
    entityKey,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName,
    sourceUrl: 'https://fixture-school.example.edu/profile/fixture-quillsby/',
    confidence: 0.9,
    observedAt: new Date('2026-10-01T00:00:00Z'),
    superseded,
    field,
    value,
  });

  const seedScreenedKey = (...extra: ReturnType<typeof reading>[]) =>
    Observation.insertMany([
      reading('netid', NETID),
      reading('fname', 'Fixture'),
      reading('lname', 'Quillsby'),
      reading('primaryDepartment', SCREENED),
      ...extra,
    ]);

  const seedPerson = (primaryDepartment?: string, writerKey?: string) =>
    Researcher.create({
      displayName: 'Fixture Quillsby',
      identifiers: { netid: NETID },
      profile: primaryDepartment ? { primaryDepartment } : {},
      ...(writerKey
        ? {
            profileFieldWriters: {
              primaryDepartment: { userKey: writerKey, joinRank: 99, confidence: 1 },
            },
          }
        : {}),
      profileLinks: [],
      status: 'UNKNOWN',
      archived: false,
    });

  const resolve = () => materializeEntity('user', { entityKey: KEY }, {});
  const stored = async (id: unknown) => Researcher.findById(id).lean<any>();

  it('clears it with its writer record, and a second resolve writes nothing', async () => {
    const person = await seedPerson(SCREENED, KEY);
    await seedScreenedKey();

    await resolve();
    const after = await stored(person._id);
    expect(after?.profile?.primaryDepartment).toBeUndefined();
    expect(after?.profileFieldWriters?.primaryDepartment).toBeUndefined();

    expect((await resolve()).fieldsWritten).toBe(0);
    expect((await stored(person._id))?.profile?.primaryDepartment).toBeUndefined();
  });

  it('releases a sibling writer that wrote the cleared value, so another key can take the field', async () => {
    const person = await seedPerson(SCREENED, KEY);
    await seedScreenedKey(
      reading('netid', NETID, 'fixture-open-lane', NETID),
      reading('primaryDepartment', 'Fixture Studies', 'fixture-open-lane', NETID),
    );

    await materializeEntity('user', { entityKey: NETID }, {});
    expect((await stored(person._id))?.profile?.primaryDepartment).toBe('Fixture Studies');
  });

  it('lets a fill-only directory department land in the same resolve', async () => {
    const person = await seedPerson(SCREENED);
    await seedScreenedKey(reading('primaryDepartment', 'Fixture Studies', 'yale-directory'));

    await resolve();
    expect((await stored(person._id))?.profile?.primaryDepartment).toBe('Fixture Studies');

    expect((await resolve()).fieldsWritten).toBe(0);
    expect((await stored(person._id))?.profile?.primaryDepartment).toBe('Fixture Studies');
  });

  it('keeps it while one unscreened reading on another key naming the researcher states it', async () => {
    const person = await seedPerson(SCREENED);
    await seedScreenedKey(
      reading('netid', NETID, 'fixture-open-lane', NETID),
      reading('primaryDepartment', SCREENED, 'fixture-open-lane', NETID),
    );

    await resolve();
    await resolve();
    expect((await stored(person._id))?.profile?.primaryDepartment).toBe(SCREENED);
  });

  it('keeps it while a superseded unscreened reading states it', async () => {
    const person = await seedPerson(SCREENED);
    await seedScreenedKey(reading('primaryDepartment', SCREENED, 'fixture-open-lane', KEY, true));

    await resolve();
    expect((await stored(person._id))?.profile?.primaryDepartment).toBe(SCREENED);
  });

  const rosterReadings = (value: string, sourceName: string) => [
    reading('fname', 'Fixture', 'dept-faculty-roster', ROSTER_KEY),
    reading('lname', 'Quillsby', 'dept-faculty-roster', ROSTER_KEY),
    reading('primaryDepartment', value, sourceName, ROSTER_KEY),
  ];

  it('keeps it while a person-name-joined key states it unscreened', async () => {
    const person = await seedPerson(SCREENED);
    await seedScreenedKey(...rosterReadings(SCREENED, 'fixture-open-lane'));

    await resolve();
    expect((await stored(person._id))?.profile?.primaryDepartment).toBe(SCREENED);
  });

  it('clears it when the person-name-joined key states it only through a screened reading', async () => {
    const person = await seedPerson(SCREENED);
    await seedScreenedKey(...rosterReadings(SCREENED, 'fixture-screened-lane'));

    await resolve();
    expect((await stored(person._id))?.profile?.primaryDepartment).toBeUndefined();
  });

  it('lets no directory fill replace a department a person-name-joined key states in another spelling', async () => {
    const person = await seedPerson('Fixture Studies');
    await seedScreenedKey(
      reading('primaryDepartment', 'Fixture Directory Studies', 'yale-directory'),
      ...rosterReadings('fixture studies', 'dept-faculty-roster'),
    );

    await resolve();
    expect((await stored(person._id))?.profile?.primaryDepartment).toBe('Fixture Studies');
  });

  it('neither clears nor fills while more same-surname keys state the value than the engine join is asked about', async () => {
    const person = await seedPerson('Fixture Studies');
    const namesakes = Array.from({ length: 26 }, (_, index) => {
      const key = `dept:fixture-studies:fixture-namesake-${index}`;
      return [
        reading(
          'fname',
          `Namesake${String.fromCharCode(97 + (index % 26))}`,
          'dept-faculty-roster',
          key,
        ),
        reading('lname', 'Quillsby', 'dept-faculty-roster', key),
        reading('primaryDepartment', 'Fixture Studies', 'dept-faculty-roster', key),
      ];
    }).flat();
    await Observation.insertMany(namesakes);
    await seedScreenedKey(
      reading('primaryDepartment', 'Fixture Directory Studies', 'yale-directory'),
    );

    await resolve();
    expect((await stored(person._id))?.profile?.primaryDepartment).toBe('Fixture Studies');
  });

  it('clears a value only a person-name-joined key states through a screened reading', async () => {
    const person = await seedPerson(SCREENED);
    await Observation.insertMany([
      reading('netid', NETID),
      reading('fname', 'Fixture'),
      reading('lname', 'Quillsby'),
      ...rosterReadings(SCREENED, 'fixture-screened-lane'),
    ]);

    await resolve();
    expect((await stored(person._id))?.profile?.primaryDepartment).toBeUndefined();
  });

  it('never touches a never-backed stored department', async () => {
    const person = await seedPerson('Fixture Legacy Studies');
    await seedScreenedKey();

    await resolve();
    await resolve();
    expect((await stored(person._id))?.profile?.primaryDepartment).toBe('Fixture Legacy Studies');
  });

  it('clears nothing while the department catalog is unavailable', async () => {
    await OrgUnit.deleteMany({ kind: 'DEPARTMENT' });
    resetOrgUnitCanonicalizerCache();
    const person = await seedPerson(SCREENED);
    await seedScreenedKey();

    await resolve();
    expect((await stored(person._id))?.profile?.primaryDepartment).toBe(SCREENED);
  });
});
