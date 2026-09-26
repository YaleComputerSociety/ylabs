import { describe, expect, it } from 'vitest';
import {
  RESEARCH_PLAN_SCHEMA_VERSION,
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
  'org_units',
  'research_plans',
  'researchers',
  'role_assignments',
  'taxonomy_terms',
];

const STRICT_READINESS_CLEAN_COLLECTIONS = new Set([
  'accounts',
  'org_units',
  'research_plans',
  'researchers',
  'role_assignments',
  'taxonomy_terms',
]);

const VERSION_BY_COLLECTION = new Map([
  ['accounts', accountSchemaVersion],
  ['org_units', orgUnitSchemaVersion],
  ['researchers', researcherSchemaVersion],
  ['research_plans', RESEARCH_PLAN_SCHEMA_VERSION],
  ['role_assignments', roleAssignmentSchemaVersion],
  ['taxonomy_terms', taxonomyTermSchemaVersion],
]);

describe('canonical MongoDB validator registry', () => {
  it('contains exactly the six versioned Phase 1 collections in deterministic order', () => {
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
      'org_units',
      'research_plans',
      'researchers',
      'role_assignments',
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
      byCollection.get('taxonomy_terms')?.validator.$jsonSchema.properties.aliases,
    ).toMatchObject({
      bsonType: ['array', 'null'],
    });
  });

  it('carries no validator for a retired evidence claim-graph collection', () => {
    for (const retired of ['evidence_claims', 'review_decisions', 'source_documents']) {
      expect(CANONICAL_MONGO_VALIDATOR_COLLECTIONS).not.toContain(retired);
    }
    expect(JSON.stringify(CANONICAL_MONGO_VALIDATORS)).not.toContain('evidenceClaimIds');
  });

  it('does not close schemas to migration-era fields or invent unrelated validators', () => {
    expect(JSON.stringify(CANONICAL_MONGO_VALIDATORS)).not.toContain('additionalProperties');
    expect(CANONICAL_MONGO_VALIDATOR_COLLECTIONS).not.toContain('sources');
    expect(CANONICAL_MONGO_VALIDATOR_COLLECTIONS).not.toContain('student_engagement_events');
    expect(CANONICAL_MONGO_VALIDATOR_COLLECTIONS).not.toContain('research_entity_relationships');
    expect(CANONICAL_MONGO_VALIDATOR_COLLECTIONS).not.toContain('organizations');
  });

  it('requires an explicit review when generated validator contracts drift', () => {
    // Reviewed for #3377. The only drift is taxonomy_terms gaining the three review
    // provenance properties the reviewer writes: reviewedBy and reviewNote as bounded
    // strings and reviewedAt as a date. `taxonomy:review-term` requires a reviewer and
    // a note for every verdict, and until it existed nothing could move a term out of
    // UNREVIEWED at all, so an approval carried neither. They are optional in the
    // schema on purpose: 4,619 Development terms predate the writer and carry none, and
    // a required field would make every one of them unwritable. No other collection or
    // property changed.
    //
    // Reviewed for #2880 before that: role_assignments gained
    // reviewNotes: { bsonType: ['string','null'], maxLength: 500 }, because two
    // retirement lanes already wrote that field and mongoose dropped it silently.
    expect(canonicalMongoValidatorFingerprint(CANONICAL_MONGO_VALIDATORS)).toBe(
      '5488024dbacee95702ad480207e964a94fbc045acd3586e6169b5e9b573eff5d',
    );
  });
});
