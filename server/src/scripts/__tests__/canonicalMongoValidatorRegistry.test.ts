import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_CLAIM_SCHEMA_VERSION,
  RESEARCH_PLAN_SCHEMA_VERSION,
  REVIEW_DECISION_SCHEMA_VERSION,
  SOURCE_DOCUMENT_SCHEMA_VERSION,
  accountSchemaVersion,
  orgUnitSchemaVersion,
  researcherSchemaVersion,
  roleAssignmentSchemaVersion,
  taxonomyTermSchemaVersion,
} from '../../models';
import {
  CANONICAL_MONGO_VALIDATORS,
  CANONICAL_MONGO_VALIDATOR_COLLECTIONS,
} from '../canonicalMongoValidatorRegistry';
import { canonicalMongoValidatorFingerprint } from '../canonicalMongoValidatorsCore';

const EXPECTED_COLLECTIONS = [
  'accounts',
  'evidence_claims',
  'org_units',
  'research_plans',
  'researchers',
  'review_decisions',
  'role_assignments',
  'source_documents',
  'taxonomy_terms',
];

const STRICT_READINESS_CLEAN_COLLECTIONS = new Set([
  'accounts',
  'evidence_claims',
  'org_units',
  'research_plans',
  'researchers',
  'review_decisions',
  'role_assignments',
  'source_documents',
  'taxonomy_terms',
]);

const VERSION_BY_COLLECTION = new Map([
  ['accounts', accountSchemaVersion],
  ['evidence_claims', EVIDENCE_CLAIM_SCHEMA_VERSION],
  ['org_units', orgUnitSchemaVersion],
  ['researchers', researcherSchemaVersion],
  ['research_plans', RESEARCH_PLAN_SCHEMA_VERSION],
  ['review_decisions', REVIEW_DECISION_SCHEMA_VERSION],
  ['role_assignments', roleAssignmentSchemaVersion],
  ['source_documents', SOURCE_DOCUMENT_SCHEMA_VERSION],
  ['taxonomy_terms', taxonomyTermSchemaVersion],
]);

describe('canonical MongoDB validator registry', () => {
  it('contains exactly the nine versioned Phase 1 collections in deterministic order', () => {
    expect(CANONICAL_MONGO_VALIDATOR_COLLECTIONS).toEqual(EXPECTED_COLLECTIONS);
    expect(CANONICAL_MONGO_VALIDATORS).toHaveLength(EXPECTED_COLLECTIONS.length);
  });

  it('links every desired validator to its model-owned schema-version contract', () => {
    for (const desired of CANONICAL_MONGO_VALIDATORS) {
      const contract = VERSION_BY_COLLECTION.get(desired.collectionName);
      expect(contract).toBeDefined();
      expect(desired.validator.$jsonSchema.required).toContain('schemaVersion');
      expect(desired.validator.$jsonSchema.properties.schemaVersion).toEqual({
        bsonType: 'int',
        enum: contract?.supportedVersions,
        description: `Canonical schema version. New documents use version ${contract?.currentVersion}.`,
      });
      expect(desired.validationLevel).toBe(
        STRICT_READINESS_CLEAN_COLLECTIONS.has(desired.collectionName) ? 'strict' : 'moderate',
      );
      expect(desired.validationAction).toBe('error');
    }
  });

  it('flips every audit-clean collection to strict once no drifted collections remain', () => {
    const levelByCollection = new Map(
      CANONICAL_MONGO_VALIDATORS.map((desired) => [
        desired.collectionName,
        desired.validationLevel,
      ]),
    );
    expect(
      [...levelByCollection.entries()]
        .filter(([, level]) => level === 'strict')
        .map(([name]) => name),
    ).toEqual([
      'accounts',
      'evidence_claims',
      'org_units',
      'research_plans',
      'researchers',
      'review_decisions',
      'role_assignments',
      'source_documents',
      'taxonomy_terms',
    ]);
    expect(
      [...levelByCollection.entries()]
        .filter(([, level]) => level === 'moderate')
        .map(([name]) => name),
    ).toEqual([]);
  });

  it('retains Mongoose structural contracts and important bounded-array safeguards', () => {
    const byCollection = new Map(
      CANONICAL_MONGO_VALIDATORS.map((desired) => [desired.collectionName, desired]),
    );

    expect(
      byCollection.get('researchers')?.validator.$jsonSchema.properties.profileLinks,
    ).toMatchObject({
      bsonType: ['array', 'null'],
      maxItems: 5,
    });
    expect(
      byCollection.get('role_assignments')?.validator.$jsonSchema.properties.evidenceClaimIds,
    ).toMatchObject({
      bsonType: ['array', 'null'],
      maxItems: 100,
      uniqueItems: true,
    });
    expect(
      byCollection.get('source_documents')?.validator.$jsonSchema.properties.redirectChain,
    ).toMatchObject({
      bsonType: ['array', 'null'],
      maxItems: 10,
    });
    expect(
      byCollection.get('review_decisions')?.validator.$jsonSchema.properties.evidenceClaimIds,
    ).toMatchObject({
      bsonType: ['array', 'null'],
      maxItems: 50,
      uniqueItems: true,
    });
  });

  it('does not close schemas to migration-era fields or invent unrelated validators', () => {
    expect(JSON.stringify(CANONICAL_MONGO_VALIDATORS)).not.toContain('additionalProperties');
    expect(CANONICAL_MONGO_VALIDATOR_COLLECTIONS).not.toContain('sources');
    expect(CANONICAL_MONGO_VALIDATOR_COLLECTIONS).not.toContain('student_engagement_events');
    expect(CANONICAL_MONGO_VALIDATOR_COLLECTIONS).not.toContain('research_entity_relationships');
    expect(CANONICAL_MONGO_VALIDATOR_COLLECTIONS).not.toContain('organizations');
  });

  it('requires an explicit review when generated validator contracts drift', () => {
    expect(canonicalMongoValidatorFingerprint(CANONICAL_MONGO_VALIDATORS)).toBe(
      '9eacdafaed4ee3d6da1c7f91551c47a7a86f0f4fb10565e035faecf225d3553d',
    );
  });
});
