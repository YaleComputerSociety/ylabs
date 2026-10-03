/**
 * #4544 end to end against a real store: once two re-reads of the same profile attest its
 * lab website is gone, the retraction removes both the `websiteUrl` and the `website` this
 * lane asserted, and a rematerialization does not promote the link back.
 */
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
import { materializeEntity } from '../entityMaterializer';
import { appendObservations } from '../observationStore';
import { reconcileFieldRetractions } from '../fieldRetraction';
import {
  emptyLabWebsiteSlotObservation,
  entityResearchHomeToObservations,
} from '../sources/officialProfilePiBackfillScraper';
import type { ObservationInput } from '../types';

const SOURCE_NAME = 'official-profile-pi-backfill';
const SOURCE_ID = new mongoose.Types.ObjectId();
const PROFILE_URL = 'https://medicine.yale.edu/profile/rowan-fixturelab/';
const ENTITY_KEY = 'ysm-faculty-rowan-fixturelab';
const LAB_URL = 'https://fixturelab.example.org/';

async function appendRun(observations: ObservationInput[]): Promise<void> {
  const run = await ScrapeRun.create({
    sourceId: SOURCE_ID,
    sourceName: SOURCE_NAME,
    status: 'success',
    startedAt: new Date(),
  });
  await appendObservations(observations, {
    scrapeRunId: String(run._id),
    sourceId: String(SOURCE_ID),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.8,
    dryRun: false,
  });
  await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});
}

const storedRow = () => ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<Record<string, any>>();

const liveWebsiteObservations = () =>
  Observation.find({
    entityType: 'researchEntity',
    entityKey: ENTITY_KEY,
    sourceName: SOURCE_NAME,
    field: { $in: ['websiteUrl', 'website'] },
    superseded: { $ne: true },
  }).lean();

describe('a profile that stops linking the lab website this lane set (#4544)', () => {
  let replSet: MongoMemoryReplSet;
  const originalFlag = process.env.SCRAPER_FIELD_RETRACTION;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    process.env.SCRAPER_FIELD_RETRACTION = originalFlag;
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    process.env.SCRAPER_FIELD_RETRACTION = 'true';
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'role_assignments', 'signals']) {
      await db.collection(name).deleteMany({});
    }
    await ScrapeRun.deleteMany({});
    await ResearchEntity.collection.insertOne({
      slug: ENTITY_KEY,
      name: 'Rowan Fixturelab Faculty Research',
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'lab',
      sourceUrls: [PROFILE_URL],
    });
  });

  it('retracts both website fields after two attesting re-reads, and they stay gone', async () => {
    const row = await storedRow();
    await appendRun(
      entityResearchHomeToObservations(
        row!,
        {
          name: 'Fixturelab Laboratory',
          rawName: 'Fixturelab Laboratory',
          url: LAB_URL,
          kind: 'lab',
          entityType: 'LAB',
          score: 10,
          leadershipEvidenced: true,
        },
        PROFILE_URL,
      ),
    );
    const served = await storedRow();
    expect(served?.websiteUrl).toBe(LAB_URL);
    expect(served?.website).toBe(LAB_URL);

    await appendRun([emptyLabWebsiteSlotObservation(served!, PROFILE_URL)]);
    await appendRun([emptyLabWebsiteSlotObservation(served!, PROFILE_URL)]);

    const result = await reconcileFieldRetractions({
      sourceName: SOURCE_NAME,
      probeValue: async () => ({ positivelyDead: true }),
    });
    expect(result.outcome).toBe('reconciled');
    expect(await liveWebsiteObservations()).toHaveLength(0);

    const after = await storedRow();
    expect(after?.websiteUrl || undefined).toBeUndefined();
    expect(after?.website || undefined).toBeUndefined();

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});
    const rematerialized = await storedRow();
    expect(rematerialized?.websiteUrl || undefined).toBeUndefined();
    expect(rematerialized?.website || undefined).toBeUndefined();
  }, 120000);
});
