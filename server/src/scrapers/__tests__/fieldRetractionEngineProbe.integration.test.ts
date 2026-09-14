/**
 * The #2542 probe, end to end and against a real store.
 *
 * Two `ysm-faculty-directory` runs go through the production chain -
 * `facultyToResearchEntityObservations` -> `appendObservations` -> `materializeEntity`
 * -> `reconcileFieldRetractions` - with nothing stubbed between them. The first
 * assertion in each case is the characterization #2542 recorded: materialization
 * alone leaves the stale `websiteUrl` served. The retraction pass is what has to
 * turn it into an absence, and a further materialization is what has to leave it
 * absent, because a repair that the next pass undoes is not a fix.
 */
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { NO_SURNAME_ROSTER } from '../../utils/researchHomeNameIdentityAuthority';
import { materializeEntity } from '../entityMaterializer';
import { appendObservations } from '../observationStore';
import { reconcileFieldRetractions, reconcileFieldRetractionsFromRun } from '../fieldRetraction';
import {
  extractProfile,
  facultyToResearchEntityObservations,
  type RawYsmFaculty,
} from '../sources/ysmFacultyDirectoryScraper';

const SOURCE_NAME = 'ysm-faculty-directory';
const SOURCE_ID = new mongoose.Types.ObjectId();
const ENTITY_KEY = 'ysm-faculty-jordan-rivers';
const OWN_LAB = 'https://duchamplab.example.org';
const AFFILIATED_ORG = 'https://medicine.yale.edu/liver-center/';

const RIVERS: RawYsmFaculty = {
  name: 'Rivers, Jordan',
  profileUrl: 'https://medicine.yale.edu/profile/jordan-rivers/',
  slug: 'jordan-rivers',
};

function profileHtml(options: {
  labWebsite?: { name: string; url: string; description?: string };
}): string {
  const pageData = {
    mainComponents: [
      {
        key: 'ProfileDetails',
        model: {
          fullName: 'Jordan Rivers',
          sections: [
            {
              sectionType: 'about',
              bio: '',
              workdayTitle: 'Professor of Medicine',
              appointments: [],
              organizations: [],
            },
            {
              sectionType: 'research',
              researchDescription: '',
              meshKeywords: [{ id: 1000, name: 'Heart Failure' }],
              labWebsite: options.labWebsite ?? null,
              orcids: [],
            },
            { sectionType: 'getInTouch', email: 'jordan.rivers@yale.edu' },
          ],
        },
      },
    ],
  };
  return `<html><body><script id='page-data' type='application/json'>${JSON.stringify(
    pageData,
  )}</script></body></html>`;
}

async function runDirectoryPass(labWebsite?: { name: string; url: string }): Promise<string> {
  const profile = extractProfile(profileHtml({ labWebsite }), RIVERS);
  if (!profile) throw new Error('probe fixture produced no profile');
  const observations = facultyToResearchEntityObservations(
    profile,
    'netid:jordan.rivers',
    NO_SURNAME_ROSTER,
  );
  expect(observations.length).toBeGreaterThan(0);

  const run = await ScrapeRun.create({
    sourceId: SOURCE_ID,
    sourceName: SOURCE_NAME,
    status: 'success',
    startedAt: new Date(),
  });
  const scrapeRunId = String(run._id);
  const appended = await appendObservations(observations, {
    scrapeRunId,
    sourceId: String(SOURCE_ID),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.8,
    dryRun: false,
  });
  expect(appended.inserted).toBeGreaterThan(0);

  await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});
  return scrapeRunId;
}

const storedWebsiteUrl = async (): Promise<unknown> => {
  const doc = await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<{ websiteUrl?: unknown }>();
  return doc?.websiteUrl;
};

const liveWebsiteUrlObservations = () =>
  Observation.find({
    entityType: 'researchEntity',
    entityKey: ENTITY_KEY,
    field: 'websiteUrl',
    superseded: { $ne: true },
  }).lean();

describe('the observation engine can retract a field a source stopped asserting (#2542)', () => {
  let replSet: MongoMemoryReplSet;
  const originalFlag = process.env.SCRAPER_FIELD_RETRACTION;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 120000);

  afterAll(async () => {
    process.env.SCRAPER_FIELD_RETRACTION = originalFlag;
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    process.env.SCRAPER_FIELD_RETRACTION = 'true';
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of [
      'observations',
      'research_entities',
      'role_assignments',
      'signals',
      'scraperuns',
      'scrapruns',
      'scrape_runs',
      'researchers',
    ]) {
      await db.collection(name).deleteMany({});
    }
    await ScrapeRun.deleteMany({});
  });

  it('retracts a websiteUrl the profile stopped linking, and the next pass keeps it absent', async () => {
    await runDirectoryPass({ name: 'Duchamp Lab', url: OWN_LAB });
    expect(await storedWebsiteUrl()).toBe(OWN_LAB);

    await runDirectoryPass();
    await runDirectoryPass();

    // #2542's characterization: every field run 2 asserts heals, the one it stops
    // asserting does not.
    const persistedBefore = await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<{
      entityType?: string;
      kind?: string;
      websiteUrl?: unknown;
    }>();
    expect(persistedBefore?.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(persistedBefore?.kind).toBe('individual');
    expect(persistedBefore?.websiteUrl).toBe(OWN_LAB);
    expect(await liveWebsiteUrlObservations()).toHaveLength(1);

    const result = await reconcileFieldRetractions({ sourceName: SOURCE_NAME });
    expect(result.outcome).toBe('reconciled');
    expect(result.frozenFields).toEqual([]);

    expect(await storedWebsiteUrl()).toBeUndefined();
    expect(await liveWebsiteUrlObservations()).toHaveLength(0);

    const retired = (await Observation.findOne({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      field: 'websiteUrl',
    }).lean()) as any;
    expect(retired.superseded).toBe(true);
    expect(String(retired.rollback?.reason)).toContain('#2542');

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});
    expect(await storedWebsiteUrl()).toBeUndefined();
  }, 120000);

  it('retracts a websiteUrl whose lab slot now holds an affiliated organization', async () => {
    await runDirectoryPass({ name: 'Duchamp Lab', url: OWN_LAB });
    expect(await storedWebsiteUrl()).toBe(OWN_LAB);

    await runDirectoryPass({ name: 'Yale Liver Center', url: AFFILIATED_ORG });
    await runDirectoryPass({ name: 'Yale Liver Center', url: AFFILIATED_ORG });

    expect(await storedWebsiteUrl()).toBe(OWN_LAB);

    await reconcileFieldRetractions({ sourceName: SOURCE_NAME });

    expect(await storedWebsiteUrl()).toBeUndefined();
    expect(await liveWebsiteUrlObservations()).toHaveLength(0);
  }, 120000);

  it('keeps the value while the source has only read the profile once more', async () => {
    await runDirectoryPass({ name: 'Duchamp Lab', url: OWN_LAB });
    await runDirectoryPass();

    const result = await reconcileFieldRetractions({ sourceName: SOURCE_NAME });
    expect(result.counts.awaitingSecondCompleteRead).toBe(1);
    expect(result.counts.retractedObservations).toBe(0);
    expect(await storedWebsiteUrl()).toBe(OWN_LAB);
  }, 120000);

  it('keeps the value when the source never read the profile again', async () => {
    await runDirectoryPass({ name: 'Duchamp Lab', url: OWN_LAB });

    const result = await reconcileFieldRetractions({ sourceName: SOURCE_NAME });
    expect(result.counts.sourceHasNotReread).toBe(1);
    expect(result.counts.retractedObservations).toBe(0);
    expect(await storedWebsiteUrl()).toBe(OWN_LAB);
  }, 120000);

  it('keeps the value when the profile still links the same lab', async () => {
    await runDirectoryPass({ name: 'Duchamp Lab', url: OWN_LAB });
    await runDirectoryPass({ name: 'Duchamp Lab', url: OWN_LAB });
    await runDirectoryPass({ name: 'Duchamp Lab', url: OWN_LAB });

    const result = await reconcileFieldRetractions({ sourceName: SOURCE_NAME });
    expect(result.counts.retractedObservations).toBe(0);
    expect(await storedWebsiteUrl()).toBe(OWN_LAB);
  }, 120000);

  it('leaves a locked websiteUrl alone and reports the skip', async () => {
    await runDirectoryPass({ name: 'Duchamp Lab', url: OWN_LAB });
    await ResearchEntity.updateOne(
      { slug: ENTITY_KEY },
      { $set: { manuallyLockedFields: ['websiteUrl'] } },
    );
    await runDirectoryPass();
    await runDirectoryPass();

    const result = await reconcileFieldRetractions({ sourceName: SOURCE_NAME });
    expect(result.counts.lockedSkipped).toBe(1);
    expect(result.counts.retractedObservations).toBe(0);
    expect(await storedWebsiteUrl()).toBe(OWN_LAB);
    expect(await liveWebsiteUrlObservations()).toHaveLength(1);
  }, 120000);

  it('re-decides visibility for a row that lost the field, rather than leaving a stale tier', async () => {
    await runDirectoryPass({ name: 'Duchamp Lab', url: OWN_LAB });
    await runDirectoryPass();
    await runDirectoryPass();
    // A row can be published because of the very field being removed, so the
    // pre-state is deliberately a published one.
    await ResearchEntity.updateOne(
      { slug: ENTITY_KEY },
      {
        $set: {
          studentVisibilityTier: 'student_ready',
          studentVisibilityComputedTier: 'student_ready',
          studentVisibilityReasons: [],
        },
        $unset: { studentVisibilityComputedAt: '' },
      },
    );

    await reconcileFieldRetractions({ sourceName: SOURCE_NAME });

    const regated = await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<{
      studentVisibilityTier?: string;
      studentVisibilityReasons?: string[];
      studentVisibilityComputedAt?: unknown;
    }>();
    expect(regated?.studentVisibilityTier).not.toBe('student_ready');
    expect(regated?.studentVisibilityReasons?.length).toBeGreaterThan(0);
    expect(regated?.studentVisibilityComputedAt).toBeInstanceOf(Date);
  }, 120000);

  it('plans without writing in dry-run mode', async () => {
    await runDirectoryPass({ name: 'Duchamp Lab', url: OWN_LAB });
    await runDirectoryPass();
    await runDirectoryPass();

    const planned = await reconcileFieldRetractions({ sourceName: SOURCE_NAME, dryRun: true });
    expect(planned.outcome).toBe('planned');
    expect(planned.retractions).toHaveLength(1);
    expect(planned.retractions[0].clearsStoredValue).toBe(true);
    expect(await storedWebsiteUrl()).toBe(OWN_LAB);
    expect(await liveWebsiteUrlObservations()).toHaveLength(1);
  }, 120000);

  it('does nothing at all while the sweep flag is unset', async () => {
    await runDirectoryPass({ name: 'Duchamp Lab', url: OWN_LAB });
    await runDirectoryPass();
    const lastRunId = await runDirectoryPass();

    process.env.SCRAPER_FIELD_RETRACTION = 'false';
    const result = await reconcileFieldRetractionsFromRun(lastRunId);
    expect(result.outcome).toBe('disabled');
    expect(await storedWebsiteUrl()).toBe(OWN_LAB);
  }, 120000);

  it('resolves the run source name when driven from a scrape run', async () => {
    await runDirectoryPass({ name: 'Duchamp Lab', url: OWN_LAB });
    await runDirectoryPass();
    const lastRunId = await runDirectoryPass();

    const result = await reconcileFieldRetractionsFromRun(lastRunId);
    expect(result.sourceName).toBe(SOURCE_NAME);
    expect(result.outcome).toBe('reconciled');
    expect(await storedWebsiteUrl()).toBeUndefined();
  }, 120000);

  it('reports source-not-retraction-capable for an undeclared source run', async () => {
    const run = await ScrapeRun.create({
      sourceId: SOURCE_ID,
      sourceName: 'dept-faculty-roster',
      status: 'success',
      startedAt: new Date(),
    });
    const result = await reconcileFieldRetractionsFromRun(String(run._id));
    expect(result.outcome).toBe('source-not-retraction-capable');
  }, 120000);
});
