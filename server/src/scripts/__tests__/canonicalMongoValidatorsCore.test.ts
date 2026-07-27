import { describe, expect, it } from 'vitest';
import { defineCanonicalSchemaVersion } from '../../models/canonicalSchemaVersion';
import {
  buildCanonicalCollectionValidator,
  planCanonicalMongoValidators,
} from '../canonicalMongoValidatorsCore';

const version = defineCanonicalSchemaVersion({ currentVersion: 1 });

const peopleValidator = buildCanonicalCollectionValidator({
  collectionName: 'people',
  schemaVersion: version,
  requiredFields: ['displayName', 'archived', 'displayName'],
  properties: {
    displayName: { bsonType: 'string', maxLength: 240 },
    archived: { bsonType: 'bool' },
  },
});

const organizationsValidator = buildCanonicalCollectionValidator({
  collectionName: 'organizations',
  schemaVersion: version,
  requiredFields: ['name'],
  properties: {
    name: { bsonType: 'string', maxLength: 240 },
  },
});

describe('canonical MongoDB validators', () => {
  it('builds a migration-safe validator with shared schemaVersion ownership', () => {
    expect(peopleValidator).toEqual({
      collectionName: 'people',
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['schemaVersion', 'displayName', 'archived'],
          properties: {
            schemaVersion: {
              bsonType: 'int',
              enum: [1],
              description: 'Canonical schema version. New documents use version 1.',
            },
            displayName: { bsonType: 'string', maxLength: 240 },
            archived: { bsonType: 'bool' },
          },
        },
      },
      validationLevel: 'moderate',
      validationAction: 'error',
    });
  });

  it.each([
    { collectionName: 'People', schemaVersion: version },
    { collectionName: 'people.$cmd', schemaVersion: version },
    {
      collectionName: 'people',
      schemaVersion: version,
      requiredFields: ['profile.url'],
    },
    {
      collectionName: 'people',
      schemaVersion: version,
      properties: { schemaVersion: { bsonType: 'double' } },
    },
  ])('rejects unsafe or conflicting validator input %#', (spec) => {
    expect(() => buildCanonicalCollectionValidator(spec)).toThrow();
  });

  it('plans creation for a missing collection without mutating inputs', () => {
    const desiredSnapshot = structuredClone(peopleValidator);
    const plan = planCanonicalMongoValidators([peopleValidator], []);

    expect(plan).toEqual([
      {
        collectionName: 'people',
        action: 'createCollection',
        reasons: ['collection-missing'],
        command: {
          create: 'people',
          validator: peopleValidator.validator,
          validationLevel: 'moderate',
          validationAction: 'error',
        },
      },
    ]);
    expect(peopleValidator).toEqual(desiredSnapshot);
  });

  it('plans collMod with exact drift reasons for an existing collection', () => {
    const plan = planCanonicalMongoValidators(
      [peopleValidator],
      [
        {
          collectionName: 'people',
          exists: true,
          validator: { $jsonSchema: { bsonType: 'object' } },
          validationLevel: 'strict',
          validationAction: 'warn',
        },
      ],
    );

    expect(plan).toEqual([
      {
        collectionName: 'people',
        action: 'collMod',
        reasons: ['validator-drift', 'validation-level-drift', 'validation-action-drift'],
        command: {
          collMod: 'people',
          validator: peopleValidator.validator,
          validationLevel: 'moderate',
          validationAction: 'error',
        },
      },
    ]);
  });

  it('is idempotent when current validator object key order differs', () => {
    const currentValidator = {
      $jsonSchema: {
        properties: {
          archived: { bsonType: 'bool' },
          displayName: { maxLength: 240, bsonType: 'string' },
          schemaVersion: {
            description: 'Canonical schema version. New documents use version 1.',
            enum: [1],
            bsonType: 'int',
          },
        },
        required: ['schemaVersion', 'displayName', 'archived'],
        bsonType: 'object',
      },
    };

    expect(
      planCanonicalMongoValidators(
        [peopleValidator],
        [
          {
            collectionName: 'people',
            exists: true,
            validator: currentValidator,
            validationLevel: 'moderate',
            validationAction: 'error',
          },
        ],
      ),
    ).toEqual([
      {
        collectionName: 'people',
        action: 'noop',
        reasons: ['already-current'],
      },
    ]);
  });

  it('does not plan changes for collections outside the desired registry', () => {
    expect(
      planCanonicalMongoValidators(
        [],
        [
          {
            collectionName: 'legacy_rows',
            exists: true,
            validator: {},
          },
          {
            collectionName: 'system.views',
            exists: true,
            validator: {},
          },
        ],
      ),
    ).toEqual([]);
  });

  it('ignores unrelated MongoDB system collections while planning desired collections', () => {
    expect(
      planCanonicalMongoValidators(
        [peopleValidator],
        [
          {
            collectionName: 'system.views',
            exists: true,
            validator: {},
          },
        ],
      ).map(({ collectionName, action }) => ({ collectionName, action })),
    ).toEqual([{ collectionName: 'people', action: 'createCollection' }]);
  });

  it('sorts plan output independently of desired registry insertion order', () => {
    const expectedCollectionNames = ['organizations', 'people'];

    expect(
      planCanonicalMongoValidators([peopleValidator, organizationsValidator], []).map(
        ({ collectionName }) => collectionName,
      ),
    ).toEqual(expectedCollectionNames);
    expect(
      planCanonicalMongoValidators([organizationsValidator, peopleValidator], []).map(
        ({ collectionName }) => collectionName,
      ),
    ).toEqual(expectedCollectionNames);
  });

  it('rejects duplicate desired and current collection states', () => {
    expect(() => planCanonicalMongoValidators([peopleValidator, peopleValidator], [])).toThrow(
      'Duplicate desired canonical validator',
    );

    expect(() =>
      planCanonicalMongoValidators(
        [peopleValidator],
        [
          { collectionName: 'people', exists: true },
          { collectionName: 'people', exists: true },
        ],
      ),
    ).toThrow('Duplicate current collection validation state');
  });
});
