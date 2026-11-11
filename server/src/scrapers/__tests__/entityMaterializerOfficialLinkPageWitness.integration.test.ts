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

const PAGE = 'https://medicine.yale.edu/profile/casey-synthetic/';
const PAGE_EMAIL = 'casey.synthetic5733@yale.edu';
const OWNER_NETID = 'zzc5733';
const HOLDER_NETID = 'zzd5733';
const KEY = `netid:${OWNER_NETID}`;

const officialLink = (url: string) => ({
  kind: 'YALE_OFFICIAL' as const,
  purpose: 'PRIMARY_IDENTITY' as const,
  url,
  verifiedAt: new Date('2026-01-01T00:00:00Z'),
  healthStatus: 'UNKNOWN' as const,
});

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

describe('a page that names its owner stamps them past a holder it does not name (#5733)', () => {
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
    for (const name of ['observations', 'researchers', 'accounts']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seed = async (directoryNetidForPageEmail?: string) => {
    const owner = await Researcher.create({
      displayName: 'Casey Synthetic',
      identifiers: { netid: OWNER_NETID },
    });
    const holder = await Researcher.create({
      displayName: 'Casey Synthetic',
      identifiers: { netid: HOLDER_NETID },
      profileLinks: [officialLink(PAGE)],
    });
    await observe(KEY, 'dept-faculty-roster', 'https://medicine.yale.edu/people/', {
      displayName: 'Casey Synthetic',
      netid: OWNER_NETID,
      profileUrls: { official: PAGE },
    });
    await observe('netid:casey.synthetic5733', 'ysm-faculty-directory', PAGE, {
      email: PAGE_EMAIL,
    });
    if (directoryNetidForPageEmail) {
      await observe(directoryNetidForPageEmail, 'yale-directory', 'https://dir.test/', {
        netid: directoryNetidForPageEmail,
        email: PAGE_EMAIL,
      });
    }
    return { owner, holder };
  };

  const officialUrls = async (id: unknown) =>
    (
      (
        (await Researcher.findById(id).lean()) as {
          profileLinks?: Array<{ kind: string; url: string }>;
        } | null
      )?.profileLinks ?? []
    )
      .filter((link) => link.kind === 'YALE_OFFICIAL')
      .map((link) => link.url);

  it('stamps the owner the page names, leaves the holder as it was, and re-derives the same on a second run', async () => {
    const { owner, holder } = await seed(OWNER_NETID);

    for (let pass = 0; pass < 2; pass += 1) {
      await materializeEntity('user', { entityKey: KEY }, {});
      expect(await officialUrls(owner._id)).toEqual([PAGE]);
      expect(await officialUrls(holder._id)).toEqual([PAGE]);
    }
  });

  it('keeps refusing when the page names the holder rather than the candidate', async () => {
    const { owner } = await seed(HOLDER_NETID);

    await materializeEntity('user', { entityKey: KEY }, {});
    expect(await officialUrls(owner._id)).toEqual([]);
  });

  it('keeps refusing when the directory cannot say whose the page is', async () => {
    const { owner } = await seed();

    await materializeEntity('user', { entityKey: KEY }, {});
    expect(await officialUrls(owner._id)).toEqual([]);
  });
});
