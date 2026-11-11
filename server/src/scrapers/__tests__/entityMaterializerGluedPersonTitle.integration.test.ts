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
const CLEAN_TITLE = 'Associate Professor of Fixture Studies';
const GLUED_TITLE = `${CLEAN_TITLE} Avery Synthetic Avery Synthetic is associate professor of fixture studies. Avery studies how synthetic institutions change over time and draws on archival records from several fixture collections across the region.`;

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

describe('a person title with biography text glued on is never stored (#5594)', () => {
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

  it('resolves the clean title when a higher-weighted lane stated the glued one', async () => {
    const person = await researcher();
    await observe('official-profile-pi-backfill', 0.95, {
      fname: 'Avery',
      lname: 'Synthetic',
      title: GLUED_TITLE,
      profileUrls: { departmental: PAGE },
    });
    await observe('dept-faculty-roster', 0.7, { title: CLEAN_TITLE });

    await materializeEntity('user', { entityKey: KEY }, {});

    expect(await storedTitle(person._id)).toBe(CLEAN_TITLE);
  });

  it('clears a stored glued title when no title resolves', async () => {
    const person = await researcher(GLUED_TITLE);
    await observe('official-profile-pi-backfill', 0.95, {
      fname: 'Avery',
      lname: 'Synthetic',
      title: GLUED_TITLE,
      profileUrls: { departmental: PAGE },
    });

    await materializeEntity('user', { entityKey: KEY }, {});

    expect(await storedTitle(person._id)).toBeUndefined();
  });

  it('stores the leading whole appointments of an overlong appointment list', async () => {
    const appointments = [
      'Professor of Fixture Studies and of Synthetic Methods',
      'Director of the Fixture Center for Testing',
      'Chair of the Committee on Synthetic Records',
      'Faculty Fellow of Fixture College',
      'Affiliated Faculty of the Program in Placeholder Studies',
      'Member of the Steering Committee of the Synthetic Records Initiative',
    ];
    const person = await researcher();
    await observe('dept-faculty-roster', 0.7, {
      fname: 'Avery',
      lname: 'Synthetic',
      title: appointments.join('; '),
      profileUrls: { departmental: PAGE },
    });

    await materializeEntity('user', { entityKey: KEY }, {});

    expect(await storedTitle(person._id)).toBe(appointments.slice(0, 4).join('; '));
  });
});
