import type mongoose from 'mongoose';
import {
  Account,
  accountSchemaVersion,
  MAX_ORG_UNIT_ALIASES,
  MAX_RESEARCH_PLAN_CHECKLIST_ITEMS,
  MAX_RESEARCH_PLAN_DEADLINES,
  MAX_RESEARCH_PLAN_NOTES_LENGTH,
  RESEARCH_PLAN_SCHEMA_VERSION,
  MAX_TAXONOMY_ALIASES,
  OrgUnit,
  Researcher,
  ResearchPlan,
  RoleAssignment,
  TaxonomyTerm,
  orgUnitSchemaVersion,
  researcherProfileLinkKinds,
  researcherSchemaVersion,
  roleAssignmentSchemaVersion,
  taxonomyTermSchemaVersion,
} from '../models';
import type { CanonicalSchemaVersionContract } from '../models/canonicalSchemaVersion';
import {
  buildCanonicalCollectionValidator,
  type CanonicalCollectionValidator,
  type CanonicalValidationAction,
  type CanonicalValidationLevel,
  type MongoJsonSchemaProperty,
} from './canonicalMongoValidatorsCore';

interface GeneratedMongoJsonSchema {
  required?: string[];
  properties?: Record<string, MongoJsonSchemaProperty>;
}

interface CanonicalModelValidatorContract {
  model: mongoose.Model<any>;
  schemaVersion: CanonicalSchemaVersionContract;
  propertyOverrides?: Readonly<Record<string, MongoJsonSchemaProperty>>;
  /**
   * Per-collection strict-flip override. Omitted means the collection stays
   * on the shared moderate/error default; only set this once an audit for
   * that specific collection comes back clean (see #727 and
   * docs/canonical-mongodb-validator-runbook.md). Never flip every
   * collection at once by changing the shared defaults instead.
   */
  validationLevel?: CanonicalValidationLevel;
  validationAction?: CanonicalValidationAction;
}

function numericOption(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value) && typeof value[0] === 'number' && Number.isFinite(value[0])) {
    return value[0];
  }
  return undefined;
}

function topLevelMongooseConstraints(
  model: mongoose.Model<any>,
  field: string,
): MongoJsonSchemaProperty {
  const schemaType = model.schema.path(field);
  if (!schemaType) return {};

  const options = schemaType.options as Record<string, unknown>;
  const minimum = numericOption(options.min);
  const maximum = numericOption(options.max);
  const minLength = numericOption(options.minlength);
  const maxLength = numericOption(options.maxlength);
  const match = Array.isArray(options.match) ? options.match[0] : options.match;
  const pattern = match instanceof RegExp && match.flags === '' ? match.source : undefined;

  return {
    ...(minimum !== undefined ? { minimum } : {}),
    ...(maximum !== undefined ? { maximum } : {}),
    ...(minLength !== undefined ? { minLength } : {}),
    ...(maxLength !== undefined ? { maxLength } : {}),
    ...(pattern ? { pattern } : {}),
  };
}

function buildCanonicalModelValidator(
  contract: CanonicalModelValidatorContract,
): CanonicalCollectionValidator {
  const generated = contract.model.schema.toJSONSchema({
    useBsonType: true,
  }) as GeneratedMongoJsonSchema;
  const generatedProperties = structuredClone(generated.properties ?? {});
  delete generatedProperties.schemaVersion;

  const properties = Object.fromEntries(
    Object.entries(generatedProperties).map(([field, property]) => [
      field,
      {
        ...property,
        ...topLevelMongooseConstraints(contract.model, field),
        ...(contract.propertyOverrides?.[field] ?? {}),
      },
    ]),
  );

  return buildCanonicalCollectionValidator({
    collectionName: contract.model.collection.name,
    schemaVersion: contract.schemaVersion,
    requiredFields: (generated.required ?? []).filter((field) => field !== 'schemaVersion'),
    properties,
    ...(contract.validationLevel ? { validationLevel: contract.validationLevel } : {}),
    ...(contract.validationAction ? { validationAction: contract.validationAction } : {}),
  });
}

function generatedModelProperty(
  model: mongoose.Model<any>,
  field: string,
): MongoJsonSchemaProperty {
  const generated = model.schema.toJSONSchema({
    useBsonType: true,
  }) as GeneratedMongoJsonSchema;
  return structuredClone(generated.properties?.[field] ?? {});
}

const canonicalModelValidatorContracts: readonly CanonicalModelValidatorContract[] = [
  {
    model: Account,
    schemaVersion: accountSchemaVersion,
    validationLevel: 'strict',
  },
  {
    model: Researcher,
    schemaVersion: researcherSchemaVersion,
    validationLevel: 'strict',
    propertyOverrides: {
      profileLinks: { maxItems: researcherProfileLinkKinds.length },
    },
  },
  {
    model: RoleAssignment,
    schemaVersion: roleAssignmentSchemaVersion,
    validationLevel: 'strict',
  },
  {
    model: OrgUnit,
    schemaVersion: orgUnitSchemaVersion,
    validationLevel: 'strict',
    propertyOverrides: {
      aliases: {
        maxItems: MAX_ORG_UNIT_ALIASES,
        uniqueItems: true,
      },
    },
  },
  {
    model: TaxonomyTerm,
    schemaVersion: taxonomyTermSchemaVersion,
    validationLevel: 'strict',
    propertyOverrides: {
      aliases: {
        maxItems: MAX_TAXONOMY_ALIASES,
        uniqueItems: true,
      },
    },
  },
  {
    model: ResearchPlan,
    schemaVersion: RESEARCH_PLAN_SCHEMA_VERSION,
    validationLevel: 'strict',
    propertyOverrides: {
      privateNotes: { maxLength: MAX_RESEARCH_PLAN_NOTES_LENGTH },
      checklist: { maxItems: MAX_RESEARCH_PLAN_CHECKLIST_ITEMS },
      deadlines: { maxItems: MAX_RESEARCH_PLAN_DEADLINES },
    },
  },
];

export const CANONICAL_MONGO_VALIDATORS: readonly CanonicalCollectionValidator[] = Object.freeze(
  canonicalModelValidatorContracts
    .map(buildCanonicalModelValidator)
    .sort((left, right) => left.collectionName.localeCompare(right.collectionName)),
);

export const CANONICAL_MONGO_VALIDATOR_COLLECTIONS: readonly string[] = Object.freeze(
  CANONICAL_MONGO_VALIDATORS.map(({ collectionName }) => collectionName),
);
