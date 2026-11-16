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
import {
  approvalsFromCenterPlanReport,
  endRosterListingEdges,
  newCenterPlanGuard,
  type CenterPlanGuard,
  type CenterPlanReport,
} from '../centerPlanGuard';
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
const GROWING = 'growing-synthetic';
const SHRINKING = 'shrinking-synthetic';

const centerConfig = (key: string): CenterConfig => ({
  centerKey: key,
  centerName: `Fixture ${key} Center`,
  schoolName: '',
  kind: 'center',
  url: `https://${key}.example.edu/people`,
  homeUrl: `https://${key}.example.edu/`,
  paginated: false,
  extractor: (html: string) => ({ members: JSON.parse(html) as CenterMember[] }),
});

const member = (
  key: string,
  first: string,
  role: CenterMember['role'] = 'core-faculty',
): CenterMember => ({
  name: `${first} Synthetic`,
  role,
  profileUrl: `https://${key}.example.edu/people/${first.toLowerCase()}-synthetic`,
});

const alumnus = (key: string, first: string): CenterMember => ({
  ...member(key, first),
  sections: [{ label: 'Alumni', kind: 'past' }],
});

const afterAMoment = () => new Promise((resolve) => setTimeout(resolve, 5));

async function scrapeRun(rosters: Record<string, CenterMember[]>): Promise<string> {
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
  const fetcher: HtmlFetcher = async (url: string) =>
    JSON.stringify(rosters[new URL(url).hostname.split('.')[0]] ?? []);
  await new CentersInstitutesScraper(Object.keys(rosters).map(centerConfig), null, fetcher).run(
    ctx,
  );
  await appendObservations(emitted, {
    scrapeRunId: String(scrapeRunId),
    sourceId: String(SOURCE_ID),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.8,
    dryRun: false,
  });
  return String(scrapeRunId);
}

const scrapeAndApply = async (rosters: Record<string, CenterMember[]>) =>
  materializeFromRun(await scrapeRun(rosters));

/**
 * Three reads of a center whose stored edges freeze the third read's dry-run plan (three of
 * four edges departed) while the apply's projection adds five listings first, which lifts the
 * freeze (three of nine).
 */
const growingRosters = [
  ['Avery', 'Blair', 'Casey', 'Devon'].map((first, index) =>
    member(GROWING, first, index === 0 ? 'director' : 'core-faculty'),
  ),
  [
    member(GROWING, 'Avery', 'director'),
    ...['Blair', 'Casey', 'Devon'].map((first) => alumnus(GROWING, first)),
  ],
  [
    member(GROWING, 'Avery', 'director'),
    ...['Blair', 'Casey', 'Devon'].map((first) => alumnus(GROWING, first)),
    ...['Emery', 'Finley', 'Gale', 'Harper', 'Indy'].map((first) => member(GROWING, first)),
  ],
];

/** Three reads of a center that lists one of six people as an alumnus twice: a stable plan. */
const shrinkingRosters = [
  ['Jordan', 'Kai', 'Logan', 'Morgan', 'Noel', 'Oakley'].map((first, index) =>
    member(SHRINKING, first, index === 0 ? 'director' : 'core-faculty'),
  ),
  [
    ...['Jordan', 'Kai', 'Logan', 'Morgan', 'Noel'].map((first, index) =>
      member(SHRINKING, first, index === 0 ? 'director' : 'core-faculty'),
    ),
    alumnus(SHRINKING, 'Oakley'),
  ],
];
shrinkingRosters.push(shrinkingRosters[1]);

const centerId = async (key: string) =>
  (
    (await ResearchEntity.findOne({ slug: `center-${key}` })
      .select('_id')
      .lean()) as any
  )._id;

const liveEdges = async (key: string, first: string) =>
  (await RoleAssignment.find({
    'target.id': await centerId(key),
    'rosterProvenance.membershipKey': {
      $regex: `/${first.toLowerCase()}-synthetic\\|`,
    },
    state: { $ne: 'HISTORICAL' },
    archived: { $ne: true },
  }).lean()) as any[];

async function dryRunPlan(runId: string): Promise<CenterPlanReport> {
  const planned = await materializeFromRun(runId, {
    dryRun: true,
    centerPlanGuard: newCenterPlanGuard('plan'),
  });
  if (!planned.centerPlan) throw new Error('the dry run wrote no centerPlan section');
  return JSON.parse(JSON.stringify(planned.centerPlan)) as CenterPlanReport;
}

const enforcedApply = (runId: string, guard: CenterPlanGuard) =>
  materializeFromRun(runId, { centerPlanGuard: guard });

const retirementOf = (report: CenterPlanReport | undefined, key: string) =>
  report?.centers
    .find((center) => center.entityKey === `center-${key}`)
    ?.retirement.find((entry) => entry.lane === SOURCE_NAME);

describe(
  'a center roster apply carries out only the plan its dry run approved (#6348)',
  { timeout: 180000 },
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
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(console, 'info').mockImplementation(() => undefined);
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

    it('skips a center whose freeze the projection lifts and keeps its edges', async () => {
      await scrapeAndApply({ [GROWING]: growingRosters[0] });
      await scrapeAndApply({ [GROWING]: growingRosters[1] });
      const runId = await scrapeRun({ [GROWING]: growingRosters[2] });

      const plan = await dryRunPlan(runId);
      expect(retirementOf(plan, GROWING)?.digest).toMatchObject({
        verdict: 'frozen',
        freezeReason: 'edge-absence-above-ceiling',
      });

      const applied = await enforcedApply(
        runId,
        newCenterPlanGuard('enforce', approvalsFromCenterPlanReport(plan, runId)),
      );

      const growing = retirementOf(applied.centerPlan, GROWING);
      expect(growing?.planDiverged).toBe(true);
      expect(growing?.digest.verdict).toBe('retire');
      for (const first of ['Blair', 'Casey', 'Devon']) {
        expect(await liveEdges(GROWING, first)).toHaveLength(1);
      }
      expect(await liveEdges(GROWING, 'Indy')).toHaveLength(1);
    });

    it('retires exactly the approved edges when the post-projection plan matches', async () => {
      await scrapeAndApply({ [SHRINKING]: shrinkingRosters[0] });
      await scrapeAndApply({ [SHRINKING]: shrinkingRosters[1] });
      const runId = await scrapeRun({ [SHRINKING]: shrinkingRosters[2] });
      const [oakleyEdge] = await liveEdges(SHRINKING, 'Oakley');

      const plan = await dryRunPlan(runId);
      const approved = retirementOf(plan, SHRINKING)?.digest;
      expect(approved).toMatchObject({
        verdict: 'retire',
        retiredEdgeIds: [String(oakleyEdge._id)],
      });

      const applied = await enforcedApply(
        runId,
        newCenterPlanGuard('enforce', approvalsFromCenterPlanReport(plan, runId)),
      );

      const shrinking = retirementOf(applied.centerPlan, SHRINKING);
      expect(shrinking?.planDiverged).toBeUndefined();
      expect(shrinking?.digest).toEqual(approved);
      expect(await liveEdges(SHRINKING, 'Oakley')).toHaveLength(0);
      for (const first of ['Jordan', 'Kai', 'Logan', 'Morgan', 'Noel']) {
        expect(await liveEdges(SHRINKING, first)).toHaveLength(1);
      }
    });

    it('plans no superseded-holder ending for a steady name-only roster re-projected unchanged', async () => {
      await scrapeAndApply({ [SHRINKING]: shrinkingRosters[0] });
      const runId = await scrapeRun({ [SHRINKING]: shrinkingRosters[0] });

      const plan = await dryRunPlan(runId);

      const endings =
        plan.centers.find((center) => center.entityKey === `center-${SHRINKING}`)
          ?.projectionEndings ?? [];
      expect(endings.filter((ending) => ending.reason === 'superseded-listing-holder')).toEqual([]);
    });

    it('lets a matching center retire while a diverged one in the same run is skipped', async () => {
      await scrapeAndApply({ [GROWING]: growingRosters[0], [SHRINKING]: shrinkingRosters[0] });
      await scrapeAndApply({ [GROWING]: growingRosters[1], [SHRINKING]: shrinkingRosters[1] });
      const runId = await scrapeRun({
        [GROWING]: growingRosters[2],
        [SHRINKING]: shrinkingRosters[2],
      });

      const plan = await dryRunPlan(runId);
      const applied = await enforcedApply(
        runId,
        newCenterPlanGuard('enforce', approvalsFromCenterPlanReport(plan, runId)),
      );

      expect(retirementOf(applied.centerPlan, GROWING)?.planDiverged).toBe(true);
      expect(retirementOf(applied.centerPlan, SHRINKING)?.planDiverged).toBeUndefined();
      for (const first of ['Blair', 'Casey', 'Devon']) {
        expect(await liveEdges(GROWING, first)).toHaveLength(1);
      }
      expect(await liveEdges(SHRINKING, 'Oakley')).toHaveLength(0);
      expect(await liveEdges(SHRINKING, 'Noel')).toHaveLength(1);
    });

    it('retires nothing for a center the approved plan does not name, and reports it plan-diverged', async () => {
      await scrapeAndApply({ [SHRINKING]: shrinkingRosters[0] });
      await scrapeAndApply({ [SHRINKING]: shrinkingRosters[1] });
      const runId = await scrapeRun({ [SHRINKING]: shrinkingRosters[2] });
      const plan = await dryRunPlan(runId);
      expect(retirementOf(plan, SHRINKING)?.digest.verdict).toBe('retire');
      const withoutTheCenter: CenterPlanReport = {
        ...plan,
        centers: plan.centers.filter((center) => center.entityKey !== `center-${SHRINKING}`),
      };

      const applied = await enforcedApply(
        runId,
        newCenterPlanGuard('enforce', approvalsFromCenterPlanReport(withoutTheCenter, runId)),
      );

      expect(retirementOf(applied.centerPlan, SHRINKING)?.planDiverged).toBe(true);
      expect(await liveEdges(SHRINKING, 'Oakley')).toHaveLength(1);
    });

    it('ends only the approved edge when one ending filter matches an approved and an unapproved edge', async () => {
      const target = new mongoose.Types.ObjectId();
      const membershipKey = 'fixture-synthetic-identity|core-faculty';
      const edge = (role: string) =>
        RoleAssignment.create({
          personId: new mongoose.Types.ObjectId(),
          target: { kind: 'RESEARCH_ENTITY', id: target },
          role,
          state: 'CURRENT',
          confidence: 0.8,
          reviewStatus: 'UNREVIEWED',
          schemaVersion: 1,
          archived: false,
          rosterProvenance: { sourceName: SOURCE_NAME, membershipKey },
        });
      const approvedEdge = await edge('CORE_FACULTY');
      const unapprovedEdge = await edge('DIRECTOR');
      const guard = newCenterPlanGuard('enforce', {
        approvedProjectionEndings: new Map([
          ['center-fixture', new Set([String(approvedEdge._id)])],
        ]),
        approvedRetirementDigests: new Map(),
      });

      const ended = await endRosterListingEdges(
        {
          'target.id': target,
          'rosterProvenance.membershipKey': membershipKey,
          state: { $ne: 'HISTORICAL' },
        },
        { state: 'HISTORICAL', endedAt: new Date() },
        'superseded-listing-holder',
        { guard, centerEntityKey: 'center-fixture' },
      );

      expect(ended).toBe(1);
      expect(((await RoleAssignment.findById(approvedEdge._id).lean()) as any).state).toBe(
        'HISTORICAL',
      );
      expect(((await RoleAssignment.findById(unapprovedEdge._id).lean()) as any).state).toBe(
        'CURRENT',
      );
      expect(guard.skippedProjectionEndings.map((ending) => ending.edgeId)).toEqual([
        String(unapprovedEdge._id),
      ]);
    });

    describe('write-path endings a dry run plans', () => {
      const plannedEdgeIds = (report: CenterPlanReport | undefined, key: string, reason: string) =>
        (
          report?.centers.find((center) => center.entityKey === `center-${key}`)
            ?.projectionEndings ?? []
        )
          .filter((ending) => ending.reason === reason)
          .map((ending) => ending.edgeId);

      const stateOf = async (edgeId: unknown) =>
        ((await RoleAssignment.findById(edgeId).lean()) as any).state;

      it('plans the other-screened-role ending that the apply then ends under the plan', async () => {
        const SCREENED = 'screened-synthetic';
        await scrapeAndApply({ [SCREENED]: [member(SCREENED, 'Logan')] });
        const [facultyEdge] = await liveEdges(SCREENED, 'Logan');
        expect(facultyEdge.role).toBe('CORE_FACULTY');
        const runId = await scrapeRun({
          [SCREENED]: [{ ...member(SCREENED, 'Logan'), title: 'Program Coordinator' }],
        });

        const plan = await dryRunPlan(runId);
        expect(plannedEdgeIds(plan, SCREENED, 'other-screened-role')).toEqual([
          String(facultyEdge._id),
        ]);
        expect(await stateOf(facultyEdge._id)).not.toBe('HISTORICAL');

        const applied = await enforcedApply(
          runId,
          newCenterPlanGuard('enforce', approvalsFromCenterPlanReport(plan, runId)),
        );

        expect(await stateOf(facultyEdge._id)).toBe('HISTORICAL');
        expect(plannedEdgeIds(applied.centerPlan, SCREENED, 'other-screened-role')).toEqual([
          String(facultyEdge._id),
        ]);
      });

      it('plans the superseded-holder ending that the apply then ends after its resolved write', async () => {
        const DRIFTED = 'drifted-synthetic';
        await scrapeAndApply({ [DRIFTED]: [member(DRIFTED, 'Kai')] });
        const [earlierEdge] = await liveEdges(DRIFTED, 'Kai');
        await Researcher.updateOne(
          { _id: earlierEdge.personId },
          { $set: { displayName: 'Kai R. Synthetic' } },
        );
        const runId = await scrapeRun({ [DRIFTED]: [member(DRIFTED, 'Kai')] });

        const plan = await dryRunPlan(runId);
        expect(plannedEdgeIds(plan, DRIFTED, 'superseded-listing-holder')).toEqual([
          String(earlierEdge._id),
        ]);

        const applied = await enforcedApply(
          runId,
          newCenterPlanGuard('enforce', approvalsFromCenterPlanReport(plan, runId)),
        );

        expect(await stateOf(earlierEdge._id)).toBe('HISTORICAL');
        expect(plannedEdgeIds(applied.centerPlan, DRIFTED, 'superseded-listing-holder')).toEqual([
          String(earlierEdge._id),
        ]);
        const [currentEdge] = await liveEdges(DRIFTED, 'Kai');
        expect(String(currentEdge.personId)).not.toBe(String(earlierEdge.personId));
      });
    });

    describe('projection endings', () => {
      const SHARED = 'shared-synthetic';
      const SHARED_URL = `https://${SHARED}.example.edu/people/avery-synthetic`;
      const listing = (): CenterMember => ({
        name: 'Avery Synthetic',
        role: 'core-faculty',
        profileUrl: SHARED_URL,
      });
      const holdUrl = (displayName: string) =>
        Researcher.create({ displayName, profile: { websiteUrl: SHARED_URL } });

      /**
       * A listing whose profile URL a second researcher also holds, under a name the listing
       * vetoes, so the projection ends that holder's edge under the listing's key (#5582). The
       * holder's edge is a DIRECTOR edge, a lead.
       */
      async function vetoedLeadScenario() {
        const avery = await holdUrl('Avery Synthetic');
        await scrapeAndApply({ [SHARED]: [listing()] });
        const averyEdge = (await RoleAssignment.findOne({
          personId: avery._id,
          'rosterProvenance.sourceName': SOURCE_NAME,
        }).lean()) as any;
        const blair = await holdUrl('Blair Synthetic');
        const blairEdge = await RoleAssignment.create({
          personId: blair._id,
          target: { kind: 'RESEARCH_ENTITY', id: await centerId(SHARED) },
          role: 'DIRECTOR',
          state: 'CURRENT',
          confidence: 0.8,
          reviewStatus: 'UNREVIEWED',
          schemaVersion: 1,
          archived: false,
          rosterProvenance: {
            sourceName: SOURCE_NAME,
            profileUrl: SHARED_URL,
            membershipKey: averyEdge.rosterProvenance.membershipKey,
          },
        });
        const runId = await scrapeRun({ [SHARED]: [listing()] });
        return { runId, averyEdgeId: String(averyEdge._id), blairEdgeId: String(blairEdge._id) };
      }

      const stateOf = async (edgeId: string) =>
        ((await RoleAssignment.findById(edgeId).lean()) as any).state;

      const centerEntry = (report: CenterPlanReport | undefined) =>
        report?.centers.find((center) => center.entityKey === `center-${SHARED}`);

      it('lists the endings a dry run would make, edge ids included, and writes nothing', async () => {
        const { runId, averyEdgeId, blairEdgeId } = await vetoedLeadScenario();
        const historicalBefore = await RoleAssignment.countDocuments({ state: 'HISTORICAL' });

        const plan = await dryRunPlan(runId);

        expect(centerEntry(plan)?.projectionEndings).toEqual([
          {
            edgeId: blairEdgeId,
            role: 'DIRECTOR',
            lead: true,
            reason: 'misattributed-profile-url-holder',
          },
        ]);
        expect(await stateOf(blairEdgeId)).toBe('CURRENT');
        expect(await stateOf(averyEdgeId)).not.toBe('HISTORICAL');
        expect(await RoleAssignment.countDocuments({ state: 'HISTORICAL' })).toBe(historicalBefore);
      });

      it('ends an approved projection ending', async () => {
        const { runId, averyEdgeId, blairEdgeId } = await vetoedLeadScenario();
        const plan = await dryRunPlan(runId);

        const applied = await enforcedApply(
          runId,
          newCenterPlanGuard('enforce', approvalsFromCenterPlanReport(plan, runId)),
        );

        expect(await stateOf(blairEdgeId)).toBe('HISTORICAL');
        expect(await stateOf(averyEdgeId)).not.toBe('HISTORICAL');
        expect(centerEntry(applied.centerPlan)?.projectionEndings.map((e) => e.edgeId)).toEqual([
          blairEdgeId,
        ]);
        expect(centerEntry(applied.centerPlan)?.skippedProjectionEndings).toBeUndefined();
      });

      it('skips and reports a lead edge ending the approved plan does not list', async () => {
        const { runId, averyEdgeId, blairEdgeId } = await vetoedLeadScenario();
        const plan = await dryRunPlan(runId);
        const withoutTheLead: CenterPlanReport = {
          ...plan,
          centers: plan.centers.map((center) => ({
            ...center,
            projectionEndings: center.projectionEndings.filter(
              (ending) => ending.edgeId !== blairEdgeId,
            ),
          })),
        };

        const applied = await enforcedApply(
          runId,
          newCenterPlanGuard('enforce', approvalsFromCenterPlanReport(withoutTheLead, runId)),
        );

        expect(await stateOf(blairEdgeId)).toBe('CURRENT');
        expect(await stateOf(averyEdgeId)).not.toBe('HISTORICAL');
        expect(centerEntry(applied.centerPlan)?.skippedProjectionEndings).toEqual([
          {
            edgeId: blairEdgeId,
            role: 'DIRECTOR',
            lead: true,
            reason: 'misattributed-profile-url-holder',
          },
        ]);
      });
    });
  },
);
