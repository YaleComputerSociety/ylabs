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

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { toPublicResearchEntityDto } from '../../services/researchEntityDto';
import { materializeEntity } from '../entityMaterializer';

const ENTITY_KEY = 'synthetic-honors-row';

describe('profile honors reach the stored row and the detail DTO (#4771)', () => {
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
    await Observation.deleteMany({});
    await ResearchEntity.deleteMany({});
    await ResearchEntity.create({
      slug: ENTITY_KEY,
      name: 'Synthetic Honors Research',
      kind: 'lab',
      archived: false,
    });
  });

  const seed = async (value: unknown, observedAt: string) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      field: 'leadHonors',
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'official-profile-honors',
      sourceUrl: 'https://example.yale.edu/profile/synthetic',
      confidence: 0.8,
      observedAt: new Date(observedAt),
      superseded: false,
    });
  };

  const honor = {
    key: 'guggenheim',
    label: 'Guggenheim Fellowship',
    kind: 'fellowship',
    year: 2024,
  };

  it('stores the honors and serves them on the detail DTO but not the list DTO', async () => {
    await seed([honor], '2026-02-01T00:00:00Z');
    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, { dryRun: false });

    const row: any = await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean();
    expect(row.leadHonors).toEqual([honor]);
    expect((toPublicResearchEntityDto(row) as any).leadHonors).toEqual([honor]);
    expect((toPublicResearchEntityDto(row, { forList: true }) as any).leadHonors).toBeUndefined();
  });

  it('clears honors when the newest read states none', async () => {
    await seed([honor], '2026-02-01T00:00:00Z');
    await seed([], '2026-03-01T00:00:00Z');
    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, { dryRun: false });

    const row: any = await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean();
    expect(row.leadHonors ?? []).toEqual([]);
  });
});
