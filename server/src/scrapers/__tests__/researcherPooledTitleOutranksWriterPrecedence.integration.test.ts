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
import { Researcher } from '../../models/researcher';
import { materializeEntity } from '../entityMaterializer';
import { resetOverSharedPersonWebsiteKeysCache } from '../overSharedPersonWebsite';
import { clearC4Flags } from './c4FlagTestEnv';
import { recordFullCoverageRun } from './fullCoverageRunFixture';

const NETID = 'pw5578';
const NETID_KEY = `netid:${NETID}`;
const SCHOOL_KEY = 'ysm:pell-wexford';
const NAME_KEY = 'dept:fixture-dept:pell-wexford';
const OFFICIAL_PAGE = 'https://medicine.yale.edu/profile/pell-wexford/';
const ROSTER_LISTING = 'https://fixture-dept.yale.edu/people/faculty';
const NOW = new Date('2026-11-10T00:00:00Z');

const COPIED_RANK = 'Professor of Fixture Medicine';
const FIRST_HAND_RANK = 'Associate Professor of Fixture Medicine';

const NETID_FIELDS = {
  primaryDepartment: 'Fixture Medicine',
  imageUrl: 'https://medicine.yale.edu/images/pell-wexford.jpg',
  websiteUrl: 'https://pell-lab.example.edu/',
};
const SCHOOL_FIELDS = {
  primaryDepartment: 'Applied Fixtures',
  imageUrl: 'https://medicine.yale.edu/images/pell-wexford-alt.jpg',
  websiteUrl: 'https://wexford-group.example.edu/',
};

interface Read {
  entityKey: string;
  sourceName: string;
  sourceUrl: string;
  observedAt: string;
  fields: Record<string, string>;
}

async function seed(read: Read): Promise<void> {
  const scrapeRunId = new mongoose.Types.ObjectId();
  if (read.sourceName === 'ysm-faculty-directory') {
    await recordFullCoverageRun(read.sourceName, scrapeRunId, new Date(read.observedAt));
  }
  await Observation.insertMany(
    Object.entries({ fname: 'Pell', lname: 'Wexford', ...read.fields }).map(([field, value]) => ({
      entityType: 'user',
      entityKey: read.entityKey,
      sourceId: new mongoose.Types.ObjectId(),
      scrapeRunId,
      field,
      value,
      sourceName: read.sourceName,
      sourceUrl: read.sourceUrl,
      confidence: 0.9,
      observedAt: new Date(read.observedAt),
      superseded: false,
    })),
  );
}

const materialize = (entityKey: string) => materializeEntity('user', { entityKey }, { now: NOW });

async function stored(): Promise<any> {
  return Researcher.findOne({ 'identifiers.netid': NETID }).lean();
}

const writerKeyOf = (researcher: any, field: string): string | undefined =>
  researcher?.profileFieldWriters?.[field]?.userKey;

describe('the pooled title is written whatever the writer rank (#5578, #5706)', () => {
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
    clearC4Flags();
    const db = mongoose.connection.db!;
    for (const name of ['accounts', 'researchers', 'observations', 'scrape_runs']) {
      await db.collection(name).deleteMany({});
    }
    resetOverSharedPersonWebsiteKeysCache();
    await Researcher.create({
      displayName: 'Pell Wexford',
      identifiers: { netid: NETID },
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: OFFICIAL_PAGE,
          verifiedAt: new Date('2026-09-01T00:00:00Z'),
          healthStatus: 'UNKNOWN',
        },
      ],
      status: 'UNKNOWN',
      archived: false,
    });
    await seed({
      entityKey: NETID_KEY,
      sourceName: 'official-profile-pi-backfill',
      sourceUrl: OFFICIAL_PAGE,
      observedAt: '2026-06-05T00:00:00Z',
      fields: { title: COPIED_RANK, ...NETID_FIELDS },
    });
  });

  it('lets a person-name key write the pooled title after a netid-ranked writer', async () => {
    await materialize(NETID_KEY);
    await Researcher.updateOne(
      { 'identifiers.netid': NETID },
      {
        $set: {
          'profileFieldWriters.title': { userKey: NETID_KEY, joinRank: 4, confidence: 1 },
        },
      },
    );
    expect((await stored()).profile.title).toBe(COPIED_RANK);

    await seed({
      entityKey: NAME_KEY,
      sourceName: 'ysm-faculty-directory',
      sourceUrl: OFFICIAL_PAGE,
      observedAt: '2026-10-01T00:00:00Z',
      fields: { title: FIRST_HAND_RANK },
    });
    const result = await materialize(NAME_KEY);

    const researcher = await stored();
    expect(String(result.entityId)).toBe(String(researcher._id));
    expect(writerKeyOf(researcher, 'primaryDepartment')).toBe(NETID_KEY);
    expect(researcher.profile.title).toBe(FIRST_HAND_RANK);
  });

  it('keeps writer precedence for the other four fields', async () => {
    await materialize(NETID_KEY);
    await seed({
      entityKey: SCHOOL_KEY,
      sourceName: 'ysm-faculty-directory',
      sourceUrl: ROSTER_LISTING,
      observedAt: '2026-10-01T00:00:00Z',
      fields: { fname: 'Pellam', ...SCHOOL_FIELDS },
    });
    const before = await stored();

    await materialize(SCHOOL_KEY);

    const after = await stored();
    for (const field of ['displayName', 'primaryDepartment', 'imageUrl', 'websiteUrl']) {
      expect(writerKeyOf(after, field)).toBe(NETID_KEY);
    }
    expect(after.displayName).toBe(before.displayName);
    expect(after.profile.primaryDepartment).toBe(NETID_FIELDS.primaryDepartment);
    expect(after.profile.imageUrl).toBe(NETID_FIELDS.imageUrl);
    expect(after.profile.websiteUrl).toBe(NETID_FIELDS.websiteUrl);
  });

  it('leaves the pooled title in place when the materializing key states none', async () => {
    await seed({
      entityKey: SCHOOL_KEY,
      sourceName: 'ysm-faculty-directory',
      sourceUrl: OFFICIAL_PAGE,
      observedAt: '2026-10-01T00:00:00Z',
      fields: { title: FIRST_HAND_RANK },
    });
    await materialize(SCHOOL_KEY);
    expect((await stored()).profile.title).toBe(FIRST_HAND_RANK);

    await seed({
      entityKey: NAME_KEY,
      sourceName: 'dept-faculty-roster',
      sourceUrl: ROSTER_LISTING,
      observedAt: '2026-11-09T00:00:00Z',
      fields: { primaryDepartment: NETID_FIELDS.primaryDepartment },
    });
    const result = await materialize(NAME_KEY);

    expect(String(result.entityId)).toBe(String((await stored())._id));
    expect((await stored()).profile.title).toBe(FIRST_HAND_RANK);

    await Researcher.updateOne({ 'identifiers.netid': NETID }, { $unset: { 'profile.title': 1 } });
    await materialize(NAME_KEY);
    expect((await stored()).profile.title).toBe(FIRST_HAND_RANK);
  });

  it('does not write a pooled title the hygiene screen refuses', async () => {
    await materialize(NETID_KEY);
    expect((await stored()).profile.title).toBe(COPIED_RANK);

    await seed({
      entityKey: SCHOOL_KEY,
      sourceName: 'ysm-faculty-directory',
      sourceUrl: OFFICIAL_PAGE,
      observedAt: '2026-10-01T00:00:00Z',
      fields: { title: 'Associate Professor of' },
    });
    await materialize(SCHOOL_KEY);
    await materialize(NETID_KEY);

    expect((await stored()).profile.title).toBe(COPIED_RANK);
  });
});

describe('a title a key falls back to from its own evidence keeps writer precedence (#5578, #5706)', () => {
  let replSet: MongoMemoryReplSet;
  const POOL_KEY = 'ysm:fixture-pell-wexford';
  const STALE_KEY = 'dept:fixture-z:pell-wexford';
  const HIGHER_KEY = 'dept:fixture-b:pell-wexford';
  const LOWER_KEY = 'dept:fixture-c:pell-wexford';
  const listing = (key: string) => `https://${key.split(':')[1]}.yale.edu/people/faculty`;

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
    clearC4Flags();
    const db = mongoose.connection.db!;
    for (const name of ['accounts', 'researchers', 'observations', 'scrape_runs']) {
      await db.collection(name).deleteMany({});
    }
    resetOverSharedPersonWebsiteKeysCache();
  });

  const seedFallbackKey = (entityKey: string, title: string, confidence: number) =>
    Observation.insertMany(
      Object.entries({ fname: 'Pell', lname: 'Wexford', title }).map(([field, value]) => ({
        entityType: 'user',
        entityKey,
        sourceId: new mongoose.Types.ObjectId(),
        scrapeRunId: new mongoose.Types.ObjectId(),
        field,
        value,
        sourceName: 'dept-faculty-roster',
        sourceUrl: listing(entityKey),
        confidence,
        observedAt: new Date('2026-10-01T00:00:00Z'),
        superseded: false,
      })),
    );

  const createResearcher = (profileLinks: unknown[] = []) =>
    Researcher.create({
      displayName: 'Pell Wexford',
      profileLinks,
      status: 'UNKNOWN',
      archived: false,
    });

  const titleOf = async (id: unknown) =>
    ((await Researcher.findById(id).lean()) as any)?.profile?.title;

  async function settleInEitherOrder(
    keys: string[],
    reset: () => Promise<unknown>,
  ): Promise<{ titles: string[]; secondPass: number[] }> {
    const titles: string[] = [];
    let secondPass: number[] = [];
    for (const order of [keys, [...keys].reverse()]) {
      const id = (await reset()) as unknown;
      for (const entityKey of order) await materialize(entityKey);
      titles.push(await titleOf(id));
      secondPass = [];
      for (const entityKey of order) secondPass.push((await materialize(entityKey)).fieldsWritten);
    }
    return { titles, secondPass };
  }

  it('settles two name-only keys on a researcher no key identity can find', async () => {
    const { titles, secondPass } = await settleInEitherOrder([HIGHER_KEY, LOWER_KEY], async () => {
      const db = mongoose.connection.db!;
      for (const name of ['researchers', 'observations', 'scrape_runs']) {
        await db.collection(name).deleteMany({});
      }
      await seedFallbackKey(HIGHER_KEY, 'Professor of Fixture Studies', 0.9);
      await seedFallbackKey(LOWER_KEY, 'Lecturer in Fixture Studies', 0.6);
      return (await createResearcher())._id;
    });

    expect(titles[0]).toBe(titles[1]);
    expect(secondPass).toEqual([0, 0]);
  });

  it('forgets a fallback writer once a pooled title writes, so no later fallback round replaces it', async () => {
    const { titles, secondPass } = await settleInEitherOrder([HIGHER_KEY, LOWER_KEY], async () => {
      const db = mongoose.connection.db!;
      for (const name of ['researchers', 'observations', 'scrape_runs']) {
        await db.collection(name).deleteMany({});
      }
      const researcher = await createResearcher([
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: OFFICIAL_PAGE,
          verifiedAt: new Date('2026-09-01T00:00:00Z'),
          healthStatus: 'UNKNOWN',
        },
      ]);
      await seedFallbackKey(STALE_KEY, 'Senior Fellow in Fixture Studies', 0.5);
      await materialize(STALE_KEY);
      await seed({
        entityKey: POOL_KEY,
        sourceName: 'ysm-faculty-directory',
        sourceUrl: OFFICIAL_PAGE,
        observedAt: '2026-10-05T00:00:00Z',
        fields: { title: FIRST_HAND_RANK },
      });
      await materialize(POOL_KEY);
      expect(await titleOf(researcher._id)).toBe(FIRST_HAND_RANK);
      await Observation.updateMany(
        { $or: [{ entityKey: POOL_KEY }, { entityKey: STALE_KEY, field: 'title' }] },
        { $set: { superseded: true } },
      );
      await seedFallbackKey(HIGHER_KEY, 'Professor of Fixture Studies', 0.9);
      await seedFallbackKey(LOWER_KEY, 'Lecturer in Fixture Studies', 0.6);
      return researcher._id;
    });

    expect(titles).toEqual([FIRST_HAND_RANK, FIRST_HAND_RANK]);
    expect(secondPass).toEqual([0, 0]);
  });
});
