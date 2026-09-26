import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  assertRetireStaleAccessSignalFieldsApplyAllowed,
  parseRetireStaleAccessSignalFieldsArgs,
  retireStaleAccessSignalFields,
} from '../retireStaleAccessSignalFields';
import { assertStaleAccessSignalIndexDropAllowed } from '../retireStaleAccessSignalFieldsCore';

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

  // The provenance sibling outlived the top-level cluster because nothing reads it by
  // name. It is a dotted path, so the only thing that could go wrong is the query or
  // the unset not accepting one, and a sibling provenance key must survive: the removal
  // is verdict-neutral only because the citations under the other keys stay (#210).
  it('unsets the nested provenance key and leaves its siblings intact', async () => {
    const db = mongoose.connection.db!;
    await db.collection('research_entities').insertOne({
      name: 'Synthetic Lab With Provenance Residue',
      slug: 'synthetic-lab-provenance-residue',
      fieldProvenance: {
        openness: { sourceName: 'retired-lane', sourceUrl: 'https://example.edu/openness' },
        fullDescription: { sourceName: 'live-lane', sourceUrl: 'https://example.edu/about' },
      },
    });

    const before = await retireStaleAccessSignalFields({ apply: false });
    expect(before.presentBefore).toBeGreaterThanOrEqual(1);
    expect(before.fields).toContain('fieldProvenance.openness');

    const result = await retireStaleAccessSignalFields({ apply: true });
    expect(result.presentAfter).toBe(0);

    const entity = await db
      .collection('research_entities')
      .findOne({ slug: 'synthetic-lab-provenance-residue' });
    expect(entity?.fieldProvenance?.openness).toBeUndefined();
    expect(entity?.fieldProvenance?.fullDescription?.sourceUrl).toBe('https://example.edu/about');
  });

  // Unsetting a field leaves its index behind, and an index no schema declares is
  // invisible to every drift reader here: `reportMissingMongoIndexes` compares declared
  // against live, so it cannot see one that is live and undeclared, and
  // `db:build-indexes` only creates. So the drop has to be explicit, and it has to read
  // the live collection afterwards rather than trust the command (#210).
  it('drops the retired indexes once the fields read zero, and only then', async () => {
    const db = mongoose.connection.db!;
    const collection = db.collection('research_entities');
    for (const name of ['openness_1_acceptingUndergrads_1', 'opennessStatusCache_1']) {
      const key =
        name === 'opennessStatusCache_1'
          ? { opennessStatusCache: 1 }
          : { openness: 1, acceptingUndergrads: 1 };
      await collection.createIndex(key as never, { name });
    }
    expect((await collection.indexes()).map((i) => i.name)).toEqual(
      expect.arrayContaining(['openness_1_acceptingUndergrads_1', 'opennessStatusCache_1']),
    );

    const dryRun = await retireStaleAccessSignalFields({ apply: false });
    expect(dryRun.indexesPresentBefore).toHaveLength(2);
    expect(dryRun.indexesDropped).toEqual([]);

    const applied = await retireStaleAccessSignalFields({ apply: true });
    expect(applied.indexesDropped).toEqual(
      expect.arrayContaining(['openness_1_acceptingUndergrads_1', 'opennessStatusCache_1']),
    );
    expect(applied.indexesDropped).toHaveLength(2);

    const liveNames = (await collection.indexes()).map((i) => i.name);
    expect(liveNames).not.toContain('openness_1_acceptingUndergrads_1');
    expect(liveNames).not.toContain('opennessStatusCache_1');
  });

  it('refuses the index drop while a retired field is still populated', () => {
    expect(() => assertStaleAccessSignalIndexDropAllowed(1)).toThrow(/still populated on 1/);
    expect(() => assertStaleAccessSignalIndexDropAllowed(0)).not.toThrow();
  });
});
