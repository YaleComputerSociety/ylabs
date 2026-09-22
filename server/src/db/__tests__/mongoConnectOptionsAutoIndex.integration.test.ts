import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { declaredIndexName, mongoOptions, reportMissingMongoIndexes } from '../connections';
import { planDeclaredIndexes } from '../../scripts/buildMongoIndexes';

const COLLECTION = 'autoindex_probe_rows';

function probeSchema(): mongoose.Schema {
  const schema = new mongoose.Schema({ slug: String, name: String }, { collection: COLLECTION });
  schema.index({ slug: 1 }, { unique: true });
  schema.index({ name: 1 });
  return schema;
}

describe('connecting must not be a schema-mutating act (#2233)', () => {
  let server: MongoMemoryServer;
  let uri: string;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    uri = server.getUri();
  }, 60000);

  afterAll(async () => {
    await server.stop();
  });

  /** What a booting process does: open the connection, register the model, nothing else. */
  const bootWith = async (
    options: mongoose.ConnectOptions,
    modelName: string,
  ): Promise<{ collections: number; indexes: number; connection: mongoose.Connection }> => {
    const seed = await mongoose.createConnection(uri).asPromise();
    await seed.db!.collection(COLLECTION).insertOne({ slug: 'seed', name: 'seed' });
    await seed.db!.dropCollection(COLLECTION);

    const booted = await mongoose.createConnection(uri, options).asPromise();
    await booted.model(modelName, probeSchema()).init();

    const collections = (await seed.db!.listCollections({ name: COLLECTION }).toArray()).length;
    const indexes = collections ? (await seed.db!.collection(COLLECTION).indexes()).length : 0;
    await seed.close();
    return { collections, indexes, connection: booted };
  };

  it('pins both autoIndex and autoCreate off in the shared connection options', () => {
    expect(mongoOptions.autoIndex).toBe(false);
    expect(mongoOptions.autoCreate).toBe(false);
  });

  it('does not recreate a dropped collection when a model is merely registered', async () => {
    const { collections, indexes, connection } = await bootWith(mongoOptions, 'AutoIndexProbeOff');
    await connection.close();
    expect(collections).toBe(0);
    expect(indexes).toBe(0);
  });

  it('recreates the collection with its full index set under the Mongoose defaults', async () => {
    const { collections, indexes, connection } = await bootWith(
      { autoIndex: true, autoCreate: true },
      'AutoIndexProbeDefaults',
    );
    await connection.close();
    expect(collections).toBe(1);
    expect(indexes).toBe(3);
  });

  it('still recreates the collection when only autoIndex is off, which is why autoCreate is too', async () => {
    const { collections, indexes, connection } = await bootWith(
      { autoIndex: false, autoCreate: true },
      'AutoIndexProbeIndexOnly',
    );
    await connection.close();
    expect(collections).toBe(1);
    expect(indexes).toBe(1);
  });

  it('still recreates the collection when only autoCreate is off, because building an index creates it', async () => {
    const { collections, indexes, connection } = await bootWith(
      { autoIndex: true, autoCreate: false },
      'AutoIndexProbeCreateOnly',
    );
    await connection.close();
    expect(collections).toBe(1);
    expect(indexes).toBe(3);
  });
});

describe('index drift is reported rather than silently self-healed (#2233)', () => {
  let server: MongoMemoryServer;
  let connection: mongoose.Connection;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    connection = await mongoose.createConnection(server.getUri(), mongoOptions).asPromise();
  }, 60000);

  afterAll(async () => {
    await connection.close();
    await server.stop();
  });

  it('names a declared index the way the driver does, including a text index', () => {
    expect(declaredIndexName({ slug: 1 })).toBe('slug_1');
    expect(declaredIndexName({ tier: 1, archived: -1 })).toBe('tier_1_archived_-1');
    expect(declaredIndexName({ name: 'text', aliases: 'text' })).toBe('name_text_aliases_text');
    expect(declaredIndexName({ slug: 1 }, { name: 'chosen' })).toBe('chosen');
  });

  it('skips a model whose collection is absent, and does not create it', async () => {
    connection.model('DriftAbsent', probeSchema());
    const drift = await reportMissingMongoIndexes(connection);
    expect(drift.map((entry) => entry.collection)).not.toContain(COLLECTION);
    const collections = await connection.db!.listCollections({ name: COLLECTION }).toArray();
    expect(collections).toHaveLength(0);
  });

  it('reports a declared index the live collection is missing, then nothing once it is built', async () => {
    const model = connection.model('DriftPresent', probeSchema());
    await connection.db!.collection(COLLECTION).insertOne({ slug: 'a', name: 'a' });

    const before = await reportMissingMongoIndexes(connection);
    const entry = before.find((row) => row.collection === COLLECTION);
    expect(entry?.missingIndexNames.sort()).toEqual(['name_1', 'slug_1']);

    await model.createIndexes();

    const after = await reportMissingMongoIndexes(connection);
    expect(after.find((row) => row.collection === COLLECTION)).toBeUndefined();
  });

  it('builds additively: an index the schema no longer declares survives a build', async () => {
    await connection.db!.collection(COLLECTION).createIndex({ retired: 1 }, { name: 'retired_1' });
    const model = connection.model('DriftPresent');

    await model.createIndexes();

    const live = (await connection.db!.collection(COLLECTION).indexes()).map((row) => row.name);
    expect(live).toContain('retired_1');
    expect(live).toContain('slug_1');
  });

  it('plans every model that declares an index and none that declares none', () => {
    const bare = new mongoose.Schema({ note: String }, { collection: 'autoindex_probe_bare' });
    connection.model('DriftBare', bare);
    const plans = planDeclaredIndexes(connection);
    expect(plans.map((plan) => plan.collection)).toContain(COLLECTION);
    expect(plans.map((plan) => plan.collection)).not.toContain('autoindex_probe_bare');
    const probe = plans.find((plan) => plan.collection === COLLECTION);
    expect(probe?.declaredIndexNames.sort()).toEqual(['name_1', 'slug_1']);
  });
});
