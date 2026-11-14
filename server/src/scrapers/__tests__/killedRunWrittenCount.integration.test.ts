import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';

import { hermeticChildEnvironment } from '../../test/hermeticEnvironment';
import { Observation } from '../../models/observation';
import { ScrapeRun } from '../../models/scrapeRun';
import { countStoredObservationsByRun } from '../../scripts/reconcileStaleScrapeRuns';
import { planWrittenCountRecount } from '../../scripts/reconcileStaleScrapeRunsCore';

const SERVER_ROOT = path.resolve(__dirname, '../../..');
const CHILD = path.join(__dirname, 'fixtures', 'killedMidWriteRunChild.ts');
const WRITES = 12;
const CHILD_CEILING_MS = 20_000;
const SOURCE_ID = new mongoose.Types.ObjectId();

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
      { cwd: SERVER_ROOT, env: hermeticChildEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] },
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

  it('leaves a record that already counts what it wrote, so the recount finds nothing to correct', async () => {
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

    expect(await runKilledChild(runId)).toContain('flushedObservationCount');

    const after = await ScrapeRun.findById(runId).lean();
    expect(after?.observationCount).toBe(WRITES);

    const stored = await countStoredObservationsByRun([runId]);
    expect(stored.get(runId)).toBe(WRITES);
    const [recount] = planWrittenCountRecount(
      [
        {
          id: runId,
          sourceName: 'fixture-source',
          status: 'interrupted',
          startedAt: new Date(after!.startedAt),
          observationCount: after!.observationCount ?? 0,
        },
      ],
      stored,
    ).recounts;
    expect(recount.verdict).toBe('matching');
  });

  it('recounts a record that never flushed, the pre-fix shape, at the layer where the string trap bites', async () => {
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
        scrapeRunId: new mongoose.Types.ObjectId(runId),
        observedAt: new Date(),
      })),
    );

    const stored = await countStoredObservationsByRun([runId]);
    const [recount] = planWrittenCountRecount(
      [
        {
          id: runId,
          sourceName: 'fixture-source',
          status: 'interrupted',
          startedAt: run.startedAt,
          observationCount: 0,
        },
      ],
      stored,
    ).recounts;
    expect(recount).toMatchObject({ storedObservationCount: 5, verdict: 'under_recorded' });

    expect(await Observation.countDocuments({ scrapeRunId: runId as never })).toBe(5);
    const raw = mongoose.connection.db?.collection('observations');
    expect(await raw?.countDocuments({ scrapeRunId: runId })).toBe(0);
    expect(await raw?.countDocuments({ scrapeRunId: new mongoose.Types.ObjectId(runId) })).toBe(5);
  });
});
