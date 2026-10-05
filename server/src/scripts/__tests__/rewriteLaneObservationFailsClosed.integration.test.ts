import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runResearchDescriptionBackfill } from '../backfillResearchDescriptions';

const REWRITE_SOURCE_NAME = 'lab-microsite-description-llm';

const RESEARCH_BODY =
  'The laboratory studies how microglia clear protein aggregates in the ageing brain, combining two-photon imaging in mouse models with single-nucleus sequencing of post-mortem cortex to identify the clearance pathways that fail earliest in tauopathy.';

const INCUMBENT_CARD = 'Microglia research.';

const REWRITTEN = {
  fullDescription:
    'The laboratory studies how microglia clear protein aggregates in the ageing brain. It combines two-photon imaging in mouse models with single-nucleus sequencing of post-mortem cortex to identify the clearance pathways that fail earliest in tauopathy.',
  shortDescription:
    'Studies how microglia clear protein aggregates in the ageing brain and which clearance pathways fail earliest in tauopathy.',
};

const UNCITABLE_URL = 'https://probe-preview.ngrok-free.app/lab/microglia/';
const CITABLE_URL = 'https://medicine.example.edu/lab/microglia/';

const SLUG = 'fixture-rewrite-observation-fail-closed';

const insertRow = async (websiteUrl: string) => {
  await mongoose.connection.db!.collection('research_entities').insertOne({
    _id: new mongoose.Types.ObjectId(),
    slug: SLUG,
    name: 'Example Microglia Lab',
    kind: 'group',
    entityType: 'LAB',
    schemaVersion: 1,
    archived: false,
    studentVisibilityTier: 'operator_review',
    studentVisibilityReasons: ['thin_description'],
    shortDescription: INCUMBENT_CARD,
    fullDescription: RESEARCH_BODY,
    websiteUrl,
    sourceUrls: [websiteUrl],
  });
};

const storedRow = async () =>
  (await mongoose.connection
    .db!.collection('research_entities')
    .findOne({ slug: SLUG }, { projection: { shortDescription: 1, fullDescription: 1 } })) as {
    shortDescription?: string;
    fullDescription?: string;
  } | null;

const storedObservationCount = async (): Promise<number> =>
  mongoose.connection
    .db!.collection('observations')
    .countDocuments({ entityKey: SLUG, field: { $in: ['fullDescription', 'shortDescription'] } });

const runApply = () =>
  runResearchDescriptionBackfill({ dryRun: false, rewriter: async () => REWRITTEN });

describe('the llm-rewrite lane fails closed when its observations are refused (#3727)', () => {
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
    const db = mongoose.connection.db!;
    for (const name of ['research_entities', 'observations', 'sources']) {
      await db.collection(name).deleteMany({});
    }
    await db.collection('sources').insertOne({
      _id: new mongoose.Types.ObjectId(),
      name: REWRITE_SOURCE_NAME,
      weight: 0.85,
    });
  });

  it('neither writes nor counts a row whose observations the store refused', async () => {
    await insertRow(UNCITABLE_URL);

    const result = await runApply();

    expect(result.observationDropped).toBe(1);
    expect(result.rewritten).toBe(0);
    expect(result.errors).toBe(0);
    expect(await storedObservationCount()).toBe(0);
    expect(await storedRow()).toMatchObject({
      shortDescription: INCUMBENT_CARD,
      fullDescription: RESEARCH_BODY,
    });
  }, 60000);

  it('writes and counts the row when both observations are stored', async () => {
    await insertRow(CITABLE_URL);

    const result = await runApply();

    expect(result.observationDropped).toBe(0);
    expect(result.rewritten).toBe(1);
    expect(await storedObservationCount()).toBe(2);
    expect((await storedRow())?.shortDescription).not.toBe(INCUMBENT_CARD);
  }, 60000);
});
