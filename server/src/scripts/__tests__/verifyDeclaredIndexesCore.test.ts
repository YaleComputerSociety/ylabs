import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildIndexesCommand,
  compareCollectionIndexes,
  formatDeclaredIndexVerification,
  verifyDeclaredIndexes,
  type DeclaredIndexVerification,
} from '../verifyDeclaredIndexesCore';

const emptyResult = (
  overrides: Partial<DeclaredIndexVerification> = {},
): DeclaredIndexVerification => ({
  checkedCollections: 3,
  absentCollections: [],
  missing: [],
  conflicts: [],
  extra: [],
  ...overrides,
});

describe('compareCollectionIndexes', () => {
  const declared = [
    { name: 'slug_1', key: { slug: 1 } },
    { name: 'kind_1_name_1', key: { kind: 1, name: 1 } },
  ];

  it('passes when every declared index is live under its own name and keys', () => {
    expect(
      compareCollectionIndexes(declared, [
        { name: '_id_', key: { _id: 1 } },
        { name: 'slug_1', key: { slug: 1 } },
        { name: 'kind_1_name_1', key: { kind: 1, name: 1 } },
      ]),
    ).toEqual({ missing: [], conflicts: [], extra: [] });
  });

  it('reports a declared index the target lacks as missing', () => {
    expect(
      compareCollectionIndexes(declared, [{ name: 'slug_1', key: { slug: 1 } }]).missing,
    ).toEqual(['kind_1_name_1']);
  });

  it('reports an undeclared live index as extra, never the default _id index', () => {
    const result = compareCollectionIndexes(declared, [
      { name: '_id_', key: { _id: 1 } },
      { name: 'slug_1', key: { slug: 1 } },
      { name: 'kind_1_name_1', key: { kind: 1, name: 1 } },
      { name: 'legacy_1', key: { legacy: 1 } },
    ]);
    expect(result.extra).toEqual(['legacy_1']);
    expect(result.missing).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it('reports a declared name on other keys as a conflict', () => {
    const result = compareCollectionIndexes(declared, [
      { name: 'slug_1', key: { slug: -1 } },
      { name: 'kind_1_name_1', key: { kind: 1, name: 1 } },
    ]);
    expect(result.conflicts).toEqual([
      { declared: 'slug_1', live: 'slug_1', reason: 'same name, different keys' },
    ]);
    expect(result.missing).toEqual([]);
  });

  it('reports the declared keys under another name as a conflict, not as missing and extra', () => {
    const result = compareCollectionIndexes(declared, [
      { name: 'slug_1', key: { slug: 1 } },
      { name: 'byKindName', key: { kind: 1, name: 1 } },
    ]);
    expect(result.conflicts).toEqual([
      { declared: 'kind_1_name_1', live: 'byKindName', reason: 'same keys, different name' },
    ]);
    expect(result.missing).toEqual([]);
    expect(result.extra).toEqual([]);
  });

  it('matches a declared text index with its stored _fts form', () => {
    const textDeclared = [
      { name: 'name_text_abbreviation_text', key: { name: 'text', abbreviation: 'text' } },
    ];
    const stored = {
      name: 'name_text_abbreviation_text',
      key: { _fts: 'text', _ftsx: 1 },
      weights: { abbreviation: 1, name: 1 },
    };
    expect(compareCollectionIndexes(textDeclared, [stored])).toEqual({
      missing: [],
      conflicts: [],
      extra: [],
    });
    expect(
      compareCollectionIndexes(textDeclared, [{ ...stored, weights: { name: 1 } }]).conflicts,
    ).toEqual([
      {
        declared: 'name_text_abbreviation_text',
        live: 'name_text_abbreviation_text',
        reason: 'same name, different keys',
      },
    ]);
  });

  it('treats key order as significant', () => {
    const result = compareCollectionIndexes(declared, [
      { name: 'slug_1', key: { slug: 1 } },
      { name: 'name_1_kind_1', key: { name: 1, kind: 1 } },
    ]);
    expect(result.missing).toEqual(['kind_1_name_1']);
    expect(result.extra).toEqual(['name_1_kind_1']);
  });
});

describe('formatDeclaredIndexVerification', () => {
  it('passes with only a warning for extra indexes', () => {
    const { lines, failed } = formatDeclaredIndexVerification(
      'production',
      'Prod',
      emptyResult({ extra: [{ collection: 'users', indexNames: ['legacy_1'] }] }),
    );
    expect(failed).toBe(false);
    expect(lines.join('\n')).toContain('warning: users carries undeclared index(es): legacy_1');
    expect(lines.join('\n')).not.toContain('db:build-indexes');
  });

  it('fails on a missing index and prints the exact build command', () => {
    const { lines, failed } = formatDeclaredIndexVerification(
      'production',
      'Prod',
      emptyResult({ missing: [{ collection: 'users', indexNames: ['netid_1'] }] }),
    );
    expect(failed).toBe(true);
    expect(lines).toContain('MISSING users: netid_1');
    expect(lines).toContain(
      'Build the missing indexes with: SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true MONGODBURL="$PRODUCTION_MONGODBURL" yarn --cwd server db:build-indexes --apply',
    );
  });

  it('fails on a conflict without offering the build command as the fix', () => {
    const { lines, failed } = formatDeclaredIndexVerification(
      'beta',
      'Beta',
      emptyResult({
        conflicts: [
          {
            collection: 'users',
            declared: 'netid_1',
            live: 'netid_1',
            reason: 'same name, different keys',
          },
        ],
      }),
    );
    expect(failed).toBe(true);
    expect(lines.join('\n')).toContain('CONFLICT users: declared netid_1 vs live netid_1');
    expect(lines.join('\n')).toContain('needs a reviewed migration');
    expect(lines.join('\n')).not.toContain('Build the missing indexes');
  });

  it('names the URL variable and never a connection string', () => {
    expect(buildIndexesCommand('beta')).toBe(
      'MONGODBURL="$BETA_MONGODBURL" yarn --cwd server db:build-indexes --apply',
    );
    expect(buildIndexesCommand('production')).not.toMatch(/mongodb(\+srv)?:\/\//);
  });
});

describe('verifyDeclaredIndexes against an in-memory MongoDB', () => {
  let memoryServer: MongoMemoryServer | undefined;
  let connection: mongoose.Connection;

  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    connection = mongoose.createConnection(memoryServer.getUri('verify_declared_indexes_test'));
    await connection.asPromise();
    const widgetSchema = new mongoose.Schema(
      { slug: String, kind: String, name: String },
      { autoIndex: false },
    );
    widgetSchema.index({ slug: 1 }, { unique: true });
    widgetSchema.index({ kind: 1, name: 1 });
    widgetSchema.index({ name: 'text', kind: 'text' });
    connection.model('Widget', widgetSchema, 'widgets');
    const absentSchema = new mongoose.Schema({ code: String }, { autoIndex: false });
    absentSchema.index({ code: 1 });
    connection.model('Absent', absentSchema, 'absents');

    const widgets = connection.db!.collection('widgets');
    await widgets.insertOne({ slug: 'fixture', kind: 'lab', name: 'Fixture' });
    await widgets.createIndex({ slug: 1 }, { name: 'slug_1', unique: true });
    await widgets.createIndex({ legacy: 1 }, { name: 'legacy_1' });
    await widgets.createIndex({ name: 'text', kind: 'text' }, { name: 'name_text_kind_text' });
  });

  afterAll(async () => {
    await connection?.close();
    await memoryServer?.stop();
  });

  it('reports missing and extra indexes, skips absent collections, and builds nothing', async () => {
    const before = await connection.db!.collection('widgets').indexes();
    const result = await verifyDeclaredIndexes(connection);
    expect(result.checkedCollections).toBe(1);
    expect(result.absentCollections).toEqual(['absents']);
    expect(result.missing).toEqual([{ collection: 'widgets', indexNames: ['kind_1_name_1'] }]);
    expect(result.extra).toEqual([{ collection: 'widgets', indexNames: ['legacy_1'] }]);
    expect(result.conflicts).toEqual([]);
    expect(await connection.db!.collection('widgets').indexes()).toEqual(before);
    const collections = await connection.db!.listCollections({}, { nameOnly: true }).toArray();
    expect(collections.map((entry) => entry.name)).not.toContain('absents');
  });
});

describe('verifyDeclaredIndexes on the real models', () => {
  let memoryServer: MongoMemoryServer | undefined;

  beforeAll(async () => {
    await import('../../models');
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('verify_declared_indexes_models_test'));
    for (const modelName of mongoose.connection.modelNames()) {
      await mongoose.connection.model(modelName).createIndexes();
    }
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('reads a database built by the declared indexes as clean', async () => {
    const result = await verifyDeclaredIndexes(mongoose.connection);
    expect(result.checkedCollections).toBeGreaterThan(0);
    expect(result.missing).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.extra).toEqual([]);
  });
});
