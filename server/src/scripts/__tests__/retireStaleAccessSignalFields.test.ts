import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  assertRetireStaleAccessSignalFieldsApplyAllowed,
  parseRetireStaleAccessSignalFieldsArgs,
  retireStaleAccessSignalFields,
} from '../retireStaleAccessSignalFields';

describe('retireStaleAccessSignalFields CLI helpers', () => {
  it('defaults to a dry-run and parses apply safety flags', () => {
    expect(parseRetireStaleAccessSignalFieldsArgs([])).toEqual({
      apply: false,
      confirmRetireStaleAccessSignalFields: false,
    });
    expect(
      parseRetireStaleAccessSignalFieldsArgs([
        '--apply',
        '--confirm-retire-stale-access-signal-fields',
      ]),
    ).toEqual({
      apply: true,
      confirmRetireStaleAccessSignalFields: true,
    });
  });

  it('rejects malformed CLI arguments', () => {
    expect(() => parseRetireStaleAccessSignalFieldsArgs(['prod'])).toThrow(
      /Unknown retire:stale-access-signal-fields argument: prod/,
    );
    expect(() =>
      parseRetireStaleAccessSignalFieldsArgs(['--confirm-retire-stale-access-signal-fields=1']),
    ).toThrow(/does not accept a value/);
  });

  it('requires confirmation when applying', () => {
    expect(() =>
      assertRetireStaleAccessSignalFieldsApplyAllowed({
        apply: true,
        confirmRetireStaleAccessSignalFields: false,
      }),
    ).toThrow(/--confirm-retire-stale-access-signal-fields is required/);
    expect(() =>
      assertRetireStaleAccessSignalFieldsApplyAllowed({
        apply: false,
        confirmRetireStaleAccessSignalFields: false,
      }),
    ).not.toThrow();
  });
});

let memoryReplSet: MongoMemoryReplSet | undefined;

describe('retireStaleAccessSignalFields with MongoDB', () => {
  beforeAll(async () => {
    let mongoUrl = process.env.RETIRE_ACCESS_SIGNAL_TEST_MONGO_URL;
    if (!mongoUrl) {
      memoryReplSet = await MongoMemoryReplSet.create({
        binary: { version: '8.0.12' },
        replSet: { count: 1, storageEngine: 'wiredTiger' },
      });
      mongoUrl = memoryReplSet.getUri('retire_access_signal_test');
    }
    await mongoose.connect(mongoUrl);
  }, 120_000);

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
    const db = mongoose.connection.db!;

    await db.collection('research_entities').insertMany([
      {
        _id: new mongoose.Types.ObjectId(),
        name: 'Synthetic Lab With Stale Fields',
        acceptingUndergrads: true,
        openness: 'open',
        acceptanceConfidence: 0.6,
        opennessSignals: [{ field: 'acceptingUndergrads', value: true }],
        opennessStatusCache: 'verified-accepting',
        opennessExplanationCache: ['synthetic explanation'],
        opennessComputedAt: new Date(),
        opennessLastSignalAt: new Date(),
        accessAcceptanceLevel: 'ACCEPTING',
      },
      {
        _id: new mongoose.Types.ObjectId(),
        name: 'Synthetic Lab Already Clean',
        accessAcceptanceLevel: 'UNKNOWN',
      },
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryReplSet?.stop();
  });

  it('performs no writes in dry-run mode', async () => {
    const db = mongoose.connection.db!;
    const result = await retireStaleAccessSignalFields({ apply: false });

    expect(result.mode).toBe('dry-run');
    expect(result.presentBefore).toBe(1);
    expect(result.presentAfter).toBe(1);
    expect(result.modified).toBe(0);

    const entity = await db
      .collection('research_entities')
      .findOne({ name: 'Synthetic Lab With Stale Fields' });
    expect(entity?.acceptingUndergrads).toBe(true);
    expect(entity?.opennessStatusCache).toBe('verified-accepting');
  });

  it('unsets only the stale fields on apply', async () => {
    const db = mongoose.connection.db!;
    const result = await retireStaleAccessSignalFields({ apply: true });

    expect(result.mode).toBe('apply');
    expect(result.presentBefore).toBe(1);
    expect(result.presentAfter).toBe(0);
    expect(result.modified).toBe(1);

    const entity = await db
      .collection('research_entities')
      .findOne({ name: 'Synthetic Lab With Stale Fields' });
    expect(entity?.acceptingUndergrads).toBeUndefined();
    expect(entity?.openness).toBeUndefined();
    expect(entity?.acceptanceConfidence).toBeUndefined();
    expect(entity?.opennessSignals).toBeUndefined();
    expect(entity?.opennessStatusCache).toBeUndefined();
    expect(entity?.opennessExplanationCache).toBeUndefined();
    expect(entity?.opennessComputedAt).toBeUndefined();
    expect(entity?.opennessLastSignalAt).toBeUndefined();
    expect(entity?.accessAcceptanceLevel).toBe('ACCEPTING');
    expect(entity?.name).toBe('Synthetic Lab With Stale Fields');
  });
});
