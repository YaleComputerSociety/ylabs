import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntities: vi.fn(async () => {}),
    syncEntity: vi.fn(async () => true),
    deleteFromIndex: vi.fn(async () => {}),
  };
});

import { Observation } from '../../models/observation';
import { OrgUnit } from '../../models/orgUnit';
import { Researcher } from '../../models/researcher';
import { resetDirectoryNetidsByAddressCache } from '../directoryContradictedProfileNetid';
import { materializeEntity } from '../entityMaterializer';
import { resetOrgUnitCanonicalizerCache } from '../orgUnitCanonicalization';
import { clearC4Flags } from './c4FlagTestEnv';

const NETID = 'qs6217';
const RESEARCHER_EMAIL = 'quinn.s6217@yale.edu';
const OFFICIAL_PAGE = 'https://medicine.yale.edu/profile/quinn-synthetic/';
const PROFILE_KEY = 'ysm:quinn-synthetic';
const ROSTER_KEY = 'dept:fixture-informatics:quinn-synthetic';
const SECOND_ROSTER_KEY = 'dept:fixture-surgery:quinn-synthetic';
const DIRECTORY_KEY = NETID;
const ALIAS_LOCAL = 'quinn.synthetic';
const ALIAS_KEY = `netid:${ALIAS_LOCAL}`;
const NOW = new Date('2026-11-13T00:00:00Z');

interface KeyEvidence {
  entityKey: string;
  sourceName: string;
  sourceUrl: string;
  confidence: number;
  department?: string;
  title?: string;
  email?: string;
  fname?: string;
  lname?: string;
}

const PROFILE: KeyEvidence = {
  entityKey: PROFILE_KEY,
  sourceName: 'ysm-faculty-directory',
  sourceUrl: OFFICIAL_PAGE,
  confidence: 0.8,
};
const ROSTER: KeyEvidence = {
  entityKey: ROSTER_KEY,
  sourceName: 'dept-faculty-roster',
  sourceUrl: 'https://fixture-informatics.yale.edu/people/',
  confidence: 0.7,
  email: RESEARCHER_EMAIL,
};

async function seedKey(evidence: KeyEvidence): Promise<void> {
  const observation = (field: string, value: unknown) => ({
    entityType: 'user',
    entityKey: evidence.entityKey,
    sourceId: new mongoose.Types.ObjectId(),
    field,
    value,
    sourceName: evidence.sourceName,
    sourceUrl: evidence.sourceUrl,
    confidence: evidence.confidence,
    observedAt: new Date('2026-11-01T00:00:00Z'),
    superseded: false,
  });
  await Observation.insertMany([
    observation('fname', evidence.fname ?? 'Quinn'),
    observation('lname', evidence.lname ?? 'Synthetic'),
    ...(evidence.email ? [observation('email', evidence.email)] : []),
    ...(evidence.department ? [observation('primaryDepartment', evidence.department)] : []),
    ...(evidence.title ? [observation('title', evidence.title)] : []),
  ]);
}

async function storedDepartment(): Promise<string | undefined> {
  const researcher: any = await Researcher.findOne({ 'identifiers.netid': NETID }).lean();
  return researcher?.profile?.primaryDepartment;
}

async function setStoredDepartment(value: string | undefined): Promise<void> {
  await Researcher.updateOne(
    { 'identifiers.netid': NETID },
    value
      ? { $set: { 'profile.primaryDepartment': value }, $unset: { profileFieldWriters: 1 } }
      : { $unset: { 'profile.primaryDepartment': 1, profileFieldWriters: 1 } },
  );
}

async function materializeInOrder(keys: string[]): Promise<string | undefined> {
  await setStoredDepartment(undefined);
  for (const entityKey of keys) {
    await materializeEntity('user', { entityKey }, { now: NOW });
  }
  return storedDepartment();
}

async function seedCatalog(): Promise<void> {
  const school = await OrgUnit.create({
    slug: 'school-of-medicine',
    name: 'School of Medicine',
    kind: 'SCHOOL',
    status: 'ACTIVE',
  });
  const surgery = await OrgUnit.create({
    slug: 'surgery',
    name: 'Surgery',
    kind: 'DEPARTMENT',
    status: 'ACTIVE',
    parentOrgUnitId: school._id,
  });
  await OrgUnit.create({
    slug: 'colon-rectal-surgery',
    name: 'Colon & Rectal Surgery',
    kind: 'SECTION',
    status: 'ACTIVE',
    parentOrgUnitId: surgery._id,
  });
  resetOrgUnitCanonicalizerCache();
}

describe("a researcher's primaryDepartment is resolved over every key that joins it (#6217)", () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Observation.syncIndexes();
  });

  afterAll(async () => {
    resetOrgUnitCanonicalizerCache();
    resetDirectoryNetidsByAddressCache();
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    clearC4Flags();
    const db = mongoose.connection.db!;
    for (const name of ['accounts', 'researchers', 'observations', 'org_units']) {
      await db.collection(name).deleteMany({});
    }
    resetOrgUnitCanonicalizerCache();
    resetDirectoryNetidsByAddressCache();
    await Researcher.create({
      displayName: 'Quinn Synthetic',
      identifiers: { netid: NETID, email: RESEARCHER_EMAIL },
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: OFFICIAL_PAGE,
          verifiedAt: new Date('2026-09-01T00:00:00Z'),
          healthStatus: 'UNKNOWN',
        },
      ],
    });
  });

  it('keeps the first-hand department when a lower-confidence roster key materializes alone', async () => {
    await seedKey({ ...PROFILE, department: 'Ophthalmology & Visual Science' });
    await seedKey({ ...ROSTER, department: 'Biomedical Informatics & Data Science' });
    await setStoredDepartment('Ophthalmology & Visual Science');

    await materializeEntity('user', { entityKey: ROSTER_KEY }, { now: NOW });

    expect(await storedDepartment()).toBe('Ophthalmology & Visual Science');
  });

  it('stores the same department in ascending and descending key order', async () => {
    await seedKey({ ...PROFILE, department: 'Ophthalmology & Visual Science' });
    await seedKey({ ...ROSTER, department: 'Biomedical Informatics & Data Science' });

    const ascending = await materializeInOrder([PROFILE_KEY, ROSTER_KEY]);
    const descending = await materializeInOrder([ROSTER_KEY, PROFILE_KEY]);

    expect(ascending).toBe('Ophthalmology & Visual Science');
    expect(descending).toBe(ascending);
  });

  it('breaks an exact tie the same way in ascending and descending key order', async () => {
    await seedKey({ ...ROSTER, department: 'Biomedical Informatics & Data Science' });
    await seedKey({
      ...ROSTER,
      entityKey: SECOND_ROSTER_KEY,
      sourceUrl: 'https://fixture-surgery.yale.edu/people/',
      department: 'Anesthesiology',
    });

    const ascending = await materializeInOrder([ROSTER_KEY, SECOND_ROSTER_KEY]);
    const descending = await materializeInOrder([SECOND_ROSTER_KEY, ROSTER_KEY]);

    expect(ascending).toBeDefined();
    expect(descending).toBe(ascending);
  });

  it('never lets a fill-only directory reading hold out an official department through the pool', async () => {
    await seedKey({
      entityKey: DIRECTORY_KEY,
      sourceName: 'yale-directory',
      sourceUrl: 'https://directory.yale.edu/',
      confidence: 0.9,
      department: 'Biomedical Informatics & Data Science',
    });
    await seedKey({ ...PROFILE, department: 'Ophthalmology & Visual Science' });

    expect(await materializeInOrder([DIRECTORY_KEY, PROFILE_KEY])).toBe(
      'Ophthalmology & Visual Science',
    );
    expect(await materializeInOrder([PROFILE_KEY, DIRECTORY_KEY])).toBe(
      'Ophthalmology & Visual Science',
    );
  });

  it('writes nothing on a second pass over every key', async () => {
    await seedKey({ ...PROFILE, department: 'Ophthalmology & Visual Science' });
    await seedKey({ ...ROSTER, department: 'Biomedical Informatics & Data Science' });
    const keys = [ROSTER_KEY, PROFILE_KEY];
    for (const entityKey of keys) await materializeEntity('user', { entityKey }, { now: NOW });

    const second = [];
    for (const entityKey of keys) {
      second.push(await materializeEntity('user', { entityKey }, { now: NOW }));
    }

    expect(second.map((result) => result.fieldsWritten)).toEqual([0, 0]);
  });

  it("never pools a namesake key that the researcher's own identity does not name", async () => {
    await seedKey({ ...PROFILE, department: 'Anesthesiology' });
    await seedKey({
      entityKey: 'netid:quinn.namesake',
      sourceName: 'dept-faculty-roster',
      sourceUrl: 'https://fixture-psychology.yale.edu/people/',
      confidence: 0.9,
      email: 'quinn.namesake6217@yale.edu',
      department: 'Psychology',
    });
    await setStoredDepartment('Anesthesiology');

    await materializeEntity('user', { entityKey: 'netid:quinn.namesake' }, { now: NOW });

    expect(await storedDepartment()).toBe('Anesthesiology');
  });

  it('keeps the title control order-independent alongside the department', async () => {
    await seedKey({ ...PROFILE, title: 'Professor of Ophthalmology' });
    await seedKey({ ...ROSTER, title: 'Lecturer in Informatics' });
    const titleIn = async (keys: string[]) => {
      await Researcher.updateOne(
        { 'identifiers.netid': NETID },
        { $unset: { 'profile.title': 1 } },
      );
      for (const entityKey of keys) await materializeEntity('user', { entityKey }, { now: NOW });
      const researcher: any = await Researcher.findOne({ 'identifiers.netid': NETID }).lean();
      return researcher?.profile?.title;
    };

    expect(await titleIn([PROFILE_KEY, ROSTER_KEY])).toBe(await titleIn([ROSTER_KEY, PROFILE_KEY]));
  });

  describe("a key the researcher's identity names but whose own join reaches someone else", () => {
    const OTHER_NETID = 'ro6217';
    const seedOtherPersonKey = async (overrides: Partial<KeyEvidence>) => {
      await Researcher.create({
        displayName: 'Rowan Other',
        identifiers: { netid: OTHER_NETID },
      });
      await seedKey({
        entityKey: `netid:${OTHER_NETID}`,
        sourceName: 'dept-faculty-roster',
        sourceUrl: 'https://fixture-psychology.yale.edu/people/',
        confidence: 0.9,
        email: RESEARCHER_EMAIL,
        fname: 'Rowan',
        lname: 'Other',
        ...overrides,
      });
    };

    it("keeps that key's department out of the pool", async () => {
      await seedKey({ ...PROFILE, department: 'Ophthalmology & Visual Science' });
      await seedOtherPersonKey({ department: 'Psychology' });

      expect(await materializeInOrder([PROFILE_KEY])).toBe('Ophthalmology & Visual Science');
    });

    it("keeps that key's title out of the pool", async () => {
      await seedKey({ ...ROSTER, title: 'Lecturer in Informatics' });
      await seedOtherPersonKey({ title: 'Professor of Psychology' });
      await Researcher.updateOne(
        { 'identifiers.netid': NETID },
        { $unset: { 'profile.title': 1, profileFieldWriters: 1 } },
      );

      await materializeEntity('user', { entityKey: ROSTER_KEY }, { now: NOW });

      const researcher: any = await Researcher.findOne({ 'identifiers.netid': NETID }).lean();
      expect(researcher?.profile?.title).toBe('Lecturer in Informatics');
    });
  });

  describe('the directory alias rule', () => {
    const seedDirectory = async (localPart: string, netids: string[]) => {
      for (const netid of netids) {
        await seedKey({
          entityKey: netid,
          sourceName: 'yale-directory',
          sourceUrl: 'https://directory.yale.edu/',
          confidence: 0.9,
          email: `${localPart}@yale.edu`,
        });
      }
    };
    const seedAliasKey = async (overrides: Partial<KeyEvidence> = {}) =>
      seedKey({
        entityKey: ALIAS_KEY,
        sourceName: 'dept-faculty-roster',
        sourceUrl: 'https://fixture-ophthalmology.yale.edu/people/',
        confidence: 0.7,
        department: 'Ophthalmology & Visual Science',
        ...overrides,
      });

    it('pools a dotted key the directory pairs with exactly this netid', async () => {
      await seedDirectory(ALIAS_LOCAL, [DIRECTORY_KEY]);
      await seedAliasKey();
      await seedKey(PROFILE);

      expect(await materializeInOrder([PROFILE_KEY])).toBe('Ophthalmology & Visual Science');
    });

    it('fails closed when the directory pairs the address with two netids', async () => {
      await seedDirectory(ALIAS_LOCAL, [DIRECTORY_KEY, 'zz9999']);
      await seedAliasKey();
      await seedKey(PROFILE);

      expect(await materializeInOrder([PROFILE_KEY])).toBeUndefined();
    });

    it('refuses an alias key whose own join reaches a different researcher', async () => {
      await Researcher.create({
        displayName: 'Rowan Other',
        identifiers: { netid: 'ro1111' },
      });
      await seedDirectory(ALIAS_LOCAL, [DIRECTORY_KEY]);
      await seedAliasKey({ fname: 'Rowan', lname: 'Other' });
      await seedKey(PROFILE);

      expect(await materializeInOrder([PROFILE_KEY])).toBeUndefined();
    });
  });

  it('keeps a stated section over its parent department that more keys state', async () => {
    await seedCatalog();
    await seedKey({ ...PROFILE, department: 'Colon & Rectal Surgery' });
    await seedKey({ ...ROSTER, department: 'Surgery' });
    await seedKey({
      ...ROSTER,
      entityKey: SECOND_ROSTER_KEY,
      sourceUrl: 'https://fixture-surgery.yale.edu/people/',
      department: 'Surgery',
    });

    expect(await materializeInOrder([ROSTER_KEY, SECOND_ROSTER_KEY, PROFILE_KEY])).toBe(
      'Colon & Rectal Surgery',
    );
  });
});
