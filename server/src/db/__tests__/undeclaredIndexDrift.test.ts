import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import '../../models';
import { RETIRED_INDEXES } from '../../scripts/cleanupLegacyMongoCollections';
import { compareDeclaredAndLiveIndexNames, declaredIndexNamesByCollection } from '../connections';

function fixtureConnection() {
  const connection = mongoose.createConnection();
  const schema = new mongoose.Schema({
    slug: { type: String, unique: true },
    owner: { type: String, index: true },
    title: String,
    archived: Boolean,
  });
  schema.index({ archived: 1, title: 1 });
  schema.index({ title: 'text' });
  connection.model('DriftFixture', schema, 'drift_fixtures');
  return connection;
}

describe('index drift between declared and live indexes', () => {
  it('derives declared names from field-level, unique, compound and text declarations', () => {
    const declared = declaredIndexNamesByCollection(fixtureConnection()).get('drift_fixtures');

    expect(declared?.models).toEqual(['DriftFixture']);
    expect([...(declared?.indexNames ?? [])].sort()).toEqual(
      ['archived_1_title_1', 'owner_1', 'slug_1', 'title_text'].sort(),
    );
  });

  it('reports both directions: declared but missing, and live but undeclared', () => {
    const declared = declaredIndexNamesByCollection(fixtureConnection()).get('drift_fixtures')!;
    const live = ['_id_', 'slug_1', 'owner_1', 'title_text', 'retiredField_1', 'legacy_1_x_-1'];

    expect(compareDeclaredAndLiveIndexNames(declared.indexNames, live)).toEqual({
      missing: ['archived_1_title_1'],
      undeclared: ['legacy_1_x_-1', 'retiredField_1'],
    });
  });

  it('never reports the default _id index as undeclared', () => {
    expect(compareDeclaredAndLiveIndexNames([], ['_id_'])).toEqual({
      missing: [],
      undeclared: [],
    });
  });

  it('retires no index that a registered model still declares', () => {
    const declared = declaredIndexNamesByCollection(mongoose.connection);
    for (const retired of RETIRED_INDEXES) {
      expect(declared.get(retired.collection)?.indexNames ?? []).not.toContain(retired.name);
    }
  });
});
