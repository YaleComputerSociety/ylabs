/**
 * Declares the desired canonical MongoDB validators. It does not apply them.
 *
 * As of #752, closed as declined, no environment carries any of these
 * validators: `model-refactor:validators-assert --environment development`
 * reports all six as `validator-absent`. The declaration is kept reviewed and
 * pre-flighted rather than enforced, because the measured non-conforming count
 * is zero everywhere, so applying `strict`/`error` would refuse nothing today
 * while turning a future malformed bulk write into a mid-sweep hard failure.
 *
 * So a green `canonicalMongoValidatorRegistry.test.ts` is not evidence that any
 * collection is validated. The fingerprint gate governs this file; only
 * `model-refactor:validators-assert` reads the database. Applying validators
 * later means updating `CANONICAL_MONGO_VALIDATOR_ENFORCEMENT` below, which the
 * registry test asserts explicitly.
 */
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
   * Per-collection strict-flip override for the declaration. Omitted means the
   * collection stays on the shared moderate/error default; only set this once an
   * audit for that specific collection comes back clean (see #727 and
   * docs/canonical-mongodb-validator-runbook.md). Never flip every
   * collection at once by changing the shared defaults instead. Setting it here
   * changes what would be applied, never what any database currently enforces.
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

export type CanonicalMongoValidatorEnforcementState = 'declared-not-applied' | 'applied';

/**
 * The recorded answer to "is this registry a declaration or an enforcement?".
 * Anyone who applies the validators has to change this value, which makes the
 * registry test fail until the decision is restated rather than letting a green
 * suite quietly change meaning. The strict-readiness report prints it beside
 * what the database actually carries, so the two can disagree out loud.
 */
export const CANONICAL_MONGO_VALIDATOR_ENFORCEMENT: {
  readonly state: CanonicalMongoValidatorEnforcementState;
} = Object.freeze({ state: 'declared-not-applied' });
