import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Department } from '../department';
import { declaredIndexName, reportMissingMongoIndexes } from '../../db/connections';

/**
 * MongoDB permits one text index per collection, so a declared text index is not a
 * widening of whatever text index already exists: it is a second one, and the server
 * refuses it with `IndexOptionsConflict`. A declaration refused that way leaves no
 * trace on the collection, so reading the declaration proves nothing and every
 * assertion here reads the live collection instead (#3142).
 *
 * The incumbent is recreated in `beforeEach` because a clean database cannot
 * reproduce the defect: the conflict needs an existing text index of a different
 * shape, which is exactly the state every real environment is in.
 */
const LIVE_TEXT_INDEX_FIELDS = { name: 'text', abbreviation: 'text' } as const;
const LIVE_TEXT_INDEX_NAME = 'name_text_abbreviation_text';

const liveIndexNames = async (): Promise<string[]> =>
  (await mongoose.connection.db!.collection('departments').indexes()).map((index) =>
    String(index.name),
  );

describe('the declared Department text index can be built against the index that exists (#3142)', () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri(), { autoIndex: false, autoCreate: false });
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await server.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db!;
    const existing = await db.listCollections({ name: 'departments' }).toArray();
    if (existing.length > 0) await db.dropCollection('departments');
    await db.createCollection('departments');
    await db.collection('departments').createIndex(LIVE_TEXT_INDEX_FIELDS as never);
  });

  it('declares exactly one text index, because a second one can never be created', () => {
    const textIndexes = Department.schema
      .indexes()
      .filter(([key]) => Object.values(key as Record<string, unknown>).includes('text'));

    expect(textIndexes).toHaveLength(1);
  });

  it('builds without an IndexOptionsConflict and leaves the declared index present', async () => {
    const rejection = await Department.createIndexes().then(
      () => null,
      (error: { codeName?: string; message?: string }) => String(error?.codeName ?? error?.message),
    );

    expect(rejection).toBeNull();
    expect(await liveIndexNames()).toContain(LIVE_TEXT_INDEX_NAME);
  });

  it('reports no missing index once built, so the drift report can reach zero', async () => {
    await Department.createIndexes();

    const drift = await reportMissingMongoIndexes();

    expect(drift.filter((entry) => entry.collection === 'departments')).toEqual([]);
  });

  it('names every declared index after one that is actually live', async () => {
    await Department.createIndexes();
    const live = new Set(await liveIndexNames());

    const declared = Department.schema
      .indexes()
      .map(([key, options]) =>
        declaredIndexName(key as Record<string, unknown>, options as Record<string, unknown>),
      );

    expect(declared.filter((name) => !live.has(name))).toEqual([]);
  });
});
