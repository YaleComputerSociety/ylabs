import { createHash } from 'crypto';
import {
  canonicalSchemaVersionBsonProperty,
  defineCanonicalSchemaVersion,
  type CanonicalSchemaVersionContract,
} from '../models/canonicalSchemaVersion';

export const CANONICAL_VALIDATION_LEVEL = 'moderate' as const;
export const CANONICAL_VALIDATION_ACTION = 'error' as const;

export type MongoJsonSchemaProperty = Record<string, unknown>;

export interface CanonicalCollectionValidatorSpec {
  collectionName: string;
  schemaVersion: CanonicalSchemaVersionContract;
  requiredFields?: readonly string[];
  properties?: Readonly<Record<string, MongoJsonSchemaProperty>>;
}

export interface CanonicalCollectionValidator {
  collectionName: string;
  validator: {
    $jsonSchema: {
      bsonType: 'object';
      required: string[];
      properties: Record<string, MongoJsonSchemaProperty>;
    };
  };
  validationLevel: typeof CANONICAL_VALIDATION_LEVEL;
  validationAction: typeof CANONICAL_VALIDATION_ACTION;
}

export interface CurrentMongoCollectionValidation {
  collectionName: string;
  exists: boolean;
  validator?: unknown;
  validationLevel?: unknown;
  validationAction?: unknown;
}

export type CanonicalMongoValidatorPlanAction = 'createCollection' | 'collMod' | 'noop';

export type CanonicalMongoValidatorPlanReason =
  | 'collection-missing'
  | 'validator-drift'
  | 'validation-level-drift'
  | 'validation-action-drift'
  | 'already-current';

export interface CanonicalMongoValidatorPlanItem {
  collectionName: string;
  action: CanonicalMongoValidatorPlanAction;
  reasons: CanonicalMongoValidatorPlanReason[];
  command?: Record<string, unknown>;
}

export interface CanonicalMongoValidatorRollbackItem {
  collectionName: string;
  reason: 'restore-previous-validation' | 'disable-created-collection-validator';
  command: Record<string, unknown>;
}

const MONGO_COLLECTION_NAME_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const MONGO_FIELD_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertCollectionName(value: string): void {
  if (!MONGO_COLLECTION_NAME_PATTERN.test(value)) {
    throw new Error(
      `collectionName must use lowercase snake_case without MongoDB special characters: ${value}`,
    );
  }
}

function assertFieldName(value: string): void {
  if (!MONGO_FIELD_NAME_PATTERN.test(value) || value.startsWith('$')) {
    throw new Error(`Validator field names must be simple MongoDB-safe top-level fields: ${value}`);
  }
}

function uniqueRequiredFields(values: readonly string[]): string[] {
  const fields: string[] = [];
  for (const value of values) {
    assertFieldName(value);
    if (!fields.includes(value)) fields.push(value);
  }
  return fields;
}

export function buildCanonicalCollectionValidator(
  spec: CanonicalCollectionValidatorSpec,
): CanonicalCollectionValidator {
  assertCollectionName(spec.collectionName);
  const schemaVersion = defineCanonicalSchemaVersion(spec.schemaVersion);

  if (spec.properties && Object.hasOwn(spec.properties, 'schemaVersion')) {
    throw new Error('schemaVersion is owned by the shared canonical validator contract.');
  }
  for (const field of Object.keys(spec.properties ?? {})) {
    assertFieldName(field);
  }

  const required = uniqueRequiredFields(['schemaVersion', ...(spec.requiredFields ?? [])]);
  const properties = Object.fromEntries(
    Object.entries(spec.properties ?? {}).map(([field, property]) => [
      field,
      structuredClone(property),
    ]),
  );

  return {
    collectionName: spec.collectionName,
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required,
        properties: {
          schemaVersion: canonicalSchemaVersionBsonProperty(schemaVersion),
          ...properties,
        },
      },
    },
    validationLevel: CANONICAL_VALIDATION_LEVEL,
    validationAction: CANONICAL_VALIDATION_ACTION,
  };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]),
  );
}

export function canonicalMongoValidatorValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

export function canonicalMongoValidatorFingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

function indexCurrentCollections(
  currentCollections: readonly CurrentMongoCollectionValidation[],
  desiredNames: ReadonlySet<string>,
): Map<string, CurrentMongoCollectionValidation> {
  const byName = new Map<string, CurrentMongoCollectionValidation>();
  for (const current of currentCollections) {
    if (!desiredNames.has(current.collectionName)) continue;

    assertCollectionName(current.collectionName);
    if (byName.has(current.collectionName)) {
      throw new Error(`Duplicate current collection validation state: ${current.collectionName}`);
    }
    byName.set(current.collectionName, current);
  }
  return byName;
}

export function planCanonicalMongoValidators(
  desiredValidators: readonly CanonicalCollectionValidator[],
  currentCollections: readonly CurrentMongoCollectionValidation[],
): CanonicalMongoValidatorPlanItem[] {
  const desiredNames = new Set<string>();
  for (const desired of desiredValidators) {
    assertCollectionName(desired.collectionName);
    if (desiredNames.has(desired.collectionName)) {
      throw new Error(`Duplicate desired canonical validator: ${desired.collectionName}`);
    }
    desiredNames.add(desired.collectionName);
  }

  const currentByName = indexCurrentCollections(currentCollections, desiredNames);
  const sortedDesiredValidators = [...desiredValidators].sort((left, right) =>
    left.collectionName.localeCompare(right.collectionName),
  );

  return sortedDesiredValidators.map((desired) => {
    const current = currentByName.get(desired.collectionName);
    if (!current?.exists) {
      return {
        collectionName: desired.collectionName,
        action: 'createCollection',
        reasons: ['collection-missing'],
        command: {
          create: desired.collectionName,
          validator: structuredClone(desired.validator),
          validationLevel: desired.validationLevel,
          validationAction: desired.validationAction,
        },
      };
    }

    const reasons: CanonicalMongoValidatorPlanReason[] = [];
    if (!canonicalMongoValidatorValuesEqual(current.validator, desired.validator)) {
      reasons.push('validator-drift');
    }
    if (current.validationLevel !== desired.validationLevel) {
      reasons.push('validation-level-drift');
    }
    if (current.validationAction !== desired.validationAction) {
      reasons.push('validation-action-drift');
    }

    if (reasons.length === 0) {
      return {
        collectionName: desired.collectionName,
        action: 'noop',
        reasons: ['already-current'],
      };
    }

    return {
      collectionName: desired.collectionName,
      action: 'collMod',
      reasons,
      command: {
        collMod: desired.collectionName,
        validator: structuredClone(desired.validator),
        validationLevel: desired.validationLevel,
        validationAction: desired.validationAction,
      },
    };
  });
}

function previousValidationLevel(current: CurrentMongoCollectionValidation): string {
  if (
    current.validationLevel === 'strict' ||
    current.validationLevel === 'moderate' ||
    current.validationLevel === 'off'
  ) {
    return current.validationLevel;
  }
  return 'strict';
}

function previousValidationAction(current: CurrentMongoCollectionValidation): string {
  return current.validationAction === 'warn' || current.validationAction === 'error'
    ? current.validationAction
    : 'error';
}

export function buildCanonicalMongoValidatorRollbackPlan(
  plan: readonly CanonicalMongoValidatorPlanItem[],
  currentCollections: readonly CurrentMongoCollectionValidation[],
): CanonicalMongoValidatorRollbackItem[] {
  const currentByName = new Map(
    currentCollections.map((current) => [current.collectionName, current] as const),
  );

  return plan.flatMap((item): CanonicalMongoValidatorRollbackItem[] => {
    if (item.action === 'noop') return [];

    const current = currentByName.get(item.collectionName);
    if (item.action === 'createCollection') {
      return [
        {
          collectionName: item.collectionName,
          reason: 'disable-created-collection-validator',
          command: {
            collMod: item.collectionName,
            validator: {},
            validationLevel: 'off',
            validationAction: 'error',
          },
        },
      ];
    }

    if (!current?.exists) {
      throw new Error(
        `Missing current validation state for collMod rollback: ${item.collectionName}`,
      );
    }

    return [
      {
        collectionName: item.collectionName,
        reason: 'restore-previous-validation',
        command: {
          collMod: item.collectionName,
          validator: structuredClone(current.validator ?? {}),
          validationLevel: previousValidationLevel(current),
          validationAction: previousValidationAction(current),
        },
      },
    ];
  });
}
