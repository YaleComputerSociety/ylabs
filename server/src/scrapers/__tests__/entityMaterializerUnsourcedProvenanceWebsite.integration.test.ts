import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntity: vi.fn().mockResolvedValue(undefined),
  deleteFromIndex: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: meiliMocks.syncEntity,
    deleteFromIndex: meiliMocks.deleteFromIndex,
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { materializeEntity } from '../entityMaterializer';

const SLUG = 'faculty-research-synthetic-member';
const STORED_SITE = 'https://synthetic-member-lab.example.org/';
const PROFILE_URL = 'https://environment.yale.edu/directory/faculty/synthetic-member';

describe('a websiteUrl written without evidence clears on materialize (#3586)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedObservation = async (field: string, value: unknown, sourceName: string) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: PROFILE_URL,
      confidence: 0.8,
      observedAt: new Date('2026-09-20T00:00:00Z'),
      superseded: false,
    });
  };

  // Inserted past the model on purpose: this is the stored shape the model now refuses to write (#3769).
  const seedRow = async (fields: Record<string, unknown> = {}) => {
    const { insertedId } = await ResearchEntity.collection.insertOne({
      slug: SLUG,
      name: 'Synthetic Member Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: false,
      websiteUrl: STORED_SITE,
      sourceUrls: [PROFILE_URL],
      fieldProvenance: {
        websiteUrl: {
          sourceName: 'hand-written-discovery',
          sourceUrl: STORED_SITE,
          observedAt: new Date('2026-09-14T00:00:00Z'),
          confidence: 0.9,
        },
      },
      ...fields,
    });
    await seedObservation('name', 'Synthetic Member Research', 'dept-faculty-roster');
    await seedObservation('sourceUrls', [PROFILE_URL], 'dept-faculty-roster');
    return { _id: insertedId as mongoose.Types.ObjectId };
  };

  const storedWebsiteUrl = async (id: mongoose.Types.ObjectId) =>
    (await ResearchEntity.findById(id).lean<{ websiteUrl?: string }>())?.websiteUrl ?? '';

  it('clears a stored website whose only record names a lane without evidence', async () => {
    const row = await seedRow();

    await materializeEntity('researchEntity', { entityKey: SLUG });

    expect(await storedWebsiteUrl(row._id)).toBe('');
  });

  it('stays cleared on a second pass', async () => {
    const row = await seedRow();

    await materializeEntity('researchEntity', { entityKey: SLUG });
    await materializeEntity('researchEntity', { entityKey: SLUG });

    expect(await storedWebsiteUrl(row._id)).toBe('');
  });

  it('keeps the website once a lane observes it', async () => {
    const row = await seedRow();
    await seedObservation('websiteUrl', STORED_SITE, 'lab-site-search-discovery');

    await materializeEntity('researchEntity', { entityKey: SLUG });

    expect(await storedWebsiteUrl(row._id)).toBe(STORED_SITE);
  });

  it('keeps a locked website', async () => {
    const row = await seedRow({ manuallyLockedFields: ['websiteUrl'] });

    await materializeEntity('researchEntity', { entityKey: SLUG });

    expect(await storedWebsiteUrl(row._id)).toBe(STORED_SITE);
  });

  it('keeps a website whose provenance cites an observation', async () => {
    const row = await seedRow({
      fieldProvenance: {
        websiteUrl: {
          sourceName: 'dept-faculty-roster',
          sourceId: new mongoose.Types.ObjectId(),
          observationId: new mongoose.Types.ObjectId(),
          sourceUrl: PROFILE_URL,
          observedAt: new Date('2026-09-14T00:00:00Z'),
          confidence: 0.8,
        },
      },
    });

    await materializeEntity('researchEntity', { entityKey: SLUG });

    expect(await storedWebsiteUrl(row._id)).toBe(STORED_SITE);
  });
});
