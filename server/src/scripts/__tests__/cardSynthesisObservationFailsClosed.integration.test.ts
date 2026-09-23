import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runCardSynthesisBackfill } from '../backfillResearchDescriptions';

/**
 * The card lane writes the entity field AND an observation. The field is what a
 * student reads, but the observation is what makes it survive: the materializer
 * resolves `shortDescription` from observations, so a `$set` with no observation
 * behind it is restored to the incumbent at the next resolve.
 *
 * The lane used to discard `appendObservations`' result, write the field anyway and
 * count the row, so a run reported a delivery that a re-read of the served surface
 * disproved (#3158). The refusal is reproduced here with a citation the observation
 * store will not accept, because that is a real refusal on the real path rather than a
 * stubbed one: `appendObservations` fails closed on an uncitable host, whoever writes.
 */
const CARD_SOURCE_NAME = 'lab-microsite-description-llm';

const RESEARCH_BODY =
  'The laboratory studies how microglia clear protein aggregates in the ageing brain, combining two-photon imaging in mouse models with single-nucleus sequencing of post-mortem cortex to identify the clearance pathways that fail earliest in tauopathy.';

const CAREER_BIOGRAPHY_CARD =
  'Dr. Rowan Tallis trained at three universities before an appointment to the faculty in 2001.';

const UNCITABLE_URL = 'https://probe-preview.ngrok-free.app/profile/tallis/';
const CITABLE_URL = 'https://medicine.example.edu/profile/tallis/';

const SLUG = 'fixture-card-observation-fail-closed';

const insertRow = async (websiteUrl: string) => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');
  await db.collection('research_entities').insertOne({
    _id: new mongoose.Types.ObjectId(),
    slug: SLUG,
    name: 'Example Research Profile',
    kind: 'individual',
    entityType: 'FACULTY_RESEARCH_AREA',
    schemaVersion: 1,
    archived: false,
    studentVisibilityTier: 'student_ready',
    studentVisibilityReasons: ['source_backed_description'],
    shortDescription: CAREER_BIOGRAPHY_CARD,
    fullDescription: RESEARCH_BODY,
    websiteUrl,
    sourceUrls: [websiteUrl],
  });
};

const storedCard = async (): Promise<string> => {
  const row = await mongoose.connection
    .db!.collection('research_entities')
    .findOne({ slug: SLUG }, { projection: { shortDescription: 1 } });
  return String((row as { shortDescription?: string } | null)?.shortDescription ?? '');
};

const storedObservationCount = async (): Promise<number> =>
  mongoose.connection
    .db!.collection('observations')
    .countDocuments({ entityKey: SLUG, field: 'shortDescription' });

const runApply = () =>
  runCardSynthesisBackfill({
    dryRun: false,
    limit: 50,
    servedCardBiographies: true,
    cardSynthesizer: async () =>
      'Studies how microglia clear protein aggregates in the ageing brain and which clearance pathways fail earliest in tauopathy.',
  });

describe('the card lane fails closed when its observation is refused (#3158)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    // The hermetic setup file clears the key so no suite can reach a live backend, and
    // the lane reads it to decide whether the LLM arm exists at all. The synthesizer
    // itself is injected, so a placeholder only unlocks the arm.
    process.env.OPENAI_API_KEY = 'test-key-not-a-credential';
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    delete process.env.OPENAI_API_KEY;
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['research_entities', 'observations', 'sources']) {
      await db.collection(name).deleteMany({});
    }
    await db.collection('sources').insertOne({
      _id: new mongoose.Types.ObjectId(),
      name: CARD_SOURCE_NAME,
      weight: 0.85,
    });
  });

  it('neither writes nor counts a row whose observation the store refused', async () => {
    await insertRow(UNCITABLE_URL);

    const result = await runApply();

    expect(result.observationDropped).toBe(1);
    expect(result.updated).toBe(0);
    expect(await storedObservationCount()).toBe(0);
    // The field must still hold the value it had, because a write with no observation
    // behind it is the thing that silently reverts.
    expect(await storedCard()).toBe(CAREER_BIOGRAPHY_CARD);
  }, 60000);

  it('writes and counts the row when the observation is stored', async () => {
    await insertRow(CITABLE_URL);

    const result = await runApply();

    expect(result.observationDropped).toBe(0);
    expect(result.updated).toBe(1);
    expect(await storedObservationCount()).toBe(1);
    expect(await storedCard()).not.toBe(CAREER_BIOGRAPHY_CARD);
  }, 60000);
});
