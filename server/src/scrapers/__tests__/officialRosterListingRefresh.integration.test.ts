import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async (..._args: unknown[]) => {}),
  syncEntity: vi.fn(async () => true),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, ...meiliMocks };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return {
    ...actual,
    recomputeBrowseRankForEntities: vi.fn().mockResolvedValue({ updated: 0, indexSyncFailures: 0 }),
  };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { ScrapeRun } from '../../models/scrapeRun';
import { getResearchGroupDetail } from '../../services/researchGroupService';
import { materializeFromRun } from '../entityMaterializer';
import { appendObservations } from '../observationStore';
import {
  OFFICIAL_RESEARCH_HOME_ROSTER_SOURCE,
  OfficialResearchHomeRosterScraper,
  type OfficialRosterConfig,
} from '../sources/officialResearchHomeRosterScraper';
import type { ObservationInput, ScraperContext } from '../types';
import { clearC4Flags } from './c4FlagTestEnv';

const SOURCE_ID = new mongoose.Types.ObjectId();
const LAB_SLUG = 'ysm-synthetic-fixture';
const DAY_MS = 24 * 60 * 60 * 1000;

const CONFIG: OfficialRosterConfig = {
  researchEntityKey: LAB_SLUG,
  url: 'https://medicine.yale.edu/lab/synthetic-fixture/people/',
  currentSectionLabels: ['Lab Manager'],
};

const PROFILE_PATH = '/lab/synthetic-fixture/profile/fixture-manager/';

const card = (name: string) => `
  <article class="profile-grid-item" aria-label="${name}'s Profile">
    <a class="profile-grid-item__link-details" href="${PROFILE_PATH}">
      <span class="profile-grid-item__name">${name}</span>
    </a>
    <p class="profile-grid-item__title">Lab Manager</p>
  </article>`;

const page = (name: string, publishedAt: Date) => `
  <html><head><meta property="publish-date" content="${publishedAt.toISOString()}" /></head><body>
    <section class="organization-member-listing" aria-label="Lab Manager">
      <h2>Lab Manager</h2>${card(name)}
    </section>
  </body></html>`;

async function readRoster(name: string, observedAt: Date): Promise<string> {
  const scrapeRunId = new mongoose.Types.ObjectId();
  await ScrapeRun.create({
    _id: scrapeRunId,
    sourceId: SOURCE_ID,
    sourceName: OFFICIAL_RESEARCH_HOME_ROSTER_SOURCE,
    status: 'running',
  });
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: String(scrapeRunId),
    sourceId: String(SOURCE_ID),
    sourceName: OFFICIAL_RESEARCH_HOME_ROSTER_SOURCE,
    sourceWeight: 0.95,
    options: { dryRun: false, useCache: false, release: false, referenceDate: observedAt },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: () => {},
  };
  await new OfficialResearchHomeRosterScraper([CONFIG], async () => page(name, observedAt)).run(
    ctx,
  );
  await appendObservations(emitted, {
    scrapeRunId: String(scrapeRunId),
    sourceId: String(SOURCE_ID),
    sourceName: OFFICIAL_RESEARCH_HOME_ROSTER_SOURCE,
    sourceWeight: 0.95,
    dryRun: false,
  });
  await materializeFromRun(String(scrapeRunId));
  return String(scrapeRunId);
}

const labId = async () =>
  ((await ResearchEntity.findOne({ slug: LAB_SLUG }).select('_id').lean()) as any)._id;

const currentListingEdges = async () =>
  (await RoleAssignment.find({
    'target.id': await labId(),
    'rosterProvenance.sourceName': OFFICIAL_RESEARCH_HOME_ROSTER_SOURCE,
    state: 'CURRENT',
    archived: { $ne: true },
  }).lean()) as any[];

const servedMemberNames = async (): Promise<string[]> => {
  const detail = await getResearchGroupDetail(LAB_SLUG);
  if (!detail) throw new Error('the fixture lab is not served');
  return (detail.members ?? [])
    .map((entry: any) => String(entry.user?.displayName || ''))
    .filter(Boolean)
    .sort();
};

describe(
  'official-research-home-roster refreshes every listed key on each complete read (#4758)',
  { timeout: 120000 },
  () => {
    let replSet: MongoMemoryReplSet;

    beforeAll(async () => {
      replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      await mongoose.connect(replSet.getUri());
      await Observation.syncIndexes();
    });

    afterAll(async () => {
      await mongoose.disconnect();
      await replSet?.stop();
    });

    beforeEach(async () => {
      clearC4Flags();
      const db = mongoose.connection.db;
      if (!db) throw new Error('no db');
      for (const collection of [
        'observations',
        'research_entities',
        'researchers',
        'role_assignments',
        'scrape_runs',
        'accounts',
      ]) {
        await db.collection(collection).deleteMany({});
      }
      await ResearchEntity.create({
        slug: LAB_SLUG,
        name: 'Synthetic Fixture Lab',
        kind: 'lab',
        entityType: 'LAB',
        archived: false,
        studentVisibilityTier: 'student_ready',
        fullDescription:
          'The lab studies synthetic fixtures and the methods used to test roster pipelines.',
      });
    });

    it('refreshes a listing whose displayed name the page re-spelled, on one researcher record', async () => {
      const firstRead = new Date(Date.now() - 30 * DAY_MS);
      await readRoster('Fixture Manager', firstRead);
      expect(await currentListingEdges()).toHaveLength(1);

      const secondRead = new Date();
      const runId = await readRoster('Fixture Q. Manager', secondRead);

      const edges = await currentListingEdges();
      expect(edges).toHaveLength(1);
      expect(new Date(edges[0].rosterProvenance.observedAt).getTime()).toBe(secondRead.getTime());
      const run = (await ScrapeRun.findById(runId).lean()) as any;
      expect(run.materializationSkipped).toBe(0);
      expect(await servedMemberNames()).toEqual(['Fixture Q. Manager']);
    });

    it('ends the earlier holder edge when the listing resolves to another researcher record', async () => {
      await readRoster('Fixture Manager', new Date(Date.now() - 30 * DAY_MS));
      const [firstEdge] = await currentListingEdges();
      await Researcher.updateOne(
        { _id: firstEdge.personId },
        { $set: { displayName: 'Fixture R. Manager' } },
      );

      await readRoster('Fixture Manager', new Date());

      const edges = await currentListingEdges();
      expect(edges).toHaveLength(1);
      expect(String(edges[0].personId)).not.toBe(String(firstEdge.personId));
      const ended = (await RoleAssignment.findById(firstEdge._id).lean()) as any;
      expect(ended.state).toBe('HISTORICAL');
      expect(await servedMemberNames()).toEqual(['Fixture Manager']);
    });

    it('keeps an earlier holder edge whose identity the lane proved', async () => {
      await readRoster('Fixture Manager', new Date(Date.now() - 30 * DAY_MS));
      const [firstEdge] = await currentListingEdges();
      await Researcher.updateOne(
        { _id: firstEdge.personId },
        { $set: { displayName: 'Fixture R. Manager' } },
      );
      await RoleAssignment.updateOne(
        { _id: firstEdge._id },
        { $set: { 'rosterProvenance.identityBasis': 'profile-url' } },
      );

      await readRoster('Fixture Manager', new Date());

      const kept = (await RoleAssignment.findById(firstEdge._id).lean()) as any;
      expect(kept.state).toBe('CURRENT');
    });
  },
);
