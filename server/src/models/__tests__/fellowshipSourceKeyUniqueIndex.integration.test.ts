import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Fellowship } from '../fellowship';
import { unbuildableIndexSpecReason } from '../../db/connections';
import { planDuplicateFellowshipSourceKeyRetirements } from '../../scripts/repairDuplicateFellowshipSourceKeysCore';

const SOURCE_KEY = 'department-probe:probe-major-research-grant';

async function liveSourceKeyIndex(): Promise<Record<string, unknown> | undefined> {
  const indexes = await mongoose.connection.db!.collection('fellowships').indexes();
  return indexes.find((index) => index.name === 'sourceKey_1') as
    | Record<string, unknown>
    | undefined;
}

describe('the declared fellowship sourceKey unique index can actually be built (#3081)', () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await server.stop();
  });

  beforeEach(async () => {
    const collections = await mongoose.connection.db!.listCollections({ name: 'fellowships' }).toArray();
    if (collections.length > 0) await mongoose.connection.db!.dropCollection('fellowships');
  });

  it('declares a spec MongoDB accepts, which mixing sparse with a partial filter would not be', () => {
    const declared = Fellowship.schema
      .indexes()
      .find(([key]) => Object.keys(key).join(',') === 'sourceKey');
    expect(declared).toBeDefined();
    const options = declared![1] as Record<string, unknown>;
    expect(options.unique).toBe(true);
    expect(options.partialFilterExpression).toEqual({ sourceKey: { $type: 'string' } });
    expect(options.sparse).toBeUndefined();
    expect(unbuildableIndexSpecReason(options)).toBeNull();
  });

  it('builds sourceKey_1 as a unique partial index, and the build is asserted by listIndexes', async () => {
    await Fellowship.createIndexes();
    const live = await liveSourceKeyIndex();
    expect(live).toBeDefined();
    expect(live?.unique).toBe(true);
    expect(live?.partialFilterExpression).toEqual({ sourceKey: { $type: 'string' } });
    expect(live?.sparse).toBeUndefined();
  });

  it('rejects a second row holding the same string sourceKey', async () => {
    await Fellowship.createIndexes();
    await Fellowship.create({ title: 'Probe Grant', sourceKey: SOURCE_KEY });
    await expect(Fellowship.create({ title: 'Probe Grant Copy', sourceKey: SOURCE_KEY })).rejects.toThrow(
      /duplicate key/i,
    );
  });

  it('admits many rows carrying no sourceKey, which is what sparse was there for', async () => {
    await Fellowship.createIndexes();
    await Fellowship.create({ title: 'No Key One' });
    await Fellowship.create({ title: 'No Key Two' });
    expect(await Fellowship.countDocuments({ sourceKey: { $type: 'string' } })).toBe(0);
    expect(await Fellowship.countDocuments({})).toBe(2);
  });

  it('cannot build over a duplicate, and the planned retirement is what unblocks it', async () => {
    const archived = await Fellowship.create({
      title: 'Probe Grant',
      sourceKey: SOURCE_KEY,
      archived: true,
    });
    const live = await Fellowship.create({
      title: 'Probe Grant',
      sourceKey: SOURCE_KEY,
      archived: false,
    });

    await expect(Fellowship.createIndexes()).rejects.toThrow(/duplicate key/i);
    expect(await liveSourceKeyIndex()).toBeUndefined();

    const plan = planDuplicateFellowshipSourceKeyRetirements([
      { id: String(archived._id), sourceKey: SOURCE_KEY, archived: true },
      { id: String(live._id), sourceKey: SOURCE_KEY, archived: false },
    ]);
    expect(plan.retirements).toEqual([
      { sourceKey: SOURCE_KEY, keepId: String(live._id), retireIds: [String(archived._id)] },
    ]);
    for (const id of plan.retirements[0].retireIds) {
      await Fellowship.updateOne({ _id: id }, { $unset: { sourceKey: '' } });
    }

    await Fellowship.createIndexes();
    expect(await liveSourceKeyIndex()).toBeDefined();
    expect(await Fellowship.countDocuments({})).toBe(2);
    expect(String((await Fellowship.findOne({ sourceKey: SOURCE_KEY }).lean())!._id)).toBe(
      String(live._id),
    );
  });
});
