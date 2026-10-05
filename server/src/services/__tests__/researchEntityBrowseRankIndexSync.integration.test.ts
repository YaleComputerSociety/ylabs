import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntity: vi.fn(async (_entityType: string, _doc: unknown) => true),
}));

vi.mock('../meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../meiliSyncService')>('../meiliSyncService');
  return { ...actual, syncEntity: meiliMocks.syncEntity };
});

import { ResearchEntity } from '../../models/researchEntity';
import { recomputeBrowseRankForEntities } from '../researchEntityBrowseRankService';

describe('recomputeBrowseRankForEntities reports index-sync failures apart from updates', () => {
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
    await db.collection('research_entities').deleteMany({});
    meiliMocks.syncEntity.mockReset();
    meiliMocks.syncEntity.mockResolvedValue(true);
  });

  const createStaleEntity = async (slug: string) =>
    ResearchEntity.create({
      slug,
      name: `Entity ${slug}`,
      entityType: 'LAB',
      fullDescription: 'A complete, source-backed description of the research work.',
      status: 'ACTIVE',
      archived: false,
      browseRankScore: -999,
    });

  it('counts a row whose index sync failed as updated in Mongo and as an index-sync failure', async () => {
    const synced = await createStaleEntity('rank-synced');
    const unsynced = await createStaleEntity('rank-unsynced');
    meiliMocks.syncEntity.mockImplementation(
      async (_entityType: string, doc: unknown) =>
        String((doc as { _id: unknown })._id) !== String(unsynced._id),
    );

    const result = await recomputeBrowseRankForEntities([synced._id, unsynced._id]);

    expect(result.updated).toBe(2);
    expect(result.indexSyncFailures).toBe(1);
    expect(meiliMocks.syncEntity).toHaveBeenCalledTimes(2);
  });

  it('reports no index-sync failures when every sync succeeds or sync is off', async () => {
    const entity = await createStaleEntity('rank-clean');

    const synced = await recomputeBrowseRankForEntities([entity._id]);
    expect(synced.updated).toBe(1);
    expect(synced.indexSyncFailures).toBe(0);

    await ResearchEntity.updateOne({ _id: entity._id }, { $set: { browseRankScore: -999 } });
    const unsyncedRun = await recomputeBrowseRankForEntities([entity._id], { sync: false });
    expect(unsyncedRun.updated).toBe(1);
    expect(unsyncedRun.indexSyncFailures).toBe(0);
  });
  it('counts a stamp-only write as stamped, not updated, so it cannot mask an earlier sync failure', async () => {
    const entity = await createStaleEntity('rank-stamp-only');
    await recomputeBrowseRankForEntities([entity._id]);
    await ResearchEntity.updateOne(
      { _id: entity._id },
      { $unset: { browseRankScorerVersion: '' } },
    );
    meiliMocks.syncEntity.mockClear();

    const dryRun = await recomputeBrowseRankForEntities([entity._id], { dryRun: true });
    expect(dryRun.updated).toBe(0);
    expect(dryRun.stamped).toBe(1);

    const stampRun = await recomputeBrowseRankForEntities([entity._id]);
    expect(stampRun.updated).toBe(0);
    expect(stampRun.stamped).toBe(1);
    expect(stampRun.indexSyncFailures).toBe(0);
    expect(meiliMocks.syncEntity).not.toHaveBeenCalled();
  });
});
