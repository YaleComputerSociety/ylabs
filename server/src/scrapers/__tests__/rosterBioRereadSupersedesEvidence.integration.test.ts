import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { ScrapeRun } from '../../models/scrapeRun';
import { appendObservations } from '../observationStore';
import {
  ROSTER_BIO_RESEARCH_EVIDENCE_SOURCE,
  loadRosterBioCoveredIdentities,
  loadRosterBioPeople,
} from '../sources/rosterBioResearchEvidenceScraper';
import {
  ROSTER_BIO_EVIDENCE_FIELD,
  planRosterBioResearchRows,
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
  await ResearchEntity.deleteMany({});
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

describe('a roster-bio re-read reaches an own row whose biography was removed (#6107)', () => {
  const PERSON_KEY = 'dept:synthetic:reread-fixture';

  const storeObservation = (fields: Record<string, unknown>) =>
    mongoose.connection.collection('observations').insertOne({
      superseded: false,
      observedAt: new Date(),
      sourceUrl: PROFILE_URL,
      ...fields,
    });

  it('plans a no-value assertion for the own row when the latest bio is empty', async () => {
    await ResearchEntity.create({
      slug: SLUG,
      name: 'Synthetic reread fixture',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: false,
    });
    await storeObservation({
      sourceName: ROSTER_BIO_RESEARCH_EVIDENCE_SOURCE,
      entityType: 'researchEntity',
      entityKey: SLUG,
      field: 'inferredPiUserKey',
      value: PERSON_KEY,
    });
    for (const [field, value] of Object.entries({
      bio: '',
      fname: 'Reread',
      lname: 'Fixture',
      title: 'Professor of Synthetic Studies',
      profileUrls: [PROFILE_URL],
    })) {
      await storeObservation({
        sourceName: 'dept-faculty-roster',
        entityType: 'user',
        entityKey: PERSON_KEY,
        field,
        value,
      });
    }

    const [people, covered] = await Promise.all([
      loadRosterBioPeople(),
      loadRosterBioCoveredIdentities(),
    ]);
    const { planned, reread } = planRosterBioResearchRows(people, covered, () => null);

    expect(planned).toEqual([]);
    expect(reread.map(rosterBioRereadObservation)).toEqual([
      expect.objectContaining({
        entityKey: SLUG,
        field: ROSTER_BIO_EVIDENCE_FIELD,
        value: '',
        assertsNoValueFor: [ROSTER_BIO_EVIDENCE_FIELD],
      }),
    ]);
  });
});
