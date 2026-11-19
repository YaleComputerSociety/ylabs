import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertCopyCarriesEveryDirectoryRemoval,
  countTargetDirectoryRemovalsMissingFromSource,
  directoryRemovalCopyBlockers,
} from '../directoryRemovalCopyGuard';
import { applySync, collectionsForOptions } from '../syncBetaToDevelopment';
import {
  applyCopy,
  buildPromotionSummary,
  promotionCollectionNamesForOptions,
  type PromotionOptions,
} from '../promoteAcceptedBetaCopy';

const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);
const recordedAt = new Date('2026-11-10T00:00:00Z');

const promotionOptions: PromotionOptions = {
  mode: 'apply',
  datasetVersion: 'synthetic-directory-removal-guard',
  betaUrl: 'mongodb+srv://user:pass@beta.example.test/Beta',
  productionUrl: 'mongodb+srv://user:pass@production.example.test/Prod',
  confirmLane: true,
  confirmProd: true,
  includeObservations: false,
  includeScrapeRuns: false,
  retireScrapeRunsActor: '',
};

async function seedTargetOnlyActiveEntry(): Promise<void> {
  await sourceDb
    .collection('directory_removals')
    .insertOne({ digest: digestA, kind: 'netid', recordedAt });
  await targetDb.collection('directory_removals').insertMany([
    { digest: digestA, kind: 'netid', recordedAt },
    { digest: digestB, kind: 'email', recordedAt },
  ]);
  await targetDb.collection('signals').insertOne({ field: 'synthetic-target-row' });
}

async function targetDigests(): Promise<string[]> {
  const rows = await targetDb.collection('directory_removals').find({}).toArray();
  return rows.map((row) => row.digest).sort();
}

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
  await targetDb.collection('signals').deleteMany({});
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

  it('stops a collection sync before it replaces the target', async () => {
    await seedTargetOnlyActiveEntry();
    await expect(
      applySync(
        sourceDb,
        targetDb,
        collectionsForOptions({ includeObservations: false }),
        [],
        async () => undefined,
        async () => undefined,
      ),
    ).rejects.toThrow(/holds 1 active directory removal entry/);
    expect(await targetDigests()).toEqual([digestA, digestB]);
    expect(await targetDb.collection('signals').countDocuments()).toBe(1);
  });

  it('stops a promotion before it replaces the target', async () => {
    await seedTargetOnlyActiveEntry();
    await expect(
      applyCopy(sourceDb, targetDb, promotionOptions, { client, requiredDatabaseNames: [] }),
    ).rejects.toThrow(/holds 1 active directory removal entry/);
    expect(await targetDigests()).toEqual([digestA, digestB]);
    expect(await targetDb.collection('signals').countDocuments()).toBe(1);
  });

  it('reports the refusal in a promotion dry run, so a clear dry run means apply can run', async () => {
    await seedTargetOnlyActiveEntry();
    const blockers = await directoryRemovalCopyBlockers(sourceDb, targetDb, 'Synthetic copy');
    expect(blockers).toHaveLength(1);
    const summary = buildPromotionSummary(promotionOptions, [], [], 0, blockers);
    expect(summary.applyBlockers).toEqual(blockers);
    await sourceDb
      .collection('directory_removals')
      .insertOne({ digest: digestB, kind: 'email', recordedAt });
    expect(await directoryRemovalCopyBlockers(sourceDb, targetDb, 'Synthetic copy')).toEqual([]);
  });
});
