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

type PersistedEntity = { methods?: string[]; name?: string };

describe('materializeEntity persists methods through the schema, not just into the update $set (#1175)', () => {
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

  const seedEntity = async (overrides: Record<string, unknown> = {}) => {
    return ResearchEntity.create({
      slug: 'methods-fixture-lab',
      name: 'Methods Fixture Lab',
      kind: 'lab',
      studentVisibilityTier: 'student_ready',
      archived: false,
      ...overrides,
    });
  };

  const seedObservation = async (field: string, value: unknown) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: 'methods-fixture-lab',
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://medicine.yale.edu/lab/methods-fixture/',
      confidence: 0.8,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });
  };

  it('writes a resolved methods observation onto the persisted document', async () => {
    await seedEntity();
    await seedObservation('methods', ['CRISPR', 'single-cell RNA-seq']);

    const result = await materializeEntity(
      'researchEntity',
      { entityKey: 'methods-fixture-lab' },
      {},
    );

    expect(result.skipped).toBeUndefined();

    const persisted = await ResearchEntity.findOne({
      slug: 'methods-fixture-lab',
    }).lean<PersistedEntity>();

    expect(persisted?.methods).toEqual(['CRISPR', 'single-cell RNA-seq']);
  });

  it('updates methods on an entity that already has a persisted value', async () => {
    await seedEntity({ methods: ['legacy technique'] });
    await seedObservation('methods', ['optogenetics']);

    await materializeEntity('researchEntity', { entityKey: 'methods-fixture-lab' }, {});

    const persisted = await ResearchEntity.findOne({
      slug: 'methods-fixture-lab',
    }).lean<PersistedEntity>();

    expect(persisted?.methods).toEqual(['optogenetics']);
  });
});
