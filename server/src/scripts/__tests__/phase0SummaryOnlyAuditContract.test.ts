import { describe, expect, it } from 'vitest';
import { buildDuplicateEntityNameReviewSummaryOnlyOutput } from '../duplicateEntityNameReview';
import { buildResearchEntityCoverageSummaryOnlyOutput } from '../researchEntityCoverageAudit';
import {
  assertPhase0SummaryOnlyConfiguredTarget,
  assertPhase0SummaryOnlyConnectedTarget,
  parsePhase0SummaryOnlyEnvironment,
} from '../phase0SummaryOnlyAudit';

const PRIVATE = 'PRIVATE_RECORD_VALUE';
const FORBIDDEN_KEYS = new Set([
  'applied',
  'candidateusers',
  'canonicalentityid',
  'canonicaluserid',
  'clusters',
  'duplicateuserids',
  'entities',
  'entityids',
  'entityslugs',
  'identityvalue',
  'inferrednames',
  'memberid',
  'mongoTarget'.toLowerCase(),
  'name',
  'normalizedname',
  'plan',
  'plans',
  'replacementnetid',
  'replacementuserid',
  'rows',
  'samples',
  'sharedwebsiteurl',
  'slug',
  'sourceurl',
  'url',
  'userid',
  'userids',
  'warnings',
]);

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
    return keys;
  }
  if (!value || typeof value !== 'object') return keys;
  for (const [key, nested] of Object.entries(value)) {
    keys.push(key.toLowerCase());
    collectKeys(nested, keys);
  }
  return keys;
}

function expectAggregateOnlyContract(output: unknown): void {
  expect(JSON.stringify(output)).not.toContain(PRIVATE);
  expect(collectKeys(output).filter((key) => FORBIDDEN_KEYS.has(key))).toEqual([]);
  expect(output).toMatchObject({
    summaryOnly: true,
    environment: 'development',
    db: 'Development',
  });
}

describe('Phase 0 summary-only audit output security contract', () => {
  it('fails closed on missing, production, configured, and connected environment mismatches', () => {
    expect(() =>
      assertPhase0SummaryOnlyConfiguredTarget({
        summaryOnly: true,
        mongoUrl: 'mongodb://example.test/Development',
        scriptName: 'test-audit',
      }),
    ).toThrow('--summary-only requires --environment');
    expect(() =>
      assertPhase0SummaryOnlyConfiguredTarget({
        summaryOnly: false,
        environment: 'development',
        mongoUrl: 'mongodb://example.test/Development',
        scriptName: 'test-audit',
      }),
    ).toThrow('--environment is only valid with --summary-only');
    expect(() => parsePhase0SummaryOnlyEnvironment('production')).toThrow(
      '--environment requires development, beta, or production-copy',
    );
    expect(() =>
      assertPhase0SummaryOnlyConfiguredTarget({
        summaryOnly: true,
        environment: 'development',
        mongoUrl: 'mongodb://example.test/Beta',
        scriptName: 'test-audit',
      }),
    ).toThrow(/environment development does not match MongoDB database Beta/);
    expect(() =>
      assertPhase0SummaryOnlyConfiguredTarget({
        summaryOnly: true,
        environment: 'development',
        mongoUrl: 'mongodb://example.test/Development',
        scriptName: 'test-audit',
      }),
    ).not.toThrow();
    expect(() =>
      assertPhase0SummaryOnlyConnectedTarget({
        summaryOnly: true,
        environment: 'beta',
        databaseName: 'ProductionCopy',
        scriptName: 'test-audit',
      }),
    ).toThrow(/environment beta does not match MongoDB database ProductionCopy/);
    expect(() =>
      assertPhase0SummaryOnlyConnectedTarget({
        summaryOnly: true,
        environment: 'production-copy',
        databaseName: 'ProductionCopy',
        scriptName: 'test-audit',
      }),
    ).not.toThrow();
  });

  it('recursively excludes sensitive keys and values from all audit outputs', () => {
    const duplicateEntity = buildDuplicateEntityNameReviewSummaryOnlyOutput(
      {
        generatedAt: '2026-07-28T00:00:00.000Z',
        mongoTarget: PRIVATE,
        mode: 'dry-run',
        applyBlocked: false,
        applyStatus: PRIVATE,
        clusterLimit: 100,
        clusterCount: 1,
        entityCountInClusters: 2,
        reviewSummary: {
          totalClusters: 1,
          byCategory: [
            { category: 'shared_website_merge_review', count: 1 },
            { category: PRIVATE as never, count: 99 },
          ],
        },
        planSummary: {
          planLimit: 10,
          plannedClusterCount: 1,
          plannedEntityCount: 2,
          planTruncated: false,
          preflightSummary: {
            mergePreflightReadyForReview: 1,
            manualDisambiguationRequired: 0,
            withReferenceRewrite: 1,
            totalReferencesImpacted: 3,
            requiredReviewerDecisions: [{ decision: PRIVATE, count: 1 }],
          },
          plans: [
            {
              planId: PRIVATE,
              normalizedName: PRIVATE,
              reviewCategory: 'shared_website_merge_review',
              entityIds: [PRIVATE],
              entitySlugs: [PRIVATE],
              sharedWebsiteUrl: PRIVATE,
              proposedAction: 'review_for_merge_or_aliasing',
              reviewPreflight: {
                status: 'merge_preflight_ready_for_review',
                referenceRewriteRequired: true,
                totalReferencesImpacted: 3,
                blockers: [PRIVATE],
                requiredReviewerDecisions: [PRIVATE],
              },
              applyBlocked: false,
              applyStatus: PRIVATE,
            },
          ],
        },
        clusters: [
          {
            normalizedName: PRIVATE,
            count: 2,
            reviewCategory: 'shared_website_merge_review',
            entities: [{ id: PRIVATE, name: PRIVATE, slug: PRIVATE, websiteUrl: PRIVATE }],
          },
        ],
        nextAction: PRIVATE,
        applied: [{ private: PRIVATE }] as never,
      },
      { environment: 'development', db: 'Development' },
    );

    const coverage = buildResearchEntityCoverageSummaryOnlyOutput(
      {
        generatedAt: '2026-07-28T00:00:00.000Z',
        scope: 'bulk',
        totalEntitiesScanned: 10,
        flaggedEntities: 2,
        filters: {
          includeArchived: false,
          includeAll: true,
          minScore: 0,
        },
        issueCounts: {
          NO_MEMBERS: 2,
          [PRIVATE]: 99,
        },
      },
      { environment: 'development', db: 'Development' },
    );

    for (const output of [duplicateEntity, coverage]) {
      expectAggregateOnlyContract(output);
    }
  });
});
