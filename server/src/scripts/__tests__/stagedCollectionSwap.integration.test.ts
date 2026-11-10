import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applyStagedCollectionSwap,
  listRetainedGenerations,
  stagedSwapCollectionExists,
} from '../stagedCollectionSwap';

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
const RETAINED_PREFIX = '__test_prev_';

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
  });

  afterAll(async () => {
    await client.close();
    await replSet?.stop();
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
      preflight: async () => {},
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

  /**
   * The retirement path (#2589): a cleared collection is renamed to a backup during
   * the same cutover and dropped only after verify passes, so it is gone on success
   * and fully restored on failure. Asserted here rather than trusting the flag.
   */
  it('clears a retired collection on success', async () => {
    await targetDb.collection('retired').insertMany([{ stale: 1 }, { stale: 2 }]);

    await run({ clearedCollectionNames: ['retired'] });

    expect(await stagedSwapCollectionExists(targetDb, 'retired')).toBe(false);
    expect(await leftoverCollections()).toEqual([]);
  });

  it('restores a retired collection when verify rejects', async () => {
    await targetDb.collection('retired').insertMany([{ stale: 1 }, { stale: 2 }]);

    await expect(
      run({
        clearedCollectionNames: ['retired'],
        verify: async () => {
          throw new Error('induced verify failure');
        },
      }),
    ).rejects.toThrow('induced verify failure');

    expect(await targetDb.collection('retired').countDocuments({})).toBe(2);
    expect(await leftoverCollections()).toEqual([]);
  });

  it('tolerates retiring a collection the target does not have', async () => {
    await expect(run({ clearedCollectionNames: ['never_existed'] })).resolves.toMatchObject({
      droppedGenerations: [],
    });
    expect(await leftoverCollections()).toEqual([]);
  });

  it('creates the target collection when production does not already have it', async () => {
    await targetDb.collection('beta').drop();
    expect(await stagedSwapCollectionExists(targetDb, 'beta')).toBe(false);

    await run();

    expect((await targetState()).beta).toEqual({ count: 2, origins: ['source'] });
    expect(await leftoverCollections()).toEqual([]);
  });

  it('writes nothing when the preflight refuses', async () => {
    const before = await targetState();
    let staged = 0;

    await expect(
      run({
        preflight: async () => {
          throw new Error('no headroom');
        },
        stage: async (collection, operationId) => {
          staged += 1;
          return stage(collection, operationId);
        },
      }),
    ).rejects.toThrow('no headroom');

    expect(staged).toBe(0);
    expect(await targetState()).toEqual(before);
    expect(await leftoverCollections()).toEqual([]);
  });
});

describe('applyStagedCollectionSwap previous-generation retention (#4149)', () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let sourceDb: Db;
  let targetDb: Db;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(replSet.getUri());
    await client.connect();
    sourceDb = client.db('retain_source');
    targetDb = client.db('retain_target');
  });

  afterAll(async () => {
    await client.close();
    await replSet?.stop();
  });

  beforeEach(async () => {
    for (const db of [sourceDb, targetDb]) {
      for (const info of await db.listCollections({}, { nameOnly: true }).toArray()) {
        await db.collection(info.name).drop();
      }
    }
    for (const { name } of COLLECTIONS) {
      await targetDb.collection(name).insertOne({ origin: 'original', name });
    }
  });

  const swapIn = (origin: string, rows: number, verify: () => Promise<void> = async () => {}) =>
    applyStagedCollectionSwap({
      targetDb,
      collections: COLLECTIONS,
      backupPrefix: BACKUP_PREFIX,
      retainedPrefix: RETAINED_PREFIX,
      label: 'retaining swap',
      preflight: async () => {},
      stage: async (collection, operationId) => {
        const stagingName = `${STAGING_PREFIX}${operationId}_${collection.name}`;
        await targetDb
          .collection(stagingName)
          .insertMany(
            Array.from({ length: rows }, (_, n) => ({ origin, name: collection.name, n })),
          );
        return stagingName;
      },
      verify,
    });

  const retainedOrigins = async (retainedName: string) => [
    ...new Set(
      (await targetDb.collection(retainedName).find({}).toArray()).map((doc) => String(doc.origin)),
    ),
  ];

  it('keeps the replaced collections as the previous generation instead of dropping them', async () => {
    const result = await swapIn('first', 2);

    expect(result.retained?.operationId).toBe(result.operationId);
    expect(result.retained?.collections.map((entry) => [entry.collection, entry.count])).toEqual([
      ['alpha', 1],
      ['beta', 1],
      ['gamma', 1],
    ]);
    for (const entry of result.retained!.collections) {
      expect(await retainedOrigins(entry.retainedName)).toEqual(['original']);
    }
    const leftovers = (await targetDb.listCollections({}, { nameOnly: true }).toArray()).map(
      (info) => info.name,
    );
    expect(leftovers.filter((name) => name.startsWith(BACKUP_PREFIX))).toEqual([]);
    expect(leftovers.filter((name) => name.startsWith(STAGING_PREFIX))).toEqual([]);
  });

  it("holds exactly one previous generation after two swaps, the first swap's result", async () => {
    const first = await swapIn('first', 2);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await swapIn('second', 3);

    const generations = await listRetainedGenerations(targetDb, RETAINED_PREFIX);
    expect(generations.map((generation) => generation.operationId)).toEqual([second.operationId]);
    expect(second.droppedGenerations).toEqual([first.operationId]);
    for (const entry of generations[0].collections) {
      expect(entry.count).toBe(2);
      expect(await retainedOrigins(entry.retainedName)).toEqual(['first']);
    }
    expect(await targetDb.collection('alpha').countDocuments({})).toBe(3);
  });

  it('keeps the older generation when a later swap fails verification', async () => {
    const first = await swapIn('first', 2);
    await new Promise((resolve) => setTimeout(resolve, 2));

    await expect(
      swapIn('second', 3, async () => {
        throw new Error('verify rejected');
      }),
    ).rejects.toThrow('verify rejected');

    const generations = await listRetainedGenerations(targetDb, RETAINED_PREFIX);
    expect(generations.map((generation) => generation.operationId)).toEqual([first.operationId]);
    expect(await targetDb.collection('alpha').countDocuments({ origin: 'first' })).toBe(2);
  });

  it('retains a collection the swap created as an empty one, so a rollback restores no rows', async () => {
    await targetDb.collection('gamma').drop();

    const result = await swapIn('first', 2);

    const gamma = result.retained!.collections.find((entry) => entry.collection === 'gamma')!;
    expect(gamma.count).toBe(0);
    expect(await stagedSwapCollectionExists(targetDb, gamma.retainedName)).toBe(true);
  });
});
