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
import { Researcher } from '../../models/researcher';
import { materializeEntity, resolveNetidForRosterEmailAlias } from '../entityMaterializer';
import { resetDirectoryNetidsByAddressCache } from '../directoryContradictedProfileNetid';
import { resolveExistingUserForIdentity } from '../sources/officialProfilePiBackfillScraper';

const PAGE = 'https://engineering.yale.edu/faculty-directory/rowan-fixture/';
const ADDRESS = 'rowan.fixture@yale.edu';
const OWNER_NETID = 'rf101';
const NAMESAKE_NETID = 'rz202';

const pageIdentity = (email = ADDRESS) => ({
  canonicalUrl: PAGE,
  fetchedUrl: PAGE,
  displayName: 'Rowan Fixture',
  email,
  title: 'Professor',
  departments: [],
  researchInterests: [],
});

describe('the official profile backfill never stamps a namesake netid (#5370)', () => {
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
    resetDirectoryNetidsByAddressCache();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'researchers', 'accounts']) {
      await db.collection(name).deleteMany({});
    }
  });

  const observe = (
    sourceName: string,
    entityKey: string,
    fields: Record<string, unknown>,
    sourceUrl = PAGE,
  ) =>
    Observation.insertMany(
      Object.entries(fields).map(([field, value]) => ({
        entityType: 'user',
        entityKey,
        sourceId: new mongoose.Types.ObjectId(),
        sourceName,
        sourceUrl,
        confidence: 0.95,
        observedAt: new Date('2026-06-05T00:00:00Z'),
        superseded: false,
        field,
        value,
      })),
    );

  const seedDirectory = () =>
    observe(
      'yale-directory',
      OWNER_NETID,
      { netid: OWNER_NETID, email: ADDRESS, fname: 'Rowan', lname: 'Fixture' },
      'https://directory.example.test/',
    );

  const seedMisattributedLaneKey = () =>
    observe('official-profile-pi-backfill', `netid:${NAMESAKE_NETID}`, {
      netid: NAMESAKE_NETID,
      fname: 'Rowan',
      lname: 'Fixture',
      email: ADDRESS,
      title: 'Professor',
      profileUrls: { medicine: PAGE, official: PAGE },
    });

  const seedNamesake = () =>
    Researcher.create({
      displayName: 'Robin Fixture',
      identifiers: { netid: NAMESAKE_NETID, email: `${NAMESAKE_NETID}@yale.edu` },
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: PAGE,
          verifiedAt: new Date('2026-08-01T00:00:00Z'),
        },
      ],
      status: 'ACTIVE',
      archived: false,
    });

  it('refuses the sole holder of the page URL when its name is another person', async () => {
    await seedNamesake();

    expect(await resolveExistingUserForIdentity(pageIdentity(''))).toBeNull();
    expect(await resolveExistingUserForIdentity(pageIdentity())).toBeNull();
  });

  it('refuses an agreeing candidate whose netid the directory pairs with another person', async () => {
    await seedDirectory();
    await Researcher.create({
      displayName: 'Rowan Fixture',
      identifiers: { netid: NAMESAKE_NETID },
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: PAGE,
          verifiedAt: new Date('2026-08-01T00:00:00Z'),
        },
      ],
      status: 'ACTIVE',
      archived: false,
    });

    expect(await resolveExistingUserForIdentity(pageIdentity())).toBeNull();
  });

  it('still resolves the holder of the page address', async () => {
    await seedDirectory();
    const owner = await Researcher.create({
      displayName: 'Rowan Fixture',
      identifiers: { netid: OWNER_NETID, email: ADDRESS },
      status: 'ACTIVE',
      archived: false,
    });

    expect(await resolveExistingUserForIdentity(pageIdentity())).toEqual({
      _id: String(owner._id),
      netid: OWNER_NETID,
      email: ADDRESS,
    });
  });

  it('maps the alias to the directory netid past a stale namesake key', async () => {
    await seedDirectory();
    await seedMisattributedLaneKey();

    expect(await resolveNetidForRosterEmailAlias('rowan.fixture')).toEqual({
      status: 'resolved',
      netid: OWNER_NETID,
    });
  });

  it('keeps an alias ambiguous when no directory lane speaks for it', async () => {
    await seedMisattributedLaneKey();
    await observe('dept-faculty-roster', 'netid:rf303', { email: ADDRESS });

    expect((await resolveNetidForRosterEmailAlias('rowan.fixture')).status).toBe('ambiguous');
  });

  it("skips the stale key and withdraws the page link it gave the namesake's record", async () => {
    await seedDirectory();
    await seedMisattributedLaneKey();
    const namesake = await seedNamesake();

    const result = await materializeEntity('user', { entityKey: `netid:${NAMESAKE_NETID}` });

    expect(result.skipped).toBe('directory-contradicts-profile-netid');
    const after = await Researcher.findById(namesake._id).lean();
    expect(after?.profileLinks || []).toEqual([]);
    expect(after?.identifiers?.email).toBe(`${NAMESAKE_NETID}@yale.edu`);

    const again = await materializeEntity('user', { entityKey: `netid:${NAMESAKE_NETID}` });
    expect(again).toMatchObject({
      skipped: 'directory-contradicts-profile-netid',
      fieldsWritten: 0,
    });
  });

  it('withdraws nothing on a dry run', async () => {
    await seedDirectory();
    await seedMisattributedLaneKey();
    const namesake = await seedNamesake();

    const result = await materializeEntity(
      'user',
      { entityKey: `netid:${NAMESAKE_NETID}` },
      { dryRun: true },
    );

    expect(result).toMatchObject({
      skipped: 'directory-contradicts-profile-netid',
      fieldsWritten: 1,
    });
    const after = await Researcher.findById(namesake._id).lean();
    expect(after?.profileLinks?.map((link) => link.url)).toEqual([PAGE]);
  });
});
