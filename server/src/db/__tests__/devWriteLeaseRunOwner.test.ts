import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type LeaseModule = typeof import('../devWriteLease');

const LEASE_ON: NodeJS.ProcessEnv = { DEV_WRITE_OWNER: 'test-session' };

let memoryServer: MongoMemoryServer;
let client: MongoClient;
let db: Db;
const loaded: LeaseModule[] = [];

const descriptor = () => ({ db, databaseName: db.databaseName, host: 'cluster.example.net' });

async function freshProcessModule(): Promise<LeaseModule> {
  vi.resetModules();
  const lease = await import('../devWriteLease');
  lease.setDevWriteLeaseRuntimeForTests({ log: () => undefined, stop: () => undefined });
  loaded.push(lease);
  return lease;
}

async function ownerOf(host: string): Promise<string | undefined> {
  const record = await db
    .collection<{ _id: string; ownerId?: string }>('scrape_job_locks')
    .findOne({ _id: `development:host:${host}` });
  return record?.ownerId;
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
  delete process.env.DEV_WRITE_LEASE_OWNER;
  process.env.DEV_WRITE_OWNER = 'test-session';
  db = client.db('Development');
  await db.dropDatabase();
});

afterEach(async () => {
  for (const lease of loaded.splice(0)) {
    await lease.releaseHeldDevWriteLeases();
    lease.resetDevWriteLeaseStateForTests();
  }
  delete process.env.DEV_WRITE_LEASE_OWNER;
  delete process.env.DEV_WRITE_OWNER;
});

describe('the run owner shared by concurrent first host leases', () => {
  it('is one owner within a process', async () => {
    const lease = await freshProcessModule();
    lease.armDevHostLeases(descriptor(), 'scrape run', LEASE_ON);

    await Promise.all(
      ['one.example.edu', 'two.example.edu', 'three.example.edu'].map((host) =>
        lease.ensureDevHostLease(host),
      ),
    );

    const owners = new Set(
      await Promise.all(['one.example.edu', 'two.example.edu', 'three.example.edu'].map(ownerOf)),
    );
    expect(owners.size).toBe(1);
  });

  it('is a different owner in each separate process, so two runs never share one', async () => {
    const first = await freshProcessModule();
    first.armDevHostLeases(descriptor(), 'scrape run', LEASE_ON);
    await first.ensureDevHostLease('first-run.example.edu');
    delete process.env.DEV_WRITE_LEASE_OWNER;

    const second = await freshProcessModule();
    second.armDevHostLeases(descriptor(), 'scrape run', LEASE_ON);
    await second.ensureDevHostLease('second-run.example.edu');

    const firstOwner = await ownerOf('first-run.example.edu');
    const secondOwner = await ownerOf('second-run.example.edu');
    expect(firstOwner).toBeTruthy();
    expect(secondOwner).toBeTruthy();
    expect(secondOwner).not.toBe(firstOwner);
    await expect(second.ensureDevHostLease('first-run.example.edu')).rejects.toThrow(/held by/);
  });
});
