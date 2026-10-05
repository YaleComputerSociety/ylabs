import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  syncEntity: vi.fn(async (_entityType: string, _doc: unknown) => true),
  recomputeBrowseRankForEntities: vi.fn(async (_ids: unknown[]) => ({
    considered: 1,
    updated: 1,
    indexSyncFailures: 0,
    scoresByEntityId: new Map<string, number>(),
  })),
}));

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: mocks.syncEntity };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: mocks.recomputeBrowseRankForEntities };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { materializeEntity } from '../entityMaterializer';

describe('materializeEntity reports rows whose last index resync did not land', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

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
    mocks.syncEntity.mockResolvedValue(true);
    await ResearchEntity.create({
      slug: 'index-sync-fixture',
      name: 'Index Sync Lab',
      kind: 'lab',
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: 'index-sync-fixture',
      field: 'researchAreas',
      value: ['immunology', 'genomics'],
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://example.edu/lab/',
      confidence: 0.9,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });
  });

  it('flags the row once when every resync of it fails, without hiding the write', async () => {
    mocks.syncEntity.mockResolvedValue(false);
    mocks.recomputeBrowseRankForEntities.mockResolvedValueOnce({
      considered: 1,
      updated: 1,
      indexSyncFailures: 1,
      scoresByEntityId: new Map<string, number>(),
    });

    const result = await materializeEntity('researchEntity', { entityKey: 'index-sync-fixture' });

    expect(result.fieldsWritten).toBeGreaterThan(0);
    expect(result.indexSyncFailed).toBe(true);
  });

  it('clears the flag when a later browse-rank resync lands the fresh document', async () => {
    mocks.syncEntity.mockResolvedValueOnce(false);

    const result = await materializeEntity('researchEntity', { entityKey: 'index-sync-fixture' });

    expect(result.fieldsWritten).toBeGreaterThan(0);
    expect(result.indexSyncFailed).toBeUndefined();
  });

  it('keeps the flag when the browse rank is unchanged and so never resyncs', async () => {
    mocks.syncEntity.mockResolvedValueOnce(false);
    mocks.recomputeBrowseRankForEntities.mockResolvedValueOnce({
      considered: 1,
      updated: 0,
      indexSyncFailures: 0,
      scoresByEntityId: new Map<string, number>(),
    });

    const result = await materializeEntity('researchEntity', { entityKey: 'index-sync-fixture' });

    expect(result.indexSyncFailed).toBe(true);
  });

  it('omits the flag when every resync lands', async () => {
    const result = await materializeEntity('researchEntity', { entityKey: 'index-sync-fixture' });

    expect(result.fieldsWritten).toBeGreaterThan(0);
    expect(result.indexSyncFailed).toBeUndefined();
  });
});
