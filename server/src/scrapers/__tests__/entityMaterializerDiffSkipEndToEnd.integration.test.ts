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
import { syncEntity } from '../../services/meiliSyncService';

const syncEntityMock = vi.mocked(syncEntity);

type PersistedEntity = {
  name?: string;
  researchAreas?: string[];
  websiteUrl?: string;
  lastObservedAt?: Date;
};

describe('materializeEntity skips write and re-sync on an unchanged re-projection', () => {
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

  const seedEntity = async (overrides: Record<string, unknown> = {}) =>
    ResearchEntity.create({
      slug: 'diff-skip-fixture',
      name: 'Diff Skip Lab',
      kind: 'lab',
      studentVisibilityTier: 'operator_review',
      archived: false,
      ...overrides,
    });

  const seedObservation = async (field: string, value: unknown, superseded = false) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: 'diff-skip-fixture',
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

  const persisted = () =>
    ResearchEntity.findOne({ slug: 'diff-skip-fixture' }).lean<PersistedEntity>();

  const materializeUntilSteadyState = async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const result = await materializeEntity('researchEntity', { entityKey: 'diff-skip-fixture' });
      if (result.skipped === 'unchanged') return attempt;
    }
    throw new Error('projection never converged to a no-op over an unchanged observation log');
  };

  it('re-materializing an unchanged observation log converges to a true no-op (no write, no re-sync)', async () => {
    await seedEntity();
    await seedObservation('name', 'Diff Skip Lab');
    await seedObservation('researchAreas', ['immunology', 'genomics']);

    const convergedAt = await materializeUntilSteadyState();
    expect(convergedAt).toBeLessThan(6);

    const atSteadyState = await persisted();
    const frozenLastObservedAt = atSteadyState?.lastObservedAt;
    expect(frozenLastObservedAt).toBeInstanceOf(Date);

    syncEntityMock.mockClear();
    await new Promise((resolve) => setTimeout(resolve, 5));

    const noop = await materializeEntity('researchEntity', { entityKey: 'diff-skip-fixture' });

    expect(noop.skipped).toBe('unchanged');
    expect(noop.fieldsWritten).toBe(0);
    expect(syncEntityMock).not.toHaveBeenCalled();

    const afterNoop = await persisted();
    expect(afterNoop?.lastObservedAt?.getTime()).toBe(frozenLastObservedAt?.getTime());
    expect(afterNoop?.name).toBe('Diff Skip Lab');
    expect(afterNoop?.researchAreas).toEqual(['immunology', 'genomics']);
  });

  it('a real observation change breaks the no-op and still writes and re-syncs', async () => {
    await seedEntity();
    await seedObservation('name', 'Diff Skip Lab');
    await seedObservation('researchAreas', ['immunology', 'genomics']);

    await materializeUntilSteadyState();
    const atSteadyState = await persisted();
    const frozenLastObservedAt = atSteadyState?.lastObservedAt;

    await Observation.updateMany(
      { entityKey: 'diff-skip-fixture', field: 'researchAreas' },
      { $set: { superseded: true } },
    );
    await seedObservation('researchAreas', ['immunology', 'genomics', 'neuroscience']);

    syncEntityMock.mockClear();
    await new Promise((resolve) => setTimeout(resolve, 5));

    const changed = await materializeEntity('researchEntity', { entityKey: 'diff-skip-fixture' });

    expect(changed.skipped).not.toBe('unchanged');
    expect(syncEntityMock).toHaveBeenCalledTimes(1);

    const afterChange = await persisted();
    expect(afterChange?.researchAreas).toEqual(['immunology', 'genomics', 'neuroscience']);
    expect(afterChange?.lastObservedAt?.getTime()).toBeGreaterThan(
      frozenLastObservedAt?.getTime() ?? 0,
    );
  });

  it('does not drop an unbacked derived field on a no-op re-projection', async () => {
    await seedEntity({ websiteUrl: 'https://lab.example.edu' });
    await seedObservation('name', 'Diff Skip Lab');

    await materializeUntilSteadyState();

    syncEntityMock.mockClear();
    const noop = await materializeEntity('researchEntity', { entityKey: 'diff-skip-fixture' });

    expect(noop.skipped).toBe('unchanged');
    expect(syncEntityMock).not.toHaveBeenCalled();

    const afterNoop = await persisted();
    expect(afterNoop?.websiteUrl).toBe('https://lab.example.edu');
  });
});
