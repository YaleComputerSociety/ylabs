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
      currentValidators: [{ collectionName: 'accounts', validationLevel: 'moderate' }],
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
      currentValidators: [{ collectionName: 'taxonomy_terms', validationLevel: 'moderate' }],
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
      currentValidators: [
        { collectionName: 'source_documents', validationLevel: 'strict' },
        { collectionName: 'accounts', validationLevel: 'moderate' },
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
      currentValidators: [],
      facts: [fact({ collectionName: 'researchers', nonConformingCount: 0 })],
      generatedAt: GENERATED_AT,
    });

    expect(report.collections.map((row) => row.collectionName)).toEqual(['accounts', 'researchers']);
    expect(report.collections[0].exists).toBe(false);
    expect(report.collections[0].currentValidationLevel).toBe('unknown');
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
    expect(args).toEqual({ environment: 'development', sampleLimit: 3, output: '/tmp/report.json' });
  });

  it('rejects an unknown environment and a negative sample limit', () => {
    expect(() => parseStrictReadinessArgs(['--environment', 'staging'])).toThrow('--environment');
    expect(() =>
      parseStrictReadinessArgs(['--environment', 'development', '--sample-limit', '-1']),
    ).toThrow('--sample-limit');
  });
});
