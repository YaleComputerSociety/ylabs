import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { DirectoryRemoval } from '../../models/directoryRemoval';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { ScrapeRun } from '../../models/scrapeRun';
import { DirectoryRemovalUnavailableError } from '../../services/directoryRemovalMatcher';
import {
  loadDirectoryRemovalMintGuard,
  withDirectoryRemovalMintGuard,
} from '../../services/directoryRemovalMintGuard';
import { findOrCreateForOwner } from '../../services/researchGroupService';
import {
  DIRECTORY_REMOVAL_KEY_ENV,
  directoryRemovalDigest,
  type DirectoryRemovalKind,
} from '../../utils/directoryRemovalDigest';
import {
  adoptUnprovenancedRoleAssignments,
  writeCanonicalMembership,
} from '../canonicalMembershipMaterializer';
import { materializeFromRun } from '../entityMaterializer';
import { appendObservations } from '../observationStore';
import {
  CentersInstitutesScraper,
  type CenterConfig,
  type CenterMember,
} from '../sources/centersInstitutesScraper';
import type { ObservationInput, ScraperContext } from '../types';
import { clearC4Flags } from './c4FlagTestEnv';

const KEY = 'synthetic-directory-removal-key-0123456789';
const SOURCE_NAME = 'centers-institutes-index';
const SOURCE_ID = new mongoose.Types.ObjectId();
const ROSTER_URL = 'https://fixture-center.example.edu/people';

const member = (first: string, role: CenterMember['role'] = 'core-faculty'): CenterMember => ({
  name: `${first} Synthetic`,
  role,
  profileUrl: `https://fixture-center.example.edu/people/${first.toLowerCase()}-synthetic`,
});

const REMOVED = member('Casey');
const ROSTER = [member('Avery', 'director'), member('Blair'), REMOVED, member('Devon')];

const config: CenterConfig = {
  centerKey: 'fixture-synthetic',
  centerName: 'Fixture Synthetic Center',
  schoolName: '',
  kind: 'center',
  url: ROSTER_URL,
  homeUrl: 'https://fixture-center.example.edu/',
  paginated: false,
  extractor: (html: string) => ({ members: JSON.parse(html) as CenterMember[] }),
};

const digest = (kind: DirectoryRemovalKind, value: string) =>
  directoryRemovalDigest(KEY, kind, value)!;

const recordRemoval = (kind: DirectoryRemovalKind, value: string) =>
  DirectoryRemoval.create({ digest: digest(kind, value), kind, recordedAt: new Date() });

const afterAMoment = () => new Promise((resolve) => setTimeout(resolve, 5));

async function appendLaneObservations(): Promise<string> {
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
  await new CentersInstitutesScraper([config], null, async () => JSON.stringify(ROSTER)).run(ctx);
  await appendObservations(emitted, {
    scrapeRunId: String(scrapeRunId),
    sourceId: String(SOURCE_ID),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.8,
    dryRun: false,
  });
  return String(scrapeRunId);
}

const runLane = async () => materializeFromRun(await appendLaneObservations());

const PROFILE_SLUG = 'faculty-research-area-gray-synthetic';
const PROFILE_URL = 'https://example.edu/profile/gray-synthetic';

async function appendFacultyResearchProfileObservations(): Promise<string> {
  await afterAMoment();
  const scrapeRunId = new mongoose.Types.ObjectId();
  await ScrapeRun.create({
    _id: scrapeRunId,
    sourceId: SOURCE_ID,
    sourceName: 'ysm-faculty-directory',
    status: 'running',
  });
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: PROFILE_SLUG,
    sourceUrl: PROFILE_URL,
  };
  const observations: ObservationInput[] = [
    { ...base, field: 'slug', value: PROFILE_SLUG },
    { ...base, field: 'name', value: 'Gray Synthetic Faculty Research' },
    { ...base, field: 'entityType', value: 'FACULTY_RESEARCH_AREA' },
    { ...base, field: 'sourceUrls', value: [PROFILE_URL] },
    { ...base, field: 'inferredPiUserKey', value: 'gray.synthetic@example.edu' },
  ];
  await appendObservations(observations, {
    scrapeRunId: String(scrapeRunId),
    sourceId: String(SOURCE_ID),
    sourceName: 'ysm-faculty-directory',
    sourceWeight: 0.8,
    dryRun: false,
  });
  return String(scrapeRunId);
}

const removalsRefusedMaterializing = async (scrapeRunId: string) =>
  (await materializeFromRun(scrapeRunId)).removedByRequest;

const researchersNamed = (first: string) =>
  Researcher.countDocuments({ displayName: new RegExp(`^${first} Synthetic$`, 'i') });

const edgesFor = async (first: string) => {
  const people = await Researcher.find({ displayName: new RegExp(`^${first} Synthetic$`, 'i') })
    .select('_id')
    .lean();
  const listed = await RoleAssignment.countDocuments({
    'rosterProvenance.profileUrl': member(first).profileUrl,
  });
  const held = await RoleAssignment.countDocuments({
    personId: { $in: people.map((person) => person._id) },
  });
  return listed + held;
};

const rowsNaming = (first: string) =>
  ResearchEntity.countDocuments({ slug: new RegExp(first.toLowerCase()) });

describe(
  'a person removed from the directory is never minted or attached (#4160)',
  { timeout: 120000 },
  () => {
    let replSet: MongoMemoryReplSet;

    beforeAll(async () => {
      replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      await mongoose.connect(replSet.getUri());
      await Observation.syncIndexes();
      await DirectoryRemoval.syncIndexes();
    });

    afterAll(async () => {
      await mongoose.disconnect();
      await replSet?.stop();
    });

    beforeEach(async () => {
      clearC4Flags();
      vi.stubEnv(DIRECTORY_REMOVAL_KEY_ENV, KEY);
      const db = mongoose.connection.db;
      if (!db) throw new Error('no db');
      for (const name of [
        'observations',
        'research_entities',
        'research_entity_relationships',
        'researchers',
        'role_assignments',
        'scrape_runs',
        'directory_removals',
      ]) {
        await db.collection(name).deleteMany({});
      }
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('lists every member while the removal list is empty', async () => {
      const result = await runLane();

      expect(result.removedByRequest).toBe(0);
      expect(await researchersNamed('Casey')).toBe(1);
      expect(await edgesFor('Casey')).toBeGreaterThan(0);
    });

    it('materializes stored evidence of a removed member twice without an edge, a researcher or a profile', async () => {
      const scrapeRunId = await appendLaneObservations();
      await recordRemoval('profile_url', REMOVED.profileUrl!);

      const first = await materializeFromRun(scrapeRunId);
      const second = await materializeFromRun(scrapeRunId);

      expect(first.removedByRequest).toBeGreaterThan(0);
      expect(second.removedByRequest).toBe(first.removedByRequest);
      expect(await researchersNamed('Casey')).toBe(0);
      expect(await edgesFor('Casey')).toBe(0);
      expect(await rowsNaming('casey')).toBe(0);
      expect(await researchersNamed('Blair')).toBe(1);
      expect(await edgesFor('Blair')).toBeGreaterThan(0);
      expect(
        await ResearchEntity.countDocuments({ 'manuallyLockedFields.0': { $exists: true } }),
      ).toBe(0);
      expect(
        await ResearchEntity.countDocuments({ studentVisibilityOverrideTier: { $exists: true } }),
      ).toBe(0);
    });

    it('mints a faculty research profile while its lead is not on the list', async () => {
      expect(
        await removalsRefusedMaterializing(await appendFacultyResearchProfileObservations()),
      ).toBe(0);
      expect(await ResearchEntity.countDocuments({ slug: PROFILE_SLUG })).toBe(1);
    });

    it('never mints the faculty research profile of a removed lead, on any pass', async () => {
      const scrapeRunId = await appendFacultyResearchProfileObservations();
      await recordRemoval('email', 'gray.synthetic@example.edu');

      expect(await removalsRefusedMaterializing(scrapeRunId)).toBe(1);
      expect(await removalsRefusedMaterializing(scrapeRunId)).toBe(1);
      expect(await ResearchEntity.countDocuments({ slug: PROFILE_SLUG })).toBe(0);
    });

    it('mints no faculty research profile for a lead removed before the lane runs', async () => {
      await recordRemoval('email', 'gray.synthetic@example.edu');

      await materializeFromRun(await appendFacultyResearchProfileObservations());

      expect(await Observation.countDocuments({ entityKey: PROFILE_SLUG })).toBe(0);
      expect(await ResearchEntity.countDocuments({ slug: PROFILE_SLUG })).toBe(0);
    });

    it('refuses the whole run when entries exist and no key is configured', async () => {
      await recordRemoval('profile_url', REMOVED.profileUrl!);
      vi.stubEnv(DIRECTORY_REMOVAL_KEY_ENV, '');

      await expect(runLane()).rejects.toThrow(DirectoryRemovalUnavailableError);
      expect(await Researcher.countDocuments({})).toBe(0);
      expect(await RoleAssignment.countDocuments({})).toBe(0);
    });

    describe('canonical membership writes', () => {
      const entityId = () => String(new mongoose.Types.ObjectId());
      const facts = { legacyRole: 'core-faculty', isCurrentMember: true, confidence: 0.9 };

      const writeUnderGuard = async (identity: Record<string, unknown>, profileUrl?: string) => {
        const guard = await loadDirectoryRemovalMintGuard();
        const write = await withDirectoryRemovalMintGuard(
          () =>
            writeCanonicalMembership(
              entityId(),
              {
                ...facts,
                displayName: String(identity.displayName ?? ''),
                ...(profileUrl
                  ? { rosterProvenance: { sourceName: SOURCE_NAME, profileUrl } }
                  : {}),
              },
              identity,
            ),
          guard,
        );
        return { write, refusals: guard.refusals };
      };

      it('still mints and attaches a keyless researcher whose name matches a name entry', async () => {
        await recordRemoval('name', 'Emery Synthetic');

        const { write, refusals } = await writeUnderGuard({ displayName: 'Emery Synthetic' });

        expect(write.outcome).not.toBe('removed_by_request');
        expect(refusals).toBe(0);
        expect(await Researcher.countDocuments({})).toBe(1);
        expect(await RoleAssignment.countDocuments({})).toBe(1);
      });

      it('mints a namesake listed with a profile url of their own', async () => {
        await recordRemoval('name', 'Emery Synthetic');

        const { write, refusals } = await writeUnderGuard(
          { displayName: 'Emery Synthetic' },
          member('Emery').profileUrl,
        );

        expect(write.outcome).toBe('created');
        expect(refusals).toBe(0);
        expect(await Researcher.countDocuments({})).toBe(1);
      });

      it('attaches no edge to an existing researcher whose netid is on the list', async () => {
        const removed = await Researcher.create({
          displayName: 'Finley Synthetic',
          identifiers: { netid: 'zz9101' },
          profileLinks: [],
        });
        await recordRemoval('netid', 'zz9101');

        const { write } = await writeUnderGuard({
          displayName: 'Finley Synthetic',
          resolvedPersonId: removed._id,
        });

        expect(write.outcome).toBe('removed_by_request');
        expect(await RoleAssignment.countDocuments({})).toBe(0);
      });

      it('still attaches a namesake who holds an identity of their own', async () => {
        const namesake = await Researcher.create({
          displayName: 'Emery Synthetic',
          identifiers: { netid: 'zz9102' },
          profileLinks: [],
        });
        await recordRemoval('name', 'Emery Synthetic');

        const { write, refusals } = await writeUnderGuard({
          displayName: 'Emery Synthetic',
          resolvedPersonId: namesake._id,
        });

        expect(write.outcome).toBe('created');
        expect(refusals).toBe(0);
      });

      it("stamps no provenance onto a removed person's existing edges", async () => {
        const removed = await Researcher.create({
          displayName: 'Finley Synthetic',
          identifiers: { netid: 'zz9101' },
          profileLinks: [],
        });
        const target = new mongoose.Types.ObjectId();
        await RoleAssignment.create({
          personId: removed._id,
          target: { kind: 'RESEARCH_ENTITY', id: target },
          role: 'AFFILIATED',
          state: 'CURRENT',
          confidence: 0.8,
          reviewStatus: 'UNREVIEWED',
        });
        await recordRemoval('netid', 'zz9101');

        const adopted = await adoptUnprovenancedRoleAssignments(String(target), {
          personId: removed._id,
          sourceName: SOURCE_NAME,
          listedRole: 'AFFILIATED',
          listedMembershipKey: 'synthetic-membership-key',
          listedObservedAt: new Date(),
          membershipKeyForRole: () => 'synthetic-membership-key',
          adoptedAt: new Date(),
        });

        expect(adopted).toBe(0);
        expect(
          await RoleAssignment.countDocuments({ 'rosterProvenance.sourceName': SOURCE_NAME }),
        ).toBe(0);
      });
    });

    it('creates no faculty research profile for a removed owner', async () => {
      await recordRemoval('netid', 'zz9103');

      const outcome = await findOrCreateForOwner({
        netid: 'zz9103',
        fname: 'Gray',
        lname: 'Synthetic',
      });

      expect(outcome).toEqual({ group: null, created: false, refused: 'removed_by_request' });
      expect(await ResearchEntity.countDocuments({})).toBe(0);
      expect(await Researcher.countDocuments({})).toBe(0);
      expect(await RoleAssignment.countDocuments({})).toBe(0);
    });
  },
);
