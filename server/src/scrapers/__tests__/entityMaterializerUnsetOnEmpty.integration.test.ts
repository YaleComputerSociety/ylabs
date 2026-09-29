import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { materializeEntity } from '../entityMaterializer';

type PersistedEntity = {
  methods?: string[];
  inferredPiUserId?: string;
  shortDescription?: string;
  researchAreas?: string[];
};

const STALE_PI = '0123456789abcdef01234567';

describe('materializeEntity clears stale observation-backed fields on rematerialize', () => {
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
  });

  const seedEntity = async (overrides: Record<string, unknown> = {}) =>
    ResearchEntity.create({
      slug: 'unset-fixture',
      name: 'Unset Lab',
      kind: 'lab',
      studentVisibilityTier: 'operator_review',
      archived: false,
      ...overrides,
    });

  const seedObservation = async (field: string, value: unknown, superseded = false) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: 'unset-fixture',
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://example.edu/lab/',
      confidence: 0.9,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded,
    });
  };

  const persisted = () => ResearchEntity.findOne({ slug: 'unset-fixture' }).lean<PersistedEntity>();

  it('unsets methods that no longer has a live observation', async () => {
    await seedEntity({ methods: ['Cryo-EM'] });
    await seedObservation('name', 'Unset Lab');
    await seedObservation('methods', ['Cryo-EM'], true);

    await materializeEntity('researchEntity', { entityKey: 'unset-fixture' });

    const doc = await persisted();
    expect(doc?.methods).toBeUndefined();
  });

  /**
   * `inferredPiUserId` is in `CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS` and the
   * projection duly plans `$unset` for it, but the schema declares no path and the
   * schemas are `strict`, so mongoose drops it from the update in both directions.
   * The engine cannot set the field and cannot clear it either.
   *
   * This was asserted the other way and passed for the wrong reason: the fixture
   * seeded the value through `ResearchEntity.create`, which strips it as well, so
   * the row never held a value and `toBeUndefined` held whatever the engine did.
   * The seed here goes through the raw driver so the row really does hold one, and
   * the assertion states what actually happens (#3883).
   */
  it('cannot clear inferredPiUserId, because no schema path declares it', async () => {
    await seedEntity({ methods: ['Cryo-EM'] });
    const collection = mongoose.connection.db?.collection('research_entities');
    if (!collection) throw new Error('no db');
    await collection.updateOne({ slug: 'unset-fixture' }, { $set: { inferredPiUserId: STALE_PI } });
    await seedObservation('name', 'Unset Lab');
    await seedObservation('methods', ['Cryo-EM'], true);

    const planned = await materializeEntity(
      'researchEntity',
      { entityKey: 'unset-fixture' },
      { dryRun: true },
    );
    expect(planned.plannedUnset?.inferredPiUserId).toBe('');

    await materializeEntity('researchEntity', { entityKey: 'unset-fixture' });

    const doc = await persisted();
    expect(doc?.inferredPiUserId).toBe(STALE_PI);
    // The same pass clears a declared field, so the survival above is the undeclared
    // path and not a pass that failed to run.
    expect(doc?.methods).toBeUndefined();
  });

  it('keeps methods that still have a live observation', async () => {
    await seedEntity({ methods: ['Cryo-EM'] });
    await seedObservation('name', 'Unset Lab');
    await seedObservation('methods', ['Single-cell sequencing']);

    await materializeEntity('researchEntity', { entityKey: 'unset-fixture' });

    const doc = await persisted();
    expect(doc?.methods).toEqual(['Single-cell sequencing']);
  });

  it('does not clear a manually locked field with no observation', async () => {
    await seedEntity({ methods: ['Cryo-EM'], manuallyLockedFields: ['methods'] });
    await seedObservation('name', 'Unset Lab');

    await materializeEntity('researchEntity', { entityKey: 'unset-fixture' });

    const doc = await persisted();
    expect(doc?.methods).toEqual(['Cryo-EM']);
  });

  it('leaves derived description and research-area fields untouched', async () => {
    await seedEntity({
      shortDescription: 'Keep this short description.',
      researchAreas: ['Keep This Area'],
    });
    await seedObservation('name', 'Unset Lab');

    await materializeEntity('researchEntity', { entityKey: 'unset-fixture' });

    const doc = await persisted();
    expect(doc?.shortDescription).toBe('Keep this short description.');
    expect(doc?.researchAreas).toEqual(['Keep This Area']);
  });
});
