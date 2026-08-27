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
import { appendObservations } from '../observationStore';
import { materializeEntity } from '../entityMaterializer';

const ENTITY_KEY = 'lossless-decide-late-fixture';

const DEGRADED_FULL = 'Immunology.';

const USEFUL_FULL =
  'The laboratory investigates how gene regulatory networks control immune cell differentiation, ' +
  'developing single-cell sequencing methods and computational models and validating predictions ' +
  'with targeted CRISPR screens across multiple disease contexts.';

const HIGH_WEIGHT_SOURCE = 'ysm-atoz-index';
const USEFUL_SOURCE = 'lab-microsite-description-llm';

const floodVariants = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => `${USEFUL_FULL} Restatement variant ${i}.`);

async function seedEntity(overrides: Record<string, unknown> = {}) {
  return ResearchEntity.create({
    slug: ENTITY_KEY,
    name: 'Synthetic Immunology Lab',
    kind: 'lab',
    studentVisibilityTier: 'operator_review',
    archived: false,
    ...overrides,
  });
}

function ctxFor(sourceName: string, sourceWeight: number) {
  return {
    scrapeRunId: new mongoose.Types.ObjectId().toString(),
    sourceId: new mongoose.Types.ObjectId().toString(),
    sourceName,
    sourceWeight,
    dryRun: false,
  };
}

async function appendFullDescription(
  sourceName: string,
  sourceWeight: number,
  values: string[],
  startDay: number,
) {
  return appendObservations(
    values.map((value, i) => ({
      entityType: 'researchEntity' as const,
      entityKey: ENTITY_KEY,
      field: 'fullDescription',
      value,
      sourceUrl: `https://example.edu/${sourceName}/${i}`,
      observedAt: new Date(2026, 0, startDay + i),
    })),
    ctxFor(sourceName, sourceWeight),
  );
}

async function activeFullDescriptionCount() {
  return Observation.countDocuments({
    entityType: 'researchEntity',
    entityKey: ENTITY_KEY,
    field: 'fullDescription',
    superseded: false,
  });
}

type PersistedEntity = { fullDescription?: string };

async function persistedFullDescription() {
  const persisted = await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<PersistedEntity>();
  return persisted?.fullDescription;
}

describe('lossless decide-late: full retained log materializes the useful description', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.C4_LOSSLESS_INGEST;
  });

  it('flag OFF (byte-identical to today): same-source flood collapses to one active row at write time', async () => {
    delete process.env.C4_LOSSLESS_INGEST;
    await seedEntity();

    const flood = floodVariants(5);
    const result = await appendFullDescription(USEFUL_SOURCE, 0.75, flood, 1);

    expect(result.inserted).toBe(5);
    expect(result.superseded).toBe(4);
    expect(await activeFullDescriptionCount()).toBe(1);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });
    expect(await persistedFullDescription()).toBe(flood[flood.length - 1]);
  });

  it('flag ON: retains the degraded prose and the whole paraphrase flood, yet materializes the useful description', async () => {
    process.env.C4_LOSSLESS_INGEST = 'true';
    await seedEntity();

    const degraded = await appendFullDescription(HIGH_WEIGHT_SOURCE, 0.95, [DEGRADED_FULL], 20);
    expect(degraded.inserted).toBe(1);
    expect(degraded.skipped).toBe(0);

    const flood = floodVariants(5);
    const useful = await appendFullDescription(USEFUL_SOURCE, 0.75, flood, 1);
    expect(useful.inserted).toBe(5);
    expect(useful.superseded).toBe(0);

    expect(await activeFullDescriptionCount()).toBe(6);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const materialized = await persistedFullDescription();
    expect(materialized).toBe(flood[flood.length - 1]);
    expect(materialized).not.toBe(DEGRADED_FULL);
    expect(await activeFullDescriptionCount()).toBe(6);
  });
});
