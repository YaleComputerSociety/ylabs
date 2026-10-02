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

const ENTITY_KEY = 'synthetic-grant-periods-lab';

const award = (index: number, ended: boolean) => ({
  id: `R01GM9000${String(index).padStart(2, '0')}`,
  agency: 'NIGMS',
  startDate: new Date(Date.UTC(2024, 0, 30 - index)),
  endDate: ended ? new Date('2020-01-31T00:00:00Z') : new Date('2999-01-31T00:00:00Z'),
});

describe('dated award periods reach the stored row and the served count (#4245)', () => {
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
      name: 'Synthetic Grant Periods Lab',
      kind: 'lab',
      archived: false,
    });
  });

  const seed = async (sourceName: string, field: string, value: unknown) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: 'https://reporter.nih.gov/',
      confidence: 0.9,
      observedAt: new Date('2026-02-01T00:00:00Z'),
      superseded: false,
    });
  };

  it('stores every dated award and serves the running ones as the count', async () => {
    const awards = Array.from({ length: 12 }, (_value, index) => award(index, index === 0));
    await seed('nih-reporter', 'recentGrants', awards.slice(0, 10));
    await seed('nih-reporter', 'recentGrantPeriods', awards);
    await seed('nih-reporter', 'recentGrantCount', 12);
    await seed('nih-reporter', 'fundingAgencies', ['NIH']);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const stored = await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<
      Record<string, unknown>
    >();
    expect(stored?.recentGrantPeriods).toHaveLength(12);
    expect(stored?.recentGrantCount).toBe(12);
    const dto = toPublicResearchEntityDto(stored as Record<string, unknown>);
    expect(dto.recentGrants as unknown[]).toHaveLength(9);
    expect(dto.recentGrantCount).toBe(11);
  });

  it('keeps the summed count and no periods while another lane has not dated its awards', async () => {
    const awards = Array.from({ length: 3 }, (_value, index) => award(index, false));
    await seed('nih-reporter', 'recentGrants', awards);
    await seed('nih-reporter', 'recentGrantPeriods', awards);
    await seed('nih-reporter', 'recentGrantCount', 3);
    await seed('nsf-awards', 'recentGrantCount', 4);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const stored = await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<
      Record<string, unknown>
    >();
    expect(stored?.recentGrantPeriods).toEqual([]);
    expect(stored?.recentGrantCount).toBe(7);
  });
});
