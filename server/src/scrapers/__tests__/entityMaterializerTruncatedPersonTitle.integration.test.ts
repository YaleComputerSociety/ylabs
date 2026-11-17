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

const PAGE = 'https://medicine.yale.edu/profile/avery-synthetic/';
const KEY = 'dept:ysm-fixture:avery-synthetic';
const WHOLE_TITLE = 'Associate Professor of Fixture Studies';
const TRUNCATED_TITLE = 'Associate Professor of';

const observe = (sourceName: string, confidence: number, fields: Record<string, unknown>) =>
  Promise.all(
    Object.entries(fields).map(([field, value]) =>
      Observation.create({
        entityType: 'user',
        entityKey: KEY,
        sourceId: new mongoose.Types.ObjectId(),
        sourceName,
        sourceUrl: PAGE,
        confidence,
        observedAt: new Date('2026-06-05T00:00:00Z'),
        superseded: false,
        field,
        value,
      }),
    ),
  );

const researcher = (storedTitle?: string) =>
  Researcher.create({
    displayName: 'Avery Synthetic',
    ...(storedTitle ? { profile: { title: storedTitle.slice(0, 400) } } : {}),
    profileLinks: [
      {
        kind: 'YALE_OFFICIAL',
        purpose: 'PRIMARY_IDENTITY',
        url: PAGE,
        verifiedAt: new Date('2026-01-01T00:00:00Z'),
        healthStatus: 'UNKNOWN',
      },
    ],
    status: 'UNKNOWN',
    archived: false,
  });

const storedTitle = async (id: unknown) =>
  (await Researcher.findById(id).lean<{ profile?: { title?: string } }>())?.profile?.title;

describe('a person title cut off before the field it names is never stored (#6426)', () => {
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

  it('resolves the whole title when a higher-weighted lane stated the truncated one', async () => {
    const person = await researcher();
    await observe('dept-faculty-roster', 0.95, {
      fname: 'Avery',
      lname: 'Synthetic',
      title: TRUNCATED_TITLE,
      profileUrls: { departmental: PAGE },
    });
    await observe('official-profile-pi-backfill', 0.7, { title: WHOLE_TITLE });

    await materializeEntity('user', { entityKey: KEY }, {});

    expect(await storedTitle(person._id)).toBe(WHOLE_TITLE);
  });

  it('stores no title when the only title stated is truncated', async () => {
    const person = await researcher();
    await observe('dept-faculty-roster', 0.95, {
      fname: 'Avery',
      lname: 'Synthetic',
      title: TRUNCATED_TITLE,
      profileUrls: { departmental: PAGE },
    });

    await materializeEntity('user', { entityKey: KEY }, {});

    expect(await storedTitle(person._id)).toBeUndefined();
  });

  it('clears a stored truncated title when no whole title resolves', async () => {
    const person = await researcher(TRUNCATED_TITLE);
    await observe('dept-faculty-roster', 0.95, {
      fname: 'Avery',
      lname: 'Synthetic',
      title: TRUNCATED_TITLE,
      profileUrls: { departmental: PAGE },
    });

    await materializeEntity('user', { entityKey: KEY }, {});

    expect(await storedTitle(person._id)).toBeUndefined();
  });
});
