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

import { Account } from '../../models/account';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { ScrapeRun } from '../../models/scrapeRun';
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

const PROFILE_URL = `https://medicine.yale.edu${PROFILE_PATH}`;

const memberPage = (email: string) =>
  `<html><body><h1>Profile</h1><a href="mailto:${email}">Email</a></body></html>`;

async function readRoster(name: string, memberPages: Record<string, string> | null): Promise<void> {
  const observedAt = new Date();
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
  const memberPageFetcher = memberPages
    ? async (url: string) => {
        const html = memberPages[url];
        if (html === undefined) throw new Error('Request failed with status code 404');
        return html;
      }
    : null;
  await new OfficialResearchHomeRosterScraper(
    [CONFIG],
    async () => page(name, observedAt),
    null,
    memberPageFetcher,
  ).run(ctx);
  await appendObservations(emitted, {
    scrapeRunId: String(scrapeRunId),
    sourceId: String(SOURCE_ID),
    sourceName: OFFICIAL_RESEARCH_HOME_ROSTER_SOURCE,
    sourceWeight: 0.95,
    dryRun: false,
  });
  await materializeFromRun(String(scrapeRunId));
}

const labId = async () =>
  ((await ResearchEntity.findOne({ slug: LAB_SLUG }).select('_id').lean()) as any)._id;

const listingHolders = async (): Promise<string[]> =>
  (
    (await RoleAssignment.find({
      'target.id': await labId(),
      'rosterProvenance.sourceName': OFFICIAL_RESEARCH_HOME_ROSTER_SOURCE,
      state: 'CURRENT',
      archived: { $ne: true },
    }).lean()) as any[]
  ).map((edge) => String(edge.personId));

const identifiedHolder = async (displayName: string, email: string) => {
  const netid = 'fm42';
  await Account.create({ netid, email, status: 'UNKNOWN', archived: false });
  const researcher = await Researcher.create({
    displayName,
    identifiers: { netid, email },
    profileLinks: [],
    archived: false,
  });
  return String(researcher._id);
};

describe(
  'official-research-home-roster joins a listing through its member page identity evidence (#5927)',
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

    it('resolves a variant-name listing to the identified researcher its member page email names', async () => {
      const holder = await identifiedHolder('Fixture Manager', 'fixture.manager7@yale.edu');

      await readRoster('Fixture Q. Manager', {
        [PROFILE_URL]: memberPage('fixture.manager7@yale.edu'),
      });

      expect(await listingHolders()).toEqual([holder]);
      expect(await Researcher.countDocuments({ archived: { $ne: true } })).toBe(1);
    });

    it('still mints the listed person when the member page email names no identified researcher', async () => {
      const holder = await identifiedHolder('Fixture Manager', 'fixture.other7@yale.edu');

      await readRoster('Fixture Q. Manager', {
        [PROFILE_URL]: memberPage('fixture.manager7@yale.edu'),
      });

      const holders = await listingHolders();
      expect(holders).toHaveLength(1);
      expect(holders[0]).not.toBe(holder);
    });

    it('reads no member page when the lane is built without a member page fetcher', async () => {
      const holder = await identifiedHolder('Fixture Manager', 'fixture.manager7@yale.edu');

      await readRoster('Fixture Q. Manager', null);

      expect(await Observation.countDocuments({ field: 'profileIdentityEvidence' })).toBe(0);
      expect(await listingHolders()).not.toEqual([holder]);
    });
  },
);
