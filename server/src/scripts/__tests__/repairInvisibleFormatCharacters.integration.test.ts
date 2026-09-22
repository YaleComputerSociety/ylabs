import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async (_entityType: string, docs: unknown[]) => docs.length),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../../services/meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
}));

import { runInvisibleFormatCharacterRepair } from '../repairInvisibleFormatCharacters';

const DIRTY_FELLOWSHIP_TITLE =
  'Sum\u00admer Under\u00adgrad\u00aduate Re\u00adsearch Fel\u00adlowship';
const DIRTY_FELLOWSHIP_ELIGIBILITY = 'Open to rising sopho\u200bmores and juniors.';
const DIRTY_ENTITY_SYNTHESIS = 'Studies cata\u00adlytic RNA folding in living cells.';
const DIRTY_RESEARCHER_TITLE = 'Assis\u00adtant Pro\u00adfessor of Economics';

const researchEntities = () => mongoose.connection.db!.collection('research_entities');
const researchers = () => mongoose.connection.db!.collection('researchers');
const fellowships = () => mongoose.connection.db!.collection('fellowships');

describe('repair-invisible-format-characters against real collections (#2874)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
    meiliMocks.syncEntities.mockImplementation(
      async (_entityType: string, docs: unknown[]) => docs.length,
    );
  });

  beforeEach(async () => {
    await Promise.all([
      researchEntities().deleteMany({}),
      researchers().deleteMany({}),
      fellowships().deleteMany({}),
    ]);
    await researchEntities().insertOne({
      slug: 'synthetic-catalysis-lab',
      name: 'Synthetic Catalysis Group',
      profileSynthesisDescription: DIRTY_ENTITY_SYNTHESIS,
    });
    await researchers().insertOne({
      slug: 'synthetic-researcher',
      displayName: 'Synthetic Researcher',
      profile: { title: DIRTY_RESEARCHER_TITLE },
    });
    await fellowships().insertOne({
      sourceKey: 'synthetic-fellowship',
      title: DIRTY_FELLOWSHIP_TITLE,
      eligibility: DIRTY_FELLOWSHIP_ELIGIBILITY,
    });
  });

  it('repairs the student-visible fellowship collection, not only entities and researchers', async () => {
    const dryRun = await runInvisibleFormatCharacterRepair({ dryRun: true });
    expect(Object.keys(dryRun.scanned).sort()).toEqual([
      'fellowships',
      'research_entities',
      'researchers',
    ]);
    expect(dryRun.summary.byCollectionAndField).toMatchObject({
      'fellowships.title': 1,
      'fellowships.eligibility': 1,
    });
    expect((await fellowships().findOne({}))?.title).toBe(DIRTY_FELLOWSHIP_TITLE);

    const applied = await runInvisibleFormatCharacterRepair({ dryRun: false });
    expect(applied.documentsUpdated).toBe(3);
    const fellowship = await fellowships().findOne({});
    expect(fellowship?.title).toBe('Summer Undergraduate Research Fellowship');
    expect(fellowship?.eligibility).toBe('Open to rising sophomores and juniors.');
    expect((await researchers().findOne({}))?.profile).toEqual({
      title: 'Assistant Professor of Economics',
    });

    const second = await runInvisibleFormatCharacterRepair({ dryRun: true });
    expect(second.summary.rows).toBe(0);
  });

  it('reports the resync a failing Meilisearch actually accepted rather than the batch size', async () => {
    meiliMocks.syncEntities.mockImplementation(async () => 0);

    const result = await runInvisibleFormatCharacterRepair({ dryRun: false });

    expect(result.documentsUpdated).toBe(3);
    expect(result.entitiesResynced).toBe(0);
    expect(result.entitiesAwaitingResync).toBe(1);
  });

  it('reports every entity resynced when Meilisearch accepts the batch', async () => {
    const result = await runInvisibleFormatCharacterRepair({ dryRun: false });

    expect(result.entitiesResynced).toBe(1);
    expect(result.entitiesAwaitingResync).toBe(0);
  });
});
