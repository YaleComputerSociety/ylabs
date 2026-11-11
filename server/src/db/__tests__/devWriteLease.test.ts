import fs from 'node:fs';
import path from 'node:path';

import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  DEV_APPLY_LEASE_NAME,
  DEV_WRITE_LEASE_COLLECTION,
  DEV_WRITE_LEASE_HEARTBEAT_MS,
  DEV_WRITE_LEASE_OWNER_ENV,
  DEV_WRITE_LEASE_TTL_MS,
  DevWriteLeaseHeldError,
  acquireDevWriteLease,
  acquireIntendedDevApplyLease,
  armDevHostLeases,
  ensureDevHostLease,
  recordDevApplyIntent,
  recordDevDryRunIntent,
  releaseHeldDevWriteLeases,
  resetDevWriteLeaseStateForTests,
  resolveDevWriteLeaseTarget,
  type DevWriteLeaseRecord,
} from '../devWriteLease';
import { describeDevLocks, parseDevLocksArgs, releasableByHand } from '../../scripts/devWriteLocks';

const SERVER_SRC = path.resolve(__dirname, '../..');
const LEASE_ON: NodeJS.ProcessEnv = {};

let memoryServer: MongoMemoryServer;
let client: MongoClient;

const database = (name: string): Db => client.db(name);
const leases = (db: Db) => db.collection<DevWriteLeaseRecord>(DEV_WRITE_LEASE_COLLECTION);
const descriptor = (db: Db) => ({ db, databaseName: db.databaseName, host: 'cluster.example.net' });

class Clock {
  constructor(private at: number) {}
  now = () => new Date(this.at);
  advance(ms: number) {
    this.at += ms;
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

beforeEach(() => {
  resetDevWriteLeaseStateForTests();
  delete process.env[DEV_WRITE_LEASE_OWNER_ENV];
});

afterEach(async () => {
  await releaseHeldDevWriteLeases();
  resetDevWriteLeaseStateForTests();
  delete process.env[DEV_WRITE_LEASE_OWNER_ENV];
});

describe('which database the lease protects', () => {
  it.each([
    ['Development', 'cluster.example.net', 'development'],
    ['development', 'localhost', 'development'],
    ['ylabs_test', 'cluster.example.net', 'skip'],
    ['Beta', 'cluster.example.net', 'skip'],
    ['Prod', 'cluster.example.net', 'skip'],
    ['Production', 'cluster.example.net', 'skip'],
    ['ProductionCopy', 'cluster.example.net', 'skip'],
    ['ylabs_local', 'localhost', 'skip'],
    ['ylabs_local', '127.0.0.1', 'skip'],
    ['ylabs', 'cluster.example.net', 'refuse'],
    ['', 'cluster.example.net', 'refuse'],
  ])('%s on %s resolves to %s', (databaseName, host, kind) => {
    expect(resolveDevWriteLeaseTarget({ databaseName, host }).kind).toBe(kind);
  });
});

describe('acquiring a named lease', () => {
  it('refuses a second owner while the first is live, and names the holder', async () => {
    const db = database('Development_acquire');
    const clock = new Clock(Date.UTC(2026, 10, 11, 9));
    const first = await acquireDevWriteLease(
      { name: DEV_APPLY_LEASE_NAME, command: 'first:apply --apply' },
      { db, env: { DEV_WRITE_OWNER: 'session-a' }, now: clock.now, newOwnerId: () => 'owner-a' },
    );
    expect(first.ownerId).toBe('owner-a');

    clock.advance(60_000);
    const attempt = acquireDevWriteLease(
      { name: DEV_APPLY_LEASE_NAME, command: 'second:apply --apply' },
      { db, env: {}, now: clock.now, newOwnerId: () => 'owner-b' },
    );
    await expect(attempt).rejects.toBeInstanceOf(DevWriteLeaseHeldError);
    await expect(attempt).rejects.toThrow(/session-a.*first:apply --apply.*60 s ago/);

    await first.release();
    const second = await acquireDevWriteLease(
      { name: DEV_APPLY_LEASE_NAME, command: 'second:apply --apply' },
      { db, env: {}, now: clock.now, newOwnerId: () => 'owner-b' },
    );
    expect(second.ownerId).toBe('owner-b');
  });

  it('survives an hours-long apply through its heartbeat, then is taken over once heartbeats stop', async () => {
    const db = database('Development_long_apply');
    const clock = new Clock(Date.UTC(2026, 10, 11, 9));
    const holder = await acquireDevWriteLease(
      { name: DEV_APPLY_LEASE_NAME, command: 'long:apply --apply' },
      { db, env: {}, now: clock.now, newOwnerId: () => 'long-owner' },
    );
    const sixHours = 6 * 60 * 60_000;
    for (let elapsed = 0; elapsed < sixHours; elapsed += DEV_WRITE_LEASE_HEARTBEAT_MS) {
      clock.advance(DEV_WRITE_LEASE_HEARTBEAT_MS);
      await expect(holder.heartbeat()).resolves.toBe(true);
      if (elapsed % (30 * 60_000) === 0) {
        await expect(
          acquireDevWriteLease(
            { name: DEV_APPLY_LEASE_NAME, command: 'intruder --apply' },
            { db, env: {}, now: clock.now, newOwnerId: () => 'intruder' },
          ),
        ).rejects.toBeInstanceOf(DevWriteLeaseHeldError);
      }
    }

    clock.advance(DEV_WRITE_LEASE_TTL_MS - 1000);
    await expect(
      acquireDevWriteLease(
        { name: DEV_APPLY_LEASE_NAME, command: 'intruder --apply' },
        { db, env: {}, now: clock.now, newOwnerId: () => 'intruder' },
      ),
    ).rejects.toBeInstanceOf(DevWriteLeaseHeldError);

    clock.advance(2000);
    const taken = await acquireDevWriteLease(
      { name: DEV_APPLY_LEASE_NAME, command: 'next --apply' },
      { db, env: {}, now: clock.now, newOwnerId: () => 'next-owner' },
    );
    expect(taken.ownerId).toBe('next-owner');
    await expect(holder.heartbeat()).resolves.toBe(false);
  });

  it('takes over a live lease whose owner process on this host has exited', async () => {
    const db = database('Development_dead_pid');
    const deps = { db, env: {}, host: 'laptop', isLocalProcessAlive: () => false };
    await acquireDevWriteLease(
      { name: DEV_APPLY_LEASE_NAME, command: 'crashed --apply' },
      { ...deps, pid: 111, newOwnerId: () => 'crashed' },
    );
    const next = await acquireDevWriteLease(
      { name: DEV_APPLY_LEASE_NAME, command: 'next --apply' },
      { ...deps, pid: 222, newOwnerId: () => 'next' },
    );
    expect(next.ownerId).toBe('next');
  });

  it('never takes over a live lease held from another host', async () => {
    const db = database('Development_other_host');
    await acquireDevWriteLease(
      { name: DEV_APPLY_LEASE_NAME, command: 'remote --apply' },
      { db, env: {}, host: 'render', pid: 111, newOwnerId: () => 'remote' },
    );
    await expect(
      acquireDevWriteLease(
        { name: DEV_APPLY_LEASE_NAME, command: 'local --apply' },
        { db, env: {}, host: 'laptop', pid: 111, isLocalProcessAlive: () => false },
      ),
    ).rejects.toBeInstanceOf(DevWriteLeaseHeldError);
  });

  it('lets a child of the holder join, and only the root owner releases', async () => {
    const db = database('Development_join');
    const root = await acquireDevWriteLease(
      { name: DEV_APPLY_LEASE_NAME, command: 'sweep --apply' },
      { db, env: {}, newOwnerId: () => 'sweep-owner' },
    );
    const childEnv = { [DEV_WRITE_LEASE_OWNER_ENV]: 'sweep-owner' };
    const child = await acquireDevWriteLease(
      { name: DEV_APPLY_LEASE_NAME, command: 'scrape run' },
      { db, env: childEnv },
    );
    expect(child.joined).toBe(true);
    const siblingHost = await acquireDevWriteLease(
      { name: 'host:example.edu', command: 'scrape run' },
      { db, env: childEnv },
    );
    await siblingHost.release();
    await child.release();
    expect((await leases(db).findOne({ _id: 'development:host:example.edu' }))?.locked).toBe(true);
    expect((await leases(db).findOne({ _id: `development:${DEV_APPLY_LEASE_NAME}` }))?.locked).toBe(
      true,
    );

    await root.release();
    expect(await leases(db).countDocuments({ locked: true })).toBe(0);
  });
});

describe('the connect-path hook', () => {
  it('touches no lease for a process that recorded no apply intent', async () => {
    const db = database('Development_no_intent');
    await expect(acquireIntendedDevApplyLease(descriptor(db), LEASE_ON)).resolves.toBeUndefined();
    expect(await db.listCollections({ name: DEV_WRITE_LEASE_COLLECTION }).toArray()).toEqual([]);
  });

  it('only reads, and never writes, the lease for a dry run', async () => {
    const db = database('Development_dry_run');
    recordDevDryRunIntent('repair:thing');
    await expect(acquireIntendedDevApplyLease(descriptor(db), LEASE_ON)).resolves.toBeUndefined();
    expect(await db.listCollections({ name: DEV_WRITE_LEASE_COLLECTION }).toArray()).toEqual([]);
  });

  it('takes the apply lease in Development for a recorded apply', async () => {
    const db = database('Development');
    recordDevApplyIntent('repair:thing', ['--apply']);
    const lease = await acquireIntendedDevApplyLease(descriptor(db), LEASE_ON);
    expect(lease?.name).toBe(DEV_APPLY_LEASE_NAME);
    expect(process.env[DEV_WRITE_LEASE_OWNER_ENV]).toBe(lease?.ownerId);
    expect((await leases(db).findOne({}))?.command).toBe('repair:thing --apply');
  });

  it.each(['Beta', 'Prod', 'Production', 'ylabs_test'])(
    'creates no lease document in %s even for a recorded apply',
    async (name) => {
      const db = database(name);
      recordDevApplyIntent('repair:thing', ['--apply']);
      await expect(acquireIntendedDevApplyLease(descriptor(db), LEASE_ON)).resolves.toBeUndefined();
      expect(await db.listCollections({ name: DEV_WRITE_LEASE_COLLECTION }).toArray()).toEqual([]);
    },
  );

  it('refuses an apply against a remote database it cannot place, writing nothing', async () => {
    const db = database('ylabs_unplaced');
    recordDevApplyIntent('repair:thing', ['--apply']);
    await expect(acquireIntendedDevApplyLease(descriptor(db), LEASE_ON)).rejects.toThrow(
      /refused to apply/,
    );
    expect(await db.listCollections({ name: DEV_WRITE_LEASE_COLLECTION }).toArray()).toEqual([]);
  });

  it('does nothing when the lease is switched off', async () => {
    const db = database('Development_off');
    recordDevApplyIntent('repair:thing');
    await expect(
      acquireIntendedDevApplyLease(descriptor(db), { DEV_WRITE_LEASE: 'off' }),
    ).resolves.toBeUndefined();
  });

  it('exempts append-only measurement scripts', async () => {
    const db = database('Development_exempt');
    recordDevApplyIntent('lane:scorecard', ['--apply']);
    await expect(acquireIntendedDevApplyLease(descriptor(db), LEASE_ON)).resolves.toBeUndefined();
  });
});

describe('per-host leases', () => {
  it('stay unarmed outside Development and take one lease per host inside it', async () => {
    const beta = database('Beta');
    armDevHostLeases(descriptor(beta), 'scrape run', LEASE_ON);
    await ensureDevHostLease('example.edu');
    expect(await beta.listCollections({ name: DEV_WRITE_LEASE_COLLECTION }).toArray()).toEqual([]);

    const dev = database('Development');
    armDevHostLeases(descriptor(dev), 'scrape run', LEASE_ON);
    await Promise.all([ensureDevHostLease('Example.edu'), ensureDevHostLease('example.edu')]);
    expect(await leases(dev).countDocuments({ locked: true, sourceName: /^host:/ })).toBe(1);
  });
});

describe('request-path code never takes the lease', () => {
  const REQUEST_PATH = ['routes', 'controllers', 'services', 'middleware', 'app.ts', 'index.ts'];
  const LEASE_TRIGGERS =
    /\b(assertScriptApplyAllowed|recordDevApplyIntent|holdDevApplyLeaseOnDb|holdDevApplyLeaseForRun|armDevHostLeases)\s*\(/;
  const sources = (entry: string): string[] => {
    const full = path.join(SERVER_SRC, entry);
    if (!fs.existsSync(full)) return [];
    if (fs.statSync(full).isFile()) return [full];
    return fs.readdirSync(full).flatMap((name) => {
      if (name === '__tests__') return [];
      return sources(path.join(entry, name));
    });
  };

  it('has request-path files to scan', () => {
    expect(REQUEST_PATH.flatMap(sources).length).toBeGreaterThan(50);
  });

  it.each(REQUEST_PATH)('%s never records an apply intent', (entry) => {
    const offenders = sources(entry)
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => LEASE_TRIGGERS.test(fs.readFileSync(file, 'utf8')));
    expect(offenders.map((file) => path.relative(SERVER_SRC, file))).toEqual([]);
  });
});

describe('scripts that write Development without the shared apply guard', () => {
  it.each([
    'scripts/retireStaleAccessSignalFields.ts',
    'scripts/retireStaleSavedPlanFields.ts',
    'scripts/backfillNonLabBrowseRankDebias.ts',
    'scripts/canonicalMongoValidators.ts',
    'scripts/syncBetaToDevelopment.ts',
    'scrapers/cli.ts',
  ])('%s takes the apply lease', (file) => {
    const source = fs.readFileSync(path.join(SERVER_SRC, file), 'utf8');
    expect(source).toMatch(
      /recordDevApplyIntent\(|holdDevApplyLeaseOnDb\(|holdDevApplyLeaseForRun\(/,
    );
  });
});

describe('dev:locks', () => {
  const now = new Date(Date.UTC(2026, 10, 11, 9));
  const record = (overrides: Partial<DevWriteLeaseRecord>): DevWriteLeaseRecord => ({
    _id: 'development:x',
    sourceName: 'x',
    locked: true,
    heartbeatAt: new Date(now.getTime() - 10_000),
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    ...overrides,
  });

  it('labels kind and state, apply lease first', () => {
    const rows = describeDevLocks(
      [
        record({ sourceName: 'yale-faculty' }),
        record({ sourceName: 'host:example.edu', leaseExpiresAt: new Date(now.getTime() - 1) }),
        record({ sourceName: DEV_APPLY_LEASE_NAME, ownerLabel: 'session-a' }),
        record({ sourceName: 'released-source', locked: false }),
      ],
      now,
    );
    expect(rows.map((row) => [row.kind, row.state, row.name])).toEqual([
      ['apply', 'live', DEV_APPLY_LEASE_NAME],
      ['host', 'stale', 'host:example.edu'],
      ['source', 'released', 'released-source'],
      ['source', 'live', 'yale-faculty'],
    ]);
    expect(rows[0]).toMatchObject({ ownerLabel: 'session-a', heartbeatAgeSeconds: 10 });
  });

  it('refuses a manual release while the heartbeat is fresh', () => {
    expect(releasableByHand(record({}), now)).toBe(false);
    expect(
      releasableByHand(
        record({ heartbeatAt: new Date(now.getTime() - DEV_WRITE_LEASE_TTL_MS - 1) }),
        now,
      ),
    ).toBe(true);
  });

  it('requires the confirm flag to release', () => {
    expect(() => parseDevLocksArgs(['--release', 'owner-a'])).toThrow(/confirm-release-dev-lease/);
    expect(
      parseDevLocksArgs(['--release', 'owner-a', '--confirm-release-dev-lease']).releaseOwnerId,
    ).toBe('owner-a');
  });
});
