import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installMongoWriteRefusal, MongoWriteRefusedError } from '../mongoWriteRefusal';

describe('installMongoWriteRefusal', () => {
  let mongod: MongoMemoryServer;
  const Probe = mongoose.model(
    'MongoWriteRefusalProbe',
    new mongoose.Schema({ name: String, count: Number }),
  );

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri('Refusal'));
    await Probe.create({ name: 'seed', count: 1 });
  }, 120_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  it('refuses every write path while reads keep working, and restores cleanly', async () => {
    const refusal = installMongoWriteRefusal(mongoose);
    const raw = mongoose.connection.db!.collection('mongowriterefusalprobes');
    try {
      await expect(Probe.create({ name: 'blocked' })).rejects.toBeInstanceOf(
        MongoWriteRefusedError,
      );
      await expect(
        Probe.updateOne({ name: 'seed' }, { $inc: { count: 1 } }),
      ).rejects.toBeInstanceOf(MongoWriteRefusedError);
      await expect(Probe.deleteMany({})).rejects.toBeInstanceOf(MongoWriteRefusedError);
      await expect(
        Probe.findOneAndUpdate({ name: 'seed' }, { $set: { count: 9 } }),
      ).rejects.toBeInstanceOf(MongoWriteRefusedError);
      await expect(
        Probe.bulkWrite([{ insertOne: { document: { name: 'x' } } }]),
      ).rejects.toBeInstanceOf(MongoWriteRefusedError);
      await expect(raw.insertOne({ name: 'raw' })).rejects.toBeInstanceOf(MongoWriteRefusedError);
      expect(() => raw.aggregate([{ $match: {} }, { $merge: { into: 'elsewhere' } }])).toThrow(
        MongoWriteRefusedError,
      );
      expect(() => raw.aggregate([{ $out: 'elsewhere' }])).toThrow(MongoWriteRefusedError);
      await expect(
        mongoose.connection.db!.command({ insert: 'mongowriterefusalprobes', documents: [{}] }),
      ).rejects.toBeInstanceOf(MongoWriteRefusedError);
      expect(() => raw.initializeOrderedBulkOp()).toThrow(MongoWriteRefusedError);
      await expect(mongoose.connection.db!.createCollection('fresh')).rejects.toBeInstanceOf(
        MongoWriteRefusedError,
      );

      expect(await Probe.countDocuments({})).toBe(1);
      expect((await Probe.findOne({ name: 'seed' }).lean())?.count).toBe(1);
      expect(await raw.aggregate([{ $match: { name: 'seed' } }]).toArray()).toHaveLength(1);
      expect((await mongoose.connection.db!.command({ ping: 1 })).ok).toBe(1);
      expect(refusal.refusedOperations()).toContain('collection.insertOne');
      expect(refusal.refusedOperations()).toContain('db.command(insert)');
    } finally {
      refusal.restore();
    }

    await Probe.create({ name: 'after-restore' });
    expect(await Probe.countDocuments({})).toBe(2);
  });
});
