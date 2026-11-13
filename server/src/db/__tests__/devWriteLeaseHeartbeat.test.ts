import { Collection, MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEV_APPLY_LEASE_NAME,
  DEV_HOST_LEASE_IDLE_RELEASE_MS,
  DEV_WRITE_LEASE_COLLECTION,
  DEV_WRITE_LEASE_HEARTBEAT_MS,
  DEV_WRITE_LEASE_HEARTBEAT_TIMEOUT_MS,
  DEV_WRITE_LEASE_OWNER_ENV,
  DEV_WRITE_LEASE_RENEWAL_DEADLINE_MS,
  DevWriteLeaseStoppedError,
  acquireDevWriteLease,
  acquireIntendedDevApplyLease,
  armDevHostLeases,
  devHostLeaseName,
  ensureDevHostLease,
  recordDevApplyIntent,
  releaseDevHostLease,
  releaseHeldDevWriteLeases,
  resetDevWriteLeaseStateForTests,
  runDevWriteLeaseHeartbeatTick,
  setDevWriteLeaseRuntimeForTests,
  type DevWriteLeaseRecord,
  type DevWriteLeaseStop,
} from '../devWriteLease';

const LEASE_ON: NodeJS.ProcessEnv = { DEV_WRITE_OWNER: 'test-session' };
const START = Date.UTC(2026, 10, 11, 9);

let memoryServer: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let at: number;
let stops: DevWriteLeaseStop[];
let logs: string[];

const now = () => new Date(at);
const advance = (ms: number) => {
  at += ms;
};
const leases = () => db.collection<DevWriteLeaseRecord>(DEV_WRITE_LEASE_COLLECTION);
const lease = (name: string) => leases().findOne({ _id: `development:${name}` });
const hosts = (count: number) => Array.from({ length: count }, (_, i) => `host-${i}.example.edu`);
const descriptor = () => ({ db, databaseName: db.databaseName, host: 'cluster.example.net' });

async function holdHosts(names: string[]) {
  armDevHostLeases(descriptor(), 'scrape run', LEASE_ON);
  for (const host of names) await ensureDevHostLease(host);
}

async function tickEvery(intervalMs: number, ticks: number) {
  for (let i = 0; i < ticks; i += 1) {
    advance(intervalMs);
    await runDevWriteLeaseHeartbeatTick();
  }
}

beforeAll(async () => {
  memoryServer = await MongoMemoryServer.create();
  client = await MongoClient.connect(memoryServer.getUri());
});

afterAll(async () => {
  await client?.close();
  await memoryServer?.stop();
});

beforeEach(async () => {
  resetDevWriteLeaseStateForTests();
  delete process.env[DEV_WRITE_LEASE_OWNER_ENV];
  process.env.DEV_WRITE_OWNER = 'test-session';
  db = client.db('Development');
  await db.dropDatabase();
  at = START;
  stops = [];
  logs = [];
  setDevWriteLeaseRuntimeForTests({
    now,
    log: (message) => logs.push(message),
    stop: (stop) => stops.push(stop),
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await releaseHeldDevWriteLeases();
  resetDevWriteLeaseStateForTests();
  delete process.env[DEV_WRITE_LEASE_OWNER_ENV];
  delete process.env.DEV_WRITE_OWNER;
});

describe('the heartbeat tick', () => {
  it('renews every held lease of an owner in one bounded operation', async () => {
    await holdHosts(hosts(25));
    const updateMany = vi.spyOn(Collection.prototype, 'updateMany');

    advance(DEV_WRITE_LEASE_HEARTBEAT_MS);
    await runDevWriteLeaseHeartbeatTick();

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][2]).toMatchObject({
      maxTimeMS: DEV_WRITE_LEASE_HEARTBEAT_TIMEOUT_MS,
      timeoutMS: DEV_WRITE_LEASE_HEARTBEAT_TIMEOUT_MS,
    });
    const renewed = await leases().countDocuments({ heartbeatAt: now(), locked: true });
    expect(renewed).toBe(25);
    expect(stops).toEqual([]);
  });

  it('stops on exactly the leases a partial match no longer covers', async () => {
    await holdHosts(hosts(4));
    await leases().updateMany(
      {
        sourceName: {
          $in: [devHostLeaseName('host-1.example.edu'), devHostLeaseName('host-3.example.edu')],
        },
      },
      { $set: { ownerId: 'another-run' } },
    );

    advance(DEV_WRITE_LEASE_HEARTBEAT_MS);
    await runDevWriteLeaseHeartbeatTick();

    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({
      reason: 'lost',
      leases: ['host:host-1.example.edu', 'host:host-3.example.edu'],
    });
    expect(stops[0].message).toMatch(/Lost the Development write lease/);
    await expect(ensureDevHostLease('host-0.example.edu')).rejects.toBeInstanceOf(
      DevWriteLeaseStoppedError,
    );
  });

  it('logs a rejected heartbeat with the lease names and keeps going while renewals recover in time', async () => {
    await holdHosts(hosts(2));
    vi.spyOn(Collection.prototype, 'updateMany')
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockRejectedValueOnce(new Error('connection reset'));

    await tickEvery(DEV_WRITE_LEASE_HEARTBEAT_MS, 2);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatch(
      /heartbeat failed for "host:host-0.example.edu", "host:host-1.example.edu": connection reset/,
    );

    await tickEvery(DEV_WRITE_LEASE_HEARTBEAT_MS, 10);
    expect(stops).toEqual([]);
  });

  it('stops once a lease goes past the deadline without a renewal, listing exactly the stale leases and since when', async () => {
    await holdHosts(['early.example.edu']);
    const earlyRenewal = now();
    vi.spyOn(Collection.prototype, 'updateMany').mockRejectedValue(new Error('not primary'));

    await tickEvery(DEV_WRITE_LEASE_HEARTBEAT_MS, 2);
    await ensureDevHostLease('late.example.edu');

    await tickEvery(DEV_WRITE_LEASE_HEARTBEAT_MS, 2);
    expect(stops).toEqual([]);
    expect(logs).toHaveLength(4);

    await tickEvery(DEV_WRITE_LEASE_HEARTBEAT_MS, 1);
    expect(stops).toHaveLength(1);
    const stop = stops[0];
    expect(stop.reason).toBe('renewal-failed');
    expect(stop.leases).toEqual([
      {
        name: 'host:early.example.edu',
        lastRenewedAt: earlyRenewal,
        withoutRenewalMs: DEV_WRITE_LEASE_RENEWAL_DEADLINE_MS + DEV_WRITE_LEASE_HEARTBEAT_MS,
      },
    ]);
    expect(stop.message).toContain('Renewal failed');
    expect(stop.message).toContain(
      `"host:early.example.edu": last renewed ${earlyRenewal.toISOString()}, 150 s without a renewal`,
    );
    expect(stop.message).not.toContain('late.example.edu');
    await expect(ensureDevHostLease('late.example.edu')).rejects.toBeInstanceOf(
      DevWriteLeaseStoppedError,
    );
  });

  it('stops a fetch to a fresh lease while another held lease is past the deadline', async () => {
    await holdHosts(['early.example.edu']);
    const earlyRenewal = now();
    vi.spyOn(Collection.prototype, 'updateMany').mockRejectedValue(new Error('not primary'));

    await tickEvery(DEV_WRITE_LEASE_HEARTBEAT_MS, 2);
    await ensureDevHostLease('late.example.edu');
    await tickEvery(DEV_WRITE_LEASE_HEARTBEAT_MS, 2);
    expect(stops).toEqual([]);

    advance(1_000);
    await expect(ensureDevHostLease('late.example.edu')).rejects.toBeInstanceOf(
      DevWriteLeaseStoppedError,
    );
    await expect(ensureDevHostLease('new.example.edu')).rejects.toBeInstanceOf(
      DevWriteLeaseStoppedError,
    );
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({
      reason: 'renewal-failed',
      leases: [
        { name: 'host:early.example.edu', lastRenewedAt: earlyRenewal, withoutRenewalMs: 121_000 },
      ],
    });
    expect(await lease(devHostLeaseName('new.example.edu'))).toBeNull();
  });

  it('bounds a heartbeat that never settles, then stops before the next fetch with the stale list', async () => {
    setDevWriteLeaseRuntimeForTests({
      now,
      heartbeatTimeoutMs: 25,
      log: (message) => logs.push(message),
      stop: (stop) => stops.push(stop),
    });
    await holdHosts(['a.example.edu', 'b.example.edu']);
    const lastRenewal = now();
    vi.spyOn(Collection.prototype, 'updateMany').mockImplementation(
      () => new Promise<never>(() => undefined),
    );

    const started = Date.now();
    await tickEvery(DEV_WRITE_LEASE_HEARTBEAT_MS, 4);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(logs).toHaveLength(4);
    expect(logs[0]).toMatch(/heartbeat failed for .*timed out after 25 ms/);
    expect(stops).toEqual([]);

    advance(DEV_WRITE_LEASE_HEARTBEAT_MS);
    await expect(ensureDevHostLease('b.example.edu')).rejects.toBeInstanceOf(
      DevWriteLeaseStoppedError,
    );
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({
      reason: 'renewal-failed',
      leases: ['host:a.example.edu', 'host:b.example.edu'].map((name) => ({
        name,
        lastRenewedAt: lastRenewal,
        withoutRenewalMs: 150_000,
      })),
    });

    await runDevWriteLeaseHeartbeatTick();
    expect(stops).toHaveLength(1);
  });

  it('stops at a tick with every stale lease when the hung heartbeat outlasts the deadline', async () => {
    setDevWriteLeaseRuntimeForTests({
      now,
      heartbeatTimeoutMs: 25,
      log: (message) => logs.push(message),
      stop: (stop) => stops.push(stop),
    });
    await holdHosts(['a.example.edu', 'b.example.edu']);
    const lastRenewal = now();
    vi.spyOn(Collection.prototype, 'updateMany').mockImplementation(
      () => new Promise<never>(() => undefined),
    );

    await tickEvery(DEV_WRITE_LEASE_HEARTBEAT_MS, 5);

    expect(stops).toHaveLength(1);
    expect(stops[0].reason).toBe('renewal-failed');
    expect(stops[0].leases).toEqual(
      ['host:a.example.edu', 'host:b.example.edu'].map((name) => ({
        name,
        lastRenewedAt: lastRenewal,
        withoutRenewalMs: 150_000,
      })),
    );
  });
});

describe('idle host leases', () => {
  it('are released after ten minutes without a fetch and taken again on the next one', async () => {
    await holdHosts(['busy.example.edu', 'quiet.example.edu']);
    const ownerId = (await lease('host:busy.example.edu'))?.ownerId;

    for (let elapsed = 0; elapsed < DEV_HOST_LEASE_IDLE_RELEASE_MS;) {
      advance(DEV_WRITE_LEASE_HEARTBEAT_MS);
      elapsed += DEV_WRITE_LEASE_HEARTBEAT_MS;
      await ensureDevHostLease('busy.example.edu');
      await runDevWriteLeaseHeartbeatTick();
    }

    expect(await lease('host:quiet.example.edu')).toMatchObject({
      locked: false,
      releaseReason: 'idle',
    });
    expect(await lease('host:busy.example.edu')).toMatchObject({ locked: true, ownerId });
    expect(logs.some((line) => line.includes('Released idle Development host lease'))).toBe(true);

    await ensureDevHostLease('quiet.example.edu');
    expect(await lease('host:quiet.example.edu')).toMatchObject({ locked: true, ownerId });
    await tickEvery(DEV_WRITE_LEASE_HEARTBEAT_MS, 1);
    expect(stops).toEqual([]);
  });

  it('a released host lease taken meanwhile by another run is refused on the next fetch', async () => {
    await holdHosts(['shared.example.edu']);
    await tickEvery(DEV_HOST_LEASE_IDLE_RELEASE_MS, 1);
    await acquireDevWriteLease(
      { name: 'host:shared.example.edu', command: 'other run' },
      { db, env: {}, now, newOwnerId: () => 'other-run' },
    );

    await expect(ensureDevHostLease('shared.example.edu')).rejects.toThrow(/held by/);
  });

  it('the apply lease is never idle-released', async () => {
    recordDevApplyIntent('repair:thing', ['--apply']);
    await acquireIntendedDevApplyLease(descriptor(), LEASE_ON);

    await tickEvery(
      DEV_WRITE_LEASE_HEARTBEAT_MS,
      (3 * DEV_HOST_LEASE_IDLE_RELEASE_MS) / DEV_WRITE_LEASE_HEARTBEAT_MS,
    );

    expect(await lease(DEV_APPLY_LEASE_NAME)).toMatchObject({ locked: true, heartbeatAt: now() });
    expect(stops).toEqual([]);
  });

  it('a child never idle-releases the host lease it joined from its parent', async () => {
    await acquireDevWriteLease(
      { name: 'host:parent.example.edu', command: 'sweep' },
      { db, env: {}, now, newOwnerId: () => 'sweep-owner' },
    );
    process.env[DEV_WRITE_LEASE_OWNER_ENV] = 'sweep-owner';
    await holdHosts(['parent.example.edu', 'own.example.edu']);

    await tickEvery(
      DEV_WRITE_LEASE_HEARTBEAT_MS,
      (2 * DEV_HOST_LEASE_IDLE_RELEASE_MS) / DEV_WRITE_LEASE_HEARTBEAT_MS,
    );

    expect(await lease('host:parent.example.edu')).toMatchObject({
      locked: true,
      ownerId: 'sweep-owner',
      heartbeatAt: now(),
    });
    expect(await lease('host:own.example.edu')).toMatchObject({
      locked: true,
      ownerId: 'sweep-owner',
    });
    expect(stops).toEqual([]);
  });
});

describe('finished host leases', () => {
  it('a finished host is released while the others stay held, and taken again on the next fetch', async () => {
    await holdHosts(['done.example.edu', 'busy.example.edu']);
    const ownerId = (await lease('host:busy.example.edu'))?.ownerId;

    await releaseDevHostLease('done.example.edu');

    expect(await lease('host:done.example.edu')).toMatchObject({
      locked: false,
      releaseReason: 'host-done',
    });
    expect(await lease('host:busy.example.edu')).toMatchObject({ locked: true, ownerId });
    expect(logs.some((line) => line.includes('Released finished Development host lease'))).toBe(
      true,
    );

    await ensureDevHostLease('done.example.edu');
    expect(await lease('host:done.example.edu')).toMatchObject({ locked: true, ownerId });
  });

  it('a host handed back while a renewal is in flight does not stop the run as lost', async () => {
    await holdHosts(['done.example.edu', 'busy.example.edu']);
    const updateMany = Collection.prototype.updateMany;
    let handedBack = false;
    vi.spyOn(Collection.prototype, 'updateMany').mockImplementation(async function (
      this: Collection,
      ...args: Parameters<Collection['updateMany']>
    ) {
      if (!handedBack) {
        handedBack = true;
        await releaseDevHostLease('done.example.edu');
      }
      return updateMany.apply(this, args);
    });

    advance(DEV_WRITE_LEASE_HEARTBEAT_MS);
    await runDevWriteLeaseHeartbeatTick();

    expect(handedBack).toBe(true);
    expect(stops).toEqual([]);
    expect(await lease('host:done.example.edu')).toMatchObject({
      locked: false,
      releaseReason: 'host-done',
    });
    expect(await lease('host:busy.example.edu')).toMatchObject({
      locked: true,
      heartbeatAt: now(),
    });
  });

  it('a finished host taken by another run is not touched by the end-of-run cleanup', async () => {
    await holdHosts(['done.example.edu', 'busy.example.edu']);
    await releaseDevHostLease('done.example.edu');
    await acquireDevWriteLease(
      { name: 'host:done.example.edu', command: 'other run' },
      { db, env: {}, now, newOwnerId: () => 'other-run' },
    );

    await releaseHeldDevWriteLeases();

    expect(await lease('host:busy.example.edu')).toMatchObject({ locked: false });
    expect(await lease('host:done.example.edu')).toMatchObject({
      locked: true,
      ownerId: 'other-run',
    });
  });

  it('a child never releases the host lease it joined from its parent', async () => {
    await acquireDevWriteLease(
      { name: 'host:parent.example.edu', command: 'sweep' },
      { db, env: {}, now, newOwnerId: () => 'sweep-owner' },
    );
    process.env[DEV_WRITE_LEASE_OWNER_ENV] = 'sweep-owner';
    await holdHosts(['parent.example.edu']);

    await releaseDevHostLease('parent.example.edu');

    expect(await lease('host:parent.example.edu')).toMatchObject({
      locked: true,
      ownerId: 'sweep-owner',
    });
  });

  it('does nothing for an unarmed run', async () => {
    await acquireDevWriteLease(
      { name: 'host:elsewhere.example.edu', command: 'other run' },
      { db, env: {}, now, newOwnerId: () => 'other-run' },
    );

    await releaseDevHostLease('elsewhere.example.edu');

    expect(await lease('host:elsewhere.example.edu')).toMatchObject({
      locked: true,
      ownerId: 'other-run',
    });
  });
});
