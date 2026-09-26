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

describe('a merged shell tombstone routes re-scraped evidence to the survivor', () => {
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

  const seedObservation = async (entityKey: string, field: string, value: unknown) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'ysm-faculty-directory',
      sourceUrl: 'https://medicine.yale.edu/profile/example-lead/',
      confidence: 0.9,
      observedAt: new Date('2026-02-01T00:00:00Z'),
      superseded: false,
    });
  };

  const seedWebsiteObservation = (entityKey: string, websiteUrl: string) =>
    seedObservation(entityKey, 'websiteUrl', websiteUrl);

  it('materializes into the live survivor instead of dropping the observation', async () => {
    const survivor = await ResearchEntity.create({
      slug: 'example-lead-lab',
      name: 'Example Lead Lab',
      kind: 'lab',
      archived: false,
    });
    await ResearchEntity.create({
      slug: 'faculty-research-area-example-lead',
      name: 'Example Lead Research',
      kind: 'individual',
      archived: true,
      canonicalGroupId: survivor._id,
    });
    await seedWebsiteObservation(
      'faculty-research-area-example-lead',
      'https://examplelead.yale.edu/',
    );

    const result = await materializeEntity('researchEntity', {
      entityKey: 'faculty-research-area-example-lead',
    });

    expect(result.skipped).not.toBe('merged-into-canonical');
    expect(String(result.entityId)).toBe(survivor._id.toHexString());
    expect(result.fieldsWritten).toBeGreaterThan(0);

    const survivorDoc = await ResearchEntity.findById(survivor._id).lean<{
      websiteUrl?: string;
    }>();
    expect(survivorDoc?.websiteUrl).toBe('https://examplelead.yale.edu/');

    const shell = await ResearchEntity.findOne({
      slug: 'faculty-research-area-example-lead',
    }).lean<{ archived?: boolean; websiteUrl?: string; researchAreas?: string[] }>();
    expect(shell?.archived).toBe(true);
    expect(shell?.websiteUrl ?? '').toBe('');
    expect(shell?.researchAreas ?? []).toEqual([]);
  });

  it('follows a multi-hop chain when the survivor was itself later merged', async () => {
    const finalSurvivor = await ResearchEntity.create({
      slug: 'example-lead-consolidated-lab',
      name: 'Example Lead Consolidated Lab',
      kind: 'lab',
      archived: false,
    });
    const intermediate = await ResearchEntity.create({
      slug: 'example-lead-lab',
      name: 'Example Lead Lab',
      kind: 'lab',
      archived: true,
      canonicalGroupId: finalSurvivor._id,
    });
    await ResearchEntity.create({
      slug: 'faculty-research-area-example-lead',
      name: 'Example Lead Research',
      kind: 'individual',
      archived: true,
      canonicalGroupId: intermediate._id,
    });
    await seedWebsiteObservation(
      'faculty-research-area-example-lead',
      'https://examplelead.yale.edu/',
    );

    const result = await materializeEntity('researchEntity', {
      entityKey: 'faculty-research-area-example-lead',
    });

    expect(String(result.entityId)).toBe(finalSurvivor._id.toHexString());
  });

  it('no-ops when the tombstone chain reaches no live canonical', async () => {
    await ResearchEntity.create({
      slug: 'faculty-research-area-example-lead',
      name: 'Example Lead Research',
      kind: 'individual',
      archived: true,
      canonicalGroupId: new mongoose.Types.ObjectId(),
    });
    await seedWebsiteObservation(
      'faculty-research-area-example-lead',
      'https://examplelead.yale.edu/',
    );

    const result = await materializeEntity('researchEntity', {
      entityKey: 'faculty-research-area-example-lead',
    });

    expect(result.skipped).toBe('merged-into-canonical');
    expect(result.fieldsWritten).toBe(0);
    expect(meiliMocks.syncEntity).not.toHaveBeenCalled();

    const shell = await ResearchEntity.findOne({
      slug: 'faculty-research-area-example-lead',
    }).lean<{ archived?: boolean; websiteUrl?: string }>();
    expect(shell?.archived).toBe(true);
    expect(shell?.websiteUrl ?? '').toBe('');
  });

  it('no-ops on a tombstone cycle rather than looping', async () => {
    const first = new mongoose.Types.ObjectId();
    const second = new mongoose.Types.ObjectId();
    await ResearchEntity.create({
      _id: second,
      slug: 'example-lead-lab',
      name: 'Example Lead Lab',
      kind: 'lab',
      archived: true,
      canonicalGroupId: first,
    });
    await ResearchEntity.create({
      _id: first,
      slug: 'faculty-research-area-example-lead',
      name: 'Example Lead Research',
      kind: 'individual',
      archived: true,
      canonicalGroupId: second,
    });
    await seedWebsiteObservation(
      'faculty-research-area-example-lead',
      'https://examplelead.yale.edu/',
    );

    const result = await materializeEntity('researchEntity', {
      entityKey: 'faculty-research-area-example-lead',
    });

    expect(result.skipped).toBe('merged-into-canonical');
    expect(result.fieldsWritten).toBe(0);
  });
});
