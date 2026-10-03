import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import {
  BBS_TRACK_RESTATED_CLAIM_REASON,
  reconcileBbsTrackRetirementsFromRun,
} from '../bbsTrackRosterRetirement';
import { materializeEntity } from '../entityMaterializer';
import { BBS_TRACKS } from '../sources/bbsResearchTrackScraper';

let memoryReplSet: MongoMemoryReplSet | undefined;
const sourceId = new mongoose.Types.ObjectId();
const RETIRED_COMPOUND_LABEL = 'Molecular Medicine, Pharmacology & Physiology';
const profileUrl = (slug: string) => `https://medicine.yale.edu/bbs/profile/${slug}/`;

const seedClaim = async (input: {
  entityId: mongoose.Types.ObjectId;
  profileSlug: string;
  value: string[];
}) =>
  Observation.create({
    entityType: 'researchEntity',
    entityId: input.entityId,
    field: 'researchAreas',
    sourceId,
    sourceName: 'bbs-research-track',
    sourceUrl: profileUrl(input.profileSlug),
    value: input.value,
    confidence: 0.7,
    superseded: false,
    scrapeRunId: new mongoose.Types.ObjectId(),
    observedAt: new Date('2026-09-26T00:00:00Z'),
  });

const seedRead = async (input: {
  runId: mongoose.Types.ObjectId;
  members: Record<string, Array<{ profileSlug: string; rowId?: string }>>;
  skipTrack?: string;
}) => {
  for (const track of BBS_TRACKS) {
    if (track.slug === input.skipTrack) continue;
    const listed = input.members[track.slug] ?? [{ profileSlug: `synthetic-filler-${track.slug}` }];
    await Observation.create({
      entityType: 'centerRosterHealth',
      entityKey: track.slug,
      field: 'centerRosterHealth',
      sourceId,
      sourceName: 'bbs-research-track',
      scrapeRunId: input.runId,
      observedAt: new Date('2026-10-03T00:00:00Z'),
      confidence: 0.7,
      superseded: false,
      value: {
        centerKey: track.slug,
        entityKey: track.slug,
        status: 'ok',
        complete: true,
        claimEntityKeysRecorded: true,
        discoveredCount: listed.length,
        members: listed.map((member) => ({
          memberKey: member.profileSlug,
          role: 'track-pi',
          ...(member.rowId ? { claimEntityKey: member.rowId } : {}),
        })),
        read: {
          pagesRead: 1,
          readMode: 'html',
          cacheAllowed: false,
          stopReason: 'not-paginated',
          readAt: '2026-10-03T00:00:00.000Z',
        },
      },
    });
  }
};

describe('BBS retires a claim the listing restates for a PI it could not resolve (#3834)', () => {
  beforeAll(async () => {
    memoryReplSet = await MongoMemoryReplSet.create({
      binary: { version: '8.0.12' },
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await mongoose.connect(memoryReplSet.getUri('bbs_restated_claim_test'));
  });

  afterEach(async () => {
    await Observation.deleteMany({});
    await ResearchEntity.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryReplSet?.stop();
  });

  const deps = {
    rematerializeResearchEntity: async (identifier: { entityId?: string; entityKey?: string }) => {
      await materializeEntity('researchEntity', identifier);
    },
  };

  async function seedScenario() {
    const staleRow = await ResearchEntity.create({
      slug: 'synthetic-stale-lab',
      name: 'Synthetic Stale Lab',
    });
    const currentRow = await ResearchEntity.create({
      slug: 'synthetic-current-lab',
      name: 'Synthetic Current Lab',
    });
    const resolvedRow = await ResearchEntity.create({
      slug: 'synthetic-resolved-lab',
      name: 'Synthetic Resolved Lab',
    });
    const stale = await seedClaim({
      entityId: staleRow._id as mongoose.Types.ObjectId,
      profileSlug: 'synthetic-unresolved-pi',
      value: [RETIRED_COMPOUND_LABEL],
    });
    const current = await seedClaim({
      entityId: currentRow._id as mongoose.Types.ObjectId,
      profileSlug: 'synthetic-current-pi',
      value: ['Molecular Medicine', 'Pharmacology', 'Physiology'],
    });
    const resolved = await seedClaim({
      entityId: resolvedRow._id as mongoose.Types.ObjectId,
      profileSlug: 'synthetic-resolved-pi',
      value: ['Immunology'],
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityId: staleRow._id,
      field: 'name',
      sourceId,
      sourceName: 'ysm-atoz-index',
      value: 'Synthetic Stale Lab',
      confidence: 0.9,
      superseded: false,
      observedAt: new Date('2026-09-26T00:00:00Z'),
    });
    await materializeEntity('researchEntity', { entityId: String(staleRow._id) });
    const projected = (await ResearchEntity.findById(staleRow._id).lean()) as {
      researchAreas?: string[];
    } | null;
    expect(projected?.researchAreas).toContain(RETIRED_COMPOUND_LABEL);
    const members = {
      m2p2: [{ profileSlug: 'synthetic-unresolved-pi' }, { profileSlug: 'synthetic-current-pi' }],
      immunology: [{ profileSlug: 'synthetic-resolved-pi', rowId: String(resolvedRow._id) }],
    };
    return { staleRow, stale, current, resolved, members };
  }

  it('retires the stale claim on a complete read and leaves claims the listing still supports', async () => {
    const { staleRow, stale, current, resolved, members } = await seedScenario();
    const runId = new mongoose.Types.ObjectId();
    await seedRead({ runId, members });

    const result = await reconcileBbsTrackRetirementsFromRun(String(runId), deps, {});

    expect(result.counts?.restatedClaims).toBe(1);
    const retired = await Observation.findById(stale._id).lean();
    expect(retired?.superseded).toBe(true);
    expect(JSON.stringify(retired)).toContain(BBS_TRACK_RESTATED_CLAIM_REASON);
    expect((await Observation.findById(current._id).lean())?.superseded).not.toBe(true);
    expect((await Observation.findById(resolved._id).lean())?.superseded).not.toBe(true);
    const reprojected = (await ResearchEntity.findById(staleRow._id).lean()) as {
      researchAreas?: string[];
    } | null;
    expect(reprojected?.researchAreas ?? []).not.toContain(RETIRED_COMPOUND_LABEL);
  });

  it('restates nothing from a read that missed a track', async () => {
    const { stale, members } = await seedScenario();
    const runId = new mongoose.Types.ObjectId();
    await seedRead({ runId, members, skipTrack: 'bbsb' });

    const result = await reconcileBbsTrackRetirementsFromRun(String(runId), deps, {});

    expect(result.counts?.restatedClaims ?? 0).toBe(0);
    expect((await Observation.findById(stale._id).lean())?.superseded).not.toBe(true);
  });
});
