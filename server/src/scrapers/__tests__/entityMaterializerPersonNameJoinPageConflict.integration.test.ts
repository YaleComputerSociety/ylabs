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

const OWNER_PAGE = 'https://medicine.yale.edu/profile/lorvan-tei-quennard/';
const OTHER_PERSON_PAGE = 'https://medicine.yale.edu/psychiatry/profile/lo-quennard/';
const PROFESSOR_TITLE = 'Professor of Pharmacology';
const POSTDOC_TITLE = 'Postdoctoral Associate';

describe('a person-name join never grafts a same-surname stranger onto a record (#5324)', () => {
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

  const seedUser = async (
    entityKey: string,
    fields: Record<string, unknown>,
    observedAt = new Date('2026-03-01T00:00:00Z'),
  ) => {
    for (const [field, value] of Object.entries(fields)) {
      await Observation.create({
        entityType: 'user',
        entityKey,
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: 'dept-faculty-roster',
        sourceUrl: 'https://medicine.yale.edu/psychiatry/people/',
        confidence: 0.7,
        observedAt,
        superseded: false,
        field,
        value,
      });
    }
  };

  const professor = (displayName: string, netid?: string) =>
    Researcher.create({
      displayName,
      ...(netid ? { identifiers: { netid } } : {}),
      profile: { title: PROFESSOR_TITLE },
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: OWNER_PAGE,
          verifiedAt: new Date('2026-01-01T00:00:00Z'),
          healthStatus: 'UNKNOWN',
        },
      ],
      status: 'UNKNOWN',
      archived: false,
    });

  const stored = async (id: unknown) =>
    Researcher.findById(id).lean<{ displayName?: string; profile?: { title?: string } }>();

  it('does not bind a shorter given name the record name merely starts with', async () => {
    const owner = await professor('Lorvan-Tei Quennard');
    await seedUser('dept:ysm-psychiatry:lo-quennard', {
      fname: 'Lo',
      lname: 'Quennard',
      title: POSTDOC_TITLE,
    });

    const result = await materializeEntity(
      'user',
      { entityKey: 'dept:ysm-psychiatry:lo-quennard' },
      {},
    );

    expect(result.skipped).toBeDefined();
    expect(await stored(owner._id)).toMatchObject({
      displayName: 'Lorvan-Tei Quennard',
      profile: { title: PROFESSOR_TITLE },
    });
  });

  it('refuses an exact name match whose record holds another person page on the same site', async () => {
    const conflated = await professor('Lo Quennard');
    await seedUser('dept:ysm-psychiatry:lo-quennard', {
      fname: 'Lo',
      lname: 'Quennard',
      title: POSTDOC_TITLE,
      profileUrls: { departmental: OTHER_PERSON_PAGE },
    });

    const result = await materializeEntity(
      'user',
      { entityKey: 'dept:ysm-psychiatry:lo-quennard' },
      {},
    );

    expect(result.skipped).toBeDefined();
    expect((await stored(conflated._id))?.profile?.title).toBe(PROFESSOR_TITLE);
  });

  it('still joins evidence citing the same person page under a section path', async () => {
    const owner = await professor('Lorvan-Tei Quennard');
    await seedUser('dept:ysm-cancer:lorvan-tei-quennard', {
      fname: 'Lorvan-Tei',
      lname: 'Quennard',
      title: 'Professor of Pharmacology and of Medicine',
      profileUrls: {
        departmental: 'https://medicine.yale.edu/cancer/profile/lorvan-tei-quennard/',
      },
    });

    const result = await materializeEntity(
      'user',
      { entityKey: 'dept:ysm-cancer:lorvan-tei-quennard' },
      {},
    );

    expect(String(result.entityId)).toBe(String(owner._id));
    expect((await stored(owner._id))?.profile?.title).toBe(
      'Professor of Pharmacology and of Medicine',
    );
  });

  it("re-derives a conflated record from its own netid's evidence and keeps the stranger off it", async () => {
    const conflated = await professor('Lo Quennard', 'lq7');
    await Researcher.updateOne({ _id: conflated._id }, { 'profile.title': POSTDOC_TITLE });
    await seedUser('netid:lq7', {
      fname: 'Lorvan-Tei',
      lname: 'Quennard',
      title: PROFESSOR_TITLE,
      profileUrls: { official: OWNER_PAGE },
    });
    await seedUser('dept:ysm-psychiatry:lo-quennard', {
      fname: 'Lo',
      lname: 'Quennard',
      title: POSTDOC_TITLE,
      profileUrls: { departmental: OTHER_PERSON_PAGE },
    });

    await materializeEntity('user', { entityKey: 'netid:lq7' }, {});
    const stranger = await materializeEntity(
      'user',
      { entityKey: 'dept:ysm-psychiatry:lo-quennard' },
      {},
    );

    expect(stranger.skipped).toBeDefined();
    expect(await stored(conflated._id)).toMatchObject({
      displayName: 'Lorvan-Tei Quennard',
      profile: { title: PROFESSOR_TITLE },
    });
  });
});
