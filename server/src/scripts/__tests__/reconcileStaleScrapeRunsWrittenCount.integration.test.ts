import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ScrapeRun } from '../../models/scrapeRun';
import { writeScrapeRunHeartbeat } from '../../scrapers/scrapeRunLiveness';
import { countStoredObservationsByRun } from '../reconcileStaleScrapeRuns';
import {
  planWrittenCountRecount,
  writtenCountRecountUpdate,
} from '../reconcileStaleScrapeRunsCore';

describe('the written count of a run that died mid-write (#6269)', () => {
  let replSet: MongoMemoryReplSet;
  const sourceId = new mongoose.Types.ObjectId();

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
    await db.collection('observations').deleteMany({});
    await db.collection('scraperuns').deleteMany({});
    await ScrapeRun.deleteMany({});
  });

  const storeObservations = async (runId: mongoose.Types.ObjectId, count: number) => {
    const db = mongoose.connection.db!;
    await db.collection('observations').insertMany(
      Array.from({ length: count }, (_, index) => ({
        source: 'scrape',
        entityType: 'user',
        entityKey: `fixture-key-${index}`,
        field: 'title',
        value: 'Fixture Title',
        sourceId,
        sourceName: 'fixture-source',
        scrapeRunId: runId,
        confidence: 0.5,
      })),
    );
  };

  it('keeps the highest count a heartbeat flushed, so a late beat cannot lower it', async () => {
    const run = await ScrapeRun.create({
      sourceId,
      sourceName: 'fixture-source',
      triggeredBy: 'cli',
      startedAt: new Date(),
      status: 'running',
    });

    await writeScrapeRunHeartbeat(run._id, new Date(), {
      observationCount: 40,
      entitiesObserved: 9,
    });
    await writeScrapeRunHeartbeat(run._id, new Date(), {
      observationCount: 30,
      entitiesObserved: 7,
    });

    const stored = await ScrapeRun.findById(run._id).lean();
    expect(stored).toMatchObject({ observationCount: 40, entitiesObserved: 9 });
  });

  it('counts a run by its ObjectId, where a string match counts nothing', async () => {
    const runId = new mongoose.Types.ObjectId();
    await storeObservations(runId, 7);

    const db = mongoose.connection.db!;
    expect(await db.collection('observations').countDocuments({ scrapeRunId: String(runId) })).toBe(
      0,
    );
    expect(await countStoredObservationsByRun([String(runId)])).toEqual(
      new Map([[String(runId), 7]]),
    );
  });

  it('records the true count beside the stale one on an interrupted run', async () => {
    const run = await ScrapeRun.create({
      sourceId,
      sourceName: 'fixture-source',
      triggeredBy: 'cli',
      startedAt: new Date(),
      status: 'interrupted',
      observationCount: 0,
    });
    await storeObservations(run._id, 12);

    const plan = planWrittenCountRecount(
      [
        {
          id: String(run._id),
          sourceName: 'fixture-source',
          status: 'interrupted',
          startedAt: run.startedAt,
          observationCount: 0,
        },
      ],
      await countStoredObservationsByRun([String(run._id)]),
    );
    const now = new Date();
    const write = writtenCountRecountUpdate(plan.recounts[0], now);
    if (!write) throw new Error('an under-recorded run must be written');
    await ScrapeRun.updateOne(write.filter, write.update);

    expect(await ScrapeRun.findById(run._id).lean()).toMatchObject({
      observationCount: 0,
      storedObservationCountAtReconcile: 12,
      reconciledAt: now,
    });
  });
});
