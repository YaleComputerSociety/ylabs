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

const gateMocks = vi.hoisted(() => ({ gateChangesNothing: false }));

vi.mock('../../services/studentVisibilityGateService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/studentVisibilityGateService')
  >('../../services/studentVisibilityGateService');
  return {
    ...actual,
    applyStudentVisibilityGatePlans: (
      plans: Parameters<typeof actual.applyStudentVisibilityGatePlans>[0],
    ) => actual.applyStudentVisibilityGatePlans(gateMocks.gateChangesNothing ? [] : plans),
  };
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
const HOME_URL = 'https://fixture-center.example.edu/';
const ROSTER_URL = 'https://fixture-center.example.edu/people';
const CENTER_SLUG = 'center-fixture-synthetic';

const SHARED_URL = 'https://fixture-center.example.edu/people/avery-synthetic';

const config = (members: CenterMember[]): CenterConfig => ({
  centerKey: 'fixture-synthetic',
  centerName: 'Fixture Synthetic Center',
  schoolName: '',
  kind: 'center',
  url: ROSTER_URL,
  homeUrl: HOME_URL,
  paginated: false,
  extractor: () => ({ members }),
});

const fetcher: HtmlFetcher = async () => '[]';

const afterAMoment = () => new Promise((resolve) => setTimeout(resolve, 5));

async function runLane(members: CenterMember[]): Promise<void> {
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
  await new CentersInstitutesScraper([config(members)], null, fetcher).run(ctx);
  await appendObservations(emitted, {
    scrapeRunId: String(scrapeRunId),
    sourceId: String(SOURCE_ID),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.8,
    dryRun: false,
  });
  await materializeFromRun(String(scrapeRunId));
}

const listed = (name: string, profileUrl = SHARED_URL): CenterMember => ({
  name,
  role: 'core-faculty',
  profileUrl,
});

const holdUrl = (displayName: string) =>
  Researcher.create({ displayName, profile: { websiteUrl: SHARED_URL } });

const centerId = async () =>
  ((await ResearchEntity.findOne({ slug: CENTER_SLUG }).select('_id').lean()) as any)._id;

const seedStaleLaneEdge = async (personId: unknown, membershipKey: string) =>
  RoleAssignment.create({
    personId,
    target: { kind: 'RESEARCH_ENTITY', id: await centerId() },
    role: 'CORE_FACULTY',
    state: 'CURRENT',
    confidence: 0.8,
    reviewStatus: 'UNREVIEWED',
    schemaVersion: 1,
    archived: false,
    rosterProvenance: { sourceName: SOURCE_NAME, profileUrl: SHARED_URL, membershipKey },
  });

const liveEdgeOf = async (personId: unknown, sourceName = SOURCE_NAME) =>
  RoleAssignment.findOne({
    personId,
    'target.id': await centerId(),
    'rosterProvenance.sourceName': sourceName,
    state: { $ne: 'HISTORICAL' },
    archived: { $ne: true },
  }).lean();

describe(
  'a shared profile url ends the lane edge of the holder the listed name vetoes (#5582)',
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
      await Promise.all([
        Observation.deleteMany({}),
        ResearchEntity.deleteMany({}),
        Researcher.deleteMany({}),
        RoleAssignment.deleteMany({}),
        ScrapeRun.deleteMany({}),
      ]);
    });

    it('ends the vetoed holder edge under the listing, and a rerun keeps it ended', async () => {
      const member = await holdUrl('Avery Synthetic');
      await runLane([listed('Avery Synthetic')]);
      const memberEdge = (await liveEdgeOf(member._id)) as any;
      expect(memberEdge).not.toBeNull();
      const vetoed = await holdUrl('Blair Synthetic');
      await seedStaleLaneEdge(vetoed._id, memberEdge.rosterProvenance.membershipKey);
      expect(await liveEdgeOf(vetoed._id)).not.toBeNull();

      await runLane([listed('Avery Synthetic')]);
      expect(await liveEdgeOf(member._id)).not.toBeNull();
      expect(await liveEdgeOf(vetoed._id)).toBeNull();

      await runLane([listed('Avery Synthetic')]);
      expect(await liveEdgeOf(member._id)).not.toBeNull();
      expect(await liveEdgeOf(vetoed._id)).toBeNull();
    });

    it('keeps the edge of a holder another listing on the same center names', async () => {
      const other = await holdUrl('Blair Synthetic');
      const member = await holdUrl('Avery Synthetic');
      await runLane([listed('Avery Synthetic'), listed('Blair Synthetic')]);
      await runLane([listed('Avery Synthetic'), listed('Blair Synthetic')]);
      expect(await liveEdgeOf(member._id)).not.toBeNull();
      expect(await liveEdgeOf(other._id)).not.toBeNull();
    });

    it('leaves an edge another source asserts for the vetoed holder', async () => {
      const member = await holdUrl('Avery Synthetic');
      await runLane([listed('Avery Synthetic')]);
      const vetoed = await holdUrl('Blair Synthetic');
      await RoleAssignment.create({
        personId: vetoed._id,
        target: { kind: 'RESEARCH_ENTITY', id: await centerId() },
        role: 'CORE_FACULTY',
        state: 'CURRENT',
        confidence: 0.9,
        reviewStatus: 'UNREVIEWED',
        schemaVersion: 1,
        archived: false,
        rosterProvenance: { sourceName: 'official-research-home-roster', profileUrl: SHARED_URL },
      });
      await runLane([listed('Avery Synthetic')]);
      expect(await liveEdgeOf(member._id)).not.toBeNull();
      expect(await liveEdgeOf(vetoed._id, 'official-research-home-roster')).not.toBeNull();
    });
  },
);
