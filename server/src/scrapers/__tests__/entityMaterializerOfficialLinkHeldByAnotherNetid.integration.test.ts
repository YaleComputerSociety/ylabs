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

const PAGE = 'https://medicine.yale.edu/profile/casey-synthetic/';
const KEY = 'netid:zzc5605';

const officialLink = (url: string) => ({
  kind: 'YALE_OFFICIAL' as const,
  purpose: 'PRIMARY_IDENTITY' as const,
  url,
  verifiedAt: new Date('2026-01-01T00:00:00Z'),
  healthStatus: 'UNKNOWN' as const,
});

describe('the user materializer never stamps an official page another netid carries (#5605)', () => {
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
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'researchers', 'accounts']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedKeyCitingPage = async () => {
    const base = {
      entityType: 'user' as const,
      entityKey: KEY,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'dept-faculty-roster',
      sourceUrl: 'https://medicine.yale.edu/people/',
      confidence: 0.7,
      observedAt: new Date('2026-03-01T00:00:00Z'),
      superseded: false,
    };
    for (const [field, value] of Object.entries({
      displayName: 'Casey Synthetic',
      netid: 'zzc5605',
      profileUrls: { official: PAGE },
    })) {
      await Observation.create({ ...base, field, value });
    }
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

  it('leaves the key person without the page when a researcher with another netid holds it, on every run', async () => {
    const person = await Researcher.create({
      displayName: 'Casey Synthetic',
      identifiers: { netid: 'zzc5605' },
    });
    await Researcher.create({
      displayName: 'Casey Synthetic',
      identifiers: { netid: 'zzd5605' },
      profileLinks: [officialLink(PAGE)],
    });
    await seedKeyCitingPage();

    for (let pass = 0; pass < 2; pass += 1) {
      const result = await materializeEntity('user', { entityKey: KEY }, {});
      expect(String(result.entityId)).toBe(String(person._id));
      expect(await officialUrls(person._id)).toEqual([]);
    }
  });

  it('stamps the page when its only other holder is a twin with no netid', async () => {
    const person = await Researcher.create({
      displayName: 'Casey Synthetic',
      identifiers: { netid: 'zzc5605' },
    });
    await Researcher.create({
      displayName: 'Casey Synthetic',
      profileLinks: [officialLink(PAGE)],
    });
    await seedKeyCitingPage();

    await materializeEntity('user', { entityKey: KEY }, {});
    expect(await officialUrls(person._id)).toEqual([PAGE]);
  });
});
