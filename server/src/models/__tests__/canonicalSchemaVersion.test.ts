import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  MAX_CANONICAL_SCHEMA_VERSION,
  canonicalSchemaVersionBsonProperty,
  canonicalSchemaVersionField,
  defineCanonicalSchemaVersion,
} from '../canonicalSchemaVersion';

const contract = defineCanonicalSchemaVersion({
  currentVersion: 2,
  supportedVersions: [2, 1, 2],
});

const fixtureSchema = new mongoose.Schema({
  schemaVersion: canonicalSchemaVersionField(contract),
});
const Fixture =
  mongoose.models.CanonicalSchemaVersionFixture ||
  mongoose.model(
    'CanonicalSchemaVersionFixture',
    fixtureSchema,
    'canonical_schema_version_fixtures',
  );

describe('canonical schema versions', () => {
  it('normalizes supported versions without forcing collections into lockstep', () => {
    expect(contract).toEqual({
      currentVersion: 2,
      supportedVersions: [1, 2],
    });
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.supportedVersions)).toBe(true);
  });

  it('defaults new Mongoose documents to the collection current version', () => {
    const doc = new Fixture();

    expect(doc.schemaVersion).toBe(2);
    expect(doc.validateSync()).toBeUndefined();
  });

  it('keeps explicitly supported older versions readable', () => {
    const doc = new Fixture({ schemaVersion: 1 });

    expect(doc.validateSync()).toBeUndefined();
  });

  it.each([0, -1, 1.5, 3])('rejects unsupported document version %s', (schemaVersion) => {
    const doc = new Fixture({ schemaVersion });

    expect(doc.validateSync()?.errors.schemaVersion).toBeTruthy();
  });

  it.each([
    { currentVersion: 0 },
    { currentVersion: 1.5 },
    { currentVersion: MAX_CANONICAL_SCHEMA_VERSION + 1 },
    { currentVersion: 2, supportedVersions: [1] },
    { currentVersion: 1, supportedVersions: [] },
  ])('rejects invalid version contract %#', (options) => {
    expect(() => defineCanonicalSchemaVersion(options)).toThrow();
  });

  it('builds a MongoDB int validator from the same supported versions', () => {
    expect(canonicalSchemaVersionBsonProperty(contract)).toEqual({
      bsonType: 'int',
      enum: [1, 2],
      description: 'Canonical schema version. New documents use version 2.',
    });
  });
});
