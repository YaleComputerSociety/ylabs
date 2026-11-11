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
import { materializeEntity } from '../entityMaterializer';
import { resetDirectoryNetidsByAddressCache } from '../directoryContradictedProfileNetid';

const OWN_PAGE = 'https://medicine.yale.edu/profile/rowan-fixture/';
const STRANGER_PAGE = 'https://medicine.yale.edu/profile/rowan-fixture-x/';
const RESEARCHER_NETID = 'rf5578';
const STRANGER_NETID = 'xs5578';
const RESEARCHER_KEY = `netid:${RESEARCHER_NETID}`;
const ROSTER_KEY = 'dept:ysm-fixture:rowan-fixture';
const STRANGER_TITLE = 'Associate Research Scientist';

const observe = (entityKey: string, sourceName: string, sourceUrl: string, fields: object) =>
  Observation.insertMany(
    Object.entries(fields).map(([field, value]) => ({
      entityType: 'user',
      entityKey,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl,
      confidence: 0.7,
      observedAt: new Date('2026-03-01T00:00:00Z'),
      superseded: false,
      field,
      value,
    })),
  );

describe('a pooled title passes the screens its own key materializes under (#5578)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Observation.createIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    resetDirectoryNetidsByAddressCache();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'researchers', 'accounts', 'scrape_runs']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seed = async () => {
    await observe(RESEARCHER_KEY, 'yale-directory', 'https://dir.test/', {
      netid: RESEARCHER_NETID,
      email: 'rowan.fixture5578@yale.edu',
      displayName: 'Rowan Fixture',
    });
    await observe(`netid:${STRANGER_NETID}`, 'yale-directory', 'https://dir.test/', {
      netid: STRANGER_NETID,
      email: 'stranger.synthetic5578@yale.edu',
    });
    await observe(`netid:${STRANGER_NETID}`, 'ysm-faculty-directory', STRANGER_PAGE, {
      email: 'stranger.synthetic5578@yale.edu',
    });
    await observe(ROSTER_KEY, 'dept-faculty-roster', OWN_PAGE, {
      fname: 'Rowan',
      lname: 'Fixture',
      displayName: 'Rowan Fixture',
    });
    await observe(ROSTER_KEY, 'dept-faculty-roster', STRANGER_PAGE, { title: STRANGER_TITLE });
    return Researcher.create({
      displayName: 'Rowan Fixture',
      identifiers: { netid: RESEARCHER_NETID },
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: OWN_PAGE,
          verifiedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
      status: 'UNKNOWN',
      archived: false,
    });
  };

  const storedTitle = async (id: unknown) =>
    ((await Researcher.findById(id).lean()) as { profile?: { title?: string } } | null)?.profile
      ?.title;

  it('drops a title read from a page another netid owns, from either key', async () => {
    const researcher = await seed();

    const rosterResult = await materializeEntity('user', { entityKey: ROSTER_KEY });
    expect(await storedTitle(researcher._id)).toBeUndefined();

    await materializeEntity('user', { entityKey: RESEARCHER_KEY });

    expect(rosterResult.skipped).not.toBe('page-evidence-names-another-netid');
    expect(await storedTitle(researcher._id)).toBeUndefined();
  });
});
