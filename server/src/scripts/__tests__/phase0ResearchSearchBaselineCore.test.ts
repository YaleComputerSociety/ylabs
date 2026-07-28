import { describe, expect, it } from 'vitest';
import {
  PHASE0_RESEARCH_SEARCH_CASES,
  assertPhase0ResearchSearchMeiliTarget,
  buildPhase0ResearchSearchBaselineReport,
  parsePhase0ResearchSearchBaselineArgs,
  phase0ResearchSearchResultFingerprint,
  phase0ResearchSearchSettingsFingerprint,
  requirePhase0ResearchSearchSalt,
  summarizePhase0ResearchSearchCase,
} from '../phase0ResearchSearchBaselineCore';

describe('Phase 0 ResearchEntity search baseline core', () => {
  it('parses a bounded explicit evidence target', () => {
    expect(
      parsePhase0ResearchSearchBaselineArgs([
        '--environment=beta',
        '--iterations=5',
        '--top-k=12',
        '--strict',
        '--output=/tmp/ylabs-phase0-search-beta.json',
      ]),
    ).toEqual({
      environment: 'beta',
      iterations: 5,
      topK: 12,
      strict: true,
      output: '/tmp/ylabs-phase0-search-beta.json',
    });

    expect(() =>
      parsePhase0ResearchSearchBaselineArgs([
        '--environment=production',
        '--output=/tmp/forbidden.json',
      ]),
    ).toThrow(/development, beta, or production-copy/);
    expect(() =>
      parsePhase0ResearchSearchBaselineArgs(['--output=/tmp/missing-environment.json']),
    ).toThrow(/requires --environment/);
    expect(() => parsePhase0ResearchSearchBaselineArgs(['--environment=beta'])).toThrow(
      /requires --output/,
    );
    expect(() =>
      parsePhase0ResearchSearchBaselineArgs([
        '--environment=beta',
        '--iterations=11',
        '--output=/tmp/too-many.json',
      ]),
    ).toThrow(/--iterations must be at most 10/);
    expect(() =>
      parsePhase0ResearchSearchBaselineArgs([
        '--environment=beta',
        '--top-k=25',
        '--output=/tmp/too-many-results.json',
      ]),
    ).toThrow(/--top-k must be at most 24/);
    expect(() =>
      parsePhase0ResearchSearchBaselineArgs([
        '--environment=beta',
        '--output=/var/tmp/not-approved.json',
      ]),
    ).toThrow(/--output must write under/);
  });

  it('fails closed on production and mismatched Meilisearch targets', () => {
    expect(
      assertPhase0ResearchSearchMeiliTarget({
        environment: 'development',
        host: 'http://localhost:7700',
      }),
    ).toEqual({
      targetKind: 'local',
      indexName: 'researchentities',
    });
    expect(
      assertPhase0ResearchSearchMeiliTarget({
        environment: 'beta',
        host: 'https://search-beta.example.test',
        indexPrefix: 'beta',
      }),
    ).toEqual({
      targetKind: 'remote',
      indexName: 'beta_researchentities',
    });
    expect(
      assertPhase0ResearchSearchMeiliTarget({
        environment: 'production-copy',
        host: 'https://search-copy.example.test',
        indexPrefix: 'production-copy-july',
      }),
    ).toEqual({
      targetKind: 'remote',
      indexName: 'production-copy-july_researchentities',
    });

    expect(() =>
      assertPhase0ResearchSearchMeiliTarget({
        environment: 'beta',
        host: 'https://search-beta.example.test',
        indexPrefix: 'prod',
      }),
    ).toThrow(/Primary Production/);
    expect(() =>
      assertPhase0ResearchSearchMeiliTarget({
        environment: 'beta',
        host: 'https://search-beta.example.test',
        indexPrefix: 'development',
      }),
    ).toThrow(/requires MEILISEARCH_INDEX_PREFIX=beta/);
    expect(() =>
      assertPhase0ResearchSearchMeiliTarget({
        environment: 'development',
        host: 'https://search.example.test',
      }),
    ).toThrow(/requires a local Meilisearch host/);
    expect(() =>
      assertPhase0ResearchSearchMeiliTarget({
        environment: 'development',
        host: 'https://search.example.test',
        indexPrefix: 'development',
      }),
    ).toThrow(/requires a local Meilisearch host/);
    expect(() =>
      assertPhase0ResearchSearchMeiliTarget({
        environment: 'beta',
        host: 'http://localhost:7700',
        indexPrefix: 'beta',
      }),
    ).toThrow(/requires a remote Meilisearch host/);
    expect(() =>
      assertPhase0ResearchSearchMeiliTarget({
        environment: 'production-copy',
        host: 'http://localhost:7700',
        indexPrefix: 'production-copy-july',
      }),
    ).toThrow(/requires a remote Meilisearch host/);
    expect(() =>
      assertPhase0ResearchSearchMeiliTarget({
        environment: 'production-copy',
        host: 'https://search-copy.example.test',
        indexPrefix: 'beta',
      }),
    ).toThrow(/dedicated production-copy/);
    expect(() =>
      assertPhase0ResearchSearchMeiliTarget({
        environment: 'beta',
        host: 'ftp://search-beta.example.test',
        indexPrefix: 'beta',
      }),
    ).toThrow(/http or https/);
  });

  it('requires a strong comparison salt and creates stable pseudonymous fingerprints', () => {
    expect(() => requirePhase0ResearchSearchSalt(undefined)).toThrow(/PHASE0_SEARCH_BASELINE_SALT/);
    expect(() =>
      requirePhase0ResearchSearchSalt('replace-with-a-real-secret-value-123456'),
    ).toThrow(/non-placeholder/);

    const salt = requirePhase0ResearchSearchSalt(
      '7decbd7cf96d4edca5e46dbe1d06f4a1b64b5846209f2bce',
    );
    const first = phase0ResearchSearchResultFingerprint('entity-private-1', salt);
    const second = phase0ResearchSearchResultFingerprint('entity-private-1', salt);
    const other = phase0ResearchSearchResultFingerprint('entity-private-2', salt);

    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(first).not.toContain('entity-private');
  });

  it('builds a bounded query suite and privacy-safe parity report', () => {
    expect(PHASE0_RESEARCH_SEARCH_CASES.map((searchCase) => searchCase.queryClass)).toEqual([
      'blank-browse',
      'keyword',
      'short-alias',
      'semantic-phrase',
      'department-filter',
      'research-area-filter',
      'deep-page',
    ]);

    const searchCase = PHASE0_RESEARCH_SEARCH_CASES[1];
    const summarized = summarizePhase0ResearchSearchCase(searchCase, [
      {
        latencyMs: 9,
        estimatedTotalHits: 20,
        degraded: false,
        topResultFingerprints: ['fingerprint-a', 'fingerprint-b'],
      },
      {
        latencyMs: 5,
        estimatedTotalHits: 20,
        degraded: false,
        topResultFingerprints: ['fingerprint-a', 'fingerprint-b'],
      },
      {
        latencyMs: 18,
        estimatedTotalHits: 20,
        degraded: true,
        topResultFingerprints: ['fingerprint-b', 'fingerprint-a'],
      },
    ]);
    expect(summarized.latencyMs).toEqual({ min: 5, p50: 9, p95: 18, max: 18 });
    expect(summarized.degradedSamples).toBe(1);
    expect(summarized.distinctOrderedResultSets).toBe(2);

    const privateId = '507f1f77bcf86cd799439011';
    const privateName = 'PRIVATE PERSON';
    const salt = '7decbd7cf96d4edca5e46dbe1d06f4a1b64b5846209f2bce';
    const report = buildPhase0ResearchSearchBaselineReport({
      generatedAt: '2026-07-28T12:00:00.000Z',
      sourceCommit: '5d4b09617ed96c963c1e28011075a941d1307b13',
      environment: 'beta',
      databaseName: 'Beta',
      salt,
      meiliTarget: { targetKind: 'remote', indexName: 'beta_researchentities' },
      meiliSettings: {
        searchableAttributes: ['name', 'researchAreas'],
        filterableAttributes: ['archived'],
        sortableAttributes: ['browseRankScore'],
        embedders: { default: { source: 'openAi', privateName } },
      },
      meiliStats: { numberOfDocuments: 200, isIndexing: false },
      iterations: 3,
      topK: 10,
      cases: [
        {
          ...summarized,
          samples: summarized.samples.map((sample) => ({
            ...sample,
            topResultFingerprints: [phase0ResearchSearchResultFingerprint(privateId, salt)],
          })),
        },
      ],
    });

    expect(report.summary).toEqual({
      degradedSamples: 1,
      unstableCases: 1,
      reviewRequired: true,
    });
    expect(report.meilisearch).toMatchObject({
      targetKind: 'remote',
      indexName: 'beta_researchentities',
      searchableAttributes: ['name', 'researchAreas'],
      embedderNames: ['default'],
      numberOfDocuments: 200,
      indexing: false,
    });
    expect(JSON.stringify(report)).not.toContain(privateId);
    expect(JSON.stringify(report)).not.toContain(privateName);
    expect(JSON.stringify(report)).not.toContain(salt);
  });

  it('fingerprints settings independent of object key order', () => {
    expect(
      phase0ResearchSearchSettingsFingerprint({
        sortableAttributes: ['name'],
        embedders: { default: { source: 'openAi' } },
      }),
    ).toBe(
      phase0ResearchSearchSettingsFingerprint({
        embedders: { default: { source: 'openAi' } },
        sortableAttributes: ['name'],
      }),
    );
  });
});
