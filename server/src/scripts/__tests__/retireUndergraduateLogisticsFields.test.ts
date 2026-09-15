import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  assertRetireUndergraduateLogisticsFieldsApplyAllowed,
  parseRetireUndergraduateLogisticsFieldsArgs,
  retireUndergraduateLogisticsFields,
} from '../retireUndergraduateLogisticsFields';
import {
  RETIRED_UNDERGRADUATE_LOGISTICS_INDEX_NAMES,
  assertUndergraduateLogisticsFieldsFullyUnset,
  assertUndergraduateLogisticsIndexDropAllowed,
} from '../retireUndergraduateLogisticsFieldsCore';

describe('retireUndergraduateLogisticsFields CLI helpers', () => {
  it('defaults to a dry-run and parses apply safety flags', () => {
    expect(parseRetireUndergraduateLogisticsFieldsArgs([])).toEqual({
      apply: false,
      confirmRetireUndergraduateLogisticsFields: false,
    });
    expect(
      parseRetireUndergraduateLogisticsFieldsArgs([
        '--apply',
        '--confirm-retire-undergraduate-logistics-fields',
      ]),
    ).toEqual({
      apply: true,
      confirmRetireUndergraduateLogisticsFields: true,
    });
  });

  it('rejects malformed CLI arguments', () => {
    expect(() => parseRetireUndergraduateLogisticsFieldsArgs(['prod'])).toThrow(
      /Unknown retire:undergraduate-logistics-fields argument: prod/,
    );
    expect(() =>
      parseRetireUndergraduateLogisticsFieldsArgs([
        '--confirm-retire-undergraduate-logistics-fields=1',
      ]),
    ).toThrow(/does not accept a value/);
  });

  it('requires confirmation when applying', () => {
    expect(() =>
      assertRetireUndergraduateLogisticsFieldsApplyAllowed(
        { apply: true, confirmRetireUndergraduateLogisticsFields: false },
        { SCRAPER_ENV: 'development' },
        'mongodb://localhost:27017/Development',
      ),
    ).toThrow(/--confirm-retire-undergraduate-logistics-fields is required/);
    expect(() =>
      assertRetireUndergraduateLogisticsFieldsApplyAllowed(
        { apply: false, confirmRetireUndergraduateLogisticsFields: false },
        { SCRAPER_ENV: 'development' },
        'mongodb://localhost:27017/Development',
      ),
    ).not.toThrow();
  });

  it('refuses a production apply unless the production env vars are set', () => {
    expect(() =>
      assertRetireUndergraduateLogisticsFieldsApplyAllowed(
        { apply: true, confirmRetireUndergraduateLogisticsFields: true },
        { SCRAPER_ENV: 'development' },
        'mongodb://localhost:27017/Prod',
      ),
    ).toThrow(/looks like production/);
    expect(() =>
      assertRetireUndergraduateLogisticsFieldsApplyAllowed(
        { apply: true, confirmRetireUndergraduateLogisticsFields: true },
        { SCRAPER_ENV: 'production' },
        'mongodb://localhost:27017/Prod',
      ),
    ).toThrow(/CONFIRM_PROD_SCRAPE=true/);
    expect(() =>
      assertRetireUndergraduateLogisticsFieldsApplyAllowed(
        { apply: true, confirmRetireUndergraduateLogisticsFields: true },
        { SCRAPER_ENV: 'production', CONFIRM_PROD_SCRAPE: 'true' },
        'mongodb://localhost:27017/Prod',
      ),
    ).not.toThrow();
  });
});

describe('retireUndergraduateLogisticsFields invariants', () => {
  it('fails the apply when any document still carries a retired field', () => {
    expect(() => assertUndergraduateLogisticsFieldsFullyUnset(3)).toThrow(/invariant violated: 3/);
    expect(() => assertUndergraduateLogisticsFieldsFullyUnset(0)).not.toThrow();
  });

  it('refuses the index drops while a retired field is still populated', () => {
    expect(() => assertUndergraduateLogisticsIndexDropAllowed(2)).toThrow(
      /Refusing to drop the retired undergraduate-logistics indexes/,
    );
    expect(() => assertUndergraduateLogisticsIndexDropAllowed(0)).not.toThrow();
  });
});

let memoryReplSet: MongoMemoryReplSet | undefined;

describe('retireUndergraduateLogisticsFields with MongoDB', () => {
  beforeAll(async () => {
    let mongoUrl = process.env.RETIRE_UNDERGRADUATE_LOGISTICS_TEST_MONGO_URL;
    if (!mongoUrl) {
      memoryReplSet = await MongoMemoryReplSet.create({
        binary: { version: '8.0.12' },
        replSet: { count: 1, storageEngine: 'wiredTiger' },
      });
      mongoUrl = memoryReplSet.getUri('retire_undergraduate_logistics_test');
    }
    await mongoose.connect(mongoUrl);
  }, 120_000);

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
    const db = mongoose.connection.db!;

    await db.collection('research_entities').insertMany([
      {
        _id: new mongoose.Types.ObjectId(),
        name: 'Synthetic Lab Claiming Availability',
        undergraduateCurrentAvailability: 'OPEN',
        undergraduateCompensationModel: 'PAID_OR_STIPEND',
        undergraduateEligibleStudentLevels: ['FIRST_YEAR'],
        hasUndergradHostingEvidence: true,
        archived: false,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        name: 'Synthetic Lab Carrying Only Defaults',
        undergraduateCurrentAvailability: 'UNKNOWN',
        undergraduateCompensationModel: 'UNKNOWN',
        undergraduateEligibleStudentLevels: [],
        archived: false,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        name: 'Synthetic Lab Already Clean',
        archived: false,
      },
    ]);
    for (const [indexName, key] of [
      [RETIRED_UNDERGRADUATE_LOGISTICS_INDEX_NAMES[0], { undergraduateCurrentAvailability: 1 }],
      [RETIRED_UNDERGRADUATE_LOGISTICS_INDEX_NAMES[1], { undergraduateCompensationModel: 1 }],
      [RETIRED_UNDERGRADUATE_LOGISTICS_INDEX_NAMES[2], { undergraduateEligibleStudentLevels: 1 }],
    ] as const) {
      await db
        .collection('research_entities')
        .createIndex({ archived: 1, ...key }, { name: indexName });
    }
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryReplSet?.stop();
  });

  it('performs no writes and drops no index in dry-run mode', async () => {
    const db = mongoose.connection.db!;
    const result = await retireUndergraduateLogisticsFields({ apply: false });

    expect(result.mode).toBe('dry-run');
    expect(result.presentBefore).toBe(2);
    expect(result.presentAfter).toBe(2);
    expect(result.modified).toBe(0);
    expect(result.indexesPresentBefore).toEqual([...RETIRED_UNDERGRADUATE_LOGISTICS_INDEX_NAMES]);
    expect(result.indexesDropped).toEqual([]);

    const entity = await db
      .collection('research_entities')
      .findOne({ name: 'Synthetic Lab Claiming Availability' });
    expect(entity?.undergraduateCurrentAvailability).toBe('OPEN');
  });

  it('unsets the real and default values and then drops the stale indexes', async () => {
    const db = mongoose.connection.db!;
    const result = await retireUndergraduateLogisticsFields({ apply: true });

    expect(result.mode).toBe('apply');
    expect(result.presentBefore).toBe(2);
    expect(result.presentAfter).toBe(0);
    expect(result.modified).toBe(2);
    expect(result.indexesDropped).toEqual([...RETIRED_UNDERGRADUATE_LOGISTICS_INDEX_NAMES]);

    const claiming = await db
      .collection('research_entities')
      .findOne({ name: 'Synthetic Lab Claiming Availability' });
    expect(claiming?.undergraduateCurrentAvailability).toBeUndefined();
    expect(claiming?.undergraduateCompensationModel).toBeUndefined();
    expect(claiming?.undergraduateEligibleStudentLevels).toBeUndefined();
    expect(claiming?.hasUndergradHostingEvidence).toBe(true);
    expect(claiming?.name).toBe('Synthetic Lab Claiming Availability');

    const defaults = await db
      .collection('research_entities')
      .findOne({ name: 'Synthetic Lab Carrying Only Defaults' });
    expect(defaults?.undergraduateCurrentAvailability).toBeUndefined();
    expect(defaults?.undergraduateEligibleStudentLevels).toBeUndefined();

    const indexes = await db.collection('research_entities').indexes();
    const remaining = indexes.map((index) => index.name);
    for (const indexName of RETIRED_UNDERGRADUATE_LOGISTICS_INDEX_NAMES) {
      expect(remaining).not.toContain(indexName);
    }
  });

  it('is idempotent and reports absent indexes on a second apply', async () => {
    await retireUndergraduateLogisticsFields({ apply: true });
    const result = await retireUndergraduateLogisticsFields({ apply: true });

    expect(result.presentBefore).toBe(0);
    expect(result.presentAfter).toBe(0);
    expect(result.modified).toBe(0);
    expect(result.indexesPresentBefore).toEqual([]);
    expect(result.indexesDropped).toEqual([]);
  });
});
