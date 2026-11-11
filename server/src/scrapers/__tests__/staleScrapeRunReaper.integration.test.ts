import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { hostname } from 'os';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ScrapeJobLock } from '../../models/scrapeJobLock';
import { ScrapeRun } from '../../models/scrapeRun';
import { reapDeadScrapeRuns } from '../staleScrapeRunReaper';

const NOW = new Date('2026-11-11T12:00:00Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const DEAD_PID = 2_147_483_646;
const OTHER_HOST = 'fixture-other-host';

describe('reaping dead scrape runs when a new run starts (#5628)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db!;
    for (const name of ['scrape_runs', 'scrape_job_locks', 'observations']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedRun = async (
    sourceName: string,
    fields: { heartbeatAt?: Date; owner?: Record<string, unknown> },
  ) => {
    const db = mongoose.connection.db!;
    const result = await db.collection('scrape_runs').insertOne({
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      triggeredBy: 'cli',
      startedAt: minutesAgo(600),
      status: 'running',
      invalidated: false,
      errors: [],
      ...fields,
    });
    return result.insertedId;
  };

  const seedLock = (sourceName: string, ownerId: string) =>
    mongoose.connection.db!.collection('scrape_job_locks').insertOne({
      sourceName,
      locked: true,
      ownerId,
      leaseExpiresAt: new Date(NOW.getTime() + 60 * 60_000),
    });

  const statusOf = async (id: mongoose.Types.ObjectId) =>
    (await ScrapeRun.findById(id).lean()) as Record<string, any>;

  it('closes only a run whose heartbeat stopped, with no held lock and no live owner', async () => {
    const dead = await seedRun('fixture-dead', {
      heartbeatAt: minutesAgo(60),
      owner: { host: OTHER_HOST, pid: DEAD_PID },
    });
    const fresh = await seedRun('fixture-fresh', {
      heartbeatAt: minutesAgo(1),
      owner: { host: OTHER_HOST, pid: DEAD_PID },
    });
    const locked = await seedRun('fixture-locked', {
      heartbeatAt: minutesAgo(60),
      owner: { host: OTHER_HOST, pid: DEAD_PID },
    });
    await seedLock('fixture-locked', 'another-process');
    const liveOwner = await seedRun('fixture-live-owner', {
      heartbeatAt: minutesAgo(60),
      owner: { host: hostname(), pid: process.pid },
    });
    const legacy = await seedRun('fixture-legacy', {});
    await mongoose.connection.db!.collection('observations').insertOne({
      scrapeRunId: dead,
      sourceName: 'fixture-dead',
      superseded: false,
    });

    const result = await reapDeadScrapeRuns({ detectedBy: 'test', now: NOW });

    expect(result.closed).toBe(1);
    expect(await statusOf(dead)).toMatchObject({
      status: 'interrupted',
      invalidated: false,
      interruption: { reason: 'heartbeat_stale', detectedBy: 'test' },
    });
    for (const kept of [fresh, locked, liveOwner, legacy]) {
      expect((await statusOf(kept)).status).toBe('running');
    }
    expect(
      await mongoose.connection
        .db!.collection('observations')
        .countDocuments({ scrapeRunId: dead }),
    ).toBe(1);
  });

  it("closes a dead predecessor whose source lock is the caller's own", async () => {
    const dead = await seedRun('fixture-rerun', {
      heartbeatAt: minutesAgo(60),
      owner: { host: OTHER_HOST, pid: DEAD_PID },
    });
    await seedLock('fixture-rerun', 'the-caller');

    expect(
      (await reapDeadScrapeRuns({ detectedBy: 'test', now: NOW, callerLockOwnerId: 'the-caller' }))
        .closed,
    ).toBe(1);
    expect((await statusOf(dead)).status).toBe('interrupted');
  });

  it('writes nothing outside Development, because Beta and Production get scrape_runs by promotion', async () => {
    const dead = await seedRun('fixture-promoted', {
      heartbeatAt: minutesAgo(60),
      owner: { host: OTHER_HOST, pid: DEAD_PID },
    });

    for (const databaseName of ['Beta', 'Prod']) {
      const result = await reapDeadScrapeRuns({ detectedBy: 'test', now: NOW, databaseName });
      expect(result).toMatchObject({ closed: 0, skippedDatabase: databaseName });
    }
    expect((await statusOf(dead)).status).toBe('running');
  });

  it('leaves a run alone when its lock belongs to someone other than the caller', async () => {
    const dead = await seedRun('fixture-shared', {
      heartbeatAt: minutesAgo(60),
      owner: { host: OTHER_HOST, pid: DEAD_PID },
    });
    await seedLock('fixture-shared', 'someone-else');

    await reapDeadScrapeRuns({ detectedBy: 'test', now: NOW, callerLockOwnerId: 'the-caller' });
    expect((await statusOf(dead)).status).toBe('running');
    expect(await ScrapeJobLock.countDocuments({ sourceName: 'fixture-shared' })).toBe(1);
  });
});
