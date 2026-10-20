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
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { ScrapeRun } from '../../models/scrapeRun';
import { materializeFromRun } from '../entityMaterializer';
import { appendObservations } from '../observationStore';
import { CenterProfileResearchRowsScraper } from '../sources/centerProfileResearchRowsScraper';
import type { ObservationInput, ScraperContext, ScraperResult } from '../types';
import { macmillanPersonProfileExtractor } from '../utils/centerMemberProfileResearch';
import { clearC4Flags } from './c4FlagTestEnv';

const SOURCE_NAME = 'center-profile-research-rows';
const PROFILE_ROOT = 'https://macmillan.yale.edu/people/';
const RESEARCH =
  'Her research examines how synthetic institutions shape regional identity, and her current project analyzes synthetic survey data across regions.';

const profileHtml = (body: string) =>
  `<html><body><div class="node__bio"><div class="node__body"><p>${body}</p></div></div></body></html>`;

interface Member {
  key: string;
  displayName: string;
  title: string;
  netid?: string;
}

const MEMBERS: Member[] = [
  {
    key: 'eligible',
    displayName: 'Robin Fixture',
    title: 'Professor of Synthetic Studies',
    netid: 'zz0001',
  },
  {
    key: 'trainee',
    displayName: 'Casey Fixture',
    title: 'Postdoctoral Associate in Synthetic Studies',
    netid: 'zz0002',
  },
  { key: 'no-netid', displayName: 'Drew Fixture', title: 'Professor of Synthetic Studies' },
  {
    key: 'leads-lab',
    displayName: 'Emery Fixture',
    title: 'Professor of Synthetic Studies',
    netid: 'zz0004',
  },
  {
    key: 'unread',
    displayName: 'Finley Fixture',
    title: 'Professor of Synthetic Studies',
    netid: 'zz0005',
  },
  {
    key: 'named-lab',
    displayName: 'Gray Fixture',
    title: 'Professor of Synthetic Studies',
    netid: 'zz0006',
  },
  {
    key: 'inferred-lead',
    displayName: 'Harper Fixture',
    title: 'Professor of Synthetic Studies',
    netid: 'zz0007',
  },
  {
    key: 'archived-row',
    displayName: 'Indigo Fixture',
    title: 'Professor of Synthetic Studies',
    netid: 'zz0008',
  },
];

const urlOf = (key: string) => `${PROFILE_ROOT}${key}`;

async function runLane(): Promise<{ result: ScraperResult; emitted: ObservationInput[] }> {
  await new Promise((resolve) => setTimeout(resolve, 5));
  const scrapeRunId = new mongoose.Types.ObjectId();
  await ScrapeRun.create({
    _id: scrapeRunId,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: SOURCE_NAME,
    status: 'running',
  });
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: String(scrapeRunId),
    sourceId: String(new mongoose.Types.ObjectId()),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.7,
    options: { dryRun: false, useCache: false, release: false },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: () => {},
  };
  const scraper = new CenterProfileResearchRowsScraper(
    [{ profileHost: 'macmillan.yale.edu', profileExtractor: macmillanPersonProfileExtractor }],
    async (url) => {
      if (url === urlOf('unread')) throw new Error('synthetic fetch timeout');
      return profileHtml(RESEARCH);
    },
  );
  const result = await scraper.run(ctx);
  await appendObservations(emitted, { ...ctx, dryRun: false });
  await materializeFromRun(String(scrapeRunId));
  return { result, emitted };
}

describe('center-profile-research-rows end to end (#5386)', { timeout: 120000 }, () => {
  let replSet: MongoMemoryReplSet;
  const personIds = new Map<string, mongoose.Types.ObjectId>();

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
    ]) {
      await db.collection(name).deleteMany({});
    }
    const center = await ResearchEntity.create({
      slug: 'synthetic-council',
      name: 'Synthetic Council',
      kind: 'center',
      entityType: 'CENTER',
      archived: false,
    });
    for (const member of MEMBERS) {
      const person = await Researcher.create({
        displayName: member.displayName,
        profile: { title: member.title },
        ...(member.netid ? { identifiers: { netid: member.netid } } : {}),
      });
      personIds.set(member.key, person._id as mongoose.Types.ObjectId);
      await RoleAssignment.create({
        personId: person._id,
        target: { kind: 'RESEARCH_ENTITY', id: center._id },
        role: 'CORE_FACULTY',
        state: 'CURRENT',
        confidence: 0.8,
        rosterProvenance: {
          sourceName: 'centers-institutes-index',
          sourceUrl: PROFILE_ROOT,
          profileUrl: urlOf(member.key),
          identityBasis: 'identity-evidence',
        },
      });
    }
    const ledLab = await ResearchEntity.create({
      slug: 'emery-fixture-lab',
      name: 'Emery Fixture Lab',
      kind: 'individual',
      entityType: 'LAB',
      archived: false,
    });
    await RoleAssignment.create({
      personId: personIds.get('leads-lab'),
      target: { kind: 'RESEARCH_ENTITY', id: ledLab._id },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
    });
    await ResearchEntity.create({
      slug: 'gray-fixture-synthetic-lab',
      name: 'Gray Fixture',
      kind: 'individual',
      entityType: 'LAB',
      archived: false,
    });
    const inferred = await ResearchEntity.create({
      slug: 'synthetic-inferred-row',
      name: 'Synthetic Inferred Row',
      kind: 'individual',
      entityType: 'LAB',
      archived: false,
    });
    await Observation.create({
      sourceName: 'synthetic-lane',
      sourceId: new mongoose.Types.ObjectId(),
      scrapeRunId: new mongoose.Types.ObjectId(),
      entityType: 'researchEntity',
      entityKey: inferred.slug,
      entityId: inferred._id,
      field: 'inferredPiUserKey',
      value: 'netid:zz0007',
      sourceUrl: 'https://synthetic.example.edu/',
      confidence: 0.7,
      superseded: false,
    });
    await ResearchEntity.create({
      slug: 'faculty-research-area-indigo-fixture-old',
      name: 'Indigo Fixture',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: true,
    });
  });

  it('mints one row for the eligible member, citing their profile and leading it by netid, and refuses every other member', async () => {
    const { result } = await runLane();

    const minted = (await ResearchEntity.find({
      slug: /^faculty-research-area-/,
      archived: { $ne: true },
    }).lean()) as any[];
    expect(minted.map((row) => row.slug)).toEqual(['faculty-research-area-robin-fixture']);
    expect(minted[0].entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(minted[0].sourceUrls).toEqual([urlOf('eligible')]);

    const leads = (await RoleAssignment.find({
      'target.id': minted[0]._id,
      state: { $ne: 'HISTORICAL' },
      archived: { $ne: true },
    }).lean()) as any[];
    expect(leads.map((edge) => String(edge.personId))).toEqual([String(personIds.get('eligible'))]);

    expect(result.notes).toMatch(/1 profile pages unread/);
    expect(result.notes).toMatch(/planned 1, emitting 1/);
    const skipped = JSON.parse(String(result.notes).replace(/^.*skipped /, ''));
    expect(skipped).toMatchObject({
      non_hosting_title: 1,
      no_netid: 1,
      no_profile_text: 1,
      personal_row_for_person: 2,
      row_already_infers_lead: 1,
    });
  });

  it('plans nothing on a second run, so a rerun never mints a duplicate row', async () => {
    await runLane();
    const { result, emitted } = await runLane();
    expect(emitted).toEqual([]);
    expect(result.notes).toMatch(/planned 0, emitting 0/);
    expect(
      await ResearchEntity.countDocuments({ slug: /^faculty-research-area-robin-fixture/ }),
    ).toBe(1);
  });
});
