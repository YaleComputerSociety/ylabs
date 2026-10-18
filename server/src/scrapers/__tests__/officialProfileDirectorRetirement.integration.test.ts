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
    deleteFromIndex: vi.fn().mockResolvedValue(undefined),
  };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { centerRosterRetirementDeps, materializeEntity } from '../entityMaterializer';
import {
  OFFICIAL_PROFILE_DIRECTOR_LANE,
  reconcileOfficialProfileDirectorRetirementsFromRun,
} from '../officialProfileDirectorRetirement';
import {
  organizationDirectorObservations,
  organizationDirectorReadSnapshot,
  readOrganizationDirectorProfile,
  selectOrganizationDirectorProfileTargets,
} from '../sources/officialProfilePiBackfillScraper';

const SOURCE_NAME = 'official-profile-pi-backfill';
const PROFILE_URL = 'https://medicine.yale.edu/profile/rowan-fixturedirector/';
const OTHER_PROFILE_URL = 'https://medicine.yale.edu/profile/quill-fixturecolleague/';
const PROGRAM_URL = 'https://medicine.yale.edu/psychiatry/research/fixture-mood/';
const ORGANIZATION_SLUG = 'fixturedirector-lab-rf12';

const profileHtml = (url: string, name: string, body: string) => `
  <html><head>
    <title>${name} | Yale School of Medicine</title>
    <link rel="canonical" href="${url}" />
  </head>
  <body><main>
    <h1>${name}</h1>
    ${body}
    <a href="${PROGRAM_URL}">Visit Website</a>
  </main></body></html>`;

const STATES = profileHtml(
  PROFILE_URL,
  'Rowan Fixturedirector',
  '<p>Professor of Psychiatry; Director, Fixture Mood Research Program</p>',
);
const NO_LONGER_STATES = profileHtml(
  PROFILE_URL,
  'Rowan Fixturedirector',
  '<p>Professor of Psychiatry; former Director, Fixture Mood Research Program</p>',
);
const PLACEHOLDER = `<html><head><title>Page Not Found | Yale School of Medicine</title></head>
  <body><main><h1>Page Not Found</h1><p>The page you requested could not be found.</p></main></body></html>`;
const OTHER_PROFILE = profileHtml(
  OTHER_PROFILE_URL,
  'Quill Fixturecolleague',
  '<p>Professor of Psychiatry</p>',
);

type ReadKind =
  'states' | 'absent' | 'failed' | 'cached' | 'other-profile' | 'refused' | 'placeholder';

describe('a profile-stated organization director retires when its profile stops stating it (#5091)', () => {
  let replSet: MongoMemoryReplSet;
  let clock: number;
  const deps = centerRosterRetirementDeps({}, OFFICIAL_PROFILE_DIRECTOR_LANE);

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'researchers', 'research_entities', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
    clock = Date.parse('2026-10-17T00:00:00Z');
  });

  const tick = () => new Date((clock += 60 * 60 * 1000));

  async function seedDirectedOrganization() {
    const organization = await ResearchEntity.create({
      slug: ORGANIZATION_SLUG,
      name: 'Fixture Mood Research Program',
      entityType: 'INITIATIVE',
      kind: 'initiative',
      websiteUrl: PROGRAM_URL,
      sourceUrls: [PROFILE_URL, PROGRAM_URL],
      archived: false,
    });
    await Researcher.create({
      displayName: 'Rowan Fixturedirector',
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: PROFILE_URL,
          verifiedAt: new Date('2026-01-01T00:00:00Z'),
          healthStatus: 'UNKNOWN',
        },
      ],
      status: 'UNKNOWN',
      archived: false,
    });
    const target = organization.toObject();
    const read = readOrganizationDirectorProfile(STATES, PROFILE_URL, target);
    const runId = new mongoose.Types.ObjectId();
    const observedAt = tick();
    for (const observation of organizationDirectorObservations(target, read.claim!)) {
      await Observation.create({
        ...observation,
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: SOURCE_NAME,
        scrapeRunId: runId,
        confidence: 0.9,
        observedAt,
        superseded: false,
      });
    }
    await materializeEntity('researchGroupMember', {
      entityKey: `${ORGANIZATION_SLUG}:rowan-fixturedirector`,
    });
    return target;
  }

  async function recordRun(organization: Record<string, any>, kind: ReadKind) {
    const runId = new mongoose.Types.ObjectId();
    const [target] = await selectOrganizationDirectorProfileTargets(10);
    expect(String(target?._id)).toBe(String(organization._id));
    const html =
      kind === 'states'
        ? STATES
        : kind === 'other-profile'
          ? OTHER_PROFILE
          : kind === 'refused'
            ? NO_LONGER_STATES.replace(PROFILE_URL, OTHER_PROFILE_URL)
            : kind === 'placeholder'
              ? PLACEHOLDER
              : NO_LONGER_STATES;
    const reads =
      kind === 'failed'
        ? []
        : [
            readOrganizationDirectorProfile(
              html,
              kind === 'other-profile' ? OTHER_PROFILE_URL : PROFILE_URL,
              target,
            ),
          ];
    const snapshot = organizationDirectorReadSnapshot({
      organization: target,
      reads,
      pagesRead: reads.length,
      cacheAllowed: kind === 'cached',
      readAt: new Date(clock),
      sourceUrl: PROFILE_URL,
    });
    await Observation.create({
      ...snapshot!,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: SOURCE_NAME,
      scrapeRunId: runId,
      confidence: 0.9,
      observedAt: tick(),
      superseded: false,
    });
    return reconcileOfficialProfileDirectorRetirementsFromRun(String(runId), deps);
  }

  const liveDirectorEdges = () =>
    RoleAssignment.find({
      'rosterProvenance.sourceName': SOURCE_NAME,
      role: 'DIRECTOR',
      state: { $ne: 'HISTORICAL' },
      archived: { $ne: true },
    }).lean();

  it('re-selects a row whose lead is the director this mode recorded', async () => {
    const organization = await seedDirectedOrganization();
    expect(await liveDirectorEdges()).toHaveLength(1);

    const [target] = await selectOrganizationDirectorProfileTargets(10);

    expect(String(target?._id)).toBe(String(organization._id));
    expect(target?.heldDirectorNames).toEqual(['Rowan Fixturedirector']);
  });

  it('ends the edge after two complete reads in distinct runs no longer state it', async () => {
    const organization = await seedDirectedOrganization();

    const first = await recordRun(organization, 'absent');
    expect(first).toEqual(expect.objectContaining({ retiredEdges: 0, edgesAwaitingSecondRead: 1 }));
    expect(await liveDirectorEdges()).toHaveLength(1);

    const second = await recordRun(organization, 'absent');
    expect(second).toEqual(expect.objectContaining({ retiredEdges: 1, frozen: false }));
    expect(await liveDirectorEdges()).toEqual([]);
    const ended = await RoleAssignment.findOne({ 'rosterProvenance.sourceName': SOURCE_NAME });
    expect(ended?.state).toBe('HISTORICAL');
    expect(ended?.endedAt).toBeInstanceOf(Date);
    const liveMemberObservations = await Observation.countDocuments({
      entityType: 'researchGroupMember',
      sourceName: SOURCE_NAME,
      superseded: false,
    });
    expect(liveMemberObservations).toBe(0);
    const organizationRow = await ResearchEntity.findById(organization._id).lean();
    expect(organizationRow?.manuallyLockedFields ?? []).toEqual([]);
  });

  it('re-attaches the director when a later read states the role again', async () => {
    const organization = await seedDirectedOrganization();
    await recordRun(organization, 'absent');
    await recordRun(organization, 'absent');
    expect(await liveDirectorEdges()).toEqual([]);

    const [target] = await selectOrganizationDirectorProfileTargets(10);
    expect(String(target?._id)).toBe(String(organization._id));
    const read = readOrganizationDirectorProfile(STATES, PROFILE_URL, target);
    const observedAt = tick();
    for (const observation of organizationDirectorObservations(target, read.claim!)) {
      await Observation.create({
        ...observation,
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: SOURCE_NAME,
        scrapeRunId: new mongoose.Types.ObjectId(),
        confidence: 0.9,
        observedAt,
        superseded: false,
      });
    }
    await materializeEntity('researchGroupMember', {
      entityKey: `${ORGANIZATION_SLUG}:rowan-fixturedirector`,
    });

    expect(await liveDirectorEdges()).toHaveLength(1);
  });

  it('keeps the edge after a single absent read', async () => {
    const organization = await seedDirectedOrganization();

    await recordRun(organization, 'absent');

    expect(await liveDirectorEdges()).toHaveLength(1);
  });

  it('keeps the edge while the profile still states the directorship', async () => {
    const organization = await seedDirectedOrganization();

    await recordRun(organization, 'states');
    const result = await recordRun(organization, 'states');

    expect(result).toEqual(expect.objectContaining({ retiredEdges: 0, statedEdges: 1 }));
    expect(await liveDirectorEdges()).toHaveLength(1);
  });

  it('restarts the count when a read between two absences states it again', async () => {
    const organization = await seedDirectedOrganization();

    await recordRun(organization, 'absent');
    await recordRun(organization, 'states');
    await recordRun(organization, 'absent');

    expect(await liveDirectorEdges()).toHaveLength(1);
  });

  it.each<ReadKind>(['failed', 'cached', 'other-profile', 'refused', 'placeholder'])(
    'never counts a %s read as an absence',
    async (kind) => {
      const organization = await seedDirectedOrganization();

      await recordRun(organization, 'absent');
      await recordRun(organization, kind);
      await recordRun(organization, kind);

      expect(await liveDirectorEdges()).toHaveLength(1);
    },
  );

  it('plans without writing on a dry run', async () => {
    const organization = await seedDirectedOrganization();
    await recordRun(organization, 'absent');

    const runId = new mongoose.Types.ObjectId();
    const [target] = await selectOrganizationDirectorProfileTargets(10);
    const snapshot = organizationDirectorReadSnapshot({
      organization: target,
      reads: [readOrganizationDirectorProfile(NO_LONGER_STATES, PROFILE_URL, target)],
      pagesRead: 1,
      cacheAllowed: false,
      readAt: new Date(clock),
      sourceUrl: PROFILE_URL,
    });
    await Observation.create({
      ...snapshot!,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: SOURCE_NAME,
      scrapeRunId: runId,
      confidence: 0.9,
      observedAt: tick(),
      superseded: false,
    });
    const result = await reconcileOfficialProfileDirectorRetirementsFromRun(String(runId), deps, {
      dryRun: true,
    });

    expect(result).toEqual(expect.objectContaining({ dryRun: true, retiredEdges: 1 }));
    expect(await liveDirectorEdges()).toHaveLength(1);
  });
});
