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

const ENTITY_KEY = 'synthetic-derived-kind-home';

type PersistedEntity = { kind?: string; entityType?: string };

describe('materializeEntity keeps the persisted kind derived from entityType (#2144)', () => {
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

  const seedEntity = async (overrides: Record<string, unknown>) =>
    ResearchEntity.create({
      slug: ENTITY_KEY,
      name: 'Synthetic Derived Kind Home',
      studentVisibilityTier: 'operator_review',
      archived: false,
      ...overrides,
    });

  const seedObservation = async (params: {
    field: string;
    value: unknown;
    sourceName: string;
    confidence?: number;
  }) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      field: params.field,
      value: params.value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: params.sourceName,
      sourceUrl: 'https://example.edu/synthetic-home/',
      confidence: params.confidence ?? 0.9,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });
  };

  const persisted = () => ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<PersistedEntity>();

  it('repairs a stored kind that drifted away from the stored entityType', async () => {
    await seedEntity({ kind: 'lab', entityType: 'CENTER' });
    await seedObservation({
      field: 'name',
      value: 'Synthetic Derived Kind Home',
      sourceName: 'centers-institutes-index',
    });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const doc = await persisted();
    expect(doc?.entityType).toBe('CENTER');
    expect(doc?.kind).toBe('center');
  });

  it('moves kind with entityType in the same pass when a source reclassifies the home', async () => {
    await seedEntity({ kind: 'lab', entityType: 'LAB' });
    await seedObservation({
      field: 'name',
      value: 'Synthetic Derived Kind Home',
      sourceName: 'centers-institutes-index',
    });
    await seedObservation({
      field: 'entityType',
      value: 'CORE_FACILITY',
      sourceName: 'centers-institutes-index',
    });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const doc = await persisted();
    expect(doc?.entityType).toBe('CORE_FACILITY');
    expect(doc?.kind).toBe('core_facility');
  });

  it('does not let a grant-shell kind observation contradict the stored entityType', async () => {
    await seedEntity({ kind: 'center', entityType: 'CENTER' });
    await seedObservation({
      field: 'name',
      value: 'Synthetic Derived Kind Home',
      sourceName: 'centers-institutes-index',
    });
    await seedObservation({
      field: 'kind',
      value: 'lab',
      sourceName: 'federal-award-usaspending',
      confidence: 0.95,
    });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const doc = await persisted();
    expect(doc?.entityType).toBe('CENTER');
    expect(doc?.kind).toBe('center');
  });

  it('preserves an operator-locked kind through a real materialization pass', async () => {
    await seedEntity({ kind: 'program', entityType: 'INITIATIVE', manuallyLockedFields: ['kind'] });
    await seedObservation({
      field: 'name',
      value: 'Synthetic Derived Kind Home',
      sourceName: 'centers-institutes-index',
    });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const doc = await persisted();
    expect(doc?.entityType).toBe('INITIATIVE');
    expect(doc?.kind).toBe('program');
  });
});
