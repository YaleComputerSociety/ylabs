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
    syncEntities: vi.fn().mockResolvedValue(undefined),
    deleteFromIndex: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { ResearchEntity } from '../../models/researchEntity';
import { materializeEntity } from '../entityMaterializer';
import { appendObservations } from '../observationStore';
import type { ObservationInput } from '../types';

const SLUG = 'synthetic-fixture-learning-lab';
const NAME = 'Synthetic Fixture Learning Lab';
const NAME_LANE = 'ysm-atoz-index';
const DESCRIPTION_LANE = 'lab-microsite-description-llm';
const PAGE = 'https://fixture-learning.example.edu/';
const BODY =
  'Our research interests include theoretical fixture learning, fixture statistics, fixture optimization and fixture game theory, and how fixture learning algorithms behave in strategic fixture markets.';
const OVERREACHING_CARD =
  'Investigates how fixture learning algorithms behave in strategic fixture markets using fixture statistics and fixture optimization.';
const STRIPPED_CARD =
  'Investigates how fixture learning algorithms behave in strategic fixture markets.';

let rowId = '';

async function lanes(sourceName: string, observations: Omit<ObservationInput, 'entityType'>[]) {
  await appendObservations(
    observations.map((observation) => ({
      entityType: 'researchEntity' as const,
      entityId: rowId,
      entityKey: SLUG,
      sourceUrl: PAGE,
      observedAt: new Date('2026-09-01T00:00:00Z'),
      ...observation,
    })),
    {
      scrapeRunId: new mongoose.Types.ObjectId().toString(),
      sourceId: new mongoose.Types.ObjectId().toString(),
      sourceName,
      sourceWeight: 0.8,
      dryRun: false,
    },
  );
}

const resolve = () =>
  materializeEntity(
    'researchEntity',
    { entityId: rowId },
    { synthesizeCardDescription: async () => '' },
  );

const stored = async () =>
  ResearchEntity.collection.findOne({ _id: new mongoose.Types.ObjectId(rowId) }) as Promise<
    Record<string, any>
  >;

describe('a copied card is held to the method-clause rule (#4914 follow-up)', () => {
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
    for (const name of ['observations', 'research_entities', 'role_assignments', 'signals']) {
      await db.collection(name).deleteMany({});
    }
    const row = await ResearchEntity.create({ slug: SLUG, name: NAME, entityType: 'LAB' });
    rowId = String(row._id);
    await lanes(NAME_LANE, [{ field: 'name', value: NAME }]);
  });

  it("strips a lane card's method clause the page does not state, on every resolve", async () => {
    await lanes(DESCRIPTION_LANE, [
      { field: 'fullDescription', value: BODY },
      { field: 'shortDescription', value: OVERREACHING_CARD },
    ]);

    await resolve();
    expect((await stored()).shortDescription).toBe(STRIPPED_CARD);

    await resolve();
    expect((await stored()).shortDescription).toBe(STRIPPED_CARD);
  });

  it('strips a card stored before the rule when no observation backs it', async () => {
    await lanes(DESCRIPTION_LANE, [{ field: 'fullDescription', value: BODY }]);
    await resolve();
    await ResearchEntity.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(rowId) },
      { $set: { shortDescription: OVERREACHING_CARD } },
    );

    await resolve();
    expect((await stored()).shortDescription).toBe(STRIPPED_CARD);
  });

  it('keeps a method clause the page states', async () => {
    const card =
      'Investigates how fixture learning algorithms behave in strategic fixture markets using convex fixture optimization.';
    await lanes(DESCRIPTION_LANE, [
      {
        field: 'fullDescription',
        value: `${BODY} The group proves guarantees using convex fixture optimization.`,
      },
      { field: 'shortDescription', value: card },
    ]);

    await resolve();
    expect((await stored()).shortDescription).toBe(card);
  });

  it('leaves a locked card for an operator', async () => {
    await lanes(DESCRIPTION_LANE, [{ field: 'fullDescription', value: BODY }]);
    await ResearchEntity.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(rowId) },
      { $set: { shortDescription: OVERREACHING_CARD, manuallyLockedFields: ['shortDescription'] } },
    );

    await resolve();
    expect((await stored()).shortDescription).toBe(OVERREACHING_CARD);
  });
});
