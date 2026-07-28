import { describe, expect, it } from 'vitest';
import {
  PHASE0_HOT_PATH_EXPECTED_LABELS,
  buildPhase0HotPathQueryCostReport,
  classifyPhase0HotPathFindings,
  parsePhase0HotPathQueryCostArgs,
  safePhase0HotPathErrorCode,
  summarizePhase0HotPathExplain,
  summarizePhase0HotPathIndexDefinition,
  type Phase0HotPathFixtureState,
} from '../phase0HotPathQueryCostCore';
import { buildPhase0HotPathQuerySpecs } from '../phase0HotPathQueryShapes';

function completeFixtures(): Phase0HotPathFixtureState {
  return {
    browseEntityIds: ['private-entity-1'],
    typicalEntityId: 'private-entity-1',
    typicalEntitySlug: 'private-slug',
    highFanoutEntityId: 'private-entity-2',
    detailMemberUserIds: ['private-user-1'],
    detailUserIds: ['private-user-1'],
    detailFacultyIds: ['private-faculty-1'],
    detailImageUrls: ['https://private.invalid/image.jpg'],
    detailAttributedScholarlyLinkIds: ['private-link-1'],
    detailEntryPathwayIds: ['private-pathway-1'],
    detailRelatedEntityIds: ['private-entity-3'],
    ordinaryOpportunity: {
      id: 'private-opportunity-1',
      entryPathwayId: 'private-pathway-1',
      researchEntityId: 'private-entity-1',
      evidenceIds: ['private-observation-1'],
    },
    highEvidenceOpportunity: {
      id: 'private-opportunity-2',
      entryPathwayId: 'private-pathway-2',
      researchEntityId: 'private-entity-2',
      evidenceIds: ['private-observation-2'],
    },
    accounts: [
      {
        fixtureClass: 'zero-saves',
        netid: 'privatezero',
        savedResearchEntityIds: [],
        pathwayIds: [],
      },
      {
        fixtureClass: 'typical-saves',
        netid: 'privatetypical',
        savedResearchEntityIds: ['private-entity-1'],
        pathwayIds: ['private-pathway-1'],
      },
      {
        fixtureClass: 'near-limit-saves',
        netid: 'privatenear',
        savedResearchEntityIds: ['private-entity-2'],
        pathwayIds: ['private-pathway-2'],
      },
    ],
    adminSearchTerm: 'PRIVATE PERSON',
  };
}

describe('Phase 0 hot-path query-cost core', () => {
  it('parses only explicit bounded non-production evidence targets', () => {
    expect(
      parsePhase0HotPathQueryCostArgs([
        '--environment=beta',
        '--max-time-ms=12000',
        '--strict',
        '--output=/tmp/ylabs-phase0-query-cost-beta.json',
      ]),
    ).toEqual({
      environment: 'beta',
      maxTimeMS: 12000,
      strict: true,
      output: '/tmp/ylabs-phase0-query-cost-beta.json',
    });

    expect(() =>
      parsePhase0HotPathQueryCostArgs(['--environment=production', '--output=/tmp/forbidden.json']),
    ).toThrow(/development, beta, or production-copy/);
    expect(() =>
      parsePhase0HotPathQueryCostArgs([
        '--environment=beta',
        '--max-time-ms=30001',
        '--output=/tmp/too-long.json',
      ]),
    ).toThrow(/at most 30000/);
    expect(() =>
      parsePhase0HotPathQueryCostArgs(['--environment=beta', '--output=/var/tmp/out.json']),
    ).toThrow(/must write under/);
    expect(() =>
      parsePhase0HotPathQueryCostArgs(['--output=/tmp/missing-environment.json']),
    ).toThrow(/requires --environment/);
  });

  it('reduces raw explain output to aggregate plan and lookup statistics', () => {
    const rawExplain = {
      queryPlanner: {
        parsedQuery: { slug: 'private-slug' },
        winningPlan: {
          stage: 'FETCH',
          inputStage: { stage: 'IXSCAN', indexName: 'slug_1' },
        },
        rejectedPlans: [{ stage: 'COLLSCAN', filter: { name: 'PRIVATE PERSON' } }],
      },
      executionStats: {
        nReturned: 2,
        executionTimeMillis: 13,
        totalKeysExamined: 250,
        totalDocsExamined: 240,
        executionStages: {
          stage: 'FETCH',
          inputStage: { stage: 'IXSCAN', indexName: 'slug_1' },
        },
      },
      stages: [
        {
          $lookup: { from: 'access_signals', as: '_privateRows' },
          indexesUsed: ['researchEntityId_1'],
          totalKeysExamined: 10,
          totalDocsExamined: 8,
          collectionScans: 0,
          usedDisk: false,
          spills: 0,
        },
        { $sort: { updatedAt: -1 }, usedDisk: true, spills: 1 },
      ],
    };

    const summary = summarizePhase0HotPathExplain(rawExplain);
    expect(summary).toMatchObject({
      nReturned: 2,
      executionTimeMillis: 13,
      totalKeysExamined: 250,
      totalDocsExamined: 240,
      keysPerResult: 125,
      docsPerResult: 120,
      collectionScan: false,
      blockingSort: true,
      usedDisk: true,
      spills: 1,
    });
    expect(summary.stages).toEqual(expect.arrayContaining(['FETCH', 'IXSCAN', 'SORT']));
    expect(summary.indexNames).toEqual(expect.arrayContaining(['slug_1', 'researchEntityId_1']));
    expect(summary.lookupSubplans).toContainEqual({
      indexesUsed: ['researchEntityId_1'],
      totalKeysExamined: 10,
      totalDocsExamined: 8,
      collectionScans: 0,
      usedDisk: false,
      spills: 0,
    });
    expect(classifyPhase0HotPathFindings(summary)).toEqual([
      'blocking-sort',
      'disk-spill',
      'keys-amplification',
      'documents-amplification',
    ]);
    expect(JSON.stringify(summary)).not.toContain('private-slug');
    expect(JSON.stringify(summary)).not.toContain('PRIVATE PERSON');
  });

  it('publishes safe index definitions and fingerprints the full deployed definition', () => {
    const summary = summarizePhase0HotPathIndexDefinition({
      v: 2,
      name: 'researchEntityId_1_review.status_1',
      key: { researchEntityId: 1, 'review.status': 1 },
      unique: true,
      partialFilterExpression: {
        'review.status': 'PRIVATE-VALUE-THAT-MUST-NOT-BE-RETAINED',
      },
    });

    expect(summary).toMatchObject({
      name: 'researchEntityId_1_review.status_1',
      key: { 'review.status': 1, researchEntityId: 1 },
      unique: true,
      partialFilterFields: ['review.status'],
    });
    expect(summary.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(summary)).not.toContain('PRIVATE-VALUE');
  });

  it('collects aggregate cursor and lookup execution metrics without raw pipeline data', () => {
    const summary = summarizePhase0HotPathExplain({
      stages: [
        {
          $cursor: {
            queryPlanner: {
              winningPlan: { stage: 'IXSCAN', indexName: 'archived_1' },
              rejectedPlans: [{ stage: 'COLLSCAN', filter: { name: 'PRIVATE PERSON' } }],
            },
            executionStats: {
              nReturned: 30,
              executionTimeMillis: 7,
              totalKeysExamined: 30,
              totalDocsExamined: 30,
            },
          },
          nReturned: 30,
          executionTimeMillisEstimate: 7,
        },
        {
          $lookup: { from: 'access_signals', as: '_privateRows' },
          indexesUsed: ['researchEntityId_1'],
          totalKeysExamined: 90,
          totalDocsExamined: 90,
          collectionScans: 0,
          nReturned: 30,
          executionTimeMillisEstimate: 11,
        },
        {
          $facet: { rows: [], meta: [] },
          nReturned: 1,
          executionTimeMillisEstimate: 12,
        },
      ],
    });

    expect(summary).toMatchObject({
      nReturned: 1,
      executionTimeMillis: 12,
      totalKeysExamined: 120,
      totalDocsExamined: 120,
      keysPerResult: 120,
      docsPerResult: 120,
      collectionScan: false,
    });
    expect(summary.indexNames).toEqual(
      expect.arrayContaining(['archived_1', 'researchEntityId_1']),
    );
    expect(summary.rejectedPlans).toContainEqual({
      stages: ['COLLSCAN'],
      indexNames: [],
    });
    expect(JSON.stringify(summary)).not.toContain('PRIVATE PERSON');
  });

  it('covers every audited query label without retaining fixture values in the report', () => {
    const fixtures = completeFixtures();
    const specs = buildPhase0HotPathQuerySpecs(fixtures, new Date('2026-07-28T12:00:00.000Z'));
    expect(new Set(specs.map((spec) => spec.label))).toEqual(
      new Set(PHASE0_HOT_PATH_EXPECTED_LABELS),
    );

    const queries = specs.map((spec) => ({
      label: spec.label,
      surface: spec.surface,
      collection: spec.collection,
      operation: spec.operation,
      status: 'measured' as const,
      plan: summarizePhase0HotPathExplain({
        executionStats: {
          nReturned: 1,
          executionTimeMillis: 1,
          totalKeysExamined: 1,
          totalDocsExamined: 1,
        },
        queryPlanner: { winningPlan: { stage: 'IXSCAN', indexName: '_id_' } },
      }),
      findings: [],
    }));
    const report = buildPhase0HotPathQueryCostReport({
      generatedAt: '2026-07-28T12:00:00.000Z',
      sourceCommit: 'c2478017eddeeb289f834d1498ce24375a0175c6',
      environment: 'beta',
      databaseName: 'Beta',
      serverVersion: '8.0.0',
      maxTimeMS: 5000,
      fixtures,
      indexes: [],
      queries,
    });

    expect(report.summary).toMatchObject({
      expectedQueryShapes: PHASE0_HOT_PATH_EXPECTED_LABELS.length,
      measuredQueryShapes: PHASE0_HOT_PATH_EXPECTED_LABELS.length,
      fixtureUnavailableQueryShapes: 0,
      errorQueryShapes: 0,
      uncoveredLabels: [],
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('private-slug');
    expect(serialized).not.toContain('privatezero');
    expect(serialized).not.toContain('PRIVATE PERSON');
    expect(serialized).not.toContain('private-observation');
  });

  it('reduces runtime errors to a bounded non-message code', () => {
    const error = Object.assign(new Error('private host and credential detail'), {
      name: 'MongoServerError',
      code: 50,
    });
    expect(safePhase0HotPathErrorCode(error)).toBe('MongoServerError:50');
  });
});
