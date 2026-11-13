import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Observation } from '../../models/observation';
import { ScrapeRun } from '../../models/scrapeRun';
import { appendObservations } from '../observationStore';
import { ROSTER_BIO_RESEARCH_EVIDENCE_SOURCE } from '../sources/rosterBioResearchEvidenceScraper';
import {
  ROSTER_BIO_EVIDENCE_FIELD,
  rosterBioRereadObservation,
} from '../utils/rosterBioResearchEvidence';

const SOURCE_ID = new mongoose.Types.ObjectId();
const SLUG = 'dept-synthetic-reread-fixture';
const PROFILE_URL = 'https://synthetic.yale.edu/profile/reread-fixture';
const RESEARCH =
  'Her research focuses on how synthetic proteins fold in cold environments, combining structural biology and computational modeling.';
const CLINICAL =
  'They have a special interest in synthetic glimmer fever and the care of children with it.';

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  await Observation.deleteMany({});
  await ScrapeRun.deleteMany({});
});

async function storeRead(evidenceSentences: string[]): Promise<void> {
  const run = await ScrapeRun.create({
    sourceId: SOURCE_ID,
    sourceName: ROSTER_BIO_RESEARCH_EVIDENCE_SOURCE,
    status: 'success',
    startedAt: new Date(),
  });
  await appendObservations(
    [
      rosterBioRereadObservation({
        personKey: 'dept:synthetic:reread-fixture',
        slug: SLUG,
        profileUrl: PROFILE_URL,
        evidenceSentences,
      }),
    ],
    {
      scrapeRunId: String(run._id),
      sourceId: String(SOURCE_ID),
      sourceName: ROSTER_BIO_RESEARCH_EVIDENCE_SOURCE,
      sourceWeight: 0.6,
      dryRun: false,
    },
  );
}

const liveEvidence = () =>
  Observation.find({
    sourceName: ROSTER_BIO_RESEARCH_EVIDENCE_SOURCE,
    entityKey: SLUG,
    field: ROSTER_BIO_EVIDENCE_FIELD,
    superseded: false,
  }).lean();

describe('a roster-bio re-read replaces the lane evidence it stated before (#6107)', () => {
  it('leaves only the narrower reading live when the evidence is trimmed', async () => {
    await storeRead([RESEARCH, CLINICAL]);
    await storeRead([RESEARCH]);

    const live = await liveEvidence();
    expect(live).toHaveLength(1);
    expect(live[0].value).toBe(RESEARCH);
  });

  it('leaves only a no-value assertion live when no research statement remains', async () => {
    await storeRead([CLINICAL]);
    await storeRead([]);

    const live = await liveEvidence();
    expect(live).toHaveLength(1);
    expect(live[0].value).toBe('');
    expect(live[0].assertsNoValueFor).toEqual([ROSTER_BIO_EVIDENCE_FIELD]);
  });

  it('keeps one live reading when the evidence is unchanged', async () => {
    await storeRead([RESEARCH]);
    await storeRead([RESEARCH]);

    const live = await liveEvidence();
    expect(live).toHaveLength(1);
    expect(live[0].value).toBe(RESEARCH);
  });
});
