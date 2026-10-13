import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { rematerializeSlug } from '../rematerializeResearchEntities';

const SLUG = 'dry-run-parity-fixture';
const SOURCE_URL = 'https://example.edu/parity-lab/';

const rematerialize = (apply: boolean) => rematerializeSlug(SLUG, apply, [], false, false);

describe('research-entity:rematerialize reports the same changes on a dry run and an apply', () => {
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
    for (const name of ['observations', 'research_entities', 'role_assignments', 'researchers']) {
      await db.collection(name).deleteMany({});
    }
    await ResearchEntity.create({
      slug: SLUG,
      name: 'Parity Fixture Lab',
      kind: 'lab',
      studentVisibilityTier: 'operator_review',
      archived: false,
      websiteUrl: SOURCE_URL,
    });
  });

  const seedObservation = async (field: string, value: unknown) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: SOURCE_URL,
      confidence: 0.9,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });
  };

  it('reports a stored field change in both modes and a path the schema cannot store in neither', async () => {
    await seedObservation('name', 'Renamed Parity Lab');
    await seedObservation('inferredPiUserId', '0123456789abcdef01234567');
    await seedObservation('description', 'A legacy description path the schema does not declare.');

    const dryRun = await rematerialize(false);
    const applied = await rematerialize(true);

    expect(dryRun.changes).toEqual(applied.changes);
    expect(dryRun.changes.map((change) => change.field)).toEqual(['name']);
    expect(dryRun.skipped).toBe(applied.skipped);
  });

  it('predicts the unchanged skip an apply reports once only unstorable paths differ', async () => {
    await seedObservation('name', 'Parity Fixture Lab');
    await seedObservation('inferredPiUserId', '0123456789abcdef01234567');
    await rematerialize(true);

    const dryRun = await rematerialize(false);
    const applied = await rematerialize(true);

    expect(applied.skipped).toBe('unchanged');
    expect(dryRun.skipped).toBe('unchanged');
    expect(dryRun.changes).toEqual([]);
    expect(applied.changes).toEqual([]);
  });
});
