import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';

import { hermeticChildEnvironment } from '../../test/hermeticEnvironment';
import { Observation } from '../../models/observation';
import { ScrapeRun } from '../../models/scrapeRun';
import {
  countCorrectionFor,
  needsCountCorrection,
  runRecordCountIsUnreliable,
  scrapeRunIdFilterValue,
} from '../../scripts/reconcileScrapeRunCountsCore';

const SERVER_ROOT = path.resolve(__dirname, '../../..');
const CHILD = path.join(__dirname, 'fixtures', 'killedMidWriteRunChild.ts');
const WRITES = 12;
const SOURCE_ID = new mongoose.Types.ObjectId();
const CHILD_CEILING_MS = 20_000;

const liveChildren = new Set<ChildProcess>();
const stopSurvivingChildren = (): void => {
  for (const child of liveChildren) child.kill('SIGKILL');
  liveChildren.clear();
};
process.once('exit', stopSurvivingChildren);

let memoryServer: MongoMemoryServer;
let mongoUri: string;

const runKilledChild = (runId: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', CHILD, mongoUri, runId, String(WRITES)],
      {
        cwd: SERVER_ROOT,
        env: hermeticChildEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    liveChildren.add(child);
    let stdout = '';
    child.stdout?.on('data', (chunk) => (stdout += chunk));
    const ceiling = setTimeout(() => child.kill('SIGKILL'), CHILD_CEILING_MS);
    child.on('error', reject);
    child.on('close', () => {
      clearTimeout(ceiling);
      liveChildren.delete(child);
      resolve(stdout);
    });
  });

describe('a run killed mid-write (#6269)', { timeout: CHILD_CEILING_MS + 10_000 }, () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    mongoUri = memoryServer.getUri();
    await mongoose.connect(mongoUri, { autoIndex: false, autoCreate: false });
  });

  afterEach(stopSurvivingChildren);

  afterAll(async () => {
    stopSurvivingChildren();
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('leaves a record whose flushed count matches its observations, and a recount that agrees', async () => {
    const run = await ScrapeRun.create({
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'fixture-source',
      status: 'running',
      startedAt: new Date(),
      observationCount: 0,
      entitiesObserved: 0,
      options: { dryRun: false },
    });
    const runId = String(run._id);

    const childOutput = await runKilledChild(runId);
    expect(childOutput).toContain('flushedObservationCount');

    const observations = await Observation.countDocuments({
      scrapeRunId: scrapeRunIdFilterValue(runId),
    });
    expect(observations).toBe(WRITES);

    const after = await ScrapeRun.findById(runId)
      .select('status startedAt heartbeatAt observationCount')
      .lean();
    // The heartbeat flushed the counters, so the killed run's own record is right about what it
    // wrote, which is the defect this closes: before the flush it claimed zero.
    expect(after?.observationCount).toBe(WRITES);

    // The run never finalised, so its record still claims to be running with a stale-by-design
    // heartbeat once the window passes; the reconciler therefore recounts it and finds no
    // correction to make, because the flush already told the truth.
    const facts = { ...after, _id: runId } as Parameters<typeof runRecordCountIsUnreliable>[0];
    expect(runRecordCountIsUnreliable(facts, Date.now() + 60 * 60 * 1000, 15 * 60 * 1000)).toBe(
      true,
    );
    expect(
      needsCountCorrection(
        countCorrectionFor(facts, observations).reportedObservations,
        observations,
      ),
    ).toBe(false);
  });

  it('recounts a record that never flushed, the pre-fix shape', async () => {
    const run = await ScrapeRun.create({
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'fixture-source',
      status: 'interrupted',
      startedAt: new Date(),
      observationCount: 0,
      entitiesObserved: 0,
      options: { dryRun: false },
    });
    const runId = String(run._id);
    await Observation.insertMany(
      Array.from({ length: 5 }, (_unused, index) => ({
        entityType: 'researchEntity',
        entityKey: `synthetic-unflushed-row-${index}`,
        field: 'name',
        value: `Synthetic Unflushed Row ${index}`,
        source: 'page',
        sourceId: SOURCE_ID,
        sourceName: 'fixture-source',
        confidence: 0.5,
        scrapeRunId: scrapeRunIdFilterValue(runId),
        observedAt: new Date(),
      })),
    );

    const stored = await ScrapeRun.findById(runId)
      .select('status startedAt heartbeatAt observationCount')
      .lean();
    const facts = { ...stored, _id: runId } as Parameters<typeof countCorrectionFor>[0];
    const actual = await Observation.countDocuments({
      scrapeRunId: scrapeRunIdFilterValue(runId),
    });
    const correction = countCorrectionFor(facts, actual);

    expect(correction.reportedObservations).toBe(0);
    expect(correction.actualObservations).toBe(5);
    expect(needsCountCorrection(correction.reportedObservations, actual)).toBe(true);
    // Where the string trap bites: a Mongoose query casts a string run id for us, so the recount
    // is safe through the model, but the same filter on the raw driver collection matches nothing
    // and reads exactly like "this run wrote nothing" (#6269).
    expect(await Observation.countDocuments({ scrapeRunId: runId as never })).toBe(5);
    const raw = mongoose.connection.db?.collection('observations');
    expect(await raw?.countDocuments({ scrapeRunId: runId })).toBe(0);
    expect(await raw?.countDocuments({ scrapeRunId: scrapeRunIdFilterValue(runId) })).toBe(5);
  });
});
