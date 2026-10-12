import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Observation } from '../../models/observation';
import { ScrapeRun } from '../../models/scrapeRun';
import { pruneDeadObservations } from '../observationRetention';
import { clearC4Flags } from './c4FlagTestEnv';

let memoryReplSet: MongoMemoryReplSet | undefined;

const SOURCE_NAME = 'synthetic-source';
const sourceId = new mongoose.Types.ObjectId();
const NOW = new Date('2026-05-14T12:00:00Z');

async function seedRun(startedAt: Date) {
  return ScrapeRun.create({ sourceId, sourceName: SOURCE_NAME, startedAt });
}

async function seedObservation(input: {
  scrapeRunId: mongoose.Types.ObjectId;
  superseded: boolean;
  supersededBy?: mongoose.Types.ObjectId;
}) {
  return Observation.create({
    entityType: 'researchEntity',
    entityId: new mongoose.Types.ObjectId(),
    field: 'description',
    value: 'synthetic value',
    sourceId,
    sourceName: SOURCE_NAME,
    confidence: 0.5,
    observedAt: new Date('2026-01-01T00:00:00Z'),
    ...input,
  });
}

async function remainingIds(): Promise<Set<string>> {
  const rows = await Observation.find({}).select('_id').lean();
  return new Set(rows.map((row) => String(row._id)));
}

async function danglingSupersessionPointers(): Promise<number> {
  const remaining = await remainingIds();
  const rows = await Observation.find({ supersededBy: { $type: 'objectId' } })
    .select('supersededBy')
    .lean();
  return rows.filter((row) => !remaining.has(String(row.supersededBy))).length;
}

async function seedChainInOldRun(length: number) {
  const oldRun = await seedRun(new Date('2026-01-01T00:00:00Z'));
  const live = await seedObservation({ scrapeRunId: oldRun._id, superseded: false });
  const chain: Array<Awaited<ReturnType<typeof seedObservation>>> = [];
  let next = live._id;
  for (let index = 0; index < length; index += 1) {
    const link = await seedObservation({
      scrapeRunId: oldRun._id,
      superseded: true,
      supersededBy: next,
    });
    chain.unshift(link);
    next = link._id;
  }
  return { oldRun, live, chain };
}

describe('dead-observation prune over supersession chains (#5021)', () => {
  beforeAll(async () => {
    memoryReplSet = await MongoMemoryReplSet.create({
      binary: { version: '8.0.12' },
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await mongoose.connect(memoryReplSet.getUri('observation_retention_supersession_test'));
  });

  beforeEach(async () => {
    clearC4Flags();
    await Observation.deleteMany({});
    await ScrapeRun.deleteMany({});
    await mongoose.connection.collection('research_entities').deleteMany({});
  });

  afterAll(async () => {
    clearC4Flags();
    await mongoose.disconnect();
    await memoryReplSet?.stop();
  });

  it('deletes every eligible link of a chain in one pass and keeps the live head', async () => {
    const { live } = await seedChainInOldRun(3);

    const result = await pruneDeadObservations({ now: NOW, keepRuns: 0, apply: true });

    expect(result).toMatchObject({ eligibleCandidates: 3, candidates: 3, deleted: 3 });
    expect([...(await remainingIds())]).toEqual([String(live._id)]);
    expect(await danglingSupersessionPointers()).toBe(0);
  });

  it('keeps a provenance-cited link and every link it points forward to, and nothing older', async () => {
    const { live, chain } = await seedChainInOldRun(3);
    const [oldest, cited, newest] = chain;
    await mongoose.connection.collection('research_entities').insertOne({
      fieldProvenance: { description: { observationId: cited._id } },
    });

    const result = await pruneDeadObservations({ now: NOW, keepRuns: 0, apply: true });

    expect(result).toMatchObject({ eligibleCandidates: 3, candidates: 1, deleted: 1 });
    const remaining = await remainingIds();
    expect(remaining.has(String(oldest._id))).toBe(false);
    expect(remaining.has(String(cited._id))).toBe(true);
    expect(remaining.has(String(newest._id))).toBe(true);
    expect(remaining.has(String(live._id))).toBe(true);
    expect(await danglingSupersessionPointers()).toBe(0);
  });

  it('keeps a superseded observation that a surviving kept-run observation points at', async () => {
    const oldRun = await seedRun(new Date('2026-01-01T00:00:00Z'));
    const keptRun = await seedRun(new Date('2026-05-01T00:00:00Z'));
    const live = await seedObservation({ scrapeRunId: oldRun._id, superseded: false });
    const target = await seedObservation({
      scrapeRunId: oldRun._id,
      superseded: true,
      supersededBy: live._id,
    });
    const unreferenced = await seedObservation({
      scrapeRunId: oldRun._id,
      superseded: true,
      supersededBy: live._id,
    });
    const keptReferrer = await seedObservation({
      scrapeRunId: keptRun._id,
      superseded: true,
      supersededBy: target._id,
    });

    const result = await pruneDeadObservations({ now: NOW, keepRuns: 1, apply: true });

    expect(result).toMatchObject({ eligibleCandidates: 2, candidates: 1, deleted: 1 });
    const remaining = await remainingIds();
    expect(remaining.has(String(unreferenced._id))).toBe(false);
    expect(remaining.has(String(target._id))).toBe(true);
    expect(remaining.has(String(keptReferrer._id))).toBe(true);
    expect(await danglingSupersessionPointers()).toBe(0);
  });

  it('reports the same deletable set in a dry run without deleting anything', async () => {
    await seedChainInOldRun(3);

    const result = await pruneDeadObservations({ now: NOW, keepRuns: 0, apply: false });

    expect(result).toMatchObject({ eligibleCandidates: 3, candidates: 3, deleted: 0 });
    expect((await remainingIds()).size).toBe(4);
  });
});
