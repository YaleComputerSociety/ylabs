import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

vi.mock('../../services/meiliSyncService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/meiliSyncService')>()),
  deleteFromIndex: vi.fn(async () => undefined),
}));

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { loadRunRosterPresence } from '../facultyRosterDepartureReconciler';
import {
  ROSTER_MINT_WITHDRAWAL_ARCHIVE_REASON,
  reconcileRosterMintWithdrawalsFromRun,
} from '../rosterMintWithdrawal';

let memoryReplSet: MongoMemoryReplSet | undefined;
const sourceId = new mongoose.Types.ObjectId();
const DEPT_KEY = 'synthetic-studies';

const seedRead = async (options: {
  runId: mongoose.Types.ObjectId;
  observedAt: Date;
  discovered: string[];
  withdrawn: string[];
  profilesRead?: number;
}) =>
  Observation.create({
    entityType: 'departmentRosterHealth',
    entityKey: DEPT_KEY,
    field: 'departmentRosterHealth',
    sourceId,
    sourceName: 'dept-faculty-roster',
    scrapeRunId: options.runId,
    observedAt: options.observedAt,
    confidence: 0.7,
    superseded: false,
    value: {
      deptKey: DEPT_KEY,
      deptName: 'Synthetic Studies',
      status: 'ok',
      complete: true,
      discoveredCount: options.discovered.length,
      discoveredEntityKeys: options.discovered,
      mintWithdrawalRecorded: true,
      withdrawnEntityKeys: options.withdrawn,
      profilesRead: options.profilesRead ?? options.discovered.length + options.withdrawn.length,
      read: {
        pagesRead: 1,
        readMode: 'html',
        cacheAllowed: false,
        readAt: options.observedAt.toISOString(),
      },
    },
  });

const seedLaneRow = async (slug: string, fields: Record<string, unknown> = {}) => {
  const row = await ResearchEntity.create({
    slug,
    name: `${slug} Faculty Research`,
    entityType: 'FACULTY_RESEARCH_AREA',
    studentVisibilityTier: 'operator_review',
    ...fields,
  });
  await Observation.create({
    entityType: 'researchEntity',
    entityKey: slug,
    field: 'slug',
    value: slug,
    sourceId,
    sourceName: 'dept-faculty-roster',
    confidence: 0.7,
    superseded: false,
    observedAt: new Date('2026-08-28T00:00:00Z'),
  });
  return row;
};

const firstRun = new mongoose.Types.ObjectId();
const secondRun = new mongoose.Types.ObjectId();
const firstAt = new Date('2026-10-20T00:00:00Z');
const secondAt = new Date('2026-10-21T00:00:00Z');
const listedSlugs = Array.from(
  { length: 8 },
  (_unused, index) => `dept-synthetic-studies-listed-${index}`,
);

describe('roster mint withdrawal', () => {
  beforeAll(async () => {
    memoryReplSet = await MongoMemoryReplSet.create({
      binary: { version: '8.0.12' },
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await mongoose.connect(memoryReplSet.getUri('roster_mint_withdrawal_test'));
  });

  afterEach(async () => {
    await Observation.deleteMany({});
    await ResearchEntity.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryReplSet?.stop();
  });

  it('archives a bare row after two reads and keeps rows other evidence holds up', async () => {
    for (const slug of listedSlugs) await seedLaneRow(slug);
    const bare = await seedLaneRow('dept-synthetic-studies-bare');
    const described = await seedLaneRow('dept-synthetic-studies-described', {
      fullDescription: 'Studies synthetic systems and their failure modes.',
    });
    const served = await seedLaneRow('dept-synthetic-studies-served', {
      studentVisibilityTier: 'student_ready',
    });
    const foreign = await seedLaneRow('dept-synthetic-studies-foreign');
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: foreign.slug,
      field: 'researchAreas',
      value: ['Synthetic Systems'],
      sourceId,
      sourceName: 'research-area-source-extractor',
      confidence: 0.7,
      superseded: false,
      observedAt: firstAt,
    });
    const bookkeepingOnly = await seedLaneRow('dept-synthetic-studies-bookkeeping');
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: bookkeepingOnly.slug,
      field: 'lanePageHealth',
      value: { status: 'ok' },
      sourceId,
      sourceName: 'lab-microsite-description-llm',
      confidence: 0.7,
      superseded: false,
      observedAt: firstAt,
    });
    const withdrawn = [bare, described, served, foreign, bookkeepingOnly].map((row) => row.slug);
    await seedRead({ runId: firstRun, observedAt: firstAt, discovered: listedSlugs, withdrawn });

    const afterOneRead = await reconcileRosterMintWithdrawalsFromRun(String(firstRun));
    expect(afterOneRead.counts.archived).toBe(0);
    expect(afterOneRead.counts.awaitingSecondRead).toBe(5);

    await seedRead({ runId: secondRun, observedAt: secondAt, discovered: listedSlugs, withdrawn });
    const plan = await reconcileRosterMintWithdrawalsFromRun(String(secondRun), { dryRun: true });
    expect(plan.counts.archived).toBe(2);
    expect(await ResearchEntity.countDocuments({ archived: true })).toBe(0);

    const applied = await reconcileRosterMintWithdrawalsFromRun(String(secondRun));
    expect(applied.counts.archived).toBe(2);
    expect(applied.counts.keptByReason).toEqual({
      served: 1,
      has_description: 1,
      observation_from_another_lane: 1,
    });
    const archived = await ResearchEntity.find({ archived: true })
      .select('slug archivedReason')
      .lean();
    expect(archived.map((row) => row.slug).sort()).toEqual(
      [bare.slug, bookkeepingOnly.slug].sort(),
    );
    expect(
      archived.every((row) => row.archivedReason === ROSTER_MINT_WITHDRAWAL_ARCHIVE_REASON),
    ).toBe(true);
    expect(await ResearchEntity.countDocuments({ _id: served._id, archived: { $ne: true } })).toBe(
      1,
    );
    expect(
      await ResearchEntity.countDocuments({ _id: described._id, archived: { $ne: true } }),
    ).toBe(1);
  });

  it('freezes a department whose profile reads collapsed', async () => {
    for (const slug of listedSlugs) await seedLaneRow(slug);
    const bare = await seedLaneRow('dept-synthetic-studies-bare');
    await seedRead({
      runId: firstRun,
      observedAt: firstAt,
      discovered: listedSlugs,
      withdrawn: [bare.slug],
      profilesRead: 100,
    });
    await seedRead({
      runId: secondRun,
      observedAt: secondAt,
      discovered: listedSlugs,
      withdrawn: [bare.slug],
      profilesRead: 20,
    });
    const result = await reconcileRosterMintWithdrawalsFromRun(String(secondRun));
    expect(result.departments[0].verdict).toBe('yield-regressed');
    expect(await ResearchEntity.countDocuments({ archived: true })).toBe(0);
  });

  it('freezes a pass that would withdraw most of what the read reached', async () => {
    const rows = [];
    for (let index = 0; index < 4; index += 1) {
      rows.push(await seedLaneRow(`dept-synthetic-studies-empty-${index}`));
    }
    const withdrawn = rows.map((row) => row.slug);
    const listed = [listedSlugs[0]];
    await seedLaneRow(listedSlugs[0]);
    await seedRead({ runId: firstRun, observedAt: firstAt, discovered: listed, withdrawn });
    await seedRead({ runId: secondRun, observedAt: secondAt, discovered: listed, withdrawn });
    const result = await reconcileRosterMintWithdrawalsFromRun(String(secondRun));
    expect(result.departments[0].verdict).toBe('withdrawal-above-ceiling');
    expect(await ResearchEntity.countDocuments({ archived: true })).toBe(0);
  });

  it('withdraws nothing when the earlier read still minted the row', async () => {
    for (const slug of listedSlugs) await seedLaneRow(slug);
    const bare = await seedLaneRow('dept-synthetic-studies-bare');
    await seedRead({
      runId: firstRun,
      observedAt: firstAt,
      discovered: [...listedSlugs, bare.slug],
      withdrawn: [],
    });
    await seedRead({
      runId: secondRun,
      observedAt: secondAt,
      discovered: listedSlugs,
      withdrawn: [bare.slug],
    });
    const result = await reconcileRosterMintWithdrawalsFromRun(String(secondRun));
    expect(result.counts.archived).toBe(0);
    expect(result.counts.awaitingSecondRead).toBe(1);
  });

  it('restores a withdrawn row when a later read mints it again', async () => {
    for (const slug of listedSlugs) await seedLaneRow(slug);
    const bare = await seedLaneRow('dept-synthetic-studies-bare', {
      archived: true,
      archivedReason: ROSTER_MINT_WITHDRAWAL_ARCHIVE_REASON,
    });
    await seedRead({
      runId: secondRun,
      observedAt: secondAt,
      discovered: [...listedSlugs, bare.slug],
      withdrawn: [],
    });
    const rematerialized: string[] = [];
    const result = await reconcileRosterMintWithdrawalsFromRun(
      String(secondRun),
      {},
      { rematerializeResearchEntity: async (entityKey) => void rematerialized.push(entityKey) },
    );
    expect(result.counts.restored).toBe(1);
    expect(rematerialized).toEqual([bare.slug]);
    expect(await ResearchEntity.countDocuments({ _id: bare._id, archived: false })).toBe(1);
  });

  it('counts a withdrawn mint as still listed for the departure lane', async () => {
    const snapshot = await seedRead({
      runId: secondRun,
      observedAt: secondAt,
      discovered: [listedSlugs[0]],
      withdrawn: ['dept-synthetic-studies-bare'],
    });
    const present = await loadRunRosterPresence(secondRun, [snapshot.toObject()]);
    expect(present.has('dept-synthetic-studies-bare')).toBe(true);
  });
});
