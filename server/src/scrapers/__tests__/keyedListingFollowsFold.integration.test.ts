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
import { resetDirectoryNetidsByAddressCache } from '../directoryContradictedProfileNetid';
import { materializeFromRun } from '../entityMaterializer';
import { appendObservations } from '../observationStore';
import {
  CentersInstitutesScraper,
  type CenterConfig,
  type CenterMember,
  type HtmlFetcher,
} from '../sources/centersInstitutesScraper';
import type { ObservationInput, ScraperContext } from '../types';
import { clearC4Flags } from './c4FlagTestEnv';

const SOURCE_NAME = 'centers-institutes-index';
const SOURCE_ID = new mongoose.Types.ObjectId();
const ROSTER_URL = 'https://fixture-fold-center.example.edu/people';
const CENTER_SLUG = 'center-fixture-fold';
const LONG_AGO = new Date('2026-01-15T00:00:00Z');
const LISTED_NAME = 'Avery Synthetic';
const LISTING_PROFILE_URL = 'https://fixture-fold-center.yale.edu/center/profile/avery-synthetic/';
const LISTING_KEY = `official-profile:${LISTING_PROFILE_URL}|core-faculty`;

const LISTING: CenterMember = {
  name: LISTED_NAME,
  role: 'core-faculty',
  profileUrl: LISTING_PROFILE_URL,
};

const config: CenterConfig = {
  centerKey: 'fixture-fold',
  centerName: 'Fixture Fold Center',
  schoolName: '',
  kind: 'center',
  url: ROSTER_URL,
  homeUrl: 'https://fixture-fold-center.example.edu/',
  paginated: false,
  extractor: (html: string) => ({ members: JSON.parse(html) as CenterMember[] }),
};

type ProfilePages = Record<string, string>;

const fetcherFor =
  (roster: CenterMember[], profiles: ProfilePages): HtmlFetcher =>
  async (url: string) => {
    if (url.startsWith(ROSTER_URL)) return JSON.stringify(roster);
    const html = profiles[url];
    if (html === undefined) {
      throw Object.assign(new Error('Request failed with status code 404'), {
        response: { status: 404 },
      });
    }
    return html;
  };

const profilePage = (options: { email?: string; netid?: string } = {}) => {
  const jsonLd = options.netid
    ? `<script type="application/ld+json">${JSON.stringify({
        '@type': 'Person',
        identifier: { propertyID: 'NetID', value: options.netid },
      })}</script>`
    : '';
  const mail = options.email ? `<a href="mailto:${options.email}">Email</a>` : '';
  return `<html><head>${jsonLd}</head><body><h1>Profile</h1>${mail}</body></html>`;
};

const CORROBORATED: ProfilePages = {
  [LISTING_PROFILE_URL]: profilePage({ email: 'avery.synthetic@yale.edu' }),
};

const afterAMoment = () => new Promise((resolve) => setTimeout(resolve, 5));

async function runLane(profiles: ProfilePages = {}, roster: CenterMember[] = [LISTING]) {
  await afterAMoment();
  const scrapeRunId = new mongoose.Types.ObjectId();
  await ScrapeRun.create({
    _id: scrapeRunId,
    sourceId: SOURCE_ID,
    sourceName: SOURCE_NAME,
    status: 'running',
  });
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: String(scrapeRunId),
    sourceId: String(SOURCE_ID),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.8,
    options: { dryRun: false, useCache: false, release: false },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: () => {},
  };
  const fetcher = fetcherFor(roster, profiles);
  await new CentersInstitutesScraper([config], null, fetcher, (url) =>
    fetcher(url, false, SOURCE_NAME),
  ).run(ctx);
  await appendObservations(emitted, {
    scrapeRunId: String(scrapeRunId),
    sourceId: String(SOURCE_ID),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.8,
    dryRun: false,
  });
  await materializeFromRun(String(scrapeRunId));
}

const centerId = async () =>
  ((await ResearchEntity.findOne({ slug: CENTER_SLUG }).select('_id').lean()) as any)?._id;

const liveEdgesOf = async (personId: unknown) =>
  ((await RoleAssignment.find({ personId, 'target.id': await centerId() }).lean()) as any[]).filter(
    (row) => row.archived !== true && row.state !== 'HISTORICAL',
  );

const listingShell = async () => {
  const shell = (await Researcher.findOne({
    displayName: LISTED_NAME,
    archived: { $ne: true },
  }).lean()) as any;
  expect(shell).toBeTruthy();
  const edges = await liveEdgesOf(shell._id);
  expect(edges.map((edge) => edge.rosterProvenance?.membershipKey)).toEqual([LISTING_KEY]);
  return shell._id as mongoose.Types.ObjectId;
};

const survivorRecord = async (
  identifiers: { email?: string; netid?: string } = { email: 'avery.synthetic@yale.edu' },
  displayName = 'Avery J. Quillon',
) => {
  const survivor = await Researcher.create({
    displayName,
    identifiers,
    profileLinks: [],
    archived: false,
  });
  await RoleAssignment.create({
    personId: survivor._id,
    target: { kind: 'RESEARCH_ENTITY', id: await centerId() },
    role: 'CORE_FACULTY',
    state: 'HISTORICAL',
    endedAt: LONG_AGO,
    confidence: 0.5,
    reviewStatus: 'UNREVIEWED',
    archived: false,
    startedAt: LONG_AGO,
  });
  return survivor._id as mongoose.Types.ObjectId;
};

const archivedNamesake = (
  dedupedIntoResearcherId?: mongoose.Types.ObjectId,
  displayName = LISTED_NAME,
) =>
  Researcher.create({
    displayName,
    profileLinks: [],
    archived: true,
    ...(dedupedIntoResearcherId
      ? { dedupedIntoResearcherId, dedupedAt: new Date('2026-11-12T00:00:00Z') }
      : {}),
  });

const expectListingStaysOn = async (
  shell: mongoose.Types.ObjectId,
  ...others: mongoose.Types.ObjectId[]
) => {
  expect((await liveEdgesOf(shell)).map((edge) => edge.rosterProvenance?.membershipKey)).toEqual([
    LISTING_KEY,
  ]);
  for (const other of others) expect(await liveEdgesOf(other)).toHaveLength(0);
};

describe(
  'a listing whose evidence names the fold survivor of its name resolves to that survivor (#6019)',
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
      resetDirectoryNetidsByAddressCache();
      const db = mongoose.connection.db;
      if (!db) throw new Error('no db');
      for (const name of [
        'observations',
        'research_entities',
        'research_entity_relationships',
        'researchers',
        'role_assignments',
        'scrape_runs',
        'accounts',
      ]) {
        await db.collection(name).deleteMany({});
      }
      await runLane({}, []);
    });

    it('moves the listing to the survivor and leaves the shell edge as the twin the shell dedupe joins', async () => {
      await runLane();
      const shell = await listingShell();
      const survivor = await survivorRecord();
      await archivedNamesake(survivor);

      await runLane(CORROBORATED);

      const survivorEdges = await liveEdgesOf(survivor);
      expect(survivorEdges).toHaveLength(1);
      expect(survivorEdges[0].rosterProvenance).toMatchObject({
        sourceName: SOURCE_NAME,
        membershipKey: LISTING_KEY,
      });
      expect(survivorEdges[0].rosterProvenance.identityBasis).toBeDefined();
      const shellEdges = await liveEdgesOf(shell);
      expect(shellEdges).toHaveLength(1);
      expect(shellEdges[0].rosterProvenance).toMatchObject({
        sourceName: SOURCE_NAME,
        membershipKey: LISTING_KEY,
      });
      expect(shellEdges[0].rosterProvenance.identityBasis).toBeUndefined();
      expect(await Researcher.countDocuments({ displayName: LISTED_NAME })).toBe(2);

      await runLane(CORROBORATED);
      expect(await liveEdgesOf(survivor)).toHaveLength(1);
    });

    it('does not follow the fold on a shared name when the listing states nothing the survivor holds', async () => {
      await runLane();
      const shell = await listingShell();
      const survivor = await survivorRecord();
      await archivedNamesake(survivor);

      await runLane();

      await expectListingStaysOn(shell, survivor);
    });

    it('does not follow the fold on a stated identifier the survivor holds no value of', async () => {
      const pages = { [LISTING_PROFILE_URL]: profilePage({ netid: 'fq17' }) };
      await runLane(pages);
      const shell = await listingShell();
      const survivor = await survivorRecord();
      await archivedNamesake(survivor);

      await runLane(pages);

      await expectListingStaysOn(shell, survivor);
    });

    it('does not follow an archived namesake that names no survivor', async () => {
      await runLane();
      const shell = await listingShell();
      const lookalike = await survivorRecord();
      await archivedNamesake();

      await runLane(CORROBORATED);

      await expectListingStaysOn(shell, lookalike);
    });

    it('does not follow a fold of another name into the survivor', async () => {
      await runLane();
      const shell = await listingShell();
      const survivor = await survivorRecord();
      await archivedNamesake(survivor, 'Avery Q. Synthetic');

      await runLane(CORROBORATED);

      await expectListingStaysOn(shell, survivor);
    });

    it('does not follow a fold into an archived survivor', async () => {
      await runLane();
      const shell = await listingShell();
      const survivor = await survivorRecord();
      await Researcher.updateOne({ _id: survivor }, { $set: { archived: true } });
      await archivedNamesake(survivor);

      await runLane(CORROBORATED);

      await expectListingStaysOn(shell, survivor);
    });

    it('does not follow folded namesakes that point at different survivors', async () => {
      await runLane();
      const shell = await listingShell();
      const first = await survivorRecord();
      const second = await survivorRecord({ email: 'fold.survivor2@yale.edu' }, 'Avery K. Quillon');
      await archivedNamesake(first);
      await archivedNamesake(second);

      await runLane(CORROBORATED);

      await expectListingStaysOn(shell, first, second);
    });

    it.each([
      {
        stated: 'an email',
        page: { email: 'avery.synthetic@yale.edu' },
        survivorIdentifiers: { email: 'fold.survivor1@yale.edu' },
      },
      {
        stated: 'a netid',
        page: { netid: 'fq17' },
        survivorIdentifiers: { netid: 'zq99', email: 'zq99@yale.edu' },
      },
    ])(
      'does not follow the fold to a survivor holding a different value of $stated the listing states',
      async ({ page, survivorIdentifiers }) => {
        const pages = { [LISTING_PROFILE_URL]: profilePage(page) };
        await runLane(pages);
        const shell = await listingShell();
        const survivor = await survivorRecord(survivorIdentifiers);
        await archivedNamesake(survivor);

        await runLane(pages);

        await expectListingStaysOn(shell, survivor);
      },
    );

    it.each([
      { holds: 'an email', update: { 'identifiers.email': 'fold.shell@fixture.example.edu' } },
      {
        holds: 'a profile link',
        update: {
          profileLinks: [
            {
              kind: 'YALE_OFFICIAL',
              purpose: 'PRIMARY_IDENTITY',
              url: 'https://fixture-fold-dept.yale.edu/profile/avery-synthetic/',
              verifiedAt: LONG_AGO,
            },
          ],
        },
      },
    ])(
      'does not move a listing that states nothing off a holder that has $holds',
      async ({ update }) => {
        await runLane();
        const shell = await listingShell();
        await Researcher.updateOne({ _id: shell }, { $set: update });
        const survivor = await survivorRecord();
        await archivedNamesake(survivor);

        await runLane();

        await expectListingStaysOn(shell, survivor);
      },
    );
  },
);
