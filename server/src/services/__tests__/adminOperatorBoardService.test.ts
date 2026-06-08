import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  deriveDataQualityGate,
  buildRecommendedNextActions,
  classifyOperatorQueueReason,
  derivePromotionStatus,
  readDataQualityGateArtifact,
  readScraperIntegrityGateArtifact,
  deriveScraperIntegrityGate,
  readBetaRepairQueueGateArtifact,
  deriveRepairQueueGate,
  readLaunchTrustGateArtifact,
  readLaunchReviewExceptionsArtifact,
  deriveLaunchTrustGate,
  readLaunchAcquisitionGateArtifact,
  deriveLaunchAcquisitionGate,
  readPromotionCopyDryRunArtifact,
  derivePromotionCopyGate,
  summarizeDryRunPosture,
  buildGateArtifactFreshness,
  GATE_SCORECARD_MAX_AGE_HOURS,
} from '../adminOperatorBoardService';

describe('adminOperatorBoardService', () => {
  it('separates blocking repair reasons from positive evidence signals', () => {
    expect(classifyOperatorQueueReason('missing_action_evidence')).toBe('blocking');
    expect(classifyOperatorQueueReason('profile_fallback_only')).toBe('blocking');
    expect(classifyOperatorQueueReason('not_undergraduate_relevant')).toBe('blocking');
    expect(classifyOperatorQueueReason('pi_identity_conflict')).toBe('blocking');
    expect(classifyOperatorQueueReason('concrete_next_step')).toBe('evidence');
    expect(classifyOperatorQueueReason('source_backed_description')).toBe('evidence');
    expect(classifyOperatorQueueReason('operator_override')).toBe('review');
  });

  it('summarizes latest dry and non-dry runs separately', () => {
    const summary = summarizeDryRunPosture([
      {
        _id: 'write-run',
        sourceName: 'source-a',
        status: 'success',
        startedAt: '2026-05-25T12:00:00.000Z',
        observationCount: 9,
        options: { dryRun: false },
      },
      {
        _id: 'dry-run',
        sourceName: 'source-a',
        status: 'partial',
        startedAt: '2026-05-25T13:00:00.000Z',
        observationCount: 3,
        options: { dryRun: true },
      },
    ]);

    expect(summary.latestDryRun).toMatchObject({
      id: 'dry-run',
      sourceName: 'source-a',
      status: 'partial',
      observationCount: 3,
    });
    expect(summary.latestWriteRun).toMatchObject({
      id: 'write-run',
      sourceName: 'source-a',
      status: 'success',
      observationCount: 9,
    });
  });

  it('derives top-level promotion status from source and gate posture', () => {
    expect(
      derivePromotionStatus({
        sourceRiskCounts: { ok: 5, warn: 0, error: 0 },
        integrityStatus: 'pass',
        meiliStatus: 'ready',
      }),
    ).toBe('ready');

    expect(
      derivePromotionStatus({
        sourceRiskCounts: { ok: 5, warn: 1, error: 0 },
        integrityStatus: 'watch',
        meiliStatus: 'unknown',
      }),
    ).toBe('watch');

    expect(
      derivePromotionStatus({
        sourceRiskCounts: { ok: 5, warn: 0, error: 1 },
        integrityStatus: 'failure',
        meiliStatus: 'blocked',
      }),
    ).toBe('blocked');

    expect(
      derivePromotionStatus({
        sourceRiskCounts: { ok: 5, warn: 0, error: 0 },
        integrityStatus: 'pass',
        meiliStatus: 'ready',
        dataQualityPromotionReady: false,
      }),
    ).toBe('blocked');
  });

  it('uses explicit Beta targets for non-production operator gate commands', () => {
    expect(deriveDataQualityGate()).toMatchObject({
      command: 'SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples',
    });
    expect(deriveRepairQueueGate(3)).toMatchObject({
      command:
        'SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=all --stage=source_description --mode=dry-run --retry-blocked --limit=500',
    });
    expect(deriveScraperIntegrityGate()).toMatchObject({
      command: 'SCRAPER_ENV=beta yarn --cwd server scraper:integrity-gate --include-samples',
    });
    expect(deriveLaunchTrustGate()).toMatchObject({
      command:
        'SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --strict',
    });
    expect(deriveLaunchAcquisitionGate()).toMatchObject({
      command:
        'SCRAPER_ENV=beta yarn --cwd server launch:acquisition-report --stage=all --limit=250 --sample-limit=10 --output /tmp/ylabs-launch-acquisition-report.json',
    });
    expect(derivePromotionCopyGate()).toMatchObject({
      command:
        'yarn --cwd server production:promote-beta-copy --output /tmp/ylabs-lane-a-promotion-dry-run.json',
    });
  });

  it('includes gate and Meili follow-up actions before production promotion', () => {
    expect(
      buildRecommendedNextActions({
        promotionStatus: 'watch',
        sourceRiskCounts: { ok: 2, warn: 1, error: 0 },
      }),
    ).toEqual([
      'Run bounded dry runs for warning sources before promotion.',
      'Run scraper integrity and data-quality gates before any production promotion.',
      'Rebuild Meili indexes after accepted data repairs.',
    ]);
  });

  it('adds an explicit pending search-sync action after write runs', () => {
    expect(
      buildRecommendedNextActions({
        promotionStatus: 'watch',
        sourceRiskCounts: { ok: 2, warn: 0, error: 0 },
        pendingMeiliSync: true,
      }),
    ).toContain('Rebuild Meili after the latest accepted write run.');
  });

  it('adds a data-quality blocker action when promotion blockers remain', () => {
    expect(
      buildRecommendedNextActions({
        promotionStatus: 'blocked',
        sourceRiskCounts: { ok: 2, warn: 0, error: 0 },
        dataQualityPromotionBlockerCount: 4,
      }),
    ).toContain('Resolve 4 data-quality promotion blockers before production promotion.');
  });

  it('adds launch and source-review handoff actions from saved artifact counts', () => {
    expect(
      buildRecommendedNextActions({
        promotionStatus: 'blocked',
        sourceRiskCounts: { ok: 2, warn: 1, error: 0 },
        dataQualityPromotionBlockerCount: 2,
        duplicateNameUnreviewedPlanCount: 20,
        samePiDedupeUnreviewedPlanCount: 29,
        launchHeldCount: 1046,
        launchReviewExceptionUnreviewedCount: 92,
        sourceReviewUnreviewedPlanCount: 204,
      }),
    ).toEqual([
      'Resolve 2 data-quality promotion blockers before production promotion.',
      'Resolve 1046 launch-trust held rows before production promotion.',
      'Review 92 launch review-exception plans before claiming launch trust readiness.',
      'Review 204 source-health conflict plans before accepting source-health warnings.',
      'Review 20 duplicate-name decisions before designing a guarded merge/archive path.',
      'Review 29 same-PI dedupe decisions before clearing scraper-integrity same-PI blockers.',
      'Run bounded dry runs for warning sources before promotion.',
      'Run scraper integrity and data-quality gates before any production promotion.',
      'Rebuild Meili indexes after accepted data repairs.',
    ]);
  });

  it('maps data-quality summary posture to an operator gate status', () => {
    expect(deriveDataQualityGate()).toMatchObject({
      status: 'manual',
      note: 'Gate output is not persisted in this branch yet; run before promotion.',
    });

    expect(
      deriveDataQualityGate({
        promotionReady: false,
        promotionBlockerCount: 3,
        hardErrors: [{ name: 'referenceIntegrity', count: 1 }],
      }),
    ).toMatchObject({
      status: 'blocked',
      note: 'Data-quality gate has 1 hard error and 3 must-fix promotion blockers.',
      hardErrors: [{ name: 'referenceIntegrity', count: 1 }],
    });

    expect(
      deriveDataQualityGate({
        promotionReady: true,
        promotionBlockerCount: 0,
      }),
    ).toMatchObject({
      status: 'ready',
      note: 'Latest data-quality gate has no must-fix promotion blockers.',
    });
  });

  it('loads a saved beta:data-quality artifact for operator gate review', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-operator-board-'));
    const artifactPath = path.join(dir, 'beta-quality.json');
    const validationPath = path.join(dir, 'duplicate-name-decision-validation.json');
    fs.writeFileSync(
      validationPath,
      JSON.stringify({
        reviewDecisionValidation: {
          totalDecisions: 0,
          validDecisionCount: 0,
          invalidDecisionCount: 0,
          unreviewedPlanCount: 5,
        },
      }),
    );
    fs.writeFileSync(
      artifactPath,
      JSON.stringify({
        generatedAt: '2026-05-29T22:30:00.000Z',
        summary: {
          promotionReady: false,
          promotionBlockerCount: 2,
          errors: [
            {
              name: 'referenceIntegrity',
              count: 1,
              owner: 'data-quality operator',
              nextCommand:
                'yarn --cwd server research-entity-members:audit-user-refs --limit=1000 --output /tmp/ylabs-member-user-ref-audit.json',
            },
          ],
          promotionBlockersByOwner: [
            {
              owner: 'data-quality operator',
              count: 2,
              blockerNames: ['duplicateEntityNames', 'researchEntityContentPageLeaks'],
            },
          ],
        },
        duplicateEntityNames: {
          planReview: {
            preflightGuidance: {
              sharedWebsiteReview: {
                clusterCount: 20,
                outputPath:
                  '/tmp/ylabs-duplicate-entity-name-review-shared-website-plan.json',
                requiredReviewerDecisions: [
                  'Confirm the shared website represents one research home.',
                  'Select the canonical ResearchEntity before any apply path.',
                  'Confirm guarded reference rewrite and archive behavior for active references.',
                ],
              },
              manualReviewCategories: [
                {
                  category: 'same_label_disambiguation',
                  clusterCount: 6,
                },
              ],
              acceptedDecisionTemplate: {
                outputPath:
                  '/tmp/ylabs-duplicate-entity-name-review-accepted-decisions-template.json',
                command:
                  'yarn --cwd server research-entity:duplicate-name-review --limit=10000 --plan-limit=20 --decision-template-output /tmp/ylabs-duplicate-entity-name-review-accepted-decisions-template.json --output /tmp/ylabs-duplicate-entity-name-review.json',
              },
              acceptedDecisionValidation: {
                inputPath: '/tmp/ylabs-duplicate-entity-name-review-accepted-decisions.json',
                outputPath: validationPath,
                expectedArtifactField: 'reviewDecisionValidation',
                command:
                  'yarn --cwd server research-entity:duplicate-name-review --limit=10000 --plan-limit=20 --accepted-decisions=/tmp/ylabs-duplicate-entity-name-review-accepted-decisions.json --output /tmp/ylabs-duplicate-entity-name-review-decision-validation.json',
              },
            },
          },
        },
        hygiene: {
          emails: {
            suspiciousUserEmails: {
              count: 2,
              productionCopyExclusion: {
                lane: 'Lane A accepted Beta copy',
                sampledExcludedByDefault: 2,
                sampledNeedsReviewBeforeCopy: 0,
                sampledCoverageComplete: true,
                nextAction:
                  'Review any sampled users not covered by the Lane A copy filter before production copy.',
              },
            },
          },
        },
        samePiDedupeReview: {
          applyBlocked: true,
          applyBlockedReason:
            'Accepted same-PI dedupe decisions are validation-only; apply mode cannot be combined with --accepted-decisions until decision-filtered apply exists.',
          artifactAvailable: true,
          reviewArtifactPath: '/tmp/ylabs-research-entity-dedupe.json',
          acceptedDecisionInputPath:
            '/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions.json',
          decisionTemplateOutputPath:
            '/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions-template.json',
          acceptedDecisionValidationOutputPath: '/tmp/ylabs-research-entity-dedupe.json',
          command:
            'yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --accepted-decisions=/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions.json --allow-empty-decisions --decision-template-output /tmp/ylabs-research-entity-pi-dedupe-accepted-decisions-template.json --output /tmp/ylabs-research-entity-dedupe.json',
          plannedGroups: 29,
          plannedDuplicateEntities: 29,
          reviewBreakdown: {
            crossDepartmentGroups: 29,
            highResearchAreaMergeGroups: 10,
            fundingSourceGroups: 1,
          },
          acceptedDecisionValidation: {
            artifactAvailable: true,
            totalDecisions: 0,
            validDecisionCount: 0,
            invalidDecisionCount: 0,
            unreviewedPlanCount: 29,
          },
          nextAction:
            'Review the same-PI dedupe decision template and validate accepted decisions before considering a bounded guarded apply.',
        },
      }),
    );

    const artifact = readDataQualityGateArtifact(
      artifactPath,
      new Date('2026-05-29T23:30:00.000Z'),
    );

    expect(artifact).toMatchObject({
      artifactStatus: 'loaded',
      artifactPath,
      generatedAt: '2026-05-29T22:30:00.000Z',
      promotionReady: false,
      promotionBlockerCount: 2,
      hardErrors: [
        {
          name: 'referenceIntegrity',
          count: 1,
          owner: 'data-quality operator',
          nextCommand:
            'SCRAPER_ENV=beta yarn --cwd server research-entity-members:audit-user-refs --limit=1000 --output /tmp/ylabs-member-user-ref-audit.json',
        },
      ],
      promotionBlockersByOwner: [
        {
          owner: 'data-quality operator',
          count: 2,
          blockerNames: ['duplicateEntityNames', 'researchEntityContentPageLeaks'],
        },
      ],
      duplicateNamePreflight: {
        sharedWebsiteClusterCount: 20,
        sharedWebsiteArtifactPath:
          '/tmp/ylabs-duplicate-entity-name-review-shared-website-plan.json',
        requiredReviewerDecisions: [
          'Confirm the shared website represents one research home.',
          'Select the canonical ResearchEntity before any apply path.',
          'Confirm guarded reference rewrite and archive behavior for active references.',
        ],
        manualReviewCategories: [
          {
            category: 'same_label_disambiguation',
            clusterCount: 6,
          },
        ],
        acceptedDecisionTemplate: {
          outputPath:
            '/tmp/ylabs-duplicate-entity-name-review-accepted-decisions-template.json',
          command:
            'SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --limit=10000 --plan-limit=20 --decision-template-output /tmp/ylabs-duplicate-entity-name-review-accepted-decisions-template.json --output /tmp/ylabs-duplicate-entity-name-review.json',
        },
        acceptedDecisionValidation: {
          inputPath: '/tmp/ylabs-duplicate-entity-name-review-accepted-decisions.json',
          outputPath: validationPath,
          expectedArtifactField: 'reviewDecisionValidation',
          command:
            'SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --limit=10000 --plan-limit=20 --accepted-decisions=/tmp/ylabs-duplicate-entity-name-review-accepted-decisions.json --output /tmp/ylabs-duplicate-entity-name-review-decision-validation.json',
          artifactAvailable: true,
          totalDecisions: 0,
          validDecisionCount: 0,
          invalidDecisionCount: 0,
          unreviewedPlanCount: 5,
        },
      },
      suspiciousUserEmailCopy: {
        count: 2,
        lane: 'Lane A accepted Beta copy',
        sampledExcludedByDefault: 2,
        sampledNeedsReviewBeforeCopy: 0,
        sampledCoverageComplete: true,
        nextAction:
          'Review any sampled users not covered by the Lane A copy filter before production copy.',
      },
      samePiDedupeReview: {
        applyBlocked: true,
        applyBlockedReason:
          'Accepted same-PI dedupe decisions are validation-only; apply mode cannot be combined with --accepted-decisions until decision-filtered apply exists.',
        artifactAvailable: true,
        reviewArtifactPath: '/tmp/ylabs-research-entity-dedupe.json',
        acceptedDecisionInputPath:
          '/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions.json',
        decisionTemplateOutputPath:
          '/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions-template.json',
        acceptedDecisionValidationOutputPath: '/tmp/ylabs-research-entity-dedupe.json',
        plannedGroups: 29,
        plannedDuplicateEntities: 29,
        reviewBreakdown: {
          crossDepartmentGroups: 29,
          highResearchAreaMergeGroups: 10,
          fundingSourceGroups: 1,
        },
        acceptedDecisionValidation: {
          artifactAvailable: true,
          totalDecisions: 0,
          validDecisionCount: 0,
          invalidDecisionCount: 0,
          unreviewedPlanCount: 29,
        },
      },
    });
    expect(deriveDataQualityGate(artifact)).toMatchObject({
      status: 'blocked',
      note: 'Data-quality gate has 1 hard error and 2 must-fix promotion blockers.',
      hardErrors: [
        {
          name: 'referenceIntegrity',
          count: 1,
          owner: 'data-quality operator',
          nextCommand:
            'SCRAPER_ENV=beta yarn --cwd server research-entity-members:audit-user-refs --limit=1000 --output /tmp/ylabs-member-user-ref-audit.json',
        },
      ],
      blockersByOwner: [
        {
          owner: 'data-quality operator',
          count: 2,
          blockerNames: ['duplicateEntityNames', 'researchEntityContentPageLeaks'],
        },
      ],
      duplicateNamePreflight: {
        sharedWebsiteClusterCount: 20,
        sharedWebsiteArtifactPath:
          '/tmp/ylabs-duplicate-entity-name-review-shared-website-plan.json',
        requiredReviewerDecisions: [
          'Confirm the shared website represents one research home.',
          'Select the canonical ResearchEntity before any apply path.',
          'Confirm guarded reference rewrite and archive behavior for active references.',
        ],
        manualReviewCategories: [
          {
            category: 'same_label_disambiguation',
            clusterCount: 6,
          },
        ],
        acceptedDecisionValidation: {
          outputPath: validationPath,
          artifactAvailable: true,
          totalDecisions: 0,
          validDecisionCount: 0,
          invalidDecisionCount: 0,
          unreviewedPlanCount: 5,
        },
      },
      suspiciousUserEmailCopy: {
        count: 2,
        lane: 'Lane A accepted Beta copy',
        sampledExcludedByDefault: 2,
        sampledNeedsReviewBeforeCopy: 0,
        sampledCoverageComplete: true,
      },
      samePiDedupeReview: {
        artifactAvailable: true,
        applyBlockedReason:
          'Accepted same-PI dedupe decisions are validation-only; apply mode cannot be combined with --accepted-decisions until decision-filtered apply exists.',
        plannedGroups: 29,
        plannedDuplicateEntities: 29,
        reviewBreakdown: {
          crossDepartmentGroups: 29,
          highResearchAreaMergeGroups: 10,
          fundingSourceGroups: 1,
        },
        acceptedDecisionValidation: {
          artifactAvailable: true,
          validDecisionCount: 0,
          invalidDecisionCount: 0,
          unreviewedPlanCount: 29,
        },
      },
    });
  });

  it('treats stale saved data-quality artifacts as manual gate work', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-operator-board-'));
    const artifactPath = path.join(dir, 'beta-quality.json');
    fs.writeFileSync(
      artifactPath,
      JSON.stringify({
        generatedAt: '2026-05-20T22:30:00.000Z',
        summary: {
          promotionReady: true,
          promotionBlockerCount: 0,
          promotionBlockersByOwner: [],
        },
      }),
    );

    const artifact = readDataQualityGateArtifact(
      artifactPath,
      new Date('2026-05-29T22:30:00.000Z'),
    );

    expect(artifact).toMatchObject({
      artifactStatus: 'stale',
      artifactPath,
      generatedAt: '2026-05-20T22:30:00.000Z',
      ageHours: 216,
    });
    expect(deriveDataQualityGate(artifact)).toMatchObject({
      status: 'manual',
      note: 'Saved data-quality artifact is stale; rerun the gate before promotion.',
    });
  });

  it('flags an artifact older than the tightened TTL as stale (honesty guard)', () => {
    expect(GATE_SCORECARD_MAX_AGE_HOURS).toBeLessThanOrEqual(6);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-operator-board-'));
    const artifactPath = path.join(dir, 'beta-quality.json');
    const generatedAt = '2026-06-07T00:00:00.000Z';
    fs.writeFileSync(
      artifactPath,
      JSON.stringify({
        generatedAt,
        summary: { promotionReady: true, promotionBlockerCount: 0, promotionBlockersByOwner: [] },
      }),
    );
    // One hour past the TTL: under the old 48h window this read "loaded"; the tightened TTL must
    // flag it stale so a status that has moved on cannot masquerade as the live verdict.
    const justStale = new Date(
      new Date(generatedAt).getTime() + (GATE_SCORECARD_MAX_AGE_HOURS + 1) * 60 * 60 * 1000,
    );
    expect(readDataQualityGateArtifact(artifactPath, justStale)).toMatchObject({
      artifactStatus: 'stale',
      ageHours: GATE_SCORECARD_MAX_AGE_HOURS + 1,
    });
  });

  it('reports per-gate artifact provenance and missing artifacts honestly', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-operator-board-'));
    const dqPath = path.join(dir, 'beta-quality.json');
    fs.writeFileSync(
      dqPath,
      JSON.stringify({ generatedAt: '2026-06-07T00:00:00.000Z', db: 'Beta', environment: 'beta' }),
    );
    const missingPath = path.join(dir, 'does-not-exist.json');
    const prevDq = process.env.BETA_DATA_QUALITY_SCORECARD_PATH;
    const prevCopy = process.env.PROMOTION_COPY_DRY_RUN_REPORT_PATH;
    process.env.BETA_DATA_QUALITY_SCORECARD_PATH = dqPath;
    process.env.PROMOTION_COPY_DRY_RUN_REPORT_PATH = missingPath;
    try {
      const freshness = buildGateArtifactFreshness(new Date('2026-06-07T00:30:00.000Z'));
      expect(freshness.find((f) => f.gate === 'dataQuality')).toMatchObject({
        status: 'fresh',
        generatedAt: '2026-06-07T00:00:00.000Z',
        db: 'Beta',
        environment: 'beta',
        ageMinutes: 30,
      });
      expect(freshness.find((f) => f.gate === 'productionCopy')).toMatchObject({
        status: 'missing',
        exists: false,
      });
    } finally {
      if (prevDq === undefined) delete process.env.BETA_DATA_QUALITY_SCORECARD_PATH;
      else process.env.BETA_DATA_QUALITY_SCORECARD_PATH = prevDq;
      if (prevCopy === undefined) delete process.env.PROMOTION_COPY_DRY_RUN_REPORT_PATH;
      else process.env.PROMOTION_COPY_DRY_RUN_REPORT_PATH = prevCopy;
    }
  });

  it('surfaces malformed saved data-quality artifacts as manual gate work', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-operator-board-'));
    const artifactPath = path.join(dir, 'beta-quality.json');
    fs.writeFileSync(artifactPath, JSON.stringify({ summary: { promotionReady: 'nope' } }));

    expect(deriveDataQualityGate(readDataQualityGateArtifact(artifactPath))).toMatchObject({
      status: 'manual',
      note: 'Saved data-quality artifact is not readable; rerun the gate before promotion.',
    });
  });

  it('does not echo malformed artifact contents in operator-board artifact errors', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-operator-board-'));
    const artifactPath = path.join(dir, 'beta-quality.json');
    fs.writeFileSync(artifactPath, 'mongodb://user:pass@example.invalid not json');

    const artifact = readDataQualityGateArtifact(artifactPath);

    expect(artifact).toMatchObject({
      artifactStatus: 'invalid',
      artifactPath,
      error: 'Saved artifact is not readable',
    });
    expect(JSON.stringify(artifact)).not.toContain('mongodb://user:pass@example.invalid');
  });

  it('normalizes saved Beta handoff commands to explicit Beta targets', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-operator-board-'));
    const dataQualityPath = path.join(dir, 'beta-quality.json');
    const scraperIntegrityPath = path.join(dir, 'scraper-integrity.json');
    const launchTrustPath = path.join(dir, 'launch-trust.json');

    fs.writeFileSync(
      dataQualityPath,
      JSON.stringify({
        generatedAt: '2026-05-29T22:30:00.000Z',
        recommendedCommands: {
          weeklyAudit:
            'yarn --cwd server beta:data-quality --include-samples --progress --output /tmp/ylabs-beta-quality.json',
          strictAudit:
            'SCRAPER_ENV=beta yarn --cwd server beta:data-quality --strict --include-samples --progress',
          retentionDryRun:
            'yarn --cwd server scrape prune-observations --source openalex --older-than-days 30 --keep-runs 3 --output /tmp/ylabs-openalex-prune-dry-run.json',
        },
        summary: {
          promotionReady: false,
          promotionBlockerCount: 1,
          errors: [
            {
              name: 'referenceIntegrity',
              count: 1,
              nextCommand:
                'yarn --cwd server research-entity-members:audit-user-refs --limit=1000 --output /tmp/ylabs-member-user-ref-audit.json',
            },
          ],
        },
        duplicateEntityNames: {
          planReview: {
            preflightGuidance: {
              acceptedDecisionTemplate: {
                command:
                  'yarn --cwd server research-entity:duplicate-name-review --limit=10000 --output /tmp/ylabs-duplicate-entity-name-review.json',
              },
            },
          },
        },
        samePiDedupeReview: {
          artifactAvailable: true,
          acceptedDecisionValidation: {},
          command:
            'yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --output /tmp/ylabs-research-entity-dedupe.json',
        },
      }),
    );
    fs.writeFileSync(
      scraperIntegrityPath,
      JSON.stringify({
        generatedAt: '2026-05-29T22:30:00.000Z',
        status: 'failure',
        failureNames: ['samePiSameNameResearchEntities'],
        warnings: [],
        recommendedCommands: [
          'yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --output /tmp/ylabs-research-entity-dedupe.json',
        ],
      }),
    );
    fs.writeFileSync(
      launchTrustPath,
      JSON.stringify({
        generatedAt: '2026-05-29T22:30:00.000Z',
        pass: false,
        counts: {
          held: 1,
          publicVisibilityViolations: 0,
        },
        repairLanes: [
          {
            command:
              'yarn --cwd server beta:repair-queue --collection=all --mode=dry-run --output /tmp/ylabs-beta-repair.json',
          },
        ],
      }),
    );

    const reviewTime = new Date('2026-05-29T23:30:00.000Z');

    expect(readDataQualityGateArtifact(dataQualityPath, reviewTime)).toMatchObject({
      recommendedCommands: [
        'SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --progress --output /tmp/ylabs-beta-quality.json',
        'SCRAPER_ENV=beta yarn --cwd server beta:data-quality --strict --include-samples --progress',
        'SCRAPER_ENV=beta yarn --cwd server scrape prune-observations --source openalex --older-than-days 30 --keep-runs 3 --output /tmp/ylabs-openalex-prune-dry-run.json',
      ],
      hardErrors: [
        {
          nextCommand:
            'SCRAPER_ENV=beta yarn --cwd server research-entity-members:audit-user-refs --limit=1000 --output /tmp/ylabs-member-user-ref-audit.json',
        },
      ],
      duplicateNamePreflight: {
        acceptedDecisionTemplate: {
          command:
            'SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --limit=10000 --output /tmp/ylabs-duplicate-entity-name-review.json',
        },
      },
      samePiDedupeReview: {
        command:
          'SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --output /tmp/ylabs-research-entity-dedupe.json',
      },
    });
    expect(
      deriveDataQualityGate(readDataQualityGateArtifact(dataQualityPath, reviewTime)),
    ).toMatchObject({
      recommendedCommands: [
        'SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --progress --output /tmp/ylabs-beta-quality.json',
        'SCRAPER_ENV=beta yarn --cwd server beta:data-quality --strict --include-samples --progress',
        'SCRAPER_ENV=beta yarn --cwd server scrape prune-observations --source openalex --older-than-days 30 --keep-runs 3 --output /tmp/ylabs-openalex-prune-dry-run.json',
      ],
    });
    expect(readScraperIntegrityGateArtifact(scraperIntegrityPath, reviewTime)).toMatchObject({
      recommendedCommands: [
        'SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --output /tmp/ylabs-research-entity-dedupe.json',
      ],
    });
    expect(readLaunchTrustGateArtifact(launchTrustPath, reviewTime)).toMatchObject({
      repairLaneCommands: [
        'SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=all --mode=dry-run --output /tmp/ylabs-beta-repair.json',
      ],
    });
  });

  it('loads a saved scraper integrity artifact for operator gate review', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-operator-board-'));
    const artifactPath = path.join(dir, 'scraper-integrity.json');
    fs.writeFileSync(
      artifactPath,
      JSON.stringify({
        generatedAt: '2026-05-29T22:30:00.000Z',
        status: 'pass',
        failureNames: [],
        warnings: [],
        recommendedCommands: [
          'yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --accepted-decisions=/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions.json --allow-empty-decisions --decision-template-output /tmp/ylabs-research-entity-pi-dedupe-accepted-decisions-template.json --output /tmp/ylabs-research-entity-dedupe.json',
        ],
      }),
    );

    const artifact = readScraperIntegrityGateArtifact(
      artifactPath,
      new Date('2026-05-29T23:30:00.000Z'),
    );

    expect(artifact).toMatchObject({
      artifactStatus: 'loaded',
      artifactPath,
      generatedAt: '2026-05-29T22:30:00.000Z',
      integrityStatus: 'pass',
      failureNames: [],
      warningCount: 0,
      recommendedCommands: [
        'SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --accepted-decisions=/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions.json --allow-empty-decisions --decision-template-output /tmp/ylabs-research-entity-pi-dedupe-accepted-decisions-template.json --output /tmp/ylabs-research-entity-dedupe.json',
      ],
    });
    expect(deriveScraperIntegrityGate(artifact)).toMatchObject({
      status: 'pass',
      note: 'Latest scraper integrity gate artifact passed with 0 warnings.',
      recommendedCommands: [
        'SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --accepted-decisions=/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions.json --allow-empty-decisions --decision-template-output /tmp/ylabs-research-entity-pi-dedupe-accepted-decisions-template.json --output /tmp/ylabs-research-entity-dedupe.json',
      ],
    });
  });

  it('loads a saved beta repair-queue dry-run artifact for operator gate review', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-operator-board-'));
    const artifactPath = path.join(dir, 'beta-repair-source-description.json');
    fs.writeFileSync(
      artifactPath,
      JSON.stringify({
        generatedAt: '2026-05-29T22:30:00.000Z',
        environment: 'beta',
        db: 'Beta',
        mode: 'dry-run',
        scanned: 500,
        repaired: 0,
        blocked: 500,
        blockedReasonCounts: [
          { reason: 'missing_action_evidence', count: 320 },
          { reason: 'missing_lead', count: 190 },
        ],
        options: {
          mode: 'dry-run',
          collection: 'all',
          stage: 'source_description',
          limit: 500,
        },
        attempts: [
          {
            applied: true,
            patchSummary: ['derived shortDescription from source-backed fullDescription'],
            repairSource: 'https://medicine.yale.edu/lab/example/',
          },
          {
            applied: false,
            patchSummary: [],
            repairSource: 'https://reporter.nih.gov/project-details/123',
          },
        ],
      }),
    );

    const artifact = readBetaRepairQueueGateArtifact(
      artifactPath,
      new Date('2026-05-30T01:30:00.000Z'),
    );

    expect(artifact).toMatchObject({
      artifactStatus: 'loaded',
      artifactPath,
      generatedAt: '2026-05-29T22:30:00.000Z',
      ageHours: 3,
      mode: 'dry-run',
      scanned: 500,
      repaired: 0,
      blocked: 500,
      blockedReasonCounts: [
        { reason: 'missing_action_evidence', count: 320 },
        { reason: 'missing_lead', count: 190 },
      ],
      options: {
        mode: 'dry-run',
        collection: 'all',
        stage: 'source_description',
        limit: 500,
      },
      patchSummaryCounts: [
        { summary: 'derived shortDescription from source-backed fullDescription', count: 1 },
      ],
      repairSourceHosts: [
        { host: 'medicine.yale.edu', count: 1 },
        { host: 'reporter.nih.gov', count: 1 },
      ],
    });
    expect(deriveRepairQueueGate(3, artifact)).toMatchObject({
      status: 'watch',
      note: 'Latest beta repair dry-run found 0 repairable rows and 500 blocked rows.',
      openCount: 3,
      scanned: 500,
      repairableCount: 0,
      blockedCount: 500,
      blockedReasonCounts: [
        { reason: 'missing_action_evidence', count: 320 },
        { reason: 'missing_lead', count: 190 },
      ],
      options: {
        mode: 'dry-run',
        collection: 'all',
        stage: 'source_description',
        limit: 500,
      },
      patchSummaryCounts: [
        { summary: 'derived shortDescription from source-backed fullDescription', count: 1 },
      ],
      repairSourceHosts: [
        { host: 'medicine.yale.edu', count: 1 },
        { host: 'reporter.nih.gov', count: 1 },
      ],
      artifactAgeHours: 3,
    });
  });

  it('treats stale scraper integrity artifacts as manual gate work', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-operator-board-'));
    const artifactPath = path.join(dir, 'scraper-integrity.json');
    fs.writeFileSync(
      artifactPath,
      JSON.stringify({
        generatedAt: '2026-05-20T22:30:00.000Z',
        status: 'pass',
        failureNames: [],
        warnings: [],
      }),
    );

    expect(
      deriveScraperIntegrityGate(
        readScraperIntegrityGateArtifact(artifactPath, new Date('2026-05-29T22:30:00.000Z')),
      ),
    ).toMatchObject({
      status: 'manual',
      note: 'Saved scraper integrity artifact is stale; rerun the gate before promotion.',
      artifactAgeHours: 216,
    });
  });

  it('loads a saved launch trust artifact for operator gate review', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-operator-board-'));
    const artifactPath = path.join(dir, 'launch-trust.json');
    const reviewExceptionPath = path.join(dir, 'launch-review-exceptions.json');
    fs.writeFileSync(
      artifactPath,
      JSON.stringify({
        generatedAt: '2026-05-29T22:30:00.000Z',
        pass: false,
        counts: {
          scanned: 100,
          launchEligible: 75,
          limitedButSafe: 10,
          held: 15,
          suppressed: 0,
          publicVisibilityViolations: 0,
        },
        repairLanes: [
          {
            stage: 'source_description',
            count: 15,
            command:
              'yarn --cwd server beta:repair-queue --collection=all --stage=source_description --mode=dry-run --retry-blocked --limit=500 --output /tmp/ylabs-beta-repair-source-description.json',
          },
        ],
      }),
    );
    fs.writeFileSync(
      reviewExceptionPath,
      JSON.stringify({
        generatedAt: '2026-05-29T22:32:00.000Z',
        mode: 'dry-run',
        applyBlocked: true,
        reviewExceptionCount: 92,
        planSummary: {
          plannedCount: 92,
          planTruncated: false,
        },
        reviewDecisionValidation: {
          totalDecisions: 0,
          validDecisionCount: 0,
          invalidDecisionCount: 0,
          unreviewedPlanCount: 92,
        },
      }),
    );

    const artifact = readLaunchTrustGateArtifact(
      artifactPath,
      new Date('2026-05-29T23:30:00.000Z'),
    );
    const reviewExceptionArtifact = readLaunchReviewExceptionsArtifact(
      reviewExceptionPath,
      new Date('2026-05-29T23:30:00.000Z'),
    );

    expect(artifact).toMatchObject({
      artifactStatus: 'loaded',
      artifactPath,
      generatedAt: '2026-05-29T22:30:00.000Z',
      pass: false,
      heldCount: 15,
      publicVisibilityViolations: 0,
      repairLaneCount: 1,
      repairLaneCommands: [
        'SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=all --stage=source_description --mode=dry-run --retry-blocked --limit=500 --output /tmp/ylabs-beta-repair-source-description.json',
      ],
    });
    expect(reviewExceptionArtifact).toMatchObject({
      artifactStatus: 'loaded',
      artifactPath: reviewExceptionPath,
      reviewExceptionCount: 92,
      plannedCount: 92,
      planTruncated: false,
      totalDecisions: 0,
      validDecisionCount: 0,
      invalidDecisionCount: 0,
      unreviewedPlanCount: 92,
    });
    expect(deriveLaunchTrustGate(artifact, reviewExceptionArtifact)).toMatchObject({
      status: 'blocked',
      note: 'Latest launch trust contract artifact has 15 held rows and 0 public visibility violations.',
      heldCount: 15,
      repairLaneCount: 1,
      repairLaneCommands: [
        'SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=all --stage=source_description --mode=dry-run --retry-blocked --limit=500 --output /tmp/ylabs-beta-repair-source-description.json',
      ],
      reviewExceptionDecisionValidation: {
        artifactAvailable: true,
        reviewExceptionCount: 92,
        plannedCount: 92,
        planTruncated: false,
        totalDecisions: 0,
        validDecisionCount: 0,
        invalidDecisionCount: 0,
        unreviewedPlanCount: 92,
      },
    });
  });

  it('loads a saved launch acquisition artifact for deterministic repair review', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-operator-board-'));
    const artifactPath = path.join(dir, 'launch-acquisition.json');
    fs.writeFileSync(
      artifactPath,
      JSON.stringify({
        mode: 'read-only',
        stages: ['pi_identity', 'action_evidence'],
        scanned: 75,
        bySource: {
          unattributed: { piIdentity: 56, actionEvidence: 10 },
        },
        piIdentity: {
          total: 65,
          groups: {
            missingOfficialProfileUrl: { count: 61, samples: [] },
            exactSingleUserMatch: { count: 0, samples: [] },
            ambiguousOrMismatchedUserMatch: { count: 21, samples: [] },
          },
        },
        actionEvidence: {
          total: 10,
          groups: {
            sourceObservationsWithoutUndergradAccess: { count: 4, samples: [] },
            untrustedExternalRouteEvidence: { count: 5, samples: [] },
            sourceBackedRouteNotLaunchMaterialized: { count: 0, samples: [] },
          },
        },
      }),
    );

    const artifact = readLaunchAcquisitionGateArtifact(artifactPath);

    expect(artifact).toMatchObject({
      artifactStatus: 'loaded',
      artifactPath,
      scanned: 75,
      piBlockers: 65,
      actionBlockers: 10,
      exactPiMatches: 0,
      sourceBackedRouteCandidates: 0,
      missingOfficialProfileUrl: 61,
      ambiguousOrMismatchedUserMatch: 21,
      sourceObservationsWithoutUndergradAccess: 4,
      untrustedExternalRouteEvidence: 5,
    });
    expect(deriveLaunchAcquisitionGate(artifact)).toMatchObject({
      status: 'blocked',
      note:
        'Launch acquisition report has no deterministic PI/action repair candidates; remaining rows need new source evidence, materializer logic, or manual disambiguation.',
      scanned: 75,
      piBlockers: 65,
      actionBlockers: 10,
      exactPiMatches: 0,
      sourceBackedRouteCandidates: 0,
    });
  });

  it('loads a saved Lane A promotion dry-run artifact without marking production ready', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-operator-board-'));
    const artifactPath = path.join(dir, 'lane-a-dry-run.json');
    fs.writeFileSync(
      artifactPath,
      JSON.stringify({
        mode: 'dry-run',
        datasetVersion: 'prod-promote-2026-05-31-lane-a-beta-copy',
        syntheticReferenceBlockersClear: true,
        applyBlockers: [],
        excludedSyntheticUsers: 2,
        collectionCategories: [
          {
            category: 'research-discovery',
            collectionCount: 10,
          },
        ],
      }),
    );

    const artifact = readPromotionCopyDryRunArtifact(
      artifactPath,
      new Date('2026-05-31T15:30:00.000Z'),
    );

    expect(artifact).toMatchObject({
      artifactStatus: 'loaded',
      artifactPath,
      datasetVersion: 'prod-promote-2026-05-31-lane-a-beta-copy',
      syntheticReferenceBlockersClear: true,
      applyBlockerCount: 0,
      excludedSyntheticUsers: 2,
      collectionCategoryCount: 1,
    });
    expect(derivePromotionCopyGate(artifact)).toMatchObject({
      status: 'review_required',
      note:
        'Latest Lane A dry-run artifact has no apply blockers; operator review, restore point, rollback test, and smoke gates are still required.',
      excludedSyntheticUsers: 2,
      collectionCategoryCount: 1,
    });
  });

  it('blocks Lane A promotion copy review when the saved dry-run has apply blockers', () => {
    expect(
      derivePromotionCopyGate({
        artifactStatus: 'loaded',
        artifactPath: '/tmp/ylabs-lane-a-promotion-dry-run.json',
        datasetVersion: 'prod-promote-2026-05-31-lane-a-beta-copy',
        syntheticReferenceBlockersClear: false,
        applyBlockerCount: 1,
        excludedSyntheticUsers: 2,
        collectionCategoryCount: 3,
      }),
    ).toMatchObject({
      status: 'blocked',
      note: 'Latest Lane A dry-run artifact has 1 apply blocker.',
      applyBlockerCount: 1,
    });
  });
});
