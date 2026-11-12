import http from 'node:http';
import type { AddressInfo } from 'node:net';

import axios from 'axios';
import { Collection, type Db } from 'mongodb';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DevWriteRefusedError, resetDevWriteGuardStateForTests } from '../devWriteGuard';
import {
  DEV_APPLY_LEASE_NAME,
  DEV_HOST_LEASE_PREFIX,
  DEV_WRITE_LEASE_COLLECTION,
  DEV_WRITE_LEASE_HEARTBEAT_MS,
  DEV_WRITE_LEASE_OWNER_ENV,
  DEV_WRITE_LEASE_RENEWAL_DEADLINE_MS,
  DEV_WRITE_LEASE_STOP_EXIT_CODE,
  DEV_WRITE_LEASE_SWITCH_ENV,
  DevWriteLeaseStoppedError,
  acquireDevWriteLease,
  acquireIntendedDevApplyLease,
  armDevHostLeases,
  ensureDevHostLease,
  recordDevApplyIntent,
  releaseHeldDevWriteLeases,
  resetDevWriteLeaseStateForTests,
  runDevWriteLeaseHeartbeatTick,
  setDevWriteLeaseRuntimeForTests,
} from '../devWriteLease';
import {
  DEV_WRITE_STOP_CLEANUP_WINDOW_MS,
  DevWriteStoppedError,
  devWriteStopCleanupMayWrite,
  devWriteStopped,
  enterDevWriteStoppedMode,
  registerDevWriteStopCleanup,
  runDevWriteStopCleanups,
} from '../devWriteStop';
import { Observation } from '../../models/observation';
import { ScrapeJobLock } from '../../models/scrapeJobLock';
import { ScrapeRun } from '../../models/scrapeRun';
import { Source } from '../../models/source';
import { ScraperOrchestrator } from '../../scrapers/orchestrator';
import { createScrapeJobLockOwnerId, withScrapeJobLock } from '../../scrapers/scrapeJobLock';

const FIXTURE_LANE = 'lease-stop-fixture-lane';
const LEASE_ENV: NodeJS.ProcessEnv = { DEV_WRITE_OWNER: 'test-session' };
const HOSTS = ['a.example.edu', 'b.example.edu', 'c.example.edu'];
const START = Date.UTC(2026, 10, 12, 9);

const WRITE_METHODS = [
  'insertOne',
  'insertMany',
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
  'deleteOne',
  'deleteMany',
  'bulkWrite',
] as const;

type Outage = 'none' | 'reject' | 'hang';

interface DriverWrite {
  collection: string;
  method: string;
  afterStop: boolean;
  inStopCleanup: boolean;
}

let memoryServer: MongoMemoryServer;
let pageServer: http.Server;
let pageUrl: string;
let pageRequests: number;
let db: Db;
let at: number;
let outage: Outage;
let driverWrites: DriverWrite[];
let logs: string[];
let exitCodes: number[];
let exited: Promise<void>;
let onSleep: (sleeps: number) => void;
let sleeps: number;
let savedSwitch: string | undefined;

const now = () => new Date(at);
const advance = (ms: number) => {
  at += ms;
};
const leases = () => db.collection(DEV_WRITE_LEASE_COLLECTION);

interface AfterStopAttempts {
  emit?: unknown;
  fetch?: unknown;
  modelWrite?: unknown;
}

function installOutage() {
  for (const method of WRITE_METHODS) {
    const original = Collection.prototype[method] as (...args: unknown[]) => Promise<unknown>;
    vi.spyOn(Collection.prototype, method).mockImplementation(function (
      this: Collection,
      ...args: unknown[]
    ) {
      driverWrites.push({
        collection: this.collectionName,
        method,
        afterStop: devWriteStopped(),
        inStopCleanup: devWriteStopCleanupMayWrite(this.collectionName),
      });
      if (outage === 'reject') {
        return Promise.reject(new Error('connection to the database closed')) as never;
      }
      if (outage === 'hang') return new Promise<never>(() => undefined) as never;
      return original.apply(this, args) as never;
    } as never);
  }
}

function useRuntime(overrides: { heartbeatTimeoutMs?: number; cleanupAttemptTimeoutMs?: number }) {
  let markExited: () => void = () => undefined;
  exited = new Promise<void>((resolve) => {
    markExited = resolve;
  });
  setDevWriteLeaseRuntimeForTests({
    now,
    log: (message) => logs.push(message),
    exit: (code) => {
      exitCodes.push(code);
      markExited();
    },
    sleep: async (ms) => {
      advance(ms);
      sleeps += 1;
      onSleep(sleeps);
    },
    ...overrides,
  });
}

/**
 * Holds what a writing lane run holds in Development: the apply lease, three host leases, the
 * source lock and a running scrape_runs row, with the lane parked mid-run until `release`.
 */
async function startLaneRunHoldingEverything() {
  const descriptor = { db, databaseName: db.databaseName, host: 'cluster.example.net' };
  recordDevApplyIntent('scrape:fixture', []);
  await acquireIntendedDevApplyLease(descriptor, LEASE_ENV);
  armDevHostLeases(descriptor, 'scrape run', LEASE_ENV);
  for (const host of HOSTS) await ensureDevHostLease(host);

  let reachedGate: () => void = () => undefined;
  const parked = new Promise<void>((resolve) => {
    reachedGate = resolve;
  });
  let openGate: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  const afterStop: AfterStopAttempts = {};
  const orchestrator = new ScraperOrchestrator({ runHeartbeatIntervalMs: 0 });
  orchestrator.register({
    name: FIXTURE_LANE,
    displayName: 'Fixture lane',
    async run(ctx) {
      const observation = (value: string) => ({
        entityType: 'researchEntity' as const,
        entityKey: `fixture-entity-${value}`,
        field: 'name',
        value: `Fixture Entity ${value}`,
        sourceUrl: 'https://a.example.edu/fixture',
      });
      await ctx.emit(observation('before'));
      await axios.get(pageUrl);
      reachedGate();
      await gate;
      afterStop.emit = await ctx.emit(observation('after')).then(
        () => 'written',
        (error: unknown) => error,
      );
      afterStop.fetch = await axios.get(pageUrl).then(
        () => 'fetched',
        (error: unknown) => error,
      );
      afterStop.modelWrite = await Source.updateOne(
        { name: FIXTURE_LANE },
        { $set: { displayName: 'Changed after the stop' } },
      ).then(
        () => 'written',
        (error: unknown) => error,
      );
      throw new Error('fixture lane ends after its refused attempts');
    },
  });
  const lockOwnerId = createScrapeJobLockOwnerId('scrape cli');
  const settled = withScrapeJobLock(
    {
      environment: 'development',
      sourceName: FIXTURE_LANE,
      ownerId: lockOwnerId,
      label: 'scrape cli',
      heartbeatIntervalMs: 0,
    },
    () =>
      orchestrator.run(
        FIXTURE_LANE,
        { dryRun: false, useCache: false, release: false },
        { lockOwnerId },
      ),
  ).catch((error: unknown) => error);
  await parked;
  const runRow = await db.collection('scrape_runs').findOne({ sourceName: FIXTURE_LANE });
  return { afterStop, release: openGate, settled, runId: runRow!._id };
}

async function stopForMissedRenewals() {
  advance(DEV_WRITE_LEASE_RENEWAL_DEADLINE_MS + DEV_WRITE_LEASE_HEARTBEAT_MS);
  await runDevWriteLeaseHeartbeatTick();
}

async function heldLeaseRows() {
  return leases()
    .find({
      $or: [
        { sourceName: DEV_APPLY_LEASE_NAME },
        { sourceName: { $regex: `^${DEV_HOST_LEASE_PREFIX}` } },
      ],
    })
    .toArray();
}

beforeAll(async () => {
  memoryServer = await MongoMemoryServer.create();
  await mongoose.connect(`${memoryServer.getUri()}Development`, { monitorCommands: true });
  db = mongoose.connection.db!;
  pageServer = http.createServer((_, res) => {
    pageRequests += 1;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<p>fixture</p>');
  });
  await new Promise<void>((resolve) => pageServer.listen(0, '127.0.0.1', () => resolve()));
  pageUrl = `http://127.0.0.1:${(pageServer.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => pageServer.close(() => resolve()));
  await mongoose.disconnect();
  await memoryServer?.stop();
});

beforeEach(async () => {
  savedSwitch = process.env[DEV_WRITE_LEASE_SWITCH_ENV];
  delete process.env[DEV_WRITE_LEASE_SWITCH_ENV];
  delete process.env[DEV_WRITE_LEASE_OWNER_ENV];
  process.env.DEV_WRITE_OWNER = 'test-session';
  resetDevWriteLeaseStateForTests();
  resetDevWriteGuardStateForTests();
  vi.restoreAllMocks();
  await db.dropDatabase();
  await db.collection(Source.collection.collectionName).insertOne({
    name: FIXTURE_LANE,
    displayName: 'Fixture lane',
    defaultWeight: 0.8,
    enabled: true,
  });
  at = START;
  outage = 'none';
  driverWrites = [];
  logs = [];
  exitCodes = [];
  sleeps = 0;
  pageRequests = 0;
  onSleep = () => undefined;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  installOutage();
});

afterEach(async () => {
  outage = 'none';
  vi.restoreAllMocks();
  await releaseHeldDevWriteLeases();
  resetDevWriteLeaseStateForTests();
  resetDevWriteGuardStateForTests();
  delete process.env[DEV_WRITE_LEASE_OWNER_ENV];
  delete process.env.DEV_WRITE_OWNER;
  if (savedSwitch === undefined) delete process.env[DEV_WRITE_LEASE_SWITCH_ENV];
  else process.env[DEV_WRITE_LEASE_SWITCH_ENV] = savedSwitch;
});

describe('a database outage longer than the renewal deadline', () => {
  it('refuses every model write and every scraper fetch from the moment of the stop', async () => {
    useRuntime({ cleanupAttemptTimeoutMs: 200 });
    const lane = await startLaneRunHoldingEverything();
    expect(pageRequests).toBe(1);
    const observationsBeforeStop = await db
      .collection(Observation.collection.collectionName)
      .countDocuments();

    outage = 'reject';
    await stopForMissedRenewals();
    expect(devWriteStopped()).toBe(true);
    lane.release();
    await lane.settled;
    await exited;

    expect(lane.afterStop.emit).toBeInstanceOf(DevWriteRefusedError);
    expect(lane.afterStop.modelWrite).toBeInstanceOf(DevWriteRefusedError);
    expect((lane.afterStop.modelWrite as Error).message).toMatch(
      /stopped itself \(renewal-failed\)/,
    );
    await expect(
      ScrapeRun.updateOne({ _id: lane.runId }, { $set: { status: 'success' } }),
    ).rejects.toBeInstanceOf(DevWriteRefusedError);
    expect(lane.afterStop.fetch).toBeInstanceOf(DevWriteStoppedError);
    expect(pageRequests).toBe(1);
    await expect(ensureDevHostLease('d.example.edu')).rejects.toBeInstanceOf(
      DevWriteLeaseStoppedError,
    );
    const writesAfterStop = driverWrites.filter(({ afterStop }) => afterStop);
    expect(writesAfterStop.length).toBeGreaterThan(0);
    expect(writesAfterStop.filter(({ inStopCleanup }) => !inStopCleanup)).toEqual([]);
    outage = 'none';
    expect(await db.collection(Observation.collection.collectionName).countDocuments()).toBe(
      observationsBeforeStop,
    );
    expect(await db.collection(Source.collection.collectionName).findOne({})).toMatchObject({
      displayName: 'Fixture lane',
    });
  });
});

describe('the database returning inside the cleanup window', () => {
  it('closes the run as interrupted and releases the source lock and every lease before it exits', async () => {
    useRuntime({ cleanupAttemptTimeoutMs: 200 });
    const lane = await startLaneRunHoldingEverything();
    expect(await heldLeaseRows()).toHaveLength(1 + HOSTS.length);
    let stateAtExit: Promise<unknown> | undefined;
    exited = exited.then(() => {
      stateAtExit = Promise.all([
        db.collection('scrape_runs').findOne({ _id: lane.runId }),
        db
          .collection(ScrapeJobLock.collection.collectionName)
          .findOne({ sourceName: FIXTURE_LANE }),
        heldLeaseRows(),
      ]);
    });

    outage = 'reject';
    onSleep = (count) => {
      if (count === 2) outage = 'none';
    };
    await stopForMissedRenewals();
    lane.release();
    await lane.settled;
    await exited;

    expect(exitCodes).toEqual([DEV_WRITE_LEASE_STOP_EXIT_CODE]);
    const [run, sourceLock, leaseRows] = (await stateAtExit) as [
      Record<string, any>,
      Record<string, any>,
      Array<Record<string, any>>,
    ];
    expect(run).toMatchObject({
      status: 'interrupted',
      interruption: { reason: 'lease_renewal_failed', detectedBy: 'dev-write-lease-stop' },
    });
    expect(run.finishedAt).toBeInstanceOf(Date);
    expect(run.errors.at(-1).message).toMatch(
      /Stopped by the Development write lease \(renewal-failed\)/,
    );
    expect(sourceLock).toMatchObject({ locked: false, releaseReason: 'failure' });
    expect(sourceLock.ownerId).toBeUndefined();
    expect(leaseRows).toHaveLength(1 + HOSTS.length);
    for (const row of leaseRows) {
      expect(row).toMatchObject({ locked: false, releaseReason: 'stopped' });
      expect(row.ownerId).toBeUndefined();
    }
    const report = logs.find((line) => line.startsWith('Cleanup after the stop'))!;
    expect(report).toMatch(/3 cleaned, 0 not cleaned/);
    expect(report).toMatch(/cleaned: scrape run .* closed as interrupted \(lease_renewal_failed\)/);
    expect(report).toMatch(/cleaned: development source lock "lease-stop-fixture-lane": released/);
    expect(report).toMatch(/cleaned: Development write leases of owner .*: released 4 lease\(s\)/);
    expect(logs.findIndex((line) => line.startsWith('Renewal failed'))).toBeLessThan(
      logs.indexOf(report),
    );
    expect(
      at - START - DEV_WRITE_LEASE_RENEWAL_DEADLINE_MS - DEV_WRITE_LEASE_HEARTBEAT_MS,
    ).toBeLessThan(DEV_WRITE_STOP_CLEANUP_WINDOW_MS);
    expect(await ScrapeRun.countDocuments({ status: 'running' })).toBe(0);
  });
});

describe('a database that never returns', () => {
  it('exits with the stop exit code within the cleanup bound when every cleanup write fails', async () => {
    useRuntime({ cleanupAttemptTimeoutMs: 200 });
    const lane = await startLaneRunHoldingEverything();
    outage = 'reject';
    await stopForMissedRenewals();
    const stoppedAt = at;
    lane.release();
    await lane.settled;
    await exited;

    expect(exitCodes).toEqual([DEV_WRITE_LEASE_STOP_EXIT_CODE]);
    expect(at - stoppedAt).toBeLessThanOrEqual(DEV_WRITE_STOP_CLEANUP_WINDOW_MS);
    const report = logs.find((line) => line.startsWith('Cleanup after the stop'))!;
    expect(report).toMatch(/0 cleaned, 3 not cleaned/);
    expect(report).toMatch(
      /not cleaned: scrape run .*connection to the database closed; it is left to expire on its own/,
    );
    expect(report).toMatch(/not cleaned: development source lock/);
    expect(report).toMatch(/not cleaned: Development write leases of owner/);
  });

  it('exits within the cleanup bound when every cleanup write hangs', async () => {
    useRuntime({ heartbeatTimeoutMs: 25, cleanupAttemptTimeoutMs: 20 });
    const lane = await startLaneRunHoldingEverything();
    outage = 'hang';
    const started = Date.now();
    await stopForMissedRenewals();
    const stoppedAt = at;
    lane.release();
    await exited;

    expect(exitCodes).toEqual([DEV_WRITE_LEASE_STOP_EXIT_CODE]);
    expect(at - stoppedAt).toBeLessThanOrEqual(DEV_WRITE_STOP_CLEANUP_WINDOW_MS);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(logs.find((line) => line.startsWith('Cleanup after the stop'))).toMatch(
      /0 cleaned, 3 not cleaned[\s\S]*timed out after 20 ms/,
    );
    outage = 'none';
    await lane.settled;
  });
});

describe('the stop cleanup path', () => {
  it('admits only its own scrape_runs and scrape_job_locks writes, and nothing outside it', async () => {
    const runId = new mongoose.Types.ObjectId();
    await db
      .collection('scrape_runs')
      .insertOne({ _id: runId, sourceName: FIXTURE_LANE, status: 'running' });
    const outsideCollection: unknown[] = [];
    registerDevWriteStopCleanup({
      description: 'a cleanup that writes outside the stop collections',
      run: async () => {
        await Source.updateOne({ name: FIXTURE_LANE }, { $set: { displayName: 'From a cleanup' } });
        return 'written';
      },
    });
    registerDevWriteStopCleanup({
      description: 'the run row',
      run: async () => {
        await ScrapeRun.updateOne({ _id: runId }, { $set: { status: 'interrupted' } });
        return 'closed';
      },
    });

    enterDevWriteStoppedMode('no-progress');
    await ScrapeRun.updateOne({ _id: runId }, { $set: { status: 'success' } }).catch((error) =>
      outsideCollection.push(error),
    );
    const outcomes = await runDevWriteStopCleanups({
      now,
      sleep: async (ms) => advance(ms),
      attemptTimeoutMs: 200,
    });

    expect(outsideCollection[0]).toBeInstanceOf(DevWriteRefusedError);
    expect(outcomes).toEqual([
      expect.objectContaining({
        description: 'a cleanup that writes outside the stop collections',
        cleaned: false,
        detail: expect.stringMatching(/Refused updateOne on model Source/),
      }),
      expect.objectContaining({
        description: 'the run row',
        cleaned: true,
        detail: 'closed',
        attempts: 1,
      }),
    ]);
    expect(await db.collection('scrape_runs').findOne({ _id: runId })).toMatchObject({
      status: 'interrupted',
    });
    expect(await db.collection(Source.collection.collectionName).findOne({})).toMatchObject({
      displayName: 'Fixture lane',
    });
    expect(await runDevWriteStopCleanups({ now, sleep: async () => undefined })).toEqual([]);
  });
});

describe('a child process that joined its parent owner', () => {
  it('releases none of the leases its parent owns, and reports them as left to the parent', async () => {
    useRuntime({ cleanupAttemptTimeoutMs: 200 });
    await acquireDevWriteLease(
      { name: DEV_APPLY_LEASE_NAME, command: 'scrape:sweep' },
      { db, env: LEASE_ENV, now, newOwnerId: () => 'parent-owner' },
    );
    process.env[DEV_WRITE_LEASE_OWNER_ENV] = 'parent-owner';
    const descriptor = { db, databaseName: db.databaseName, host: 'cluster.example.net' };
    recordDevApplyIntent('scrape:fixture', []);
    await acquireIntendedDevApplyLease(descriptor, LEASE_ENV);
    armDevHostLeases(descriptor, 'scrape run', LEASE_ENV);
    await ensureDevHostLease(HOSTS[0]);

    outage = 'reject';
    onSleep = () => {
      outage = 'none';
    };
    await stopForMissedRenewals();
    await exited;

    expect(exitCodes).toEqual([DEV_WRITE_LEASE_STOP_EXIT_CODE]);
    const rows = await heldLeaseRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toMatchObject({ locked: true, ownerId: 'parent-owner' });
    expect(logs.find((line) => line.startsWith('Cleanup after the stop'))).toMatch(
      /not cleaned: 2 lease\(s\) joined from the parent owner .*the parent owner releases them/,
    );
  });
});
