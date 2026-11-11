import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  DEV_WRITE_LAUNCH_COLLECTION,
  describeDevWriteLaunch,
  redactLaunchArgv,
} from '../devWriteLaunch';
import {
  DEV_WRITE_LEASE_OWNER_ENV,
  acquireIntendedDevApplyLease,
  describeScrapeRunLaunch,
  recordDevApplyIntent,
  releaseHeldDevWriteLeases,
  resetDevWriteLeaseStateForTests,
} from '../devWriteLease';

let memoryServer: MongoMemoryServer;
let client: MongoClient;

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

const descriptor = (name: string) => {
  const db = client.db(name);
  return { db, databaseName: db.databaseName, host: 'cluster.example.net' };
};

describe('redacting launch arguments', () => {
  it.each([
    [['--api-key=abc'], ['--api-key=<redacted>']],
    [
      ['--token', 'abc', '--apply'],
      ['--token', '<redacted>', '--apply'],
    ],
    [
      ['--client-secret', 'abc'],
      ['--client-secret', '<redacted>'],
    ],
    [['--password=abc'], ['--password=<redacted>']],
    [['OPENAI_API_KEY=abc'], ['OPENAI_API_KEY=<redacted>']],
    [['mongodb+srv://user:pass@cluster.example.net/db'], ['<redacted>']],
    [
      ['--token', '--apply'],
      ['--token', '--apply'],
    ],
    [
      ['--only', 'example-source', '--apply'],
      ['--only', 'example-source', '--apply'],
    ],
    [['--max-apply=100'], ['--max-apply=100']],
  ])('%j becomes %j', (argv, expected) => {
    expect(redactLaunchArgv(argv)).toEqual(expected);
  });

  it('describes owner, worktree, sha, entry and redacted argv', () => {
    expect(
      describeDevWriteLaunch({
        env: { DEV_WRITE_OWNER: 'session-a' },
        argv: ['node', 'src/scripts/repair.ts', '--apply', '--secret=abc'],
        cwd: '/work/tree/server',
        worktree: '/work/tree',
        gitSha: 'a'.repeat(40),
      }),
    ).toMatchObject({
      ownerLabel: 'session-a',
      worktree: '/work/tree',
      cwd: '/work/tree/server',
      gitSha: 'a'.repeat(40),
      entry: 'src/scripts/repair.ts',
      argv: ['--apply', '--secret=<redacted>'],
    });
  });

  it('names the lease a lane run belongs to', () => {
    expect(
      describeScrapeRunLaunch({ DEV_WRITE_OWNER: 'session-a', [DEV_WRITE_LEASE_OWNER_ENV]: 'o-1' }),
    ).toMatchObject({ ownerLabel: 'session-a', devWriteLeaseOwnerId: 'o-1' });
  });
});

describe('the apply launch record', () => {
  it('is written next to the apply lease and outlives its release', async () => {
    const connection = descriptor('Development');
    // The secret holds characters an ObjectId or timestamp never prints, so a generated id
    // cannot contain it by chance (an id with `abc` in it failed this assertion).
    recordDevApplyIntent('repair:thing', ['--apply', '--api-key=zz-launch-secret']);
    const lease = await acquireIntendedDevApplyLease(connection, { DEV_WRITE_OWNER: 'session-a' });
    await releaseHeldDevWriteLeases();

    const records = await connection.db.collection(DEV_WRITE_LAUNCH_COLLECTION).find().toArray();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      kind: 'apply',
      scriptName: 'repair:thing',
      leaseOwnerId: lease?.ownerId,
      joinedParentLease: false,
      launch: { ownerLabel: 'session-a', cwd: process.cwd() },
    });
    expect(JSON.stringify(records[0])).not.toContain('zz-launch-secret');
  });

  it.each(['Beta', 'Prod', 'ylabs_test'])('is never written in %s', async (name) => {
    const connection = descriptor(name);
    recordDevApplyIntent('repair:thing', ['--apply']);
    await acquireIntendedDevApplyLease(connection, {});
    expect(
      await connection.db.listCollections({ name: DEV_WRITE_LAUNCH_COLLECTION }).toArray(),
    ).toEqual([]);
  });
});
