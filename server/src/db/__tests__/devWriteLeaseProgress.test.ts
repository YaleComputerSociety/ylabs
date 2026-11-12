import axios from 'axios';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEV_APPLY_LEASE_NAME,
  DEV_WRITE_LEASE_COLLECTION,
  DEV_WRITE_LEASE_HEARTBEAT_MS,
  DEV_WRITE_LEASE_NO_PROGRESS_STOP_MS,
  DEV_WRITE_LEASE_OWNER_ENV,
  DEV_WRITE_LEASE_STALLED_MS,
  DevWriteLeaseHeldError,
  DevWriteLeaseStoppedError,
  acquireDevWriteLease,
  acquireIntendedDevApplyLease,
  armDevHostLeases,
  ensureDevHostLease,
  markDevWriteLeaseHeldForChildProcesses,
  recordDevApplyIntent,
  releaseHeldDevWriteLeases,
  resetDevWriteLeaseStateForTests,
  runDevWriteLeaseHeartbeatTick,
  setDevWriteLeaseRuntimeForTests,
  type DevWriteLeaseRecord,
  type DevWriteLeaseStop,
  UNMONITORED_LEASE_CLIENT_WARNING,
} from '../devWriteLease';
import {
  countsAsDevWriteProgress,
  devWriteProgress,
  recordDevWriteProgress,
  watchMongoClientProgress,
} from '../devWriteProgress';
import { SCRIPT_SOCKET_TIMEOUT_MS } from '../connections';
import { describeDevLocks, formatDevLocksTable } from '../../scripts/devWriteLocks';

const LEASE_ON: NodeJS.ProcessEnv = { DEV_WRITE_OWNER: 'test-session' };
const START = Date.UTC(2026, 10, 11, 9);
const MINUTE = 60_000;
const TICKS_PER_MINUTE = MINUTE / DEV_WRITE_LEASE_HEARTBEAT_MS;

let memoryServer: MongoMemoryServer;
let monitoredClient: MongoClient;
let unmonitoredClient: MongoClient;
let unboundedSocketClient: MongoClient;
let db: Db;
let at: number;
let stops: DevWriteLeaseStop[];

const now = () => new Date(at);
const leases = () => db.collection<DevWriteLeaseRecord>(DEV_WRITE_LEASE_COLLECTION);
const lease = (name: string) => leases().findOne({ _id: `development:${name}` });
const descriptor = (target: Db = db) => ({
  db: target,
  databaseName: target.databaseName,
  host: 'cluster.example.net',
});
const locks = async () => describeDevLocks(await leases().find().toArray(), now());
const applyLockRow = async () => (await locks()).find((row) => row.name === DEV_APPLY_LEASE_NAME);

async function holdApplyLease(target: Db = db) {
  recordDevApplyIntent('repair:thing', ['--apply']);
  return acquireIntendedDevApplyLease(descriptor(target), LEASE_ON);
}

async function tickMinutes(minutes: number, eachTick: () => Promise<void> = async () => undefined) {
  for (let i = 0; i < minutes * TICKS_PER_MINUTE; i += 1) {
    at += DEV_WRITE_LEASE_HEARTBEAT_MS;
    await eachTick();
    await runDevWriteLeaseHeartbeatTick();
  }
}

beforeAll(async () => {
  memoryServer = await MongoMemoryServer.create();
  monitoredClient = await MongoClient.connect(memoryServer.getUri(), {
    monitorCommands: true,
    socketTimeoutMS: SCRIPT_SOCKET_TIMEOUT_MS,
  });
  unmonitoredClient = await MongoClient.connect(memoryServer.getUri());
  unboundedSocketClient = await MongoClient.connect(memoryServer.getUri(), {
    monitorCommands: true,
  });
});

afterAll(async () => {
  await monitoredClient?.close();
  await unmonitoredClient?.close();
  await unboundedSocketClient?.close();
  await memoryServer?.stop();
});

beforeEach(async () => {
  db = monitoredClient.db('Development');
  await db.dropDatabase();
  resetDevWriteLeaseStateForTests();
  delete process.env[DEV_WRITE_LEASE_OWNER_ENV];
  process.env.DEV_WRITE_OWNER = 'test-session';
  at = START;
  stops = [];
  setDevWriteLeaseRuntimeForTests({
    now,
    log: () => undefined,
    stop: (stop) => stops.push(stop),
  });
});

afterEach(async () => {
  await releaseHeldDevWriteLeases();
  resetDevWriteLeaseStateForTests();
  delete process.env[DEV_WRITE_LEASE_OWNER_ENV];
  delete process.env.DEV_WRITE_OWNER;
});

describe('the no-progress window', () => {
  it('sits above the script socket timeout and the STALLED flag', () => {
    expect(DEV_WRITE_LEASE_NO_PROGRESS_STOP_MS).toBeGreaterThan(SCRIPT_SOCKET_TIMEOUT_MS);
    expect(DEV_WRITE_LEASE_NO_PROGRESS_STOP_MS).toBeGreaterThan(DEV_WRITE_LEASE_STALLED_MS);
  });
});

describe('a heartbeating holder that makes no progress', () => {
  it('is flagged STALLED at 15 minutes and stops itself at 20, listing the leases it held', async () => {
    await holdApplyLease();
    armDevHostLeases(descriptor(), 'scrape run', LEASE_ON);
    const acquiredAt = now();

    await tickMinutes(14);
    expect(await applyLockRow()).toMatchObject({ minutesWithoutProgress: 14, stalled: false });

    await tickMinutes(1);
    const rows = await locks();
    expect(rows.find((row) => row.name === DEV_APPLY_LEASE_NAME)).toMatchObject({
      state: 'live',
      heartbeatAgeSeconds: 0,
      minutesWithoutProgress: 15,
      stalled: true,
    });
    expect(JSON.parse(JSON.stringify(rows))[0]).toMatchObject({ stalled: true });
    expect(formatDevLocksTable(rows)).toContain('STALLED, no progress for 15 min');
    expect(stops).toEqual([]);

    await tickMinutes(4.5);
    expect(stops).toEqual([]);

    await tickMinutes(0.5);
    expect(stops).toHaveLength(1);
    const stop = stops[0];
    expect(stop).toMatchObject({
      reason: 'no-progress',
      leases: [DEV_APPLY_LEASE_NAME],
      lastProgressAt: acquiredAt,
      withoutProgressMs: DEV_WRITE_LEASE_NO_PROGRESS_STOP_MS,
    });
    expect(stop.message).toContain('No progress for 20 min');
    expect(stop.message).toContain(
      `"${DEV_APPLY_LEASE_NAME}": last progress ${acquiredAt.toISOString()}, 20 min without progress`,
    );
    await expect(ensureDevHostLease('next.example.edu')).rejects.toBeInstanceOf(
      DevWriteLeaseStoppedError,
    );
    expect(await lease('host:next.example.edu')).toBeNull();
  });

  it('counts none of its own heartbeats as progress', async () => {
    await holdApplyLease();
    const before = devWriteProgress().count;

    await tickMinutes(10);

    expect(devWriteProgress().count).toBe(before);
    expect(await lease(DEV_APPLY_LEASE_NAME)).toMatchObject({
      heartbeatAt: now(),
      progressAt: new Date(START),
      progressCount: before,
    });
    expect(stops).toEqual([]);
    await tickMinutes(10);
    expect(devWriteProgress().count).toBe(before);
    expect(stops).toMatchObject([{ reason: 'no-progress', leases: [DEV_APPLY_LEASE_NAME] }]);
  });

  it('cannot be taken over by another owner while it still heartbeats', async () => {
    await holdApplyLease();
    await tickMinutes(16);
    expect(await applyLockRow()).toMatchObject({ stalled: true });

    const takeOver = (host: string) =>
      acquireDevWriteLease(
        { name: DEV_APPLY_LEASE_NAME, command: 'another apply' },
        {
          db,
          env: {},
          now,
          host,
          pid: process.pid + 1,
          isLocalProcessAlive: () => false,
          newOwnerId: () => 'another-run',
        },
      );

    for (const host of ['another-host', (await lease(DEV_APPLY_LEASE_NAME))!.ownerHost!]) {
      const refusal = await takeOver(host).catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(DevWriteLeaseHeldError);
      expect((refusal as Error).message).toContain('no progress for 16 min');
    }
    expect(await lease(DEV_APPLY_LEASE_NAME)).not.toMatchObject({ ownerId: 'another-run' });
  });
});

describe('a holder making progress', () => {
  it('is never stopped or flagged over six hours of steady database work', async () => {
    await holdApplyLease();
    const before = devWriteProgress().count;
    const work = db.collection('repair_work');
    let minute = 0;

    for (let hour = 0; hour < 6; hour += 1) {
      await tickMinutes(60, async () => {
        minute += 0.5;
        if (minute % 5 === 0) {
          await work.updateOne({ name: 'batch' }, { $inc: { done: 1 } }, { upsert: true });
        }
      });
      expect(await applyLockRow()).toMatchObject({ stalled: false });
    }

    expect(stops).toEqual([]);
    const record = await lease(DEV_APPLY_LEASE_NAME);
    expect(record?.progressCount).toBe(before + 6 * 12);
    expect(record?.progressAt?.getTime()).toBe(START + 6 * 60 * MINUTE);
  });

  it('counts every settled outbound request, through axios or fetch, as progress', async () => {
    const server = createServer((request, response) => {
      response.statusCode = request.url === '/missing' ? 404 : 200;
      response.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      await holdApplyLease();
      const before = devWriteProgress().count;
      const requests = [
        () => axios.get(`${origin}/page`),
        () => fetch(`${origin}/page`).then((response) => response.text()),
        () => axios.get(`${origin}/missing`).catch(() => undefined),
      ];
      let minute = 0;

      await tickMinutes(60, async () => {
        minute += 0.5;
        if (minute % 10 === 0) await requests[(minute / 10) % requests.length]();
      });

      expect(stops).toEqual([]);
      expect(devWriteProgress().count).toBe(before + 6);
      expect(await lease(DEV_APPLY_LEASE_NAME)).toMatchObject({
        progressCount: before + 6,
        progressAt: new Date(START + 60 * MINUTE),
      });

      await tickMinutes(20);
      expect(stops).toMatchObject([
        {
          reason: 'no-progress',
          leases: [DEV_APPLY_LEASE_NAME],
          lastProgressAt: new Date(START + 60 * MINUTE),
        },
      ]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('keeps the newest progress when a parent and its child renew the same lease', async () => {
    await holdApplyLease();
    await tickMinutes(1);
    await leases().updateOne(
      { _id: `development:${DEV_APPLY_LEASE_NAME}` },
      { $set: { progressAt: new Date(START + 5 * MINUTE) } },
    );

    await tickMinutes(1);

    expect(await lease(DEV_APPLY_LEASE_NAME)).toMatchObject({
      progressAt: new Date(START + 5 * MINUTE),
    });
  });
});

describe('a holder whose progress cannot be judged', () => {
  it('is never stopped when it holds the lease for child processes', async () => {
    markDevWriteLeaseHeldForChildProcesses();
    await holdApplyLease();

    await tickMinutes(30);

    expect(stops).toEqual([]);
  });

  it('is never stopped when its lease connection reports no commands, and says so loudly once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const unmonitored = unmonitoredClient.db('Development');
    await holdApplyLease(unmonitored);
    armDevHostLeases(descriptor(unmonitored), 'scrape run', LEASE_ON);
    await ensureDevHostLease('next.example.edu');

    await tickMinutes(30);

    expect(stops).toEqual([]);
    const warnings = warn.mock.calls.filter(([message]) =>
      String(message).includes(UNMONITORED_LEASE_CLIENT_WARNING),
    );
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0][0])).toMatch(/monitorCommands: true/);
    warn.mockRestore();
  });

  it('gives no warning for a lease held through a monitored connection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await holdApplyLease(monitoredClient.db('Development'));
    expect(
      warn.mock.calls.some(([message]) =>
        String(message).includes(UNMONITORED_LEASE_CLIENT_WARNING),
      ),
    ).toBe(false);
    warn.mockRestore();
  });

  it('is flagged but never stopped when a connection it uses has no socket ceiling', async () => {
    await holdApplyLease();
    expect(watchMongoClientProgress(unboundedSocketClient)).toBe(true);

    await tickMinutes(30);

    expect(await applyLockRow()).toMatchObject({ minutesWithoutProgress: 30, stalled: true });
    expect(stops).toEqual([]);
  });
});

describe('dev:locks progress', () => {
  const owner = 'sweep-owner';
  const record = (overrides: Partial<DevWriteLeaseRecord>): DevWriteLeaseRecord => ({
    _id: 'development:x',
    sourceName: 'x',
    locked: true,
    ownerId: owner,
    heartbeatAt: new Date(START - 10_000),
    leaseExpiresAt: new Date(START + MINUTE),
    ...overrides,
  });

  it("judges the apply lease by its owner's newest progress and every other lease by its own", () => {
    const rows = describeDevLocks(
      [
        record({ sourceName: DEV_APPLY_LEASE_NAME, progressAt: new Date(START - 40 * MINUTE) }),
        record({ sourceName: 'host:busy.example.edu', progressAt: new Date(START - 2 * MINUTE) }),
        record({ sourceName: 'host:hung.example.edu', progressAt: new Date(START - 17 * MINUTE) }),
        record({
          sourceName: 'host:other.example.edu',
          ownerId: 'other-owner',
          progressAt: new Date(START - 16 * MINUTE),
        }),
        record({ sourceName: 'legacy-holder', ownerId: 'legacy-owner' }),
      ],
      new Date(START),
    );

    expect(rows.map((row) => [row.name, row.minutesWithoutProgress, row.stalled])).toEqual([
      [DEV_APPLY_LEASE_NAME, 2, false],
      ['host:busy.example.edu', 2, false],
      ['host:hung.example.edu', 17, true],
      ['host:other.example.edu', 16, true],
      ['legacy-holder', undefined, undefined],
    ]);
  });
});

describe('what counts as progress', () => {
  it('excludes lease traffic, heartbeat-shaped writes and driver liveness commands', () => {
    expect(countsAsDevWriteProgress('ping', { ping: 1 })).toBe(false);
    expect(countsAsDevWriteProgress('hello', { hello: 1 })).toBe(false);
    expect(countsAsDevWriteProgress('find', { find: DEV_WRITE_LEASE_COLLECTION, filter: {} })).toBe(
      false,
    );
    expect(
      countsAsDevWriteProgress('update', {
        update: 'scrape_runs',
        updates: [{ q: {}, u: { $set: { heartbeatAt: new Date(), updatedAt: new Date() } } }],
      }),
    ).toBe(false);

    expect(
      countsAsDevWriteProgress('update', {
        update: 'scrape_runs',
        updates: [{ q: {}, u: { $set: { heartbeatAt: new Date(), observationCount: 3 } } }],
      }),
    ).toBe(true);
    expect(countsAsDevWriteProgress('insert', { insert: 'observations', documents: [{}] })).toBe(
      true,
    );
    expect(countsAsDevWriteProgress('getMore', { getMore: 1, collection: 'researchers' })).toBe(
      true,
    );
  });

  it('records a direct progress report', () => {
    const before = devWriteProgress().count;
    at += MINUTE;
    recordDevWriteProgress();
    expect(devWriteProgress()).toEqual({ count: before + 1, lastAt: now() });
  });
});
