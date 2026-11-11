import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Observation } from '../../models/observation';
import { ScrapeRun } from '../../models/scrapeRun';
import { Source } from '../../models/source';
import {
  CONFIRM_FLAG,
  parseRetireOrphanedLaneConfigsArgs,
  runOrphanedLaneConfigRetirement,
} from '../retireOrphanedLaneConfigs';
import type {
  LaneConfigRefPresence,
  OrphanLaneDefinition,
  RequestedLaneConfig,
} from '../retireOrphanedLaneConfigsCore';

const ROSTER = 'dept-faculty-roster';
const LANES: OrphanLaneDefinition[] = [
  {
    sourceName: ROSTER,
    currentConfigIds: ['chem', 'paused-lane'],
    currentKeyNamespaces: ['chem', 'paused-lane'],
    keyNamespaceOf: (configId) => configId,
  },
];
const PENDING_ON_BRANCH: LaneConfigRefPresence[] = [
  { sourceName: ROSTER, configId: 'pending-lane', refs: ['repo#refs/heads/feat/pending-lane'] },
];

const gone: RequestedLaneConfig = { sourceName: ROSTER, configId: 'gone-lane' };
const paused: RequestedLaneConfig = { sourceName: ROSTER, configId: 'paused-lane' };
const pending: RequestedLaneConfig = { sourceName: ROSTER, configId: 'pending-lane' };

const LANDED_SHA = 'b'.repeat(40);

let sourceId: mongoose.Types.ObjectId;
const runIds: Record<string, mongoose.Types.ObjectId> = {};

const seedRun = async (name: string, only: string[], codeSha?: string) => {
  const run = await ScrapeRun.create({
    sourceId,
    sourceName: ROSTER,
    startedAt: new Date('2026-05-22T00:00:00Z'),
    status: 'success',
    options: only.length > 0 ? { only } : {},
    ...(codeSha ? { codeSha } : {}),
  });
  runIds[name] = run._id as mongoose.Types.ObjectId;
};

const seed = (entityKey: string, field: string, run: string) =>
  Observation.create({
    entityType:
      entityKey.startsWith('dept:') || entityKey.startsWith('netid:') ? 'user' : 'researchEntity',
    entityKey,
    field,
    value: `${field}-value`,
    sourceId,
    sourceName: ROSTER,
    scrapeRunId: runIds[run],
    confidence: 0.8,
    observedAt: new Date('2026-05-22T00:00:00Z'),
    superseded: false,
  });

const liveIds = async () =>
  (
    await Observation.find({ superseded: { $ne: true } })
      .select('_id')
      .lean()
  )
    .map((row) => String(row._id))
    .sort();

const run = (apply: boolean, configs: RequestedLaneConfig[]) =>
  runOrphanedLaneConfigRetirement({
    apply,
    configs,
    refPresence: PENDING_ON_BRANCH,
    scannedRepositories: [],
    lanes: LANES,
    codeShasOnRef: (codeShas) => new Set(codeShas.filter((codeSha) => codeSha === LANDED_SHA)),
  });

describe('observations:retire-orphaned-lane-configs (#5807)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Observation.createIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db!;
    await Promise.all(
      ['observations', 'scrape_runs', 'sources'].map((name) => db.collection(name).deleteMany({})),
    );
    sourceId = (await Source.create({ name: ROSTER, displayName: 'Roster', defaultWeight: 0.8 }))
      ._id as mongoose.Types.ObjectId;
    await seedRun('unlanded', ['gone-lane']);
    await seedRun('unlanded-full', []);
    await seedRun('paused', ['paused-lane']);
    await seedRun('pending', ['pending-lane']);
    await seedRun('landed', [], LANDED_SHA);

    await seed('dept-gone-lane-ash-kerr', 'websiteUrl', 'unlanded');
    await seed('dept-gone-lane-ash-kerr', 'name', 'unlanded');
    await seed('dept:gone-lane:ash-kerr', 'title', 'unlanded');
    await seed('netid:ak12', 'title', 'unlanded');
    await seed('dept-gone-lane-bo-fenn', 'websiteUrl', 'landed');
    await seed('dept-chem-ash-kerr', 'websiteUrl', 'unlanded-full');
    await seed('dept-paused-lane-cy-dorn', 'websiteUrl', 'paused');
    await seed('netid:cd34', 'title', 'paused');
    await seed('dept-pending-lane-di-ross', 'websiteUrl', 'pending');
    await seed('dept:pending-lane:di-ross', 'title', 'pending');
  });

  it('writes nothing in a dry run and counts what an apply would retire', async () => {
    const before = await liveIds();
    const { report } = await run(false, [gone]);
    expect(report).toMatchObject({
      mode: 'dry-run',
      observationsToRetire: 4,
      heldObservations: 1,
      retiredObservations: 0,
    });
    expect(report.countsByConfig[`${ROSTER}:gone-lane`].byBasis).toEqual({
      'key-namespace': 3,
      'run-only': 1,
    });
    expect(await liveIds()).toEqual(before);
  });

  it('supersedes exactly the orphaned observations, and a second apply changes nothing', async () => {
    const first = await run(true, [gone]);
    expect(first.report.retiredObservations).toBe(4);
    const retired = await Observation.find({ superseded: true }).lean();
    expect(retired.map((row) => `${row.entityKey}|${row.field}`).sort()).toEqual([
      'dept-gone-lane-ash-kerr|name',
      'dept-gone-lane-ash-kerr|websiteUrl',
      'dept:gone-lane:ash-kerr|title',
      'netid:ak12|title',
    ]);
    expect(retired.every((row) => /#5807/.test(String(row.rollback?.reason)))).toBe(true);
    expect(await Observation.countDocuments({})).toBe(10);

    const afterFirst = await liveIds();
    const second = await run(true, [gone]);
    expect(second.report.retiredObservations).toBe(0);
    expect(second.report.observationsToRetire).toBe(0);
    expect(await liveIds()).toEqual(afterFirst);
  });

  it('retracts nothing for a config the code defines but nothing has run lately', async () => {
    const before = await liveIds();
    await expect(run(true, [paused])).rejects.toThrow(/paused-lane is present-in-code/);
    const { report } = await run(false, [paused]);
    expect(report.observationsToRetire).toBe(0);
    expect(await liveIds()).toEqual(before);
  });

  it('retracts nothing for a config that exists only on an unmerged branch', async () => {
    const before = await liveIds();
    await expect(run(true, [gone, pending])).rejects.toThrow(/pending-lane is present-on-ref/);
    const { report } = await run(false, [pending]);
    expect(report.verdicts[0].verdict).toEqual({
      status: 'present-on-ref',
      refs: ['repo#refs/heads/feat/pending-lane'],
    });
    expect(report.observationsToRetire).toBe(0);
    expect(await liveIds()).toEqual(before);
  });
});

describe('parseRetireOrphanedLaneConfigsArgs', () => {
  it('is a dry run by default and needs a named config list', () => {
    expect(parseRetireOrphanedLaneConfigsArgs([`--configs=${ROSTER}:gone-lane`])).toMatchObject({
      apply: false,
      confirmed: false,
      configs: [gone],
    });
    expect(() => parseRetireOrphanedLaneConfigsArgs([])).toThrow(/requires --configs/);
    expect(() =>
      parseRetireOrphanedLaneConfigsArgs([`--configs=${ROSTER}:gone-lane`, '--skip-projection']),
    ).toThrow(/Unknown/);
    expect(
      parseRetireOrphanedLaneConfigsArgs([
        `--configs=${ROSTER}:gone-lane`,
        '--apply',
        CONFIRM_FLAG,
      ]),
    ).toMatchObject({ apply: true, confirmed: true });
  });
});
