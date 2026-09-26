import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  assertRetireDocumentedWayInFieldApplyAllowed,
  parseRetireDocumentedWayInFieldArgs,
  retireDocumentedWayInField,
} from '../retireDocumentedWayInField';
import {
  RETIRED_DOCUMENTED_WAY_IN_INDEX_NAME,
  assertDocumentedWayInFieldsFullyUnset,
  assertDocumentedWayInIndexDropAllowed,
} from '../retireDocumentedWayInFieldCore';

describe('retireDocumentedWayInField CLI helpers', () => {
  it('defaults to a dry-run and parses apply safety flags', () => {
    expect(parseRetireDocumentedWayInFieldArgs([])).toEqual({
      apply: false,
      confirmRetireDocumentedWayInField: false,
    });
    expect(
      parseRetireDocumentedWayInFieldArgs(['--apply', '--confirm-retire-documented-way-in-field']),
    ).toEqual({
      apply: true,
      confirmRetireDocumentedWayInField: true,
    });
  });

  it('rejects malformed CLI arguments', () => {
    expect(() => parseRetireDocumentedWayInFieldArgs(['prod'])).toThrow(
      /Unknown retire:documented-way-in-field argument: prod/,
    );
    expect(() =>
      parseRetireDocumentedWayInFieldArgs(['--confirm-retire-documented-way-in-field=1']),
    ).toThrow(/does not accept a value/);
  });

  it('requires confirmation when applying', () => {
    expect(() =>
      assertRetireDocumentedWayInFieldApplyAllowed(
        { apply: true, confirmRetireDocumentedWayInField: false },
        { SCRAPER_ENV: 'development' },
        'mongodb://localhost:27017/Development',
      ),
    ).toThrow(/--confirm-retire-documented-way-in-field is required/);
    expect(() =>
      assertRetireDocumentedWayInFieldApplyAllowed(
        { apply: false, confirmRetireDocumentedWayInField: false },
        { SCRAPER_ENV: 'development' },
        'mongodb://localhost:27017/Development',
      ),
    ).not.toThrow();
  });

  it('refuses a production apply unless the production env vars are set', () => {
    expect(() =>
      assertRetireDocumentedWayInFieldApplyAllowed(
        { apply: true, confirmRetireDocumentedWayInField: true },
        { SCRAPER_ENV: 'development' },
        'mongodb://localhost:27017/Prod',
      ),
    ).toThrow(/looks like production/);
    expect(() =>
      assertRetireDocumentedWayInFieldApplyAllowed(
        { apply: true, confirmRetireDocumentedWayInField: true },
        { SCRAPER_ENV: 'production' },
        'mongodb://localhost:27017/Prod',
      ),
    ).toThrow(/CONFIRM_PROD_SCRAPE=true/);
    expect(() =>
      assertRetireDocumentedWayInFieldApplyAllowed(
        { apply: true, confirmRetireDocumentedWayInField: true },
        { SCRAPER_ENV: 'production', CONFIRM_PROD_SCRAPE: 'true' },
        'mongodb://localhost:27017/Prod',
      ),
    ).not.toThrow();
  });
});

describe('retireDocumentedWayInField invariants', () => {
  it('fails the apply when any document still carries the field', () => {
    expect(() => assertDocumentedWayInFieldsFullyUnset(3)).toThrow(/invariant violated: 3/);
    expect(() => assertDocumentedWayInFieldsFullyUnset(0)).not.toThrow();
  });

  it('refuses the index drop while the field is still populated', () => {
    expect(() => assertDocumentedWayInIndexDropAllowed(2)).toThrow(
      /Refusing to drop archived_1_hasDocumentedWayIn_1/,
    );
    expect(() => assertDocumentedWayInIndexDropAllowed(0)).not.toThrow();
  });
});

let memoryReplSet: MongoMemoryReplSet | undefined;

describe('retireDocumentedWayInField with MongoDB', () => {
  beforeAll(async () => {
    let mongoUrl = process.env.RETIRE_DOCUMENTED_WAY_IN_TEST_MONGO_URL;
    if (!mongoUrl) {
      memoryReplSet = await MongoMemoryReplSet.create({
        binary: { version: '8.0.12' },
        replSet: { count: 1, storageEngine: 'wiredTiger' },
      });
      mongoUrl = memoryReplSet.getUri('retire_documented_way_in_test');
    }
    await mongoose.connect(mongoUrl);
  }, 120_000);

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
    const db = mongoose.connection.db!;

    await db.collection('research_entities').insertMany([
      {
        _id: new mongoose.Types.ObjectId(),
        name: 'Synthetic Lab With Retired Marker',
        hasDocumentedWayIn: true,
        hasUndergradHostingEvidence: true,
        archived: false,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        name: 'Synthetic Lab With False Marker',
        hasDocumentedWayIn: false,
        archived: false,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        name: 'Synthetic Lab Already Clean',
        archived: false,
      },
    ]);
    await db
      .collection('research_entities')
      .createIndex(
        { archived: 1, hasDocumentedWayIn: 1 },
        { name: RETIRED_DOCUMENTED_WAY_IN_INDEX_NAME },
      );
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryReplSet?.stop();
  });

  it('performs no writes and drops no index in dry-run mode', async () => {
    const db = mongoose.connection.db!;
    const result = await retireDocumentedWayInField({ apply: false });

    expect(result.mode).toBe('dry-run');
    expect(result.presentBefore).toBe(2);
    expect(result.presentAfter).toBe(2);
    expect(result.modified).toBe(0);
    expect(result.indexPresentBefore).toBe(true);
    expect(result.indexDropped).toBe(false);

    const entity = await db
      .collection('research_entities')
      .findOne({ name: 'Synthetic Lab With Retired Marker' });
    expect(entity?.hasDocumentedWayIn).toBe(true);
    const indexes = await db.collection('research_entities').indexes();
    expect(indexes.some((index) => index.name === RETIRED_DOCUMENTED_WAY_IN_INDEX_NAME)).toBe(true);
  });

  it('unsets the field for both true and false values and then drops the stale index', async () => {
    const db = mongoose.connection.db!;
    const result = await retireDocumentedWayInField({ apply: true });

    expect(result.mode).toBe('apply');
    expect(result.presentBefore).toBe(2);
    expect(result.presentAfter).toBe(0);
    expect(result.modified).toBe(2);
    expect(result.indexDropped).toBe(true);

    const marked = await db
      .collection('research_entities')
      .findOne({ name: 'Synthetic Lab With Retired Marker' });
    expect(marked?.hasDocumentedWayIn).toBeUndefined();
    expect(marked?.hasUndergradHostingEvidence).toBe(true);
    expect(marked?.name).toBe('Synthetic Lab With Retired Marker');

    const indexes = await db.collection('research_entities').indexes();
    expect(indexes.some((index) => index.name === RETIRED_DOCUMENTED_WAY_IN_INDEX_NAME)).toBe(
      false,
    );
  });

  it('is idempotent and reports an absent index on a second apply', async () => {
    await retireDocumentedWayInField({ apply: true });
    const result = await retireDocumentedWayInField({ apply: true });

    expect(result.presentBefore).toBe(0);
    expect(result.presentAfter).toBe(0);
    expect(result.modified).toBe(0);
    expect(result.indexPresentBefore).toBe(false);
    expect(result.indexDropped).toBe(false);
  });
});
