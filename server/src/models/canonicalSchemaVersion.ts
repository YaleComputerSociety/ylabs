import type { SchemaDefinitionProperty } from 'mongoose';

export const MAX_CANONICAL_SCHEMA_VERSION = 2_147_483_647;

export interface CanonicalSchemaVersionContract {
  currentVersion: number;
  supportedVersions: readonly number[];
}

export interface DefineCanonicalSchemaVersionOptions {
  currentVersion: number;
  supportedVersions?: readonly number[];
}

function assertPositiveInt32(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CANONICAL_SCHEMA_VERSION) {
    throw new Error(
      `${label} must be a positive 32-bit integer no greater than ${MAX_CANONICAL_SCHEMA_VERSION}.`,
    );
  }
}

/**
 * Defines the versions one canonical collection can read and the version
 * assigned to new documents.
 *
 * Versions are collection-specific so one model can evolve without forcing
 * unrelated collections to migrate in lockstep.
 */
export function defineCanonicalSchemaVersion(
  options: DefineCanonicalSchemaVersionOptions,
): CanonicalSchemaVersionContract {
  assertPositiveInt32(options.currentVersion, 'currentVersion');

  const supportedVersions = Array.from(
    new Set(options.supportedVersions ?? [options.currentVersion]),
  ).sort((left, right) => left - right);

  if (supportedVersions.length === 0) {
    throw new Error('supportedVersions must contain at least one version.');
  }
  for (const version of supportedVersions) {
    assertPositiveInt32(version, 'supportedVersions entry');
  }
  if (!supportedVersions.includes(options.currentVersion)) {
    throw new Error('supportedVersions must include currentVersion.');
  }

  return Object.freeze({
    currentVersion: options.currentVersion,
    supportedVersions: Object.freeze(supportedVersions),
  });
}

/**
 * Builds the shared Mongoose field definition for a versioned canonical
 * document.
 */
export function canonicalSchemaVersionField(
  contract: CanonicalSchemaVersionContract,
): SchemaDefinitionProperty<number> {
  const normalized = defineCanonicalSchemaVersion(contract);
  return {
    type: Number,
    required: true,
    default: normalized.currentVersion,
    enum: [...normalized.supportedVersions],
    validate: {
      validator: (value: unknown) =>
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        normalized.supportedVersions.includes(value),
      message: 'schemaVersion must be a supported positive integer.',
    },
  };
}

export interface CanonicalSchemaVersionBsonProperty extends Record<string, unknown> {
  bsonType: 'int';
  enum: number[];
  description: string;
}

/**
 * Builds the MongoDB JSON Schema fragment corresponding to the Mongoose field.
 */
export function canonicalSchemaVersionBsonProperty(
  contract: CanonicalSchemaVersionContract,
): CanonicalSchemaVersionBsonProperty {
  const normalized = defineCanonicalSchemaVersion(contract);
  return {
    bsonType: 'int',
    enum: [...normalized.supportedVersions],
    description: `Canonical schema version. New documents use version ${normalized.currentVersion}.`,
  };
}
