import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntities: vi.fn(async () => {}),
    syncEntity: vi.fn(async () => true),
    deleteFromIndex: vi.fn(async () => {}),
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
import { RoleAssignment } from '../../models/roleAssignment';
import { ScrapeRun } from '../../models/scrapeRun';
import { getResearchGroupDetail } from '../../services/researchGroupService';
import { materializeFromRun } from '../entityMaterializer';
import { appendObservations } from '../observationStore';
import {
  CentersInstitutesScraper,
  routeCenterConfigToLiveRow,
  type CenterConfig,
  type CenterMember,
  type HtmlFetcher,
} from '../sources/centersInstitutesScraper';
import type { ObservationInput, ScraperContext } from '../types';
import { clearC4Flags } from './c4FlagTestEnv';

const SOURCE_NAME = 'centers-institutes-index';
const HOME_URL = 'https://fixture-merged.example.edu/';
const ROSTER_URL = 'https://fixture-merged.example.edu/people';
const MERGED_KEY = 'center-fixture-merged-away';
const SURVIVOR_KEY = 'center-fixture-survivor';
const RETIRED_KEY = 'center-fixture-retired-initiative';

const member = (first: string): CenterMember => ({
  name: `${first} Synthetic`,
  role: 'core-faculty',
  profileUrl: `https://fixture-merged.example.edu/people/${first.toLowerCase()}-synthetic`,
});

const ROSTER = ['Avery', 'Blair', 'Casey', 'Devon', 'Emery', 'Finley'].map(member);

const config = (overrides: Partial<CenterConfig> = {}): CenterConfig => ({
  centerKey: 'fixture-merged',
  centerName: 'Fixture Merged Center',
  schoolName: '',
  kind: 'center',
  url: ROSTER_URL,
  homeUrl: HOME_URL,
  paginated: false,
  extractor: (html: string) => ({ members: JSON.parse(html) as CenterMember[] }),
  entityKey: MERGED_KEY,
  ...overrides,
});

const afterAMoment = () => new Promise((resolve) => setTimeout(resolve, 5));

async function runLane(
  roster: CenterMember[],
  configs: CenterConfig[] = [config()],
): Promise<{ fetched: string[]; notes: string }> {
  await afterAMoment();
  const scrapeRunId = new mongoose.Types.ObjectId();
  await ScrapeRun.create({
    _id: scrapeRunId,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: SOURCE_NAME,
    status: 'running',
  });
  const emitted: ObservationInput[] = [];
  const fetched: string[] = [];
  const fetcher: HtmlFetcher = async (url: string) => {
    fetched.push(url);
    return JSON.stringify(roster);
  };
  const ctx: ScraperContext = {
    scrapeRunId: String(scrapeRunId),
    sourceId: String(new mongoose.Types.ObjectId()),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.8,
    options: { dryRun: false, useCache: false, release: false },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: () => {},
  };
  const result = await new CentersInstitutesScraper(configs, null, fetcher).run(ctx);
  await appendObservations(emitted, {
    scrapeRunId: String(scrapeRunId),
    sourceId: String(new mongoose.Types.ObjectId()),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.8,
    dryRun: false,
  });
  await materializeFromRun(String(scrapeRunId));
  return { fetched, notes: String(result.notes || '') };
}

const entityId = async (slug: string) =>
  ((await ResearchEntity.findOne({ slug }).select('_id').lean()) as any)._id;

const currentLaneEdges = async (slug: string) =>
  (await RoleAssignment.find({
    'target.id': await entityId(slug),
    'rosterProvenance.sourceName': SOURCE_NAME,
    state: { $ne: 'HISTORICAL' },
    archived: { $ne: true },
  }).lean()) as any[];

const servedMemberNames = async (slug: string): Promise<string[]> => {
  const detail = await getResearchGroupDetail(slug);
  if (!detail) throw new Error('the survivor is not served');
  return (detail.members ?? [])
    .map((entry: any) => String(entry.user?.displayName || ''))
    .filter(Boolean)
    .sort();
};

describe(
  'a center config keyed to a merged row reads its roster onto the survivor (#4021)',
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
      const db = mongoose.connection.db!;
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
      const survivor = await ResearchEntity.create({
        slug: SURVIVOR_KEY,
        name: 'Fixture Merged Center',
        kind: 'center',
        entityType: 'CENTER',
        websiteUrl: HOME_URL,
        studentVisibilityTier: 'student_ready',
        fullDescription:
          'The center convenes faculty who study synthetic fixtures and the methods used to test them.',
        archived: false,
      });
      await ResearchEntity.create([
        {
          slug: MERGED_KEY,
          name: 'Fixture Merged Center',
          kind: 'center',
          entityType: 'CENTER',
          archived: true,
          canonicalGroupId: survivor._id,
        },
        {
          slug: RETIRED_KEY,
          name: 'Fixture Retired Initiative',
          kind: 'center',
          entityType: 'INITIATIVE',
          archived: true,
        },
      ]);
    });

    it('lands the roster on the live survivor rather than the archived row', async () => {
      const { notes } = await runLane(ROSTER);

      expect(await currentLaneEdges(SURVIVOR_KEY)).toHaveLength(ROSTER.length);
      expect(await currentLaneEdges(MERGED_KEY)).toHaveLength(0);
      expect(
        await Observation.countDocuments({
          sourceName: SOURCE_NAME,
          entityKey: { $regex: `^${MERGED_KEY}` },
        }),
      ).toBe(0);
      expect(notes).toContain('routed onto merge survivor: fixture-merged');
      expect(await servedMemberNames(SURVIVOR_KEY)).toEqual(
        ROSTER.map((entry) => entry.name).sort(),
      );
    });

    it('lets two complete reads retire a member the survivor roster stops listing', async () => {
      await runLane(ROSTER);
      const withoutFinley = ROSTER.filter((entry) => !entry.name.startsWith('Finley'));
      await runLane(withoutFinley);
      await runLane(withoutFinley);

      const served = await servedMemberNames(SURVIVOR_KEY);
      expect(served.some((name) => name.startsWith('Finley'))).toBe(false);
      expect(served.some((name) => name.startsWith('Blair'))).toBe(true);
    });

    it('reads nothing for a config whose row is archived with no survivor', async () => {
      const { fetched, notes } = await runLane(ROSTER, [config({ entityKey: RETIRED_KEY })]);

      expect(fetched).toEqual([]);
      expect(notes).toContain('archived-without-survivor');
      expect(
        await Observation.countDocuments({
          sourceName: SOURCE_NAME,
          entityKey: { $regex: `^${RETIRED_KEY}` },
        }),
      ).toBe(0);
    });

    it('refuses a survivor that another config already reads', async () => {
      const route = await routeCenterConfigToLiveRow(config(), [
        config(),
        config({ centerKey: 'fixture-survivor', entityKey: SURVIVOR_KEY }),
      ]);

      expect(route).toEqual({ refusal: 'survivor-claimed-by-another-config' });
    });
  },
);
