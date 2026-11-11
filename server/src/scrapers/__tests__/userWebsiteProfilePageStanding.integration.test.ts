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

const NETID = 'pw5845';
const NETID_KEY = `netid:${NETID}`;
const NAME_KEY = 'dept:fixture-dept:pell-wexford';
const ROSTER_LISTING = 'https://fixture-dept.yale.edu/people/faculty';
const NOW = new Date('2026-11-11T00:00:00Z');

const PROFILE_PAGE = 'https://medicine.yale.edu/fixturedept/profile/pell-wexford/';
const DIRECTORY_PAGE = 'https://seas.yale.edu/faculty-research/faculty-directory/pell-wexford';
const LAB_SITE = 'https://wexfordlab.example.org/';
const PERSONAL_NAME_DOMAIN = 'https://www.pellwexford.example.net/';

interface WebsiteRead {
  entityKey: string;
  value: string;
  observedAt: string;
  confidence?: number;
}

async function seedName(entityKey: string): Promise<void> {
  await Observation.insertMany(
    Object.entries({ fname: 'Pell', lname: 'Wexford' }).map(([field, value]) => ({
      entityType: 'user',
      entityKey,
      sourceId: new mongoose.Types.ObjectId(),
      scrapeRunId: new mongoose.Types.ObjectId(),
      field,
      value,
      sourceName: 'dept-faculty-roster',
      sourceUrl: ROSTER_LISTING,
      confidence: 0.7,
      observedAt: new Date('2026-08-01T00:00:00Z'),
      superseded: false,
    })),
  );
}

async function seedWebsite(read: WebsiteRead): Promise<void> {
  await Observation.create({
    entityType: 'user',
    entityKey: read.entityKey,
    sourceId: new mongoose.Types.ObjectId(),
    scrapeRunId: new mongoose.Types.ObjectId(),
    field: 'website',
    value: read.value,
    sourceName: 'dept-faculty-roster',
    sourceUrl: ROSTER_LISTING,
    confidence: read.confidence ?? 0.7,
    observedAt: new Date(read.observedAt),
    superseded: false,
  });
}

const materialize = (entityKey: string) => materializeEntity('user', { entityKey }, { now: NOW });

async function createResearcher(websiteUrl?: string) {
  return Researcher.create({
    displayName: 'Pell Wexford',
    identifiers: { netid: NETID },
    ...(websiteUrl ? { profile: { websiteUrl } } : {}),
    status: 'UNKNOWN',
    archived: false,
  });
}

async function storedWebsite(): Promise<string | undefined> {
  const researcher: any = await Researcher.findOne({ 'identifiers.netid': NETID }).lean();
  return researcher?.profile?.websiteUrl;
}

async function clearCollections(): Promise<void> {
  const db = mongoose.connection.db!;
  for (const name of ['accounts', 'researchers', 'observations', 'scrape_runs']) {
    await db.collection(name).deleteMany({});
  }
  resetOverSharedPersonWebsiteKeysCache();
}

describe("a person's profile or directory page never displaces their own website (#5845)", () => {
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
    await clearCollections();
  });

  it('keeps the lab site over a profile page a better-joined key asserts, in either order, and a second pass writes nothing', async () => {
    const websites: Array<string | undefined> = [];
    const secondPasses: number[][] = [];
    for (const order of [
      [NETID_KEY, NAME_KEY],
      [NAME_KEY, NETID_KEY],
    ]) {
      await clearCollections();
      await createResearcher();
      await seedName(NETID_KEY);
      await seedName(NAME_KEY);
      await seedWebsite({ entityKey: NETID_KEY, value: PROFILE_PAGE, observedAt: '2026-11-10' });
      await seedWebsite({ entityKey: NAME_KEY, value: LAB_SITE, observedAt: '2026-08-24' });

      for (const entityKey of order) await materialize(entityKey);
      websites.push(await storedWebsite());
      const secondPass: number[] = [];
      for (const entityKey of order) secondPass.push((await materialize(entityKey)).fieldsWritten);
      secondPasses.push(secondPass);
    }

    expect(websites).toEqual([LAB_SITE, LAB_SITE]);
    expect(secondPasses).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });

  it('prefers the lab site within one key even when its profile page is newer and surer', async () => {
    await createResearcher();
    await seedName(NAME_KEY);
    await seedWebsite({ entityKey: NAME_KEY, value: LAB_SITE, observedAt: '2026-06-01' });
    await seedWebsite({
      entityKey: NAME_KEY,
      value: PROFILE_PAGE,
      observedAt: '2026-11-10',
      confidence: 0.9,
    });

    await materialize(NAME_KEY);

    expect(await storedWebsite()).toBe(LAB_SITE);
  });

  it('leaves a stored personal-name domain that no writer holds in place against a directory page', async () => {
    await createResearcher(PERSONAL_NAME_DOMAIN);
    await seedName(NAME_KEY);
    await seedWebsite({ entityKey: NAME_KEY, value: DIRECTORY_PAGE, observedAt: '2026-08-24' });

    await materialize(NAME_KEY);
    expect(await storedWebsite()).toBe(PERSONAL_NAME_DOMAIN);
    expect((await materialize(NAME_KEY)).fieldsWritten).toBe(0);
    expect(await storedWebsite()).toBe(PERSONAL_NAME_DOMAIN);
  });

  it('lets a personal-name domain replace a stored directory page', async () => {
    await createResearcher(DIRECTORY_PAGE);
    await seedName(NETID_KEY);
    await seedName(NAME_KEY);
    await seedWebsite({ entityKey: NETID_KEY, value: DIRECTORY_PAGE, observedAt: '2026-08-24' });
    await materialize(NETID_KEY);
    await seedWebsite({
      entityKey: NAME_KEY,
      value: PERSONAL_NAME_DOMAIN,
      observedAt: '2026-08-24',
    });

    await materialize(NAME_KEY);

    expect(await storedWebsite()).toBe(PERSONAL_NAME_DOMAIN);
  });

  it.each([
    ['an http spelling', 'https://wexfordlab.example.org/', 'http://wexfordlab.example.org/'],
    [
      'a trailing slash',
      'https://wexfordlab.example.org/group',
      'https://wexfordlab.example.org/group/',
    ],
  ])('plans no website write for %s of the stored site', async (_label, storedSite, respelling) => {
    await createResearcher(storedSite);
    await seedName(NAME_KEY);
    await seedWebsite({ entityKey: NAME_KEY, value: respelling, observedAt: '2026-11-10' });

    await materialize(NAME_KEY);

    expect(await storedWebsite()).toBe(storedSite);
  });

  it('still gives the profile page to a person who has no other website', async () => {
    await createResearcher();
    await seedName(NAME_KEY);
    await seedWebsite({ entityKey: NAME_KEY, value: PROFILE_PAGE, observedAt: '2026-08-24' });

    await materialize(NAME_KEY);
    expect(await storedWebsite()).toBe(PROFILE_PAGE);
    expect((await materialize(NAME_KEY)).fieldsWritten).toBe(0);
  });
});
