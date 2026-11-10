import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertCopyCarriesEveryDirectoryRemoval,
  countTargetDirectoryRemovalsMissingFromSource,
} from '../directoryRemovalCopyGuard';
import { collectionsForOptions } from '../syncBetaToDevelopment';
import { promotionCollectionNamesForOptions } from '../promoteAcceptedBetaCopy';

const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);
const recordedAt = new Date('2026-11-10T00:00:00Z');

let server: MongoMemoryServer;
let client: MongoClient;
let sourceDb: Db;
let targetDb: Db;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  sourceDb = client.db('Development');
  targetDb = client.db('Beta');
});

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

beforeEach(async () => {
  await sourceDb.collection('directory_removals').deleteMany({});
  await targetDb.collection('directory_removals').deleteMany({});
});

describe('directory removal copy guard', () => {
  it('is copied by every whole-collection copy', () => {
    expect(collectionsForOptions({ includeObservations: false }).map((c) => c.name)).toContain(
      'directory_removals',
    );
    expect(
      promotionCollectionNamesForOptions({
        includeObservations: false,
        includeScrapeRuns: false,
      } as any),
    ).toContain('directory_removals');
  });

  it('passes when the source carries every active target entry, withdrawn or not', async () => {
    await sourceDb.collection('directory_removals').insertMany([
      { digest: digestA, kind: 'netid', recordedAt },
      { digest: digestB, kind: 'name', recordedAt, withdrawnAt: recordedAt },
    ]);
    await targetDb.collection('directory_removals').insertMany([
      { digest: digestA, kind: 'netid', recordedAt },
      { digest: digestB, kind: 'name', recordedAt },
    ]);
    await expect(
      assertCopyCarriesEveryDirectoryRemoval(sourceDb, targetDb, 'Synthetic copy'),
    ).resolves.toBeUndefined();
  });

  it('refuses a copy that would drop an active entry only the target holds', async () => {
    await sourceDb
      .collection('directory_removals')
      .insertOne({ digest: digestA, kind: 'netid', recordedAt });
    await targetDb.collection('directory_removals').insertMany([
      { digest: digestA, kind: 'netid', recordedAt },
      { digest: digestB, kind: 'email', recordedAt },
    ]);
    expect(await countTargetDirectoryRemovalsMissingFromSource(sourceDb, targetDb)).toBe(1);
    await expect(
      assertCopyCarriesEveryDirectoryRemoval(sourceDb, targetDb, 'Synthetic copy'),
    ).rejects.toThrow(/holds 1 active directory removal entry/);
  });

  it('ignores a withdrawn entry only the target holds', async () => {
    await targetDb
      .collection('directory_removals')
      .insertOne({ digest: digestB, kind: 'email', recordedAt, withdrawnAt: recordedAt });
    expect(await countTargetDirectoryRemovalsMissingFromSource(sourceDb, targetDb)).toBe(0);
  });
});
