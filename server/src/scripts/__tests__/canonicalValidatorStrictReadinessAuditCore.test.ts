import { describe, expect, it } from 'vitest';
import {
  buildStrictReadinessReport,
  parseStrictReadinessArgs,
  type StrictReadinessCollectionFact,
} from '../canonicalValidatorStrictReadinessAuditCore';

const GENERATED_AT = '2026-01-01T00:00:00.000Z';

function fact(overrides: Partial<StrictReadinessCollectionFact>): StrictReadinessCollectionFact {
  return {
    collectionName: 'accounts',
    exists: true,
    documentCount: 10,
    nonConformingCount: 0,
    sampleNonConformingIds: [],
    ...overrides,
  };
}

describe('buildStrictReadinessReport', () => {
  it('marks a fully conforming collection as clean and strict-ready', () => {
    const report = buildStrictReadinessReport({
      environment: 'development',
      databaseName: 'Development',
      desiredValidators: [{ collectionName: 'accounts' }],
      enforcementDecision: 'declared-not-applied',
      currentValidators: [
        { collectionName: 'accounts', validatorApplied: true, validationLevel: 'moderate' },
      ],
      facts: [fact({ collectionName: 'accounts', nonConformingCount: 0 })],
      generatedAt: GENERATED_AT,
    });

    expect(report.summary.collectionsClean).toBe(1);
    expect(report.summary.readyToFlipCollectionNames).toEqual(['accounts']);
    expect(report.collections[0].clean).toBe(true);
    expect(report.collections[0].strictReady).toBe(true);
  });

  it('never flips a collection that still has non-conforming documents', () => {
    const report = buildStrictReadinessReport({
      environment: 'development',
      databaseName: 'Development',
      desiredValidators: [{ collectionName: 'taxonomy_terms' }],
      enforcementDecision: 'declared-not-applied',
      currentValidators: [
        { collectionName: 'taxonomy_terms', validatorApplied: true, validationLevel: 'moderate' },
      ],
      facts: [fact({ collectionName: 'taxonomy_terms', nonConformingCount: 15 })],
      generatedAt: GENERATED_AT,
    });

    expect(report.summary.collectionsClean).toBe(0);
    expect(report.summary.readyToFlipCollectionNames).toEqual([]);
    expect(report.summary.notCleanCollectionNames).toEqual(['taxonomy_terms']);
    expect(report.collections[0].strictReady).toBe(false);
  });

  it('treats an empty collection as vacuously clean and excludes already-strict collections from the flip list', () => {
    const report = buildStrictReadinessReport({
      environment: 'development',
      databaseName: 'Development',
      desiredValidators: [{ collectionName: 'source_documents' }, { collectionName: 'accounts' }],
      enforcementDecision: 'applied',
      currentValidators: [
        { collectionName: 'source_documents', validatorApplied: true, validationLevel: 'strict' },
        { collectionName: 'accounts', validatorApplied: true, validationLevel: 'moderate' },
      ],
      facts: [
        fact({ collectionName: 'source_documents', exists: true, documentCount: 0 }),
        fact({ collectionName: 'accounts', documentCount: 5, nonConformingCount: 0 }),
      ],
      generatedAt: GENERATED_AT,
    });

    expect(report.summary.collectionsClean).toBe(2);
    expect(report.summary.collectionsAlreadyStrict).toBe(1);
    expect(report.summary.readyToFlipCollectionNames).toEqual(['accounts']);
  });

  it('sorts collections deterministically and defaults a missing fact to non-existent', () => {
    const report = buildStrictReadinessReport({
      environment: 'development',
      databaseName: 'Development',
      desiredValidators: [{ collectionName: 'researchers' }, { collectionName: 'accounts' }],
      enforcementDecision: 'declared-not-applied',
      currentValidators: [],
      facts: [fact({ collectionName: 'researchers', nonConformingCount: 0 })],
      generatedAt: GENERATED_AT,
    });

    expect(report.collections.map((row) => row.collectionName)).toEqual([
      'accounts',
      'researchers',
    ]);
    expect(report.collections[0].exists).toBe(false);
    expect(report.collections[0].currentValidationLevel).toBe('not-applied');
    expect(report.collections[0].appliedState).toBe('collection-missing');
  });
});

describe('declaredVersusApplied', () => {
  function reportWithNoValidatorApplied(
    enforcementDecision: 'declared-not-applied' | 'applied',
  ): ReturnType<typeof buildStrictReadinessReport> {
    return buildStrictReadinessReport({
      environment: 'development',
      databaseName: 'Development',
      enforcementDecision,
      desiredValidators: [{ collectionName: 'accounts' }, { collectionName: 'taxonomy_terms' }],
      currentValidators: [
        { collectionName: 'accounts', validatorApplied: false },
        { collectionName: 'taxonomy_terms', validatorApplied: false },
      ],
      facts: [
        fact({ collectionName: 'accounts' }),
        fact({ collectionName: 'taxonomy_terms', documentCount: 5291 }),
      ],
      generatedAt: GENERATED_AT,
    });
  }

  it('says plainly that no declared validator is applied, instead of reporting an unknown level', () => {
    const report = reportWithNoValidatorApplied('declared-not-applied');

    expect(report.declaredVersusApplied).toMatchObject({
      enforcementDecision: 'declared-not-applied',
      declaredCollections: 2,
      validatorAppliedInDatabase: 0,
      declaredButNotApplied: 2,
      declaredButNotAppliedCollectionNames: ['accounts', 'taxonomy_terms'],
    });
    expect(report.declaredVersusApplied.statement).toContain(
      'None of the 2 declared canonical validators is applied on Development',
    );
    expect(report.declaredVersusApplied.statement).toContain('refuses nothing they forbid');
    expect(report.declaredVersusApplied.statement).toContain('recorded decision');
    expect(report.collections.map((row) => row.appliedState)).toEqual([
      'no-validator-applied',
      'no-validator-applied',
    ]);
    expect(report.collections.map((row) => row.currentValidationLevel)).toEqual([
      'not-applied',
      'not-applied',
    ]);
  });

  it('calls the same gap a regression when the recorded decision claims the validators are applied', () => {
    expect(reportWithNoValidatorApplied('applied').declaredVersusApplied.statement).toContain(
      'this gap is a regression',
    );
  });

  it('reports a partial apply by name and flags a decision that the database has outgrown', () => {
    const partial = buildStrictReadinessReport({
      environment: 'development',
      databaseName: 'Development',
      enforcementDecision: 'declared-not-applied',
      desiredValidators: [{ collectionName: 'accounts' }, { collectionName: 'taxonomy_terms' }],
      currentValidators: [
        { collectionName: 'accounts', validatorApplied: true, validationLevel: 'strict' },
        { collectionName: 'taxonomy_terms', validatorApplied: false },
      ],
      facts: [fact({ collectionName: 'accounts' }), fact({ collectionName: 'taxonomy_terms' })],
      generatedAt: GENERATED_AT,
    });
    expect(partial.declaredVersusApplied.statement).toContain(
      '1 of 2 declared canonical validators are applied on Development',
    );
    expect(partial.declaredVersusApplied.statement).toContain('taxonomy_terms');
    expect(partial.declaredVersusApplied.statement).toContain(
      'update CANONICAL_MONGO_VALIDATOR_ENFORCEMENT',
    );
    expect(partial.declaredVersusApplied.statement).not.toContain('not a regression');

    const fullyApplied = buildStrictReadinessReport({
      environment: 'development',
      databaseName: 'Development',
      enforcementDecision: 'declared-not-applied',
      desiredValidators: [{ collectionName: 'accounts' }],
      currentValidators: [
        { collectionName: 'accounts', validatorApplied: true, validationLevel: 'strict' },
      ],
      facts: [fact({ collectionName: 'accounts' })],
      generatedAt: GENERATED_AT,
    });
    expect(fullyApplied.declaredVersusApplied.statement).toContain(
      'update CANONICAL_MONGO_VALIDATOR_ENFORCEMENT',
    );
  });
});

describe('parseStrictReadinessArgs', () => {
  it('requires an environment', () => {
    expect(() => parseStrictReadinessArgs([])).toThrow('--environment is required');
  });

  it('parses environment, sample limit, and output', () => {
    const args = parseStrictReadinessArgs([
      '--environment',
      'development',
      '--sample-limit',
      '3',
      '--output',
      '/tmp/report.json',
    ]);
    expect(args).toEqual({
      environment: 'development',
      sampleLimit: 3,
      output: '/tmp/report.json',
    });
  });

  it('rejects an unknown environment and a negative sample limit', () => {
    expect(() => parseStrictReadinessArgs(['--environment', 'staging'])).toThrow('--environment');
    expect(() =>
      parseStrictReadinessArgs(['--environment', 'development', '--sample-limit', '-1']),
    ).toThrow('--sample-limit');
  });
});
