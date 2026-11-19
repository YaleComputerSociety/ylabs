import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScrapeJobLock } from '../../models/scrapeJobLock';
import {
  DEFAULT_SCRAPE_JOB_LOCK_HEARTBEAT_MS,
  DEFAULT_SCRAPE_JOB_LOCK_LEASE_MS,
  SCRAPE_JOB_LOCK_DEAD_OWNER_HEARTBEAT_AGE_MS,
  acquireScrapeJobLock,
} from '../scrapeJobLock';

const NOW = new Date('2026-11-12T09:00:00Z');
const THIS_HOST = 'lane-host.example.internal';
const OTHER_HOST = 'other-host.example.internal';
const THIS_PID = 4100;
const HOLDER_PID = 4200;
const HOLDER_OWNER = `scrape cli:${THIS_HOST}:${HOLDER_PID}:holder`;
const SOURCE = 'fixture-source';

let memoryServer: MongoMemoryServer;

const locks = () => mongoose.connection.db!.collection(ScrapeJobLock.collection.collectionName);
const lockId = `test:${SOURCE}`;
const lockRow = () => locks().findOne({ _id: lockId as never });

const ago = (ms: number) => new Date(NOW.getTime() - ms);
const STALE = ago(SCRAPE_JOB_LOCK_DEAD_OWNER_HEARTBEAT_AGE_MS + 1_000);
const FRESH = ago(DEFAULT_SCRAPE_JOB_LOCK_HEARTBEAT_MS / 2);

async function seedHeldLock(overrides: Record<string, unknown> = {}) {
  await locks().insertOne({
    _id: lockId as never,
    environment: 'test',
    sourceName: SOURCE,
    locked: true,
    ownerId: HOLDER_OWNER,
    acquiredAt: ago(60 * 60_000),
    heartbeatAt: STALE,
    leaseExpiresAt: new Date(NOW.getTime() + 20 * 60_000),
    ownerHost: THIS_HOST,
    ownerPid: HOLDER_PID,
    ownerProcessOwnerId: HOLDER_OWNER,
    ...overrides,
  });
}

function acquire(isLocalProcessAlive: (pid: number) => boolean) {
  return acquireScrapeJobLock({
    environment: 'test',
    sourceName: SOURCE,
    ownerId: 'scrape cli:new-owner',
    now: NOW,
    ownerHost: THIS_HOST,
    ownerPid: THIS_PID,
    isLocalProcessAlive,
  });
}

beforeAll(async () => {
  memoryServer = await MongoMemoryServer.create();
  await mongoose.connect(`${memoryServer.getUri()}scrape_job_lock_takeover_test`);
});

afterAll(async () => {
  await mongoose.disconnect();
  await memoryServer?.stop();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await locks().deleteMany({});
});

describe('taking over a held source lock from a dead owner on this host', () => {
  it('takes it over when the host matches, the pid is dead and the heartbeat is older than two intervals', async () => {
    await seedHeldLock();
    const isAlive = vi.fn(() => false);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await acquire(isAlive);

    expect(result.acquired).toBe(true);
    expect(isAlive).toHaveBeenCalledWith(HOLDER_PID);
    expect(await lockRow()).toMatchObject({
      locked: true,
      ownerId: 'scrape cli:new-owner',
      ownerHost: THIS_HOST,
      ownerPid: THIS_PID,
      ownerProcessOwnerId: 'scrape cli:new-owner',
      heartbeatAt: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + DEFAULT_SCRAPE_JOB_LOCK_LEASE_MS),
    });
  });

  it('refuses a dead pid whose heartbeat is still fresh', async () => {
    await seedHeldLock({ heartbeatAt: FRESH });

    const result = await acquire(() => false);

    expect(result).toEqual({
      acquired: false,
      ownerId: 'scrape cli:new-owner',
      reason: 'lock-held',
    });
    expect(await lockRow()).toMatchObject({ ownerId: HOLDER_OWNER, heartbeatAt: FRESH });
  });

  it('refuses a live pid on this host even when its heartbeat is stale', async () => {
    await seedHeldLock();
    const isAlive = vi.fn(() => true);

    const result = await acquire(isAlive);

    expect(result).toEqual({
      acquired: false,
      ownerId: 'scrape cli:new-owner',
      reason: 'lock-held',
    });
    expect(isAlive).toHaveBeenCalledWith(HOLDER_PID);
    expect(await lockRow()).toMatchObject({
      locked: true,
      ownerId: HOLDER_OWNER,
      ownerPid: HOLDER_PID,
      heartbeatAt: STALE,
    });
  });

  it('refuses a holder on a different host, without probing its pid here', async () => {
    await seedHeldLock({ ownerHost: OTHER_HOST });
    const isAlive = vi.fn(() => false);

    const result = await acquire(isAlive);

    expect(result.acquired).toBe(false);
    expect(isAlive).not.toHaveBeenCalled();
    expect(await lockRow()).toMatchObject({ ownerId: HOLDER_OWNER });
  });

  it('honours a lock written by older code, which records no host or pid, until it expires', async () => {
    await seedHeldLock({
      ownerHost: undefined,
      ownerPid: undefined,
      ownerProcessOwnerId: undefined,
    });
    await locks().updateOne(
      { _id: lockId as never },
      { $unset: { ownerHost: '', ownerPid: '', ownerProcessOwnerId: '' } },
    );
    const isAlive = vi.fn(() => false);

    expect((await acquire(isAlive)).acquired).toBe(false);
    expect(isAlive).not.toHaveBeenCalled();
    expect(await lockRow()).toMatchObject({ ownerId: HOLDER_OWNER });
  });

  it('refuses when older code took the lock over and left the previous holder host and pid behind', async () => {
    await seedHeldLock({ ownerId: 'scrape cli:older-code-holder' });
    const isAlive = vi.fn(() => false);

    expect((await acquire(isAlive)).acquired).toBe(false);
    expect(isAlive).not.toHaveBeenCalled();
    expect(await lockRow()).toMatchObject({ ownerId: 'scrape cli:older-code-holder' });
  });

  it('still takes over an expired lease whose pid is alive, because expiry takeover is unchanged', async () => {
    await seedHeldLock({ leaseExpiresAt: ago(1_000), heartbeatAt: FRESH });

    const result = await acquire(() => true);

    expect(result.acquired).toBe(true);
    expect(await lockRow()).toMatchObject({ ownerId: 'scrape cli:new-owner', ownerPid: THIS_PID });
  });
});

describe('the lock document shape across code versions', () => {
  it('stays takeable by the older acquire query once it expires, and is then honoured by new code', async () => {
    const isAlive = vi.fn(() => false);
    await acquire(isAlive);
    const expiredAt = new Date(NOW.getTime() + DEFAULT_SCRAPE_JOB_LOCK_LEASE_MS + 1_000);

    const olderCodeTakeover = await locks().findOneAndUpdate(
      {
        environment: 'test',
        sourceName: SOURCE,
        $or: [
          { locked: { $ne: true } },
          { leaseExpiresAt: { $lte: expiredAt } },
          { leaseExpiresAt: { $exists: false } },
        ],
      },
      {
        $set: {
          locked: true,
          ownerId: 'scrape cli:older-code-holder',
          acquiredAt: expiredAt,
          heartbeatAt: ago(-DEFAULT_SCRAPE_JOB_LOCK_LEASE_MS),
          leaseExpiresAt: new Date(expiredAt.getTime() + DEFAULT_SCRAPE_JOB_LOCK_LEASE_MS),
        },
        $unset: { releasedAt: '', releaseReason: '' },
      },
      { returnDocument: 'after' },
    );
    expect(olderCodeTakeover).toMatchObject({ ownerId: 'scrape cli:older-code-holder' });

    const later = new Date(expiredAt.getTime() + SCRAPE_JOB_LOCK_DEAD_OWNER_HEARTBEAT_AGE_MS * 5);
    const refused = await acquireScrapeJobLock({
      environment: 'test',
      sourceName: SOURCE,
      ownerId: 'scrape cli:third-owner',
      now: later,
      ownerHost: THIS_HOST,
      ownerPid: THIS_PID + 1,
      isLocalProcessAlive: isAlive,
    });

    expect(refused.acquired).toBe(false);
    expect(await lockRow()).toMatchObject({ ownerId: 'scrape cli:older-code-holder' });
  });
});
