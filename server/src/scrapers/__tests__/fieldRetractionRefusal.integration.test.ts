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
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { ScrapeRun } from '../../models/scrapeRun';
import {
  FIELD_RETRACTION_REFUSAL_ROLLBACK_REASON,
  reconcileFieldRetractions,
  type SourceFieldRetractionContract,
} from '../fieldRetraction';
import { appendObservations } from '../observationStore';
import type { ObservationInput } from '../types';

const SOURCE_NAME = 'synthetic-refusing-roster';
const SOURCE_ID = new mongoose.Types.ObjectId();
const ENTITY_KEY = 'synthetic-refusal-entity';
const LISTING_PAGE = 'https://example.yale.edu/people/faculty';
const STORED_LINK = 'https://synthetic-lab.example.org/';
const CLASSIFIER = 'roster-website-signal';

const CONTRACT: SourceFieldRetractionContract = {
  witnessFields: ['slug', 'sourceUrls'],
  retractableFields: ['websiteUrl'],
  refusalClassifiers: [{ field: 'websiteUrl', classifier: CLASSIFIER }],
  notes: 'test',
};

const deadProbe = async () => ({ positivelyDead: true });

async function appendRun(observations: ObservationInput[], observedAt: Date) {
  const run = await ScrapeRun.create({
    sourceId: SOURCE_ID,
    sourceName: SOURCE_NAME,
    status: 'success',
    startedAt: observedAt,
  });
  await appendObservations(
    observations.map((observation) => ({ ...observation, observedAt })),
    {
      scrapeRunId: String(run._id),
      sourceId: String(SOURCE_ID),
      sourceName: SOURCE_NAME,
      sourceWeight: 0.8,
      dryRun: false,
    },
  );
}

const witness = (refusedValues?: ObservationInput['refusedValues']): ObservationInput[] => [
  {
    entityType: 'researchEntity',
    entityKey: ENTITY_KEY,
    field: 'slug',
    value: ENTITY_KEY,
    sourceUrl: LISTING_PAGE,
    ...(refusedValues ? { refusedValues } : {}),
  },
  {
    entityType: 'researchEntity',
    entityKey: ENTITY_KEY,
    field: 'sourceUrls',
    value: [LISTING_PAGE],
    sourceUrl: LISTING_PAGE,
  },
];

const refusedStoredLink = [
  {
    field: 'websiteUrl',
    value: STORED_LINK,
    reason: 'link_text_not_a_research_site',
    classifier: CLASSIFIER,
    classifierVersion: 2,
  },
];

describe('a newer-version refusal retires the stale assertion end to end (#5803)', () => {
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
    for (const name of ['observations', 'research_entities']) {
      await db.collection(name).deleteMany({});
    }
    await ScrapeRun.deleteMany({});
    await ResearchEntity.collection.insertOne({
      slug: ENTITY_KEY,
      name: 'Synthetic Research',
      websiteUrl: STORED_LINK,
    });
    await appendRun(
      [
        ...witness(),
        {
          entityType: 'researchEntity',
          entityKey: ENTITY_KEY,
          field: 'websiteUrl',
          value: STORED_LINK,
          sourceUrl: LISTING_PAGE,
          admittedUnder: [{ classifier: CLASSIFIER, version: 1 }],
        },
      ],
      new Date('2026-11-01T00:00:00Z'),
    );
  });

  it('stores the refusal on the witness row, retracts once, and writes nothing on the second pass', async () => {
    await appendRun(witness(refusedStoredLink), new Date('2026-11-10T00:00:00Z'));
    await appendRun(witness(refusedStoredLink), new Date('2026-11-12T00:00:00Z'));

    const storedWitness = await Observation.findOne({
      field: 'slug',
      refusedValues: { $exists: true },
    }).lean();
    expect(storedWitness?.refusedValues).toEqual(refusedStoredLink);
    const storedAssertion = await Observation.findOne({ field: 'websiteUrl' }).lean();
    expect(storedAssertion?.admittedUnder).toEqual([{ classifier: CLASSIFIER, version: 1 }]);

    const first = await reconcileFieldRetractions({
      sourceName: SOURCE_NAME,
      contract: CONTRACT,
      probeValue: deadProbe,
    });
    expect(first.counts.retractedObservations).toBe(1);
    expect(first.counts.refusalSupportedObservations).toBe(1);
    expect(first.counts.storedValuesCleared).toBe(1);
    const retired = await Observation.findOne({ field: 'websiteUrl' }).lean();
    expect(retired?.superseded).toBe(true);
    expect(retired?.rollback?.reason).toBe(FIELD_RETRACTION_REFUSAL_ROLLBACK_REASON);
    expect((await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean())?.websiteUrl).toBeUndefined();

    const snapshot = JSON.stringify(await Observation.find({}).sort({ _id: 1 }).lean());
    const second = await reconcileFieldRetractions({
      sourceName: SOURCE_NAME,
      contract: CONTRACT,
      probeValue: deadProbe,
    });
    expect(second.counts.retractedObservations).toBe(0);
    expect(second.counts.storedValuesCleared).toBe(0);
    expect(JSON.stringify(await Observation.find({}).sort({ _id: 1 }).lean())).toBe(snapshot);
  });

  it('a later read that admits the value again keeps it live', async () => {
    await appendRun(witness(refusedStoredLink), new Date('2026-11-10T00:00:00Z'));
    await appendRun(witness(refusedStoredLink), new Date('2026-11-12T00:00:00Z'));
    await appendRun(
      [
        ...witness(),
        {
          entityType: 'researchEntity',
          entityKey: ENTITY_KEY,
          field: 'websiteUrl',
          value: STORED_LINK,
          sourceUrl: LISTING_PAGE,
          admittedUnder: [{ classifier: CLASSIFIER, version: 2 }],
        },
      ],
      new Date('2026-11-14T00:00:00Z'),
    );

    const result = await reconcileFieldRetractions({
      sourceName: SOURCE_NAME,
      contract: CONTRACT,
      probeValue: deadProbe,
    });
    expect(result.counts.retractedObservations).toBe(0);
    expect(
      await Observation.countDocuments({ field: 'websiteUrl', superseded: { $ne: true } }),
    ).toBeGreaterThan(0);
    expect((await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean())?.websiteUrl).toBe(
      STORED_LINK,
    );
  });

  it('a declared contract on no production source keeps the real lanes inert', async () => {
    await appendRun(witness(refusedStoredLink), new Date('2026-11-10T00:00:00Z'));
    await appendRun(witness(refusedStoredLink), new Date('2026-11-12T00:00:00Z'));
    const result = await reconcileFieldRetractions({
      sourceName: SOURCE_NAME,
      probeValue: deadProbe,
    });
    expect(result.outcome).toBe('source-not-retraction-capable');
  });
});
