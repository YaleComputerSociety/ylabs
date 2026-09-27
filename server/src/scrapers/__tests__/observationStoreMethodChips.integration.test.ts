import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearC4Flags } from './c4FlagTestEnv';

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
import { planChipList } from '../../scripts/repairSentenceShapedChipsCore';

beforeEach(clearC4Flags);

const SLUG = 'method-chip-fixture';
const SENTENCE_CHIP = 'We use single-cell RNA sequencing to profile immune populations.';
const CLEAN_METHODS = ['Mass spectrometry', 'X-ray crystallography'];

describe('a sentence-shaped method chip is cleaned at ingest, not only at serve time (#3612)', () => {
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
    await ResearchEntity.create({
      slug: SLUG,
      name: 'Synthetic Methods Lab',
      kind: 'lab',
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
  });

  const scrapeMethods = (value: unknown, observedAt: string) =>
    appendObservations(
      [
        {
          entityType: 'researchEntity',
          entityKey: SLUG,
          field: 'methods',
          value,
          sourceUrl: 'https://example.edu/synthetic-methods-lab/',
          observedAt: new Date(observedAt),
        },
      ],
      {
        scrapeRunId: String(new mongoose.Types.ObjectId()),
        sourceId: String(new mongoose.Types.ObjectId()),
        sourceName: 'lab-microsite-methods-llm',
        sourceWeight: 0.82,
        dryRun: false,
      },
    );

  const activeMethodObservations = async () =>
    (
      await Observation.find({ field: 'methods', superseded: false })
        .select('value')
        .lean<Array<{ value: string[] }>>()
    ).map((row) => row.value);

  const storedMethods = async () => {
    await materializeEntity(
      'researchEntity',
      { entityKey: SLUG },
      { synthesizeCardDescription: async () => '' },
    );
    const persisted = await ResearchEntity.findOne({ slug: SLUG }).lean<{ methods?: string[] }>();
    return persisted?.methods;
  };

  it('stores the observation without the sentence chip and with the trailing stop trimmed', async () => {
    const raw = ['Cryo-electron microscopy', SENTENCE_CHIP, 'Patch-clamp electrophysiology.'];
    const result = await scrapeMethods(raw, '2026-05-01T00:00:00.000Z');

    expect(result.inserted).toBe(1);
    const expected = ['Cryo-electron microscopy', 'Patch-clamp electrophysiology'];
    expect(await activeMethodObservations()).toEqual([expected]);
    expect(await storedMethods()).toEqual(expected);
    expect(planChipList('methods', expected).changed).toBe(false);
    expect(planChipList('methods', raw).repaired).toEqual(expected);
  });

  it('refuses an all-sentence read so it cannot displace a clean stored method list', async () => {
    await scrapeMethods(CLEAN_METHODS, '2026-05-01T00:00:00.000Z');
    expect(await storedMethods()).toEqual(CLEAN_METHODS);

    const secondRun = await scrapeMethods([SENTENCE_CHIP], '2026-08-01T00:00:00.000Z');

    expect(secondRun.inserted).toBe(0);
    expect(await activeMethodObservations()).toEqual([CLEAN_METHODS]);
    expect(await storedMethods()).toEqual(CLEAN_METHODS);
  });
});
