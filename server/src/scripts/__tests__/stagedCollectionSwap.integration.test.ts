import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyStagedCollectionSwap, stagedSwapCollectionExists } from '../stagedCollectionSwap';

/**
 * Run against a real mongod rather than a mocked driver.
 *
 * A mocked `deleteMany`/`rename` confirms whatever ordering the test asserts, so
 * it cannot prove the property that matters here - that an induced failure
 * leaves every collection at its pre-run state. `rename` semantics, the
 * target-exists case, and drop ordering all have to be the real ones (#2347).
 */
const COLLECTIONS = [{ name: 'alpha' }, { name: 'beta' }, { name: 'gamma' }];
const BACKUP_PREFIX = '__test_backup_';
const STAGING_PREFIX = '__test_staging_';

describe('applyStagedCollectionSwap atomicity (#2347)', () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let sourceDb: Db;
  let targetDb: Db;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(replSet.getUri());
    await client.connect();
    sourceDb = client.db('swap_source');
    targetDb = client.db('swap_target');
  }, 60000);

  afterAll(async () => {
    await client.close();
    await replSet.stop();
  });

  beforeEach(async () => {
    for (const db of [sourceDb, targetDb]) {
      for (const info of await db.listCollections({}, { nameOnly: true }).toArray()) {
        await db.collection(info.name).drop();
      }
    }
    for (const { name } of COLLECTIONS) {
      await targetDb.collection(name).insertMany([{ origin: 'target', name, n: 1 }]);
      await sourceDb.collection(name).insertMany([
        { origin: 'source', name, n: 1 },
        { origin: 'source', name, n: 2 },
      ]);
    }
  });

  const stage = async (collection: { name: string }, operationId: string) => {
    const stagingName = `${STAGING_PREFIX}${operationId}_${collection.name}`;
    const docs = await sourceDb.collection(collection.name).find({}).toArray();
    await targetDb.collection(stagingName).insertMany(docs.map(({ _id: _drop, ...rest }) => rest));
    return stagingName;
  };

  const targetState = async () => {
    const state: Record<string, { count: number; origins: string[] }> = {};
    for (const { name } of COLLECTIONS) {
      const docs = await targetDb.collection(name).find({}).toArray();
      state[name] = {
        count: docs.length,
        origins: [...new Set(docs.map((d) => String((d as { origin?: unknown }).origin)))],
      };
    }
    return state;
  };

  const leftoverCollections = async () =>
    (await targetDb.listCollections({}, { nameOnly: true }).toArray())
      .map((info) => info.name)
      .filter((name) => name.startsWith(BACKUP_PREFIX) || name.startsWith(STAGING_PREFIX));

  const run = (overrides: Partial<Parameters<typeof applyStagedCollectionSwap>[0]> = {}) =>
    applyStagedCollectionSwap({
      targetDb,
      collections: COLLECTIONS,
      backupPrefix: BACKUP_PREFIX,
      label: 'test swap',
      stage,
      verify: async () => {},
      ...overrides,
    } as Parameters<typeof applyStagedCollectionSwap>[0]);

  it('swaps every collection and drops its backups once verify passes', async () => {
    await run();

    expect(await targetState()).toEqual({
      alpha: { count: 2, origins: ['source'] },
      beta: { count: 2, origins: ['source'] },
      gamma: { count: 2, origins: ['source'] },
    });
    expect(await leftoverCollections()).toEqual([]);
  });

  it('leaves every collection at its pre-run state when staging fails on the third', async () => {
    const before = await targetState();

    await expect(
      run({
        stage: async (collection: { name: string }, operationId: string) => {
          if (collection.name === 'gamma') throw new Error('induced staging failure on gamma');
          return stage(collection, operationId);
        },
      }),
    ).rejects.toThrow('induced staging failure on gamma');

    expect(await targetState()).toEqual(before);
    expect(await leftoverCollections()).toEqual([]);
  });

  /**
   * The case the 2026-09-01 outage actually was: the failure lands after some
   * collections have already been cut over. Every one of them has to come back,
   * not just the one that failed.
   */
  it('rolls back collections already cut over when a later rename fails', async () => {
    const before = await targetState();

    await expect(
      run({
        stage: async (collection: { name: string }, operationId: string) => {
          const stagingName = await stage(collection, operationId);
          if (collection.name === 'gamma') {
            // Destroy only gamma's staging, so its rename into place fails after
            // alpha and beta have already been swapped.
            await targetDb.collection(stagingName).drop();
          }
          return stagingName;
        },
      }),
    ).rejects.toThrow();

    expect(await targetState()).toEqual(before);
    expect(await leftoverCollections()).toEqual([]);
  });

  it('rolls back the whole cutover when verify rejects', async () => {
    const before = await targetState();

    await expect(
      run({
        verify: async () => {
          throw new Error('count mismatch after cutover');
        },
      }),
    ).rejects.toThrow('count mismatch after cutover');

    expect(await targetState()).toEqual(before);
    expect(await leftoverCollections()).toEqual([]);
  });

  it('creates the target collection when production does not already have it', async () => {
    await targetDb.collection('beta').drop();
    expect(await stagedSwapCollectionExists(targetDb, 'beta')).toBe(false);

    await run();

    expect((await targetState()).beta).toEqual({ count: 2, origins: ['source'] });
    expect(await leftoverCollections()).toEqual([]);
  });
});
