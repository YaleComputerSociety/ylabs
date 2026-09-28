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

import { Account } from '../../models/account';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { ResearchEntityRelationship } from '../../models/researchEntityRelationship';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { ScrapeRun } from '../../models/scrapeRun';
import { getResearchGroupDetail } from '../../services/researchGroupService';
import {
  applyCenterRosterRetirementPlan,
  CENTER_ROSTER_RETIREMENT_REASON,
  type CenterRosterGovernedObservation,
  type CenterRosterRetirementPlan,
} from '../centerRosterRetirement';
import { materializeEntity, materializeFromRun } from '../entityMaterializer';
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

const member = (first: string, role: CenterMember['role'] = 'core-faculty'): CenterMember => ({
  name: `${first} Synthetic`,
  role,
  profileUrl: `https://fixture-center.example.edu/people/${first.toLowerCase()}-synthetic`,
});

const ROSTER = [
  member('Avery', 'director'),
  member('Blair'),
  member('Casey'),
  member('Devon'),
  member('Emery'),
  member('Finley'),
];

const config = (overrides: Partial<CenterConfig> = {}): CenterConfig => ({
  centerKey: 'fixture-synthetic',
  centerName: 'Fixture Synthetic Center',
  schoolName: '',
  kind: 'center',
  url: ROSTER_URL,
  homeUrl: HOME_URL,
  paginated: false,
  extractor: (html: string) => ({ members: JSON.parse(html) as CenterMember[] }),
  ...overrides,
});

type Page = CenterMember[] | Error;

const fetcherFor =
  (pages: Page[]): HtmlFetcher =>
  async (url: string) => {
    const pageIndex = Number(new URL(url).searchParams.get('page') || '0');
    const page = pages[pageIndex] ?? [];
    if (page instanceof Error) throw page;
    return JSON.stringify(page);
  };

const notFound = (): Error =>
  Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } });

const afterAMoment = () => new Promise((resolve) => setTimeout(resolve, 5));

async function runLane(
  pages: Page[],
  options: { config?: CenterConfig; useCache?: boolean } = {},
): Promise<string> {
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
    options: { dryRun: false, useCache: options.useCache === true, release: false },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: () => {},
  };
  await new CentersInstitutesScraper([options.config ?? config()], null, fetcherFor(pages)).run(
    ctx,
  );
  await appendObservations(emitted, {
    scrapeRunId: String(scrapeRunId),
    sourceId: String(SOURCE_ID),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.8,
    dryRun: false,
  });
  await materializeFromRun(String(scrapeRunId));
  return String(scrapeRunId);
}

const centerId = async () => {
  const entity = (await ResearchEntity.findOne({ slug: CENTER_SLUG }).select('_id').lean()) as any;
  return entity._id;
};

const edgesFor = async (first: string) => {
  const edges = (await RoleAssignment.find({ 'target.id': await centerId() }).lean()) as any[];
  return edges.filter((edge) =>
    String(edge.rosterProvenance?.membershipKey || '').includes(
      `/${first.toLowerCase()}-synthetic|`,
    ),
  );
};

const currentEdges = async (first: string) =>
  (await edgesFor(first)).filter((edge) => edge.state !== 'HISTORICAL' && edge.archived !== true);

const servedMemberNames = async (): Promise<string[]> => {
  await ResearchEntity.updateOne(
    { slug: CENTER_SLUG },
    {
      $set: {
        studentVisibilityTier: 'student_ready',
        fullDescription:
          'The center convenes faculty who study synthetic fixtures and the methods used to test them.',
      },
    },
  );
  const detail = await getResearchGroupDetail(CENTER_SLUG);
  if (!detail) throw new Error('the fixture center is not served');
  return (detail?.members ?? [])
    .map((entry: any) => String(entry.user?.displayName || ''))
    .filter(Boolean)
    .sort();
};

const withoutMember = (first: string) => ROSTER.filter((entry) => !entry.name.startsWith(first));

describe(
  'centers-institutes-index retires members its complete roster reads stop listing (#3781)',
  { timeout: 120000 },
  () => {
    let replSet: MongoMemoryReplSet;

    beforeAll(async () => {
      replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      await mongoose.connect(replSet.getUri());
      await Observation.syncIndexes();
    }, 60000);

    afterAll(async () => {
      await mongoose.disconnect();
      await replSet.stop();
    });

    beforeEach(async () => {
      clearC4Flags();
      gateMocks.gateChangesNothing = false;
      meiliMocks.syncEntities.mockReset();
      meiliMocks.syncEntities.mockImplementation(async () => {});
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
    });

    it('keeps a member one complete read omits and retires it after the second', async () => {
      await runLane([ROSTER]);
      expect(await currentEdges('Finley')).toHaveLength(1);

      await runLane([withoutMember('Finley')]);
      expect(await currentEdges('Finley')).toHaveLength(1);

      await runLane([withoutMember('Finley')]);
      expect(await currentEdges('Finley')).toHaveLength(0);
      expect((await edgesFor('Finley'))[0]).toMatchObject({ state: 'HISTORICAL' });
      expect(await currentEdges('Blair')).toHaveLength(1);

      const retired = (await Observation.find({
        entityKey: {
          $regex: '^center-fixture-synthetic:(finley-synthetic|faculty-research-area-finley)',
        },
      }).lean()) as any[];
      expect(retired.length).toBeGreaterThan(0);
      for (const row of retired) {
        expect(row.superseded).toBe(true);
        expect(row.rollback?.reason).toBe(CENTER_ROSTER_RETIREMENT_REASON);
      }

      const served = await servedMemberNames();
      expect(served.some((name) => name.startsWith('Finley'))).toBe(false);
      expect(served.some((name) => name.startsWith('Blair'))).toBe(true);
    });

    it('does not resurrect a retired member on the next materialization or run', async () => {
      await runLane([ROSTER]);
      await runLane([withoutMember('Finley')]);
      await runLane([withoutMember('Finley')]);
      expect(await currentEdges('Finley')).toHaveLength(0);

      const result = await materializeEntity('researchGroupMember', {
        entityKey: `${CENTER_SLUG}:finley-synthetic`,
      });
      expect(result.fieldsWritten).toBe(0);
      await materializeEntity('researchEntity', { entityKey: CENTER_SLUG });
      await runLane([withoutMember('Finley')]);
      expect(await currentEdges('Finley')).toHaveLength(0);
    });

    it('revives a retired member only when a later read lists it again', async () => {
      await runLane([ROSTER]);
      await runLane([withoutMember('Finley')]);
      await runLane([withoutMember('Finley')]);
      expect(await currentEdges('Finley')).toHaveLength(0);

      await runLane([ROSTER]);
      expect(await currentEdges('Finley')).toHaveLength(1);
    });

    it('ends a stale lead edge once two complete reads list the person under another role', async () => {
      await runLane([ROSTER]);
      expect((await currentEdges('Avery')).map((edge) => edge.role)).toEqual(['DIRECTOR']);

      const demoted = [member('Avery'), ...ROSTER.slice(1)];
      await runLane([demoted]);
      expect((await currentEdges('Avery')).map((edge) => edge.role)).toContain('DIRECTOR');

      await runLane([demoted]);
      expect((await currentEdges('Avery')).map((edge) => edge.role)).toEqual(['CORE_FACULTY']);
      const director = (await edgesFor('Avery')).find((edge) => edge.role === 'DIRECTOR');
      expect(director).toMatchObject({ state: 'HISTORICAL' });
    });

    it('re-syncs the center search document after the retirement ends its edges', async () => {
      await runLane([ROSTER]);
      await runLane([withoutMember('Finley')]);
      const currentFinleyEdgesAtEachCenterSync: number[] = [];
      meiliMocks.syncEntities.mockImplementation(async (...args: unknown[]) => {
        const docs = args[1] as Array<{ slug?: unknown }>;
        if (docs.some((doc) => doc?.slug === CENTER_SLUG)) {
          currentFinleyEdgesAtEachCenterSync.push((await currentEdges('Finley')).length);
        }
      });

      gateMocks.gateChangesNothing = true;
      await runLane([withoutMember('Finley')]);
      gateMocks.gateChangesNothing = false;

      expect(await currentEdges('Finley')).toHaveLength(0);
      expect(currentFinleyEdgesAtEachCenterSync.at(-1)).toBe(0);
    });

    it('keeps the edge of a member still listed under a changed profile URL', async () => {
      const moved = {
        ...ROSTER[1],
        profileUrl: 'https://fixture-center.example.edu/faculty/blair-synthetic',
      };
      const rosterWithMovedProfile = [ROSTER[0], moved, ...ROSTER.slice(2)];
      await runLane([ROSTER]);
      await runLane([rosterWithMovedProfile]);
      await runLane([rosterWithMovedProfile]);

      const current = await currentEdges('Blair');
      expect(current.map((edge) => edge.role)).toEqual(['CORE_FACULTY']);
      expect(current[0].rosterProvenance.membershipKey).toContain('/faculty/blair-synthetic|');

      await runLane([rosterWithMovedProfile]);
      expect((await currentEdges('Blair')).map((edge) => edge.role)).toEqual(['CORE_FACULTY']);
    });

    it('keeps a relationship whose target a key this source still lists resolves to', async () => {
      await runLane([ROSTER]);
      const centerEntityId = String(await centerId());
      const { _id: _centerObjectId, ...centerFields } = (await ResearchEntity.findById(
        await centerId(),
      ).lean()) as any;
      const target = await ResearchEntity.create({
        ...centerFields,
        name: 'Synthetic Fixture Lab',
        slug: 'synthetic-fixture-lab',
      });
      const targetId = String(target._id);
      const relationship = await ResearchEntityRelationship.create({
        sourceResearchEntityId: await centerId(),
        targetResearchEntityId: target._id,
        relationshipType: 'AFFILIATED_LAB',
      });
      const targetClaim = (
        entityKey: string,
        value: string,
        superseded = false,
      ): CenterRosterGovernedObservation => ({
        observationId: String(new mongoose.Types.ObjectId()),
        entityKey,
        field: 'targetEntityKey',
        value,
        scrapeRunId: String(new mongoose.Types.ObjectId()),
        observedAt: new Date(),
        superseded,
      });
      const plan: CenterRosterRetirementPlan = {
        entityKey: CENTER_SLUG,
        verdict: 'retire',
        retiredMemberKeys: [],
        retiredRoleClaims: [],
        retiredProfileClaims: [],
        retiredRelationshipKeys: [`${CENTER_SLUG}:old-spelling`],
        retiredEdges: [],
        observationIds: [],
        counts: {} as CenterRosterRetirementPlan['counts'],
      };
      const deps = {
        membershipKeysAssertedByOtherSources: async () => new Set<string>(),
        personRolesAssertedByOtherSources: async () => new Set<string>(),
        relationshipTargetIdsAssertedByOtherSources: async () => new Set<string>(),
        resolveRelationshipTargetId: async () => targetId,
        rematerializeMemberKey: async () => {},
      };
      const inputs = (relationshipObservations: CenterRosterGovernedObservation[]) => ({
        centerEntityId,
        reads: [],
        memberObservations: [],
        relationshipObservations,
        edges: [],
        protectedMembershipKeys: new Set<string>(),
        protectedPersonRoles: new Set<string>(),
      });
      const isArchived = async () =>
        ((await ResearchEntityRelationship.findById(relationship._id).lean()) as any).archived ===
        true;

      await applyCenterRosterRetirementPlan(
        plan,
        inputs([
          targetClaim(`${CENTER_SLUG}:old-spelling`, 'old-spelling-target'),
          targetClaim(`${CENTER_SLUG}:new-spelling`, 'new-spelling-target'),
        ]),
        deps,
        new Date(),
      );
      expect(await isArchived()).toBe(false);

      await applyCenterRosterRetirementPlan(
        plan,
        inputs([
          targetClaim(`${CENTER_SLUG}:old-spelling`, 'old-spelling-target'),
          targetClaim(`${CENTER_SLUG}:new-spelling`, 'new-spelling-target', true),
        ]),
        deps,
        new Date(),
      );
      expect(await isArchived()).toBe(true);
    });

    it('retires nothing when the later reads fail with a 404, a fetch error, or an under-read', async () => {
      await runLane([ROSTER]);
      await runLane([notFound()]);
      await runLane([new Error('socket hang up')]);
      const paged = config({ paginated: true });
      await runLane([withoutMember('Finley'), notFound()], { config: paged });
      await runLane([withoutMember('Finley'), notFound()], { config: paged });

      for (const first of ['Avery', 'Blair', 'Casey', 'Devon', 'Emery', 'Finley']) {
        expect(await currentEdges(first)).toHaveLength(1);
      }
      expect(
        await Observation.countDocuments({ 'rollback.reason': CENTER_ROSTER_RETIREMENT_REASON }),
      ).toBe(0);
    });

    it('retires nothing from an empty page, a refused roster, or cache-permitted reads', async () => {
      await runLane([ROSTER]);
      await runLane([[]]);
      await runLane([[]]);
      const refused = config({ url: 'https://another-center.example.edu/people' });
      await runLane([withoutMember('Finley')], { config: refused });
      await runLane([withoutMember('Finley')], { config: refused });
      await runLane([withoutMember('Finley')], { useCache: true });
      await runLane([withoutMember('Finley')], { useCache: true });

      expect(await currentEdges('Finley')).toHaveLength(1);
      expect(
        await Observation.countDocuments({ 'rollback.reason': CENTER_ROSTER_RETIREMENT_REASON }),
      ).toBe(0);
    });

    it('freezes the center when the reads would retire most of what it governs', async () => {
      await runLane([ROSTER]);
      await runLane([ROSTER.slice(0, 2)]);
      await runLane([ROSTER.slice(0, 2)]);

      for (const first of ['Casey', 'Devon', 'Emery', 'Finley']) {
        expect(await currentEdges(first)).toHaveLength(1);
      }
      expect(
        await Observation.countDocuments({ 'rollback.reason': CENTER_ROSTER_RETIREMENT_REASON }),
      ).toBe(0);
    });

    it('leaves a lead another source still names, and edges another source wrote', async () => {
      await appendObservations(
        [
          { field: 'inferredDirectorName', value: 'Avery Synthetic' },
          { field: 'inferredDirectorUserName', value: { fname: 'Avery', lname: 'Synthetic' } },
          { field: 'inferredDirectorRole', value: 'director' },
          { field: 'inferredDirectorProfileUrl', value: ROSTER[0].profileUrl },
        ].map((row) => ({
          entityType: 'researchEntity' as const,
          entityKey: CENTER_SLUG,
          sourceUrl: `${HOME_URL}leadership`,
          ...row,
        })),
        {
          scrapeRunId: String(new mongoose.Types.ObjectId()),
          sourceId: String(new mongoose.Types.ObjectId()),
          sourceName: 'center-director-llm',
          sourceWeight: 0.8,
          dryRun: false,
        },
      );
      await runLane([ROSTER]);
      const otherPerson = new mongoose.Types.ObjectId();
      await RoleAssignment.create({
        personId: otherPerson,
        target: { kind: 'RESEARCH_ENTITY', id: await centerId() },
        role: 'CO_DIRECTOR',
        state: 'UNKNOWN',
        confidence: 0.8,
        reviewStatus: 'UNREVIEWED',
        archived: false,
        rosterProvenance: {
          sourceName: 'center-director-llm',
          membershipKey:
            'official-profile:https://fixture-center.example.edu/people/other|co-director',
          observedAt: new Date(Date.now() - 1000),
        },
      });

      await runLane([withoutMember('Avery')]);
      await runLane([withoutMember('Avery')]);

      const directors = (await RoleAssignment.find({
        'target.id': await centerId(),
        role: 'DIRECTOR',
        state: { $ne: 'HISTORICAL' },
      }).lean()) as any[];
      expect(directors).toHaveLength(1);
      const foreign = (await RoleAssignment.findOne({ personId: otherPerson }).lean()) as any;
      expect(foreign.state).toBe('UNKNOWN');
    });
  },
);

describe(
  'centers-institutes-index adopts provenance-less edges of the people it lists (#3799)',
  { timeout: 120000 },
  () => {
    let replSet: MongoMemoryReplSet;

    beforeAll(async () => {
      replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      await mongoose.connect(replSet.getUri());
      await Observation.syncIndexes();
    }, 60000);

    afterAll(async () => {
      await mongoose.disconnect();
      await replSet.stop();
    });

    beforeEach(async () => {
      clearC4Flags();
      gateMocks.gateChangesNothing = false;
      meiliMocks.syncEntities.mockReset();
      meiliMocks.syncEntities.mockImplementation(async () => {});
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
    });

    const LONG_AGO = new Date('2026-01-15T00:00:00Z');

    const accountHolder = async (first: string, profileUrl?: string) => {
      const netid = `${first.toLowerCase()}syn`;
      const account = await Account.create({
        netid,
        email: `${netid}@fixture.example.edu`,
        status: 'UNKNOWN',
        archived: false,
      });
      const researcher = await Researcher.create({
        displayName: `${first} Synthetic`,
        accountId: account._id,
        profileLinks: [],
        archived: false,
        ...(profileUrl ? { profile: { websiteUrl: profileUrl } } : {}),
      });
      return researcher._id as mongoose.Types.ObjectId;
    };

    const listedAccountHolder = (first: string) => accountHolder(first, member(first).profileUrl);

    const unprovenancedEdge = async (
      personId: mongoose.Types.ObjectId,
      role: string,
      rosterProvenance?: Record<string, unknown>,
    ) =>
      (
        await RoleAssignment.create({
          personId,
          target: { kind: 'RESEARCH_ENTITY', id: await centerId() },
          role,
          state: 'UNKNOWN',
          confidence: 0.5,
          reviewStatus: 'UNREVIEWED',
          archived: false,
          startedAt: LONG_AGO,
          ...(rosterProvenance ? { rosterProvenance } : {}),
        })
      )._id;

    const edge = async (id: unknown) => (await RoleAssignment.findById(id).lean()) as any;

    const personEdges = async (personId: mongoose.Types.ObjectId) =>
      (await RoleAssignment.find({ personId, 'target.id': await centerId() }).lean()) as any[];

    const seedCenterWithoutAnAdmittedRead = (roster: CenterMember[] = ROSTER) =>
      runLane([roster], { useCache: true });

    it("adopts a listed person's edge of an unlisted role and ends it after two complete reads", async () => {
      const blair = await listedAccountHolder('Blair');
      await seedCenterWithoutAnAdmittedRead();
      const stale = await unprovenancedEdge(blair, 'DIRECTOR');

      await runLane([ROSTER]);
      const adopted = await edge(stale);
      expect(adopted.state).toBe('UNKNOWN');
      expect(adopted.rosterProvenance).toMatchObject({
        sourceName: SOURCE_NAME,
        membershipKey: `official-profile:${member('Blair').profileUrl}|director`,
      });
      expect(adopted.rosterProvenance.adoptedAt).toBeInstanceOf(Date);
      expect(adopted.rosterProvenance.observedAt.getTime()).toBe(LONG_AGO.getTime());

      await runLane([ROSTER]);
      expect((await edge(stale)).state).toBe('HISTORICAL');
      const current = (await personEdges(blair)).filter((row) => row.state !== 'HISTORICAL');
      expect(current.map((row) => row.role)).toEqual(['CORE_FACULTY']);
    });

    it("adopts a listed person's edge of the listed role in place, without a second edge", async () => {
      const casey = await listedAccountHolder('Casey');
      await seedCenterWithoutAnAdmittedRead(withoutMember('Casey'));
      const existing = await unprovenancedEdge(casey, 'CORE_FACULTY');

      await runLane([ROSTER]);
      const edges = await personEdges(casey);
      expect(edges).toHaveLength(1);
      expect(String(edges[0]._id)).toBe(String(existing));
      expect(edges[0].rosterProvenance).toMatchObject({
        sourceName: SOURCE_NAME,
        membershipKey: `official-profile:${member('Casey').profileUrl}|core-faculty`,
      });

      await runLane([withoutMember('Casey')]);
      expect((await edge(existing)).state).not.toBe('HISTORICAL');
      await runLane([withoutMember('Casey')]);
      expect((await edge(existing)).state).toBe('HISTORICAL');
    });

    it('adopts nothing for a person the roster does not list, or a namesake it cannot resolve', async () => {
      const unlisted = await accountHolder('Gale');
      const namesake = await accountHolder('Devon');
      await seedCenterWithoutAnAdmittedRead();
      const unlistedEdge = await unprovenancedEdge(unlisted, 'CORE_FACULTY');
      const namesakeEdge = await unprovenancedEdge(namesake, 'DIRECTOR');

      await runLane([ROSTER]);
      await runLane([ROSTER]);
      await runLane([ROSTER]);

      for (const id of [unlistedEdge, namesakeEdge]) {
        const row = await edge(id);
        expect(row.rosterProvenance?.sourceName).toBeUndefined();
        expect(row.state).toBe('UNKNOWN');
      }
    });

    it('adopts nothing when the listing writes for a namesake rather than its profile researcher', async () => {
      const namesake = (
        await Researcher.create({
          displayName: member('Emery').name,
          profileLinks: [],
          archived: false,
        })
      )._id as mongoose.Types.ObjectId;
      await seedCenterWithoutAnAdmittedRead();
      await Researcher.create({
        displayName: member('Emery').name,
        profileLinks: [],
        archived: false,
        profile: { websiteUrl: member('Emery').profileUrl },
      });
      const namesakeEdge = await unprovenancedEdge(namesake, 'DIRECTOR');

      await runLane([ROSTER]);
      await runLane([ROSTER]);

      const row = await edge(namesakeEdge);
      expect(row.rosterProvenance?.sourceName).toBeUndefined();
      expect(row.state).toBe('UNKNOWN');
    });

    it('leaves an edge another source wrote for a listed person untouched', async () => {
      const blair = await listedAccountHolder('Blair');
      await seedCenterWithoutAnAdmittedRead();
      const foreign = await unprovenancedEdge(blair, 'DIRECTOR', {
        sourceName: 'nsf-award-search',
        observedAt: LONG_AGO,
      });

      await runLane([ROSTER]);
      await runLane([ROSTER]);
      await runLane([ROSTER]);

      const row = await edge(foreign);
      expect(row.state).toBe('UNKNOWN');
      expect(row.rosterProvenance.sourceName).toBe('nsf-award-search');
      expect(row.rosterProvenance.membershipKey).toBeUndefined();
    });

    it('adopts a lead edge on the already-lead path and then serves the person once, under the listed role', async () => {
      const blair = await listedAccountHolder('Blair');
      await seedCenterWithoutAnAdmittedRead(withoutMember('Blair'));
      const stale = await unprovenancedEdge(blair, 'DIRECTOR');
      await RoleAssignment.updateOne({ _id: stale }, { $set: { state: 'CURRENT' } });

      await runLane([ROSTER]);
      const adopted = await edge(stale);
      expect(adopted.rosterProvenance).toMatchObject({
        sourceName: SOURCE_NAME,
        membershipKey: `official-profile:${member('Blair').profileUrl}|director`,
      });
      expect(adopted.rosterProvenance.observedAt.getTime()).toBe(LONG_AGO.getTime());
      expect((await personEdges(blair)).map((row) => row.role)).toEqual(['DIRECTOR']);

      await runLane([ROSTER]);
      expect((await edge(stale)).state).toBe('HISTORICAL');

      await runLane([ROSTER]);
      const current = (await personEdges(blair)).filter((row) => row.state !== 'HISTORICAL');
      expect(current.map((row) => row.role)).toEqual(['CORE_FACULTY']);
      const served = await servedMemberNames();
      expect(served.filter((name) => name === member('Blair').name)).toHaveLength(1);
    });

    it("leaves a listed person's provenance-less edge on another entity untouched", async () => {
      const blair = await listedAccountHolder('Blair');
      await seedCenterWithoutAnAdmittedRead();
      const elsewhere = (
        await RoleAssignment.create({
          personId: blair,
          target: { kind: 'RESEARCH_ENTITY', id: new mongoose.Types.ObjectId() },
          role: 'DIRECTOR',
          state: 'UNKNOWN',
          confidence: 0.5,
          reviewStatus: 'UNREVIEWED',
          archived: false,
          startedAt: LONG_AGO,
        })
      )._id;

      await runLane([ROSTER]);
      await runLane([ROSTER]);
      await runLane([ROSTER]);

      const row = await edge(elsewhere);
      expect(row.rosterProvenance?.sourceName).toBeUndefined();
      expect(row.state).toBe('UNKNOWN');
    });

    it('freezes the center when adopted edges would make most of what it governs retire', async () => {
      const people = [];
      for (const entry of ROSTER) {
        people.push(await listedAccountHolder(entry.name.split(' ')[0]));
      }
      await seedCenterWithoutAnAdmittedRead();
      const adopted = [];
      for (const personId of people) {
        adopted.push(await unprovenancedEdge(personId, 'PI'));
        adopted.push(await unprovenancedEdge(personId, 'STAFF'));
      }

      await runLane([ROSTER]);
      await runLane([ROSTER]);
      await runLane([ROSTER]);

      for (const id of adopted) {
        const row = await edge(id);
        expect(row.rosterProvenance.sourceName).toBe(SOURCE_NAME);
        expect(row.state).toBe('UNKNOWN');
      }
    });
  },
);
