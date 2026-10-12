import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildRefOrphanCountPipeline, buildRefOrphanMatchPipeline } from '../betaDataQualityCore';

describe('buildRefOrphanCountPipeline', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    const db = mongoose.connection.db!;
    const live = new mongoose.Types.ObjectId();
    const gone = new mongoose.Types.ObjectId();
    const alsoGone = new mongoose.Types.ObjectId();
    await db.collection('targets').insertOne({ _id: live });
    await db
      .collection('owners')
      .insertMany([
        { ref: live, kind: 'a' },
        { ref: gone, kind: 'a' },
        { ref: gone, kind: 'b' },
        { ref: alsoGone, kind: 'a' },
        { ref: null, kind: 'a' },
        { ref: '', kind: 'a' },
        { kind: 'a' },
        { refs: [live, gone, gone, alsoGone], kind: 'a' },
        { refs: [], kind: 'a' },
      ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  const counts = async (field: string, ownerFilter: Record<string, unknown> = {}) => {
    const owners = mongoose.connection.db!.collection('owners');
    const perRow = await owners
      .aggregate([
        ...buildRefOrphanMatchPipeline(field, 'targets', ownerFilter),
        { $count: 'count' },
      ])
      .toArray();
    const grouped = await owners
      .aggregate(buildRefOrphanCountPipeline(field, 'targets', ownerFilter))
      .toArray();
    return { perRow: perRow[0]?.count ?? 0, grouped: grouped[0]?.count ?? 0 };
  };

  it('counts the same orphans as the per-row lookup for a scalar reference', async () => {
    expect(await counts('ref')).toEqual({ perRow: 3, grouped: 3 });
  });

  it('counts each orphaned array element, duplicates included, as the per-row lookup does', async () => {
    expect(await counts('refs')).toEqual({ perRow: 3, grouped: 3 });
  });

  it('applies the owner filter before grouping', async () => {
    expect(await counts('ref', { kind: 'b' })).toEqual({ perRow: 1, grouped: 1 });
  });
});
