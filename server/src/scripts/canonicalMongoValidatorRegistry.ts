import type mongoose from 'mongoose';
import {
  Account,
  accountSchemaVersion,
  EvidenceClaim,
  EVIDENCE_CLAIM_SCHEMA_VERSION,
  MAX_EVIDENCE_CLAIM_EXCERPT_LENGTH,
  MAX_EVIDENCE_CLAIM_SUBJECT_KEY_LENGTH,
  MAX_EVIDENCE_CLAIMS_PER_ROLE,
  MAX_ORG_UNIT_ALIASES,
  MAX_RESEARCH_PLAN_CHECKLIST_ITEMS,
  MAX_RESEARCH_PLAN_DEADLINES,
  MAX_RESEARCH_PLAN_NOTES_LENGTH,
  RESEARCH_PLAN_SCHEMA_VERSION,
  MAX_REVIEW_DECISION_EVIDENCE_CLAIMS,
  MAX_REVIEW_DECISION_FIELD_PATHS,
  MAX_REVIEW_DECISION_INTERNAL_NOTES_LENGTH,
  MAX_REVIEW_DECISION_RATIONALE_LENGTH,
  MAX_SOURCE_DOCUMENT_EXTERNAL_KEY_LENGTH,
  MAX_SOURCE_DOCUMENT_KEY_LENGTH,
  MAX_SOURCE_DOCUMENT_POINTER_LENGTH,
  MAX_SOURCE_DOCUMENT_REDIRECTS,
  MAX_SOURCE_DOCUMENT_URL_LENGTH,
  MAX_TAXONOMY_ALIASES,
  OrgUnit,
  Person,
  ResearchPlan,
  REVIEW_DECISION_SCHEMA_VERSION,
  ReviewDecision,
  RoleAssignment,
  SOURCE_DOCUMENT_SCHEMA_VERSION,
  SourceDocument,
  TaxonomyTerm,
  orgUnitSchemaVersion,
  personProfileLinkKinds,
  personSchemaVersion,
  roleAssignmentSchemaVersion,
  taxonomyTermSchemaVersion,
} from '../models';
import type { CanonicalSchemaVersionContract } from '../models/canonicalSchemaVersion';
import {
  buildCanonicalCollectionValidator,
  type CanonicalCollectionValidator,
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

const evidenceSubjectProperty = generatedModelProperty(EvidenceClaim, 'subject');
const evidenceSubjectProperties =
  (evidenceSubjectProperty.properties as Record<string, MongoJsonSchemaProperty> | undefined) ?? {};

const canonicalModelValidatorContracts: readonly CanonicalModelValidatorContract[] = [
  {
    model: Account,
    schemaVersion: accountSchemaVersion,
  },
  {
    model: Person,
    schemaVersion: personSchemaVersion,
    propertyOverrides: {
      profileLinks: { maxItems: personProfileLinkKinds.length },
    },
  },
  {
    model: RoleAssignment,
    schemaVersion: roleAssignmentSchemaVersion,
    propertyOverrides: {
      evidenceClaimIds: {
        maxItems: MAX_EVIDENCE_CLAIMS_PER_ROLE,
        uniqueItems: true,
      },
    },
  },
  {
    model: OrgUnit,
    schemaVersion: orgUnitSchemaVersion,
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
    propertyOverrides: {
      privateNotes: { maxLength: MAX_RESEARCH_PLAN_NOTES_LENGTH },
      checklist: { maxItems: MAX_RESEARCH_PLAN_CHECKLIST_ITEMS },
      deadlines: { maxItems: MAX_RESEARCH_PLAN_DEADLINES },
    },
  },
  {
    model: SourceDocument,
    schemaVersion: SOURCE_DOCUMENT_SCHEMA_VERSION,
    propertyOverrides: {
      documentKey: { maxLength: MAX_SOURCE_DOCUMENT_KEY_LENGTH },
      canonicalUrl: { maxLength: MAX_SOURCE_DOCUMENT_URL_LENGTH },
      externalResourceKey: { maxLength: MAX_SOURCE_DOCUMENT_EXTERNAL_KEY_LENGTH },
      snapshotPointer: { maxLength: MAX_SOURCE_DOCUMENT_POINTER_LENGTH },
      redirectChain: { maxItems: MAX_SOURCE_DOCUMENT_REDIRECTS },
    },
  },
  {
    model: EvidenceClaim,
    schemaVersion: EVIDENCE_CLAIM_SCHEMA_VERSION,
    propertyOverrides: {
      subject: {
        ...evidenceSubjectProperty,
        properties: {
          ...evidenceSubjectProperties,
          key: {
            bsonType: ['string', 'null'],
            maxLength: MAX_EVIDENCE_CLAIM_SUBJECT_KEY_LENGTH,
          },
        },
      },
      excerpt: { maxLength: MAX_EVIDENCE_CLAIM_EXCERPT_LENGTH },
    },
  },
  {
    model: ReviewDecision,
    schemaVersion: REVIEW_DECISION_SCHEMA_VERSION,
    propertyOverrides: {
      fieldPaths: {
        maxItems: MAX_REVIEW_DECISION_FIELD_PATHS,
        uniqueItems: true,
      },
      rationale: { maxLength: MAX_REVIEW_DECISION_RATIONALE_LENGTH },
      internalNotes: { maxLength: MAX_REVIEW_DECISION_INTERNAL_NOTES_LENGTH },
      evidenceClaimIds: {
        maxItems: MAX_REVIEW_DECISION_EVIDENCE_CLAIMS,
        uniqueItems: true,
      },
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
