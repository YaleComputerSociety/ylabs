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

const SLUG = 'synthetic-fixture-imaging-lab';
const NAME = 'Synthetic Fixture Imaging Lab';
const NAME_LANE = 'ysm-atoz-index';
const DESCRIPTION_LANE = 'lab-microsite-description-llm';
const PAGE = 'https://medicine.example.edu/profile/synthetic-fixture-imaging/';
const CHROME_BODY =
  'Medical Research Interests Fixture Imaging; Fixture Synapses; Fixture Signaling ORCID 0000-0000-0000-0000';
const CHROME_CARD = 'Medical Research Interests Fixture Imaging; Fixture Synapses.';

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

const resolve = () => materializeEntity('researchEntity', { entityId: rowId }, {});

const stored = async () =>
  ResearchEntity.collection.findOne({ _id: new mongoose.Types.ObjectId(rowId) }) as Promise<
    Record<string, any>
  >;

describe('a stored description whose only evidence is profile template chrome (#4942)', () => {
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
    await lanes(DESCRIPTION_LANE, [
      { field: 'fullDescription', value: CHROME_BODY },
      { field: 'shortDescription', value: CHROME_CARD },
    ]);
    const credit = { sourceName: DESCRIPTION_LANE, sourceUrl: PAGE };
    await ResearchEntity.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(rowId) },
      {
        $set: {
          fullDescription: CHROME_BODY,
          shortDescription: CHROME_CARD,
          'fieldProvenance.fullDescription': credit,
          'fieldProvenance.shortDescription': credit,
        },
      },
    );
  });

  it('clears the body and its card, and they stay cleared on the next resolve', async () => {
    await resolve();
    const after = await stored();
    expect(after.fullDescription || '').toBe('');
    expect(after.shortDescription || '').toBe('');
    expect(after.name).toBe(NAME);
    expect(after.manuallyLockedFields ?? []).toEqual([]);

    await resolve();
    const again = await stored();
    expect(again.fullDescription || '').toBe('');
    expect(again.shortDescription || '').toBe('');
  });

  it('keeps a locked chrome description for an operator to release', async () => {
    await ResearchEntity.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(rowId) },
      { $set: { manuallyLockedFields: ['fullDescription', 'shortDescription'] } },
    );

    await resolve();
    const after = await stored();
    expect(after.fullDescription).toBe(CHROME_BODY);
    expect(after.shortDescription).toBe(CHROME_CARD);
  });
});
