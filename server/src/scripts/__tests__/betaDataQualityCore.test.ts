import fs from 'fs';
import { mkdtemp, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildBetaDataQualityDiagnostics,
  buildResearchEntityContentPageLeakSummary,
  buildBetaDataQualityRetentionOptions,
  buildBetaDataQualityRecommendedCommands,
  buildBetaDataQualityOutput,
  buildSamePiDedupeReviewSummary,
  buildSuspiciousUserEmailScorecardSummary,
  classifyDuplicateEntityCluster,
  buildDuplicateEntityPlanReviewSummary,
  buildDuplicateEntityReviewSummary,
  buildArrayRefOrphanSamplePipeline,
  buildBetaDataQualitySummary,
  formatBetaDataQualityProgressEvent,
  buildMissingRequiredRefSamplePipeline,
  buildReferenceIntegritySummary,
  buildScalarRefOrphanSamplePipeline,
  isLikelyResearchEntityContentPageLeak,
  isInvalidObservationSourceUrl,
  isInvalidOptionalEmail,
  isInvalidOptionalUrl,
  parseBetaDataQualityArgs,
  selectLiveLinkCandidates,
  shouldStrictModeFail,
  writeScorecardOutput,
  type BetaDataQualityScorecard,
} from '../betaDataQualityCore';

describe('buildBetaDataQualityRecommendedCommands', () => {
  it('makes weekly and strict audit commands explicitly target Beta', () => {
    expect(buildBetaDataQualityRecommendedCommands()).toMatchObject({
      weeklyAudit:
        'SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --progress --output /tmp/ylabs-beta-quality.json',
      strictAudit:
        'SCRAPER_ENV=beta yarn --cwd server beta:data-quality --strict --include-samples --progress',
    });
  });

  it('uses saved output artifacts for retention dry-runs', () => {
    expect(buildBetaDataQualityRecommendedCommands()).toMatchObject({
      retentionDryRun:
        'SCRAPER_ENV=beta yarn --cwd server scrape prune-observations --source openalex --older-than-days 30 --keep-runs 3 --output /tmp/ylabs-openalex-prune-dry-run.json',
    });
  });

  it('keeps the retention scorecard scope aligned with the OpenAlex dry-run command', () => {
    expect(buildBetaDataQualityRetentionOptions()).toEqual({
      apply: false,
      olderThanDays: 30,
      keepRuns: 3,
      sourceName: 'openalex',
    });
  });
});

describe('buildBetaDataQualityDiagnostics', () => {
  it('summarizes phase durations for scorecard hang investigation', () => {
    expect(
      buildBetaDataQualityDiagnostics({
        collectionCounts: 12,
        sourceHealth: 80,
        liveLinks: 0,
      }),
    ).toEqual({
      totalMeasuredDurationMs: 92,
      slowestPhase: {
        name: 'sourceHealth',
        durationMs: 80,
      },
      phaseDurationsMs: {
        collectionCounts: 12,
        sourceHealth: 80,
        liveLinks: 0,
      },
    });
  });
});

describe('buildReferenceIntegritySummary', () => {
  it('treats optional missing refs as non-failures but present orphan refs as hard failures', () => {
    const summary = buildReferenceIntegritySummary([
      {
        name: 'contactRouteEntryPathway',
        required: false,
        missingRequired: 55,
        orphanedPresentRefs: 0,
      },
      {
        name: 'accessSignalEntryPathway',
        required: false,
        missingRequired: 0,
        orphanedPresentRefs: 2,
      },
      {
        name: 'entryPathwayResearchEntity',
        required: true,
        missingRequired: 1,
        orphanedPresentRefs: 0,
      },
    ]);

    expect(summary.missingRequiredTotal).toBe(1);
    expect(summary.orphanedPresentRefTotal).toBe(2);
    expect(summary.hardFailureTotal).toBe(3);
    expect(summary.items[0]).toMatchObject({
      name: 'contactRouteEntryPathway',
      severity: 'ok',
    });
    expect(summary.items[1]).toMatchObject({
      name: 'accessSignalEntryPathway',
      severity: 'error',
    });
    expect(summary.items[2]).toMatchObject({
      name: 'entryPathwayResearchEntity',
      severity: 'error',
    });
  });

  it('carries bounded failure samples for reviewable hard failures', () => {
    const summary = buildReferenceIntegritySummary([
      {
        name: 'research_entity_members.userId',
        required: false,
        missingRequired: 0,
        orphanedPresentRefs: 1,
        samples: [
          {
            collection: 'research_entity_members',
            field: 'userId',
            id: 'member-1',
            failureType: 'orphaned_present_ref',
            value: 'missing-user',
          },
        ],
      },
    ]);

    expect(summary.items[0]).toMatchObject({
      name: 'research_entity_members.userId',
      severity: 'error',
      samples: [
        {
          collection: 'research_entity_members',
          field: 'userId',
          id: 'member-1',
          failureType: 'orphaned_present_ref',
          value: 'missing-user',
        },
      ],
    });
  });
});

describe('reference-integrity sample pipelines', () => {
  it('builds sample pipelines for missing required and orphaned scalar refs', () => {
    expect(buildMissingRequiredRefSamplePipeline('userId', 5)).toEqual([
      { $match: { $or: [{ userId: { $exists: false } }, { userId: null }] } },
      { $project: { id: { $toString: '$_id' }, value: '$userId' } },
      { $limit: 5 },
    ]);

    expect(buildScalarRefOrphanSamplePipeline('review.reviewedByUserId', 'users', 5)).toEqual(
      expect.arrayContaining([
        { $match: { 'review.reviewedByUserId': { $exists: true, $nin: [null, ''] } } },
        expect.objectContaining({
          $lookup: expect.objectContaining({
            from: 'users',
            localField: 'review.reviewedByUserId',
          }),
        }),
        { $match: { _refTarget: { $size: 0 } } },
        { $project: { id: { $toString: '$_id' }, value: '$review.reviewedByUserId' } },
        { $limit: 5 },
      ]),
    );
  });

  it('builds sample pipelines for orphaned array refs', () => {
    expect(buildArrayRefOrphanSamplePipeline('sourceEvidenceIds', 'observations', 3)).toEqual(
      expect.arrayContaining([
        { $project: { ref: { $ifNull: ['$sourceEvidenceIds', []] } } },
        { $unwind: '$ref' },
        { $match: { ref: { $ne: null } } },
        expect.objectContaining({
          $lookup: expect.objectContaining({
            from: 'observations',
            localField: 'ref',
          }),
        }),
        { $match: { _refTarget: { $size: 0 } } },
        { $project: { id: { $toString: '$_id' }, value: '$ref' } },
        { $limit: 3 },
      ]),
    );
  });

  it('can scope reference sample pipelines to non-archived owner rows', () => {
    const activeFilter = { archived: { $ne: true } };

    expect(buildMissingRequiredRefSamplePipeline('userId', 5, activeFilter)[0]).toEqual({
      $match: {
        archived: { $ne: true },
        $or: [{ userId: { $exists: false } }, { userId: null }],
      },
    });

    expect(buildScalarRefOrphanSamplePipeline('userId', 'users', 5, activeFilter)[0]).toEqual({
      $match: {
        archived: { $ne: true },
        userId: { $exists: true, $nin: [null, ''] },
      },
    });

    expect(buildArrayRefOrphanSamplePipeline('sourceEvidenceIds', 'observations', 3, activeFilter)[0]).toEqual({
      $match: activeFilter,
    });
  });
});

describe('optional hygiene validators', () => {
  it('allows empty optional URL/email fields and flags malformed non-empty values', () => {
    expect(isInvalidOptionalUrl('')).toBe(false);
    expect(isInvalidOptionalUrl(undefined)).toBe(false);
    expect(isInvalidOptionalUrl('https://example.edu/lab')).toBe(false);
    expect(isInvalidOptionalUrl('ftp://example.edu/lab')).toBe(true);

    expect(isInvalidOptionalEmail('')).toBe(false);
    expect(isInvalidOptionalEmail(undefined)).toBe(false);
    expect(isInvalidOptionalEmail('fixture.person@example.edu')).toBe(false);
    expect(isInvalidOptionalEmail('not-an-email')).toBe(true);
  });

  it('allows local file provenance for observation source URLs only', () => {
    expect(isInvalidOptionalUrl('file:fixture_directory.csv')).toBe(true);
    expect(isInvalidObservationSourceUrl('file:fixture_directory.csv')).toBe(false);
    expect(isInvalidObservationSourceUrl('https://example.edu/source')).toBe(false);
    expect(isInvalidObservationSourceUrl('not-a-url')).toBe(true);
  });
});

describe('research entity content-page leak detection', () => {
  it('flags active blog pages classified as research homes', () => {
    expect(
      isLikelyResearchEntityContentPageLeak({
        name: 'Synthetic Research Updates Blog',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: 'https://fixtures.example.edu/lab/synthetic-research-updates-blog/',
      }),
    ).toEqual(['content-page-title', 'content-page-url', 'content-page-classified-as-lab']);
  });

  it('does not flag legitimate resources institutes', () => {
    expect(
      isLikelyResearchEntityContentPageLeak({
        name: 'Synthetic Resources Institute',
        kind: 'institute',
        entityType: 'INSTITUTE',
        websiteUrl: 'https://fixtures.example.edu/research/centers/synthetic-resources-institute',
      }),
    ).toEqual([]);
  });

  it('summarizes active content-page leak candidates', () => {
    const summary = buildResearchEntityContentPageLeakSummary([
      {
        id: 'bad',
        name: 'Synthetic Research Updates Blog',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: 'https://fixtures.example.edu/lab/synthetic-research-updates-blog/',
      },
      {
        id: 'ok',
        name: 'Synthetic Resources Institute',
        kind: 'institute',
        entityType: 'INSTITUTE',
        websiteUrl: 'https://fixtures.example.edu/research/centers/synthetic-resources-institute',
      },
    ]);

    expect(summary.count).toBe(1);
    expect(summary.samples).toEqual([
      expect.objectContaining({
        id: 'bad',
        name: 'Synthetic Research Updates Blog',
        reasons: ['content-page-title', 'content-page-url', 'content-page-classified-as-lab'],
      }),
    ]);
  });
});

describe('duplicate research entity review classification', () => {
  it('classifies duplicate-name clusters by safe review posture', () => {
    expect(
      classifyDuplicateEntityCluster({
        normalizedName: 'collins lab',
        count: 2,
        entities: [
          { id: 'one', name: 'Collins Lab', slug: 'collins-lab-jc528' },
          { id: 'two', name: 'Collins Lab', slug: 'collins-lab-ayc8' },
        ],
      }),
    ).toBe('same_label_disambiguation');

    expect(
      classifyDuplicateEntityCluster({
        normalizedName: 'charles ahn lab',
        count: 2,
        entities: [
          { id: 'physics', name: 'Charles Ahn Lab', websiteUrl: 'http://ahnlab.yale.edu/' },
          { id: 'seas', name: 'Charles Ahn Lab', websiteUrl: 'https://ahnlab.yale.edu' },
        ],
      }),
    ).toBe('shared_website_merge_review');

    expect(
      classifyDuplicateEntityCluster({
        normalizedName: 'rothman lab',
        count: 2,
        entities: [
          { id: 'medicine', name: 'Rothman Lab', websiteUrl: 'https://medicine.yale.edu/lab/rothman/' },
          { id: 'engineering', name: 'Rothman Lab' },
        ],
      }),
    ).toBe('same_label_disambiguation');

    expect(
      classifyDuplicateEntityCluster({
        normalizedName: 'andrew neitzke faculty research',
        count: 2,
        entities: [
          { id: 'physics', name: 'Andrew Neitzke Faculty Research', departments: ['Physics'] },
          { id: 'math', name: 'Andrew Neitzke Faculty Research', departments: ['Mathematics'] },
        ],
      }),
    ).toBe('cross_department_same_person_review');
  });

  it('summarizes duplicate-name review categories', () => {
    const summary = buildDuplicateEntityReviewSummary([
      {
        normalizedName: 'collins lab',
        count: 2,
        entities: [
          { id: 'one', name: 'Collins Lab' },
          { id: 'two', name: 'Collins Lab' },
        ],
      },
      {
        normalizedName: 'manual duplicate',
        count: 2,
        entities: [
          { id: 'one', name: 'Manual Duplicate' },
          { id: 'two', name: 'Manual Duplicate' },
        ],
      },
    ]);

    expect(summary).toEqual({
      totalClusters: 2,
      byCategory: [
        { category: 'manual_review', count: 1 },
        { category: 'same_label_disambiguation', count: 1 },
      ],
    });
  });

  it('builds compact duplicate-name plan review commands for broad scorecards', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-duplicate-name-validation-'));
    const acceptedDecisionsPath = path.join(dir, 'accepted-decisions.json');
    const validationOutputPath = path.join(dir, 'decision-validation.json');
    const planReview = buildDuplicateEntityPlanReviewSummary({
      totalClusters: 3,
      byCategory: [
        { category: 'shared_website_merge_review', count: 2 },
        { category: 'same_label_disambiguation', count: 1 },
      ],
    }, 20, {
      acceptedDecisionValidationInputPath: acceptedDecisionsPath,
      acceptedDecisionValidationOutputPath: validationOutputPath,
    });

    expect(planReview).toEqual({
      applyBlocked: true,
      planLimit: 20,
      totalClusters: 3,
      categoryCounts: [
        { category: 'shared_website_merge_review', count: 2 },
        { category: 'same_label_disambiguation', count: 1 },
      ],
      preflightGuidance: {
        applyBlocked: true,
        expectedArtifactFields: ['planSummary.preflightSummary', 'plans[].reviewPreflight'],
        sharedWebsiteReview: {
          category: 'shared_website_merge_review',
          clusterCount: 2,
          outputPath:
            '/tmp/ylabs-duplicate-entity-name-review-shared-website-plan.json',
          expectedStatus: 'merge_preflight_ready_for_review',
          requiredReviewerDecisions: [
            'Confirm the shared website represents one research home.',
            'Select the canonical ResearchEntity before any apply path.',
            'Confirm guarded reference rewrite and archive behavior for active references.',
          ],
        },
        manualReviewCategories: [
          {
            category: 'same_label_disambiguation',
            clusterCount: 1,
            expectedStatus: 'manual_disambiguation_required',
          },
        ],
        acceptedDecisionTemplate: {
          outputPath:
            '/tmp/ylabs-duplicate-entity-name-review-accepted-decisions-template.json',
          expectedArtifactFields: [
            'decisions[].planId',
            'decisions[].entityIds',
            'decisions[].decision',
            'decisions[].canonicalEntityId',
          ],
          command:
            'SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --limit=10000 --plan-limit=20 --decision-template-output /tmp/ylabs-duplicate-entity-name-review-accepted-decisions-template.json --output /tmp/ylabs-duplicate-entity-name-review.json',
        },
        acceptedDecisionValidation: {
          inputPath: acceptedDecisionsPath,
          outputPath: validationOutputPath,
          expectedArtifactField: 'reviewDecisionValidation',
          acceptedDecisionFields: ['planId', 'decision', 'canonicalEntityId', 'reviewedBy'],
          artifactAvailable: false,
          command:
            `SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --limit=10000 --plan-limit=20 --accepted-decisions=${acceptedDecisionsPath} --allow-empty-decisions --output ${validationOutputPath}`,
        },
      },
      recommendedCommands: [
        {
          label: 'all_duplicate_name_plans',
          clusterCount: 3,
          outputPath: '/tmp/ylabs-duplicate-entity-name-review.json',
          command:
            'SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --limit=10000 --plan-limit=20 --output /tmp/ylabs-duplicate-entity-name-review.json',
        },
        {
          label: 'shared_website_merge_review',
          category: 'shared_website_merge_review',
          clusterCount: 2,
          outputPath:
            '/tmp/ylabs-duplicate-entity-name-review-shared-website-plan.json',
          command:
            'SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --limit=10000 --category=shared_website_merge_review --plan-limit=20 --output /tmp/ylabs-duplicate-entity-name-review-shared-website-plan.json',
        },
        {
          label: 'same_label_disambiguation',
          category: 'same_label_disambiguation',
          clusterCount: 1,
          outputPath:
            '/tmp/ylabs-duplicate-entity-name-review-same-label-disambiguation-plan.json',
          command:
            'SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --limit=10000 --category=same_label_disambiguation --plan-limit=20 --output /tmp/ylabs-duplicate-entity-name-review-same-label-disambiguation-plan.json',
        },
      ],
      nextAction:
        'Run the category-specific dry-run review commands and inspect the saved artifacts before designing any guarded merge/archive apply path.',
    });
    expect(planReview).not.toHaveProperty('plans');
  });

  it('defaults duplicate-name decision validation to the full duplicate cluster count', () => {
    const planReview = buildDuplicateEntityPlanReviewSummary({
      totalClusters: 34,
      byCategory: [
        { category: 'shared_website_merge_review', count: 20 },
        { category: 'cross_department_same_person_review', count: 8 },
        { category: 'same_label_disambiguation', count: 6 },
      ],
    });

    expect(planReview.planLimit).toBe(34);
    expect(
      planReview.preflightGuidance.acceptedDecisionTemplate.command,
    ).toContain('--plan-limit=34');
    expect(
      planReview.preflightGuidance.acceptedDecisionValidation.command,
    ).toContain('--plan-limit=34');
    expect(planReview.recommendedCommands.map((command) => command.command)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('--plan-limit=34'),
      ]),
    );
  });

  it('loads duplicate-name accepted-decision validation status when the artifact exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-duplicate-name-validation-'));
    const acceptedDecisionsPath = path.join(dir, 'accepted-decisions.json');
    const validationOutputPath = path.join(dir, 'decision-validation.json');
    fs.writeFileSync(
      validationOutputPath,
      JSON.stringify({
        reviewDecisionValidation: {
          applyBlockedReason:
            'Accepted same-PI dedupe decisions are validation-only; apply mode cannot be combined with --accepted-decisions until decision-filtered apply exists.',
          totalDecisions: 2,
          validDecisionCount: 1,
          invalidDecisionCount: 1,
          unreviewedPlanCount: 19,
        },
      }),
    );

    const planReview = buildDuplicateEntityPlanReviewSummary(
      {
        totalClusters: 3,
        byCategory: [{ category: 'shared_website_merge_review', count: 3 }],
      },
      20,
      {
        acceptedDecisionValidationInputPath: acceptedDecisionsPath,
        acceptedDecisionValidationOutputPath: validationOutputPath,
      },
    );

    expect(planReview.preflightGuidance.acceptedDecisionValidation).toMatchObject({
      inputPath: acceptedDecisionsPath,
      outputPath: validationOutputPath,
      artifactAvailable: true,
      totalDecisions: 2,
      validDecisionCount: 1,
      invalidDecisionCount: 1,
      unreviewedPlanCount: 19,
    });
  });
});

describe('buildSamePiDedupeReviewSummary', () => {
  it('loads same-PI dedupe accepted-decision validation status from the saved dry-run artifact', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-same-pi-validation-'));
    const reviewArtifactPath = path.join(dir, 'same-pi-dedupe.json');
    const acceptedDecisionInputPath = path.join(dir, 'accepted-decisions.json');
    const decisionTemplateOutputPath = path.join(dir, 'accepted-decisions-template.json');
    fs.writeFileSync(
      reviewArtifactPath,
      JSON.stringify({
        plannedGroups: 3,
        plannedDuplicateEntities: 3,
        reviewBreakdown: {
          totalGroups: 3,
          fundingSourceGroups: 1,
          crossDepartmentGroups: 3,
          highResearchAreaMergeGroups: 2,
        },
        reviewDecisionValidation: {
          totalDecisions: 2,
          validDecisionCount: 1,
          invalidDecisionCount: 1,
          unreviewedPlanCount: 2,
        },
      }),
    );

    expect(
      buildSamePiDedupeReviewSummary({
        reviewArtifactPath,
        acceptedDecisionInputPath,
        decisionTemplateOutputPath,
      }),
    ).toEqual({
      applyBlocked: false,
      artifactAvailable: true,
      applyStatus:
        'Accepted same-PI dedupe decisions can drive bounded apply mode; only valid merge_into_canonical decisions are applied.',
      reviewArtifactPath,
      acceptedDecisionInputPath,
      decisionTemplateOutputPath,
      acceptedDecisionValidationOutputPath: reviewArtifactPath,
      command:
        `SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --limit=10000` +
        ` --accepted-decisions=${acceptedDecisionInputPath}` +
        ` --allow-empty-decisions --decision-template-output ${decisionTemplateOutputPath}` +
        ` --output ${reviewArtifactPath}`,
      plannedGroups: 3,
      plannedDuplicateEntities: 3,
      reviewBreakdown: {
        totalGroups: 3,
        fundingSourceGroups: 1,
        crossDepartmentGroups: 3,
        highResearchAreaMergeGroups: 2,
      },
      acceptedDecisionValidation: {
        artifactAvailable: true,
        totalDecisions: 2,
        validDecisionCount: 1,
        invalidDecisionCount: 1,
        unreviewedPlanCount: 2,
      },
      nextAction:
        'Review the same-PI dedupe decision template and validate accepted decisions before considering a bounded guarded apply.',
    });
  });

  it('keeps same-PI dedupe review status actionable when the saved artifact is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-same-pi-validation-'));
    const reviewArtifactPath = path.join(dir, 'missing.json');

    expect(buildSamePiDedupeReviewSummary({ reviewArtifactPath })).toMatchObject({
      applyBlocked: false,
      artifactAvailable: false,
      reviewArtifactPath,
      acceptedDecisionValidation: {
        artifactAvailable: false,
      },
    });
  });
});

describe('buildBetaDataQualitySummary', () => {
  it('classifies hard blockers as errors and quality gaps as warnings', () => {
    const summary = buildBetaDataQualitySummary({
      referenceHardFailures: 1,
      invalidUrlCount: 2,
      expiredOpenOpportunityCount: 1,
      paperAuthorshipIntegrityFailures: 3,
      sourceHealthErrors: 1,
      sourceHealthWarnings: 2,
      duplicateEntityClusterCount: 4,
      missingShortDescriptionCount: 10,
      weakShortDescriptionCount: 5,
      suspiciousUserEmailCount: 8,
      retentionCandidateCount: 6,
      coverageGaps: {
        withoutPathways: 7,
        withoutAccessSignals: 8,
        withoutContactRoutes: 9,
      },
    });

    expect(summary.status).toBe('error');
    expect(summary.errorCount).toBe(5);
    expect(summary.warnCount).toBe(9);
    expect(summary.errors.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        'referenceIntegrity',
        'urlSyntax',
        'expiredOpenOpportunities',
        'paperAuthorship',
        'sourceHealthErrors',
      ]),
    );
    expect(summary.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'referenceIntegrity',
          owner: 'data-quality operator',
          nextCommand:
            'SCRAPER_ENV=beta yarn --cwd server research-entity-members:audit-user-refs --limit=1000 --output /tmp/ylabs-member-user-ref-audit.json',
        }),
      ]),
    );
    expect(summary.errors).toHaveLength(5);
    expect(summary.warnings.map((item) => item.name)).toContain('duplicateEntityNames');
    expect(shouldStrictModeFail(summary)).toBe(true);
  });

  it('returns warning status when only quality gaps remain', () => {
    const summary = buildBetaDataQualitySummary({
      referenceHardFailures: 0,
      invalidUrlCount: 0,
      expiredOpenOpportunityCount: 0,
      paperAuthorshipIntegrityFailures: 0,
      sourceHealthErrors: 0,
      sourceHealthWarnings: 1,
      duplicateEntityClusterCount: 2,
      missingShortDescriptionCount: 3,
      weakShortDescriptionCount: 0,
      suspiciousUserEmailCount: 1,
      retentionCandidateCount: 0,
      coverageGaps: {
        withoutPathways: 4,
        withoutAccessSignals: 5,
        withoutContactRoutes: 6,
      },
    });

    expect(summary.status).toBe('warn');
    expect(summary.errorCount).toBe(0);
    expect(summary.promotionReady).toBe(false);
    expect(summary.promotionBlockerCount).toBe(3);
    expect(summary.promotionBlockers.map((item) => item.name)).toEqual([
      'sourceHealthWarnings',
      'duplicateEntityNames',
      'suspiciousUserEmails',
    ]);
    expect(summary.promotionBlockersByOwner).toEqual([
      { owner: 'data-quality operator', count: 1, blockerNames: ['duplicateEntityNames'] },
      { owner: 'identity/account operator', count: 1, blockerNames: ['suspiciousUserEmails'] },
      { owner: 'scraper-source operator', count: 1, blockerNames: ['sourceHealthWarnings'] },
    ]);
    expect(shouldStrictModeFail(summary)).toBe(false);
  });

  it('accepts suspicious user email warnings when Lane A exclusion covers the full suspicious set', () => {
    const summary = buildBetaDataQualitySummary({
      referenceHardFailures: 0,
      invalidUrlCount: 0,
      expiredOpenOpportunityCount: 0,
      paperAuthorshipIntegrityFailures: 0,
      sourceHealthErrors: 0,
      sourceHealthWarnings: 1,
      duplicateEntityClusterCount: 2,
      missingShortDescriptionCount: 3,
      weakShortDescriptionCount: 0,
      suspiciousUserEmailCount: 2,
      suspiciousUserEmailsProductionCopyExclusionComplete: true,
      retentionCandidateCount: 0,
      coverageGaps: {
        withoutPathways: 4,
        withoutAccessSignals: 5,
        withoutContactRoutes: 6,
      },
    });

    expect(summary.promotionReady).toBe(false);
    expect(summary.promotionBlockerCount).toBe(2);
    expect(summary.promotionBlockers.map((item) => item.name)).toEqual([
      'sourceHealthWarnings',
      'duplicateEntityNames',
    ]);
    expect(summary.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'suspiciousUserEmails',
          classification: 'accepted_release_warning',
          owner: 'identity/account operator',
        }),
      ]),
    );
  });

  it('blocks promotion when Beta contains real student analytics events', () => {
    const summary = buildBetaDataQualitySummary({
      referenceHardFailures: 0,
      invalidUrlCount: 0,
      expiredOpenOpportunityCount: 0,
      paperAuthorshipIntegrityFailures: 0,
      sourceHealthErrors: 0,
      sourceHealthWarnings: 0,
      duplicateEntityClusterCount: 0,
      missingShortDescriptionCount: 0,
      weakShortDescriptionCount: 0,
      suspiciousUserEmailCount: 0,
      betaStudentAnalyticsEventCount: 35,
      retentionCandidateCount: 0,
      coverageGaps: {
        withoutPathways: 0,
        withoutAccessSignals: 0,
        withoutContactRoutes: 0,
      },
    });

    expect(summary.promotionReady).toBe(false);
    expect(summary.promotionBlockers).toEqual([
      expect.objectContaining({
        name: 'betaStudentAnalyticsEvents',
        count: 35,
        classification: 'must_fix_before_promotion',
        owner: 'identity/account operator',
        nextCommand:
          'SCRAPER_ENV=beta yarn --cwd server beta:clear-student-analytics --output /tmp/ylabs-beta-student-analytics-cleanup.json',
      }),
    ]);
  });

  it('marks promotion ready when only accepted release warnings remain', () => {
    const summary = buildBetaDataQualitySummary({
      referenceHardFailures: 0,
      invalidUrlCount: 0,
      expiredOpenOpportunityCount: 0,
      paperAuthorshipIntegrityFailures: 0,
      sourceHealthErrors: 0,
      sourceHealthWarnings: 0,
      duplicateEntityClusterCount: 0,
      missingShortDescriptionCount: 25,
      weakShortDescriptionCount: 0,
      suspiciousUserEmailCount: 0,
      retentionCandidateCount: 0,
      coverageGaps: {
        withoutPathways: 10,
        withoutAccessSignals: 9,
        withoutContactRoutes: 8,
      },
    });

    expect(summary.status).toBe('warn');
    expect(summary.promotionReady).toBe(true);
    expect(summary.promotionBlockerCount).toBe(0);
    expect(summary.promotionBlockers).toEqual([]);
    expect(summary.promotionBlockersByOwner).toEqual([]);
    expect(shouldStrictModeFail(summary)).toBe(false);
  });

  it('adds operator classification metadata and next commands to current promotion warnings', () => {
    const summary = buildBetaDataQualitySummary({
      referenceHardFailures: 0,
      invalidUrlCount: 0,
      expiredOpenOpportunityCount: 0,
      paperAuthorshipIntegrityFailures: 0,
      sourceHealthErrors: 0,
      sourceHealthWarnings: 12,
      duplicateEntityClusterCount: 269,
      researchEntityContentPageLeakCount: 3,
      missingShortDescriptionCount: 2858,
      weakShortDescriptionCount: 11,
      suspiciousUserEmailCount: 4,
      retentionCandidateCount: 0,
      coverageGaps: {
        withoutPathways: 1825,
        withoutAccessSignals: 1981,
        withoutContactRoutes: 3056,
      },
    });

    expect(summary.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'sourceHealthWarnings',
          classification: 'must_fix_before_promotion',
          owner: 'scraper-source operator',
          nextCommand: 'SCRAPER_ENV=beta yarn --cwd server source:health --output /tmp/ylabs-source-health.json',
        }),
        expect.objectContaining({
          name: 'duplicateEntityNames',
          classification: 'must_fix_before_promotion',
          owner: 'data-quality operator',
          nextCommand:
            'SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --limit=10000 --output /tmp/ylabs-duplicate-entity-name-review.json',
        }),
        expect.objectContaining({
          name: 'researchEntityContentPageLeaks',
          classification: 'must_fix_before_promotion',
          owner: 'data-quality operator',
          nextCommand:
            'SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json',
        }),
        expect.objectContaining({
          name: 'missingShortDescriptions',
          classification: 'accepted_release_warning',
          owner: 'content-quality operator',
        }),
        expect.objectContaining({
          name: 'weakShortDescriptions',
          classification: 'post_promotion_backlog',
          owner: 'content-quality operator',
        }),
        expect.objectContaining({
          name: 'coverageWithoutPathways',
          classification: 'accepted_release_warning',
          owner: 'pathway coverage operator',
        }),
        expect.objectContaining({
          name: 'coverageWithoutAccessSignals',
          classification: 'accepted_release_warning',
          owner: 'pathway coverage operator',
        }),
        expect.objectContaining({
          name: 'coverageWithoutContactRoutes',
          classification: 'accepted_release_warning',
          owner: 'contact coverage operator',
        }),
        expect.objectContaining({
          name: 'suspiciousUserEmails',
          classification: 'must_fix_before_promotion',
          owner: 'identity/account operator',
          nextCommand:
            'SCRAPER_ENV=beta yarn --cwd server users:email-hygiene --limit=1000 --output /tmp/ylabs-user-email-hygiene.json',
        }),
      ]),
    );
  });
});

describe('buildSuspiciousUserEmailScorecardSummary', () => {
  it('keeps Lane A production-copy exclusion posture with suspicious user samples', () => {
    const summary = buildSuspiciousUserEmailScorecardSummary({
      count: 2,
      includeSamples: true,
      samples: [
        {
          id: 'user-1',
          netid: 'devadmin',
          name: 'Dev Admin',
          email: 'devadmin@example.invalid',
          reason: 'placeholder-or-synthetic-pattern',
          productionCopyExcludedByDefault: true,
        },
        {
          id: 'user-2',
          netid: 'reviewme',
          name: 'Review Me',
          email: 'test456@yale.edu',
          reason: 'placeholder-or-synthetic-pattern',
          productionCopyExcludedByDefault: false,
        },
      ],
    });

    expect(summary).toEqual({
      count: 2,
      productionCopyExclusion: {
        lane: 'Lane A accepted Beta copy',
        strategy:
          "The guarded Lane A copy excludes known dev/test users from the users collection and separately blocks copied records that still reference excluded users.",
        sampledExcludedByDefault: 1,
        sampledNeedsReviewBeforeCopy: 1,
        sampledCoverageComplete: false,
        nextAction:
          'Review any sampled users not covered by the Lane A copy filter before production copy; do not delete users as part of this data-quality audit.',
      },
      samples: [
        {
          id: 'user-1',
          netid: 'devadmin',
          name: 'Dev Admin',
          email: 'devadmin@example.invalid',
          reason: 'placeholder-or-synthetic-pattern',
          productionCopyExcludedByDefault: true,
          productionCopyDisposition: 'excluded_from_lane_a_users_copy',
        },
        {
          id: 'user-2',
          netid: 'reviewme',
          name: 'Review Me',
          email: 'test456@yale.edu',
          reason: 'placeholder-or-synthetic-pattern',
          productionCopyExcludedByDefault: false,
          productionCopyDisposition: 'review_before_lane_a_copy',
        },
      ],
    });
  });

  it('does not treat sampled synthetic-user exclusions as full coverage when samples are truncated', () => {
    const summary = buildSuspiciousUserEmailScorecardSummary({
      count: 3,
      includeSamples: true,
      samples: [
        {
          id: 'user-1',
          netid: 'devadmin',
          name: 'Dev Admin',
          email: 'devadmin@example.invalid',
          reason: 'placeholder-or-synthetic-pattern',
          productionCopyExcludedByDefault: true,
        },
        {
          id: 'user-2',
          netid: 'test123',
          name: 'Test User',
          email: 'test123@example.invalid',
          reason: 'placeholder-or-synthetic-pattern',
          productionCopyExcludedByDefault: true,
        },
      ],
    });

    expect(summary.productionCopyExclusion).toMatchObject({
      sampledExcludedByDefault: 2,
      sampledNeedsReviewBeforeCopy: 0,
      sampledCoverageComplete: false,
    });
  });
});

describe('parseBetaDataQualityArgs', () => {
  it('parses strict output live-link sample and sample flags', () => {
    expect(
      parseBetaDataQualityArgs([
        '--strict',
        '--output',
        '/tmp/report.json',
        '--days=14',
        '--live-links',
        '--link-sample-size=25',
        '--include-samples',
        '--progress',
      ]),
    ).toEqual({
      strict: true,
      output: '/tmp/report.json',
      days: 14,
      liveLinks: true,
      linkSampleSize: 25,
      includeSamples: true,
      progress: true,
    });
  });

  it('rejects flag-looking output paths before Mongo setup', () => {
    expect(() => parseBetaDataQualityArgs(['--output', '--strict'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseBetaDataQualityArgs(['--output=--strict'])).toThrow(
      /--output requires a path/,
    );
  });

  it('rejects unsafe numeric bounds before Mongo setup', () => {
    expect(() => parseBetaDataQualityArgs(['--days=9007199254740992'])).toThrow(
      /--days must be a positive integer/,
    );
    expect(() =>
      parseBetaDataQualityArgs(['--link-sample-size=9007199254740992']),
    ).toThrow(/--link-sample-size must be a positive integer/);
  });
});

describe('formatBetaDataQualityProgressEvent', () => {
  it('formats stable progress lines for slow scorecard investigation', () => {
    expect(
      formatBetaDataQualityProgressEvent({
        phase: 'sourceHealth',
        status: 'finished',
        durationMs: 81.4,
      }),
    ).toBe('[beta:data-quality] sourceHealth finished in 81ms');

    expect(
      formatBetaDataQualityProgressEvent({
        phase: 'sourceHealth',
        status: 'started',
      }),
    ).toBe('[beta:data-quality] sourceHealth started');
  });
});

describe('selectLiveLinkCandidates', () => {
  it('dedupes and respects the requested sample size', () => {
    const rows = selectLiveLinkCandidates(
      [
        { value: 'https://example.edu/a', source: 'entity.website' },
        { value: 'https://example.edu/a', source: 'listing.website' },
        { value: 'https://example.edu/b', source: 'pathway.sourceUrls' },
        { value: 'not-a-url', source: 'bad' },
      ],
      1,
    );

    expect(rows).toEqual([
      {
        url: 'https://example.edu/a',
        sources: ['entity.website', 'listing.website'],
      },
    ]);
  });
});

describe('writeScorecardOutput', () => {
  it('wraps scorecard artifacts with target metadata and parsed options', () => {
    const scorecard = {
      generatedAt: '2026-05-15T00:00:00.000Z',
      mongoTarget: 'example.mongodb.net/Beta',
      summary: {
        status: 'ok',
        errorCount: 0,
        warnCount: 0,
        errors: [],
        warnings: [],
      },
    } as unknown as BetaDataQualityScorecard;

    const output = buildBetaDataQualityOutput(scorecard, {
      environment: 'beta',
      db: 'Beta',
      options: {
        strict: false,
        days: 30,
        liveLinks: false,
        linkSampleSize: 50,
        includeSamples: true,
        progress: false,
        output: '/tmp/ylabs-beta-quality.json',
      },
    });

    expect(output).toMatchObject({
      generatedAt: '2026-05-15T00:00:00.000Z',
      mongoTarget: 'example.mongodb.net/Beta',
      environment: 'beta',
      db: 'Beta',
      options: {
        strict: false,
        days: 30,
        liveLinks: false,
        linkSampleSize: 50,
        includeSamples: true,
        progress: false,
        output: '/tmp/ylabs-beta-quality.json',
      },
      summary: { status: 'ok' },
    });
  });

  it('writes the JSON scorecard shape to disk when output is provided', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ylabs-quality-test-'));
    const output = path.join(dir, 'scorecard.json');
    const scorecard = {
      generatedAt: '2026-05-15T00:00:00.000Z',
      mongoTarget: 'example.mongodb.net/Beta',
      summary: {
        status: 'ok',
        errorCount: 0,
        warnCount: 0,
        errors: [],
        warnings: [],
      },
    } as unknown as BetaDataQualityScorecard;

    await writeScorecardOutput(scorecard, output);

    expect(JSON.parse(await readFile(output, 'utf8'))).toMatchObject({
      mongoTarget: 'example.mongodb.net/Beta',
      summary: { status: 'ok' },
    });
    await rm(dir, { recursive: true, force: true });
  });
});
