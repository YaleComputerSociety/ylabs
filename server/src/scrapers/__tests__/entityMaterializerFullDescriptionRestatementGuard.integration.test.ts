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

const MU_LAB_SHORT =
  'Studies the mechanisms of resistance to anti-cancer therapy and novel therapeutic approaches to overcome resistance.';

const MU_LAB_RESTATEMENT_FULL =
  'The Mu Lab studies the mechanisms of resistance to anti-cancer therapy and novel therapeutic approaches to overcome resistance.';

const MU_LAB_RICHER_FULL =
  'The Mu Lab combines patient-derived organoids and single-cell sequencing to map how tumors evolve resistance to targeted anti-cancer therapies, and tests combination regimens designed to delay or reverse that resistance in preclinical models.';

type PersistedEntity = { fullDescription?: string; shortDescription?: string };

describe('materializeEntity rejects a fullDescription that restates shortDescription (#1721)', () => {
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
      slug: 'restatement-fixture',
      name: 'Mu Lab',
      kind: 'lab',
      studentVisibilityTier: 'operator_review',
      archived: false,
      shortDescription: MU_LAB_SHORT,
      ...overrides,
    });

  const seedFull = async (
    value: string,
    sourceName: string,
    confidence: number,
    observedAt: string,
  ) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: 'restatement-fixture',
      field: 'fullDescription',
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: `https://example.edu/${sourceName}/`,
      confidence,
      observedAt: new Date(observedAt),
      superseded: false,
    });
  };

  it('falls through past a restatement winner to a genuinely richer observation', async () => {
    await seedEntity();
    await seedFull(MU_LAB_RESTATEMENT_FULL, 'ysm-atoz-index', 0.95, '2026-02-01T00:00:00Z');
    await seedFull(MU_LAB_RICHER_FULL, 'lab-microsite-description-llm', 0.7, '2026-01-01T00:00:00Z');

    await materializeEntity('researchEntity', { entityKey: 'restatement-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'restatement-fixture',
    }).lean<PersistedEntity>();
    expect(persisted?.fullDescription).toBe(MU_LAB_RICHER_FULL);
    expect(persisted?.shortDescription).toBe(MU_LAB_SHORT);
  });

  it('blanks fullDescription when the only candidate restates the short and no richer alternative exists', async () => {
    await seedEntity();
    await seedFull(MU_LAB_RESTATEMENT_FULL, 'ysm-atoz-index', 0.95, '2026-02-01T00:00:00Z');

    await materializeEntity('researchEntity', { entityKey: 'restatement-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'restatement-fixture',
    }).lean<PersistedEntity>();
    expect(persisted?.fullDescription).toBe('');
    expect(persisted?.shortDescription).toBe(MU_LAB_SHORT);
  });

  it('does not blank a genuinely distinct fullDescription', async () => {
    await seedEntity();
    await seedFull(MU_LAB_RICHER_FULL, 'lab-microsite-description-llm', 0.95, '2026-02-01T00:00:00Z');

    await materializeEntity('researchEntity', { entityKey: 'restatement-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'restatement-fixture',
    }).lean<PersistedEntity>();
    expect(persisted?.fullDescription).toBe(MU_LAB_RICHER_FULL);
  });
});
