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

describe('materializeEntity does not resurrect a merged FRA shell', () => {
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
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedNameObservation = async (entityKey: string, value: string) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey,
      field: 'name',
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'ysm-faculty-directory',
      sourceUrl: 'https://medicine.yale.edu/profile/jane-roe/',
      confidence: 0.9,
      observedAt: new Date('2026-02-01T00:00:00Z'),
      superseded: false,
    });
  };

  it('treats a re-scrape of a canonicalGroupId-tombstoned archived shell as a no-op', async () => {
    const canonicalId = new mongoose.Types.ObjectId();
    await ResearchEntity.create({
      slug: 'faculty-research-area-jane-roe',
      name: 'Jane Roe Research',
      kind: 'individual',
      archived: true,
      canonicalGroupId: canonicalId,
    });
    await seedNameObservation('faculty-research-area-jane-roe', 'Jane Roe Research Renamed');

    const result = await materializeEntity('researchEntity', {
      entityKey: 'faculty-research-area-jane-roe',
    });

    expect(result.skipped).toBe('merged-into-canonical');
    expect(result.created).toBe(false);
    expect(result.fieldsWritten).toBe(0);
    expect(meiliMocks.syncEntity).not.toHaveBeenCalled();

    const doc = await ResearchEntity.findOne({ slug: 'faculty-research-area-jane-roe' }).lean<{
      archived?: boolean;
      canonicalGroupId?: unknown;
      name?: string;
    }>();
    expect(doc?.archived).toBe(true);
    expect(String(doc?.canonicalGroupId)).toBe(canonicalId.toHexString());
    expect(doc?.name).toBe('Jane Roe Research');
  });

  it('still materializes an archived shell that was not merged into a canonical', async () => {
    await ResearchEntity.create({
      slug: 'faculty-research-area-departed-scholar',
      name: 'Departed Scholar Research',
      kind: 'individual',
      archived: true,
    });
    await seedNameObservation(
      'faculty-research-area-departed-scholar',
      'Departed Scholar Research',
    );

    const result = await materializeEntity('researchEntity', {
      entityKey: 'faculty-research-area-departed-scholar',
    });

    expect(result.skipped).not.toBe('merged-into-canonical');
  });
});
