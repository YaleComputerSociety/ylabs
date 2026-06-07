import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AdminOperatorBoard from '../AdminOperatorBoard';
import axios from '../../../utils/axios';

vi.mock('../../../utils/axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AdminOperatorBoard', () => {
  it('keeps repair queues ahead of evidence signals without changing the board layout', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        generatedAt: '2026-05-25T15:00:00.000Z',
        recommendedNextActions: [
          'Resolve 2 data-quality promotion blockers before production promotion.',
          'Run scraper integrity and data-quality gates before any production promotion.',
        ],
        trustTiers: {
          research: [
            { tier: 'student_ready', count: 4 },
            { tier: 'limited_but_safe', count: 3 },
            { tier: 'operator_review', count: 2 },
            { tier: 'suppressed', count: 1 },
          ],
          programs: [
            { tier: 'student_ready', count: 2 },
            { tier: 'limited_but_safe', count: 1 },
            { tier: 'operator_review', count: 0 },
            { tier: 'suppressed', count: 1 },
          ],
        },
        reasonCounts: {
          research: [],
          programs: [],
        },
        releaseQueue: {
          openCount: 2,
          statusCounts: { open: 2, resolved: 4 },
          topBlockers: [{ reason: 'missing_description', count: 2 }],
          sourcePressure: [{ sourceName: 'ysm-atoz-index', count: 2 }],
          samples: [
            {
              id: 'queue-sample',
              collection: 'research',
              recordId: 'entity-held',
              label: 'Queued Lab',
              blockerReasons: ['missing_description'],
              evidenceSignals: ['concrete_next_step'],
              sourceNames: ['ysm-atoz-index'],
              nextRepairAction: 'Backfill a source-backed research description.',
            },
          ],
        },
        repairQueue: {
          openCount: 2,
          statusCounts: { queued: 1, repaired: 1 },
          byStage: [
            {
              stage: 'source_description',
              status: 'queued',
              count: 1,
              nextAction: 'Backfill source-backed description fields.',
            },
            {
              stage: 'pi_identity',
              status: 'blocked',
              count: 1,
              nextAction: 'Resolve PI identity.',
            },
          ],
          samples: [
            {
              id: 'repair-sample',
              collection: 'research',
              recordId: 'entity-repair',
              label: 'Auto Repair Lab',
              repairStage: 'source_description',
              repairStatus: 'queued',
              safeToAttempt: true,
              blockerReasons: ['missing_description'],
              sourceNames: ['ysm-atoz-index'],
              nextRepairAction: 'Backfill source-backed description fields.',
              attemptCount: 0,
              appliedPatchSummary: [],
              remainingBlockers: ['missing_description'],
            },
          ],
        },
        queues: [
          {
            collection: 'research',
            reason: 'source_backed_description',
            kind: 'evidence',
            count: 25,
            nextAction: 'Review for possible promotion.',
            samples: [
              {
                id: 'sample-evidence',
                label: 'Source Backed Lab',
                tier: 'limited_but_safe',
                reasons: ['source_backed_description', 'missing_action_evidence'],
              },
            ],
          },
          {
            collection: 'research',
            reason: 'missing_action_evidence',
            kind: 'blocking',
            count: 5,
            nextAction: 'Add source-backed action evidence.',
            samples: [
              {
                id: 'sample-blocker',
                label: 'Repair Candidate Lab',
                tier: 'operator_review',
                reasons: ['missing_action_evidence', 'source_backed_description'],
              },
            ],
          },
        ],
        gates: {
          repairQueue: {
            status: 'watch',
            command: 'yarn --cwd server beta:repair-queue --mode=apply --collection=all',
            note: 'Latest beta repair dry-run found 0 repairable rows and 500 blocked rows.',
            openCount: 2,
            scanned: 500,
            repairableCount: 0,
            blockedCount: 500,
            blockedReasonCounts: [
              { reason: 'missing_action_evidence', count: 320 },
              { reason: 'missing_lead', count: 190 },
            ],
          },
          dataQuality: {
            status: 'blocked',
            command: 'yarn --cwd server beta:data-quality --include-samples',
            note: 'Data-quality gate has 1 hard error and 3 must-fix promotion blockers.',
            recommendedCommands: [
              'SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --progress --output /tmp/ylabs-beta-quality.json',
            ],
            hardErrors: [
              {
                name: 'referenceIntegrity',
                count: 1,
                owner: 'data-quality operator',
                nextCommand:
                  'yarn --cwd server research-entity-members:audit-user-refs --limit=1000 --output /tmp/ylabs-member-user-ref-audit.json',
              },
            ],
            blockersByOwner: [
              {
                owner: 'data-quality operator',
                count: 2,
                blockerNames: ['duplicateEntityNames', 'researchEntityContentPageLeaks'],
              },
              {
                owner: 'identity/account operator',
                count: 1,
                blockerNames: ['suspiciousUserEmails'],
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
                  'yarn --cwd server research-entity:duplicate-name-review --limit=10000 --plan-limit=20 --decision-template-output /tmp/ylabs-duplicate-entity-name-review-accepted-decisions-template.json --output /tmp/ylabs-duplicate-entity-name-review.json',
              },
              acceptedDecisionValidation: {
                inputPath: '/tmp/ylabs-duplicate-entity-name-review-accepted-decisions.json',
                outputPath:
                  '/tmp/ylabs-duplicate-entity-name-review-decision-validation.json',
                expectedArtifactField: 'reviewDecisionValidation',
                command:
                  'yarn --cwd server research-entity:duplicate-name-review --limit=10000 --plan-limit=20 --accepted-decisions=/tmp/ylabs-duplicate-entity-name-review-accepted-decisions.json --output /tmp/ylabs-duplicate-entity-name-review-decision-validation.json',
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
          },
          scraperIntegrity: {
            status: 'pass',
            command: 'yarn --cwd server scraper:integrity-gate --include-samples',
            note: 'Latest scraper integrity gate artifact passed with 2 warnings.',
            warningCount: 2,
            failureNames: [],
            recommendedCommands: [
              'yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --accepted-decisions=/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions.json --allow-empty-decisions --decision-template-output /tmp/ylabs-research-entity-pi-dedupe-accepted-decisions-template.json --output /tmp/ylabs-research-entity-dedupe.json',
            ],
          },
          launchTrust: {
            status: 'blocked',
            command:
              'yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --strict',
            note: 'Latest launch trust contract artifact has 15 held rows and 0 public visibility violations.',
            heldCount: 15,
            publicVisibilityViolations: 0,
            repairLaneCount: 1,
            repairLaneCommands: [
              'yarn --cwd server beta:repair-queue --collection=all --stage=source_description --mode=dry-run --retry-blocked --limit=500 --output /tmp/ylabs-beta-repair-source-description.json',
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
          },
          launchAcquisition: {
            status: 'blocked',
            command:
              'SCRAPER_ENV=beta yarn --cwd server launch:acquisition-report --stage=all --limit=250 --sample-limit=10 --output /tmp/ylabs-launch-acquisition-report.json',
            note:
              'Launch acquisition report has no deterministic PI/action repair candidates; remaining rows need new source evidence, materializer logic, or manual disambiguation.',
            scanned: 75,
            piBlockers: 65,
            actionBlockers: 10,
            exactPiMatches: 0,
            sourceBackedRouteCandidates: 0,
            missingOfficialProfileUrl: 61,
            ambiguousOrMismatchedUserMatch: 21,
            sourceObservationsWithoutUndergradAccess: 4,
            untrustedExternalRouteEvidence: 5,
          },
          productionCopy: {
            status: 'review_required',
            command:
              'yarn --cwd server production:promote-beta-copy --output /tmp/ylabs-lane-a-promotion-dry-run.json',
            note:
              'Latest Lane A dry-run artifact has no apply blockers; operator review, restore point, rollback test, and smoke gates are still required.',
            excludedSyntheticUsers: 2,
            collectionCategoryCount: 3,
          },
        },
        sourceFreshness: {
          windowDays: 30,
          riskCounts: { ok: 1, warn: 7, error: 0 },
          reviewSummary: {
            warningRows: 7,
            materializationConflictRows: 6,
            reportArtifacts: {
              available: 6,
              missing: 0,
              withConflictReview: 6,
            },
            activeObservationConflictCount: 445,
            actionableConflictCount: 313,
            sameSourceConflictCount: 206,
            crossSourceConflictCount: 107,
            priorityReviewConflictCount: 226,
            contextReviewConflictCount: 87,
            metadataReviewConflictCount: 132,
            categoryCounts: [
              { category: 'additive_metadata', count: 132 },
              { category: 'identity_or_routing', count: 129 },
            ],
            reviewQueues: [
              {
                queue: 'priority_review',
                label: 'Identity, access, or student-facing content',
                count: 226,
                categories: [
                  { category: 'identity_or_routing', count: 129 },
                  { category: 'content', count: 60 },
                  { category: 'access_evidence', count: 37 },
                ],
              },
              {
                queue: 'context_review',
                label: 'Funding or uncategorized context',
                count: 87,
                categories: [
                  { category: 'funding_context', count: 47 },
                  { category: 'other', count: 40 },
                ],
              },
              {
                queue: 'metadata_review',
                label: 'Additive metadata merge review',
                count: 132,
                categories: [{ category: 'additive_metadata', count: 132 }],
              },
            ],
            reviewArtifactRollups: {
              staleObservationReview: {
                fieldCounts: [
                  { field: 'userType', count: 149 },
                  { field: 'name', count: 86 },
                ],
                policyBucketCounts: [
                  { policyBucket: 'stale_identity_or_routing_review', count: 494 },
                  { policyBucket: 'stale_funding_context_review', count: 47 },
                ],
              },
              crossSourceObservationReview: {
                fieldCounts: [
                  { field: 'fullDescription', count: 12 },
                  { field: 'shortDescription', count: 11 },
                ],
                policyBucketCounts: [
                  { policyBucket: 'description_policy_review', count: 23 },
                  { policyBucket: 'routing_or_entity_type_review', count: 18 },
                ],
              },
            },
            reviewDecisionValidationStatus: {
              staleObservationReview: {
                total: 6,
                available: 0,
                missing: 6,
                invalidDecisionCount: 0,
                unreviewedPlanCount: 0,
                missingCommands: [
                  {
                    sourceName: 'department-undergrad-research',
                    command:
                      'SCRAPER_ENV=beta yarn --cwd server observations:stale-conflict-review --source=department-undergrad-research --queue=priority_review --limit=1000 --sample-size=20 --accepted-decisions=/tmp/ylabs-stale-observation-conflicts-department-undergrad-research-priority_review-accepted-decisions.json --allow-empty-decisions --output /tmp/ylabs-stale-observation-conflicts-department-undergrad-research-priority_review-decision-validation.json',
                  },
                ],
              },
              crossSourceObservationReview: {
                total: 2,
                available: 1,
                missing: 1,
                invalidDecisionCount: 0,
                unreviewedPlanCount: 3,
                missingCommands: [
                  {
                    sourceName: 'ysm-atoz-index',
                    command:
                      'SCRAPER_ENV=beta yarn --cwd server observations:cross-source-conflict-review --source=ysm-atoz-index --queue=priority_review --limit=1000 --sample-size=20 --accepted-decisions=/tmp/ylabs-cross-source-observation-conflicts-ysm-atoz-index-priority_review-accepted-decisions.json --allow-empty-decisions --output /tmp/ylabs-cross-source-observation-conflicts-ysm-atoz-index-priority_review-decision-validation.json',
                  },
                ],
              },
            },
            rows: [
              {
                sourceName: 'department-undergrad-research',
                staleObservationReview: {
                  acceptedDecisionTemplate: {
                    outputPath:
                      '/tmp/ylabs-stale-observation-conflicts-department-undergrad-research-priority_review-accepted-decisions-template.json',
                  },
                  acceptedDecisionValidation: {
                    outputPath:
                      '/tmp/ylabs-stale-observation-conflicts-department-undergrad-research-priority_review-decision-validation.json',
                    artifactAvailable: false,
                  },
                },
                crossSourceObservationReview: {
                  acceptedDecisionTemplate: {
                    outputPath:
                      '/tmp/ylabs-cross-source-observation-conflicts-department-undergrad-research-priority_review-accepted-decisions-template.json',
                  },
                  acceptedDecisionValidation: {
                    outputPath:
                      '/tmp/ylabs-cross-source-observation-conflicts-department-undergrad-research-priority_review-decision-validation.json',
                    artifactAvailable: true,
                    totalDecisions: 0,
                    validDecisionCount: 0,
                    invalidDecisionCount: 0,
                    unreviewedPlanCount: 3,
                  },
                },
              },
            ],
          },
          rows: [],
        },
      },
    });

    render(<AdminOperatorBoard />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Data Quality Operator Board' })).toBeTruthy();
    });

    expect(screen.getByText('Recommended Next Actions')).toBeTruthy();
    expect(
      screen.getByText('Resolve 2 data-quality promotion blockers before production promotion.'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Run scraper integrity and data-quality gates before any production promotion.',
      ),
    ).toBeTruthy();

    const repairBadge = screen.getByText('Repair queue');
    const evidenceBadge = screen.getByText('Evidence signal');
    expect(repairBadge.compareDocumentPosition(evidenceBadge)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByText('Likely blockers')).toBeTruthy();
    expect(screen.getByText('Evidence signals')).toBeTruthy();
    expect(screen.getByText('Repair Candidate Lab')).toBeTruthy();
    expect(screen.getByText('Source Backed Lab')).toBeTruthy();
    expect(screen.getByText('Release Queue')).toBeTruthy();
    expect(screen.getByText('Automatic Repair Queue')).toBeTruthy();
    expect(screen.getByText('Auto Repair Lab')).toBeTruthy();
    expect(screen.getAllByText('Source & description').length).toBeGreaterThan(0);
    expect(screen.getByText('Queued Lab')).toBeTruthy();
    expect(screen.getByText('ysm-atoz-index')).toBeTruthy();
    expect(screen.getByText('Data quality status: blocked')).toBeTruthy();
    expect(screen.getByText('Automatic repair status: watch')).toBeTruthy();
    expect(
      screen.getByText('Latest beta repair dry-run found 0 repairable rows and 500 blocked rows.'),
    ).toBeTruthy();
    expect(screen.getByText('Open queue items: 2')).toBeTruthy();
    expect(screen.getByText('Scanned: 500')).toBeTruthy();
    expect(screen.getByText('Repairable: 0')).toBeTruthy();
    expect(screen.getByText('Blocked: 500')).toBeTruthy();
    expect(
      screen.getByText('Blocked reasons: missing_action_evidence 320 · missing_lead 190'),
    ).toBeTruthy();
    expect(
      screen.getByText('Data-quality gate has 1 hard error and 3 must-fix promotion blockers.'),
    ).toBeTruthy();
    expect(screen.getByText('referenceIntegrity')).toBeTruthy();
    expect(
      screen.getByText(
        'yarn --cwd server research-entity-members:audit-user-refs --limit=1000 --output /tmp/ylabs-member-user-ref-audit.json',
      ),
    ).toBeTruthy();
    expect(screen.getAllByText('data-quality operator').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('2 blockers')).toBeTruthy();
    expect(screen.getByText('duplicateEntityNames, researchEntityContentPageLeaks')).toBeTruthy();
    expect(screen.getByText('Duplicate-name preflight')).toBeTruthy();
    expect(screen.getByText('Shared-website clusters: 20')).toBeTruthy();
    expect(
      screen.getByText('/tmp/ylabs-duplicate-entity-name-review-shared-website-plan.json'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Confirm the shared website represents one research home. Select the canonical ResearchEntity before any apply path. Confirm guarded reference rewrite and archive behavior for active references.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Manual review: same_label_disambiguation 6')).toBeTruthy();
    expect(screen.getByText('Duplicate-name decision template')).toBeTruthy();
    expect(
      screen.getByText(
        '/tmp/ylabs-duplicate-entity-name-review-accepted-decisions-template.json',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Duplicate-name decision validation')).toBeTruthy();
    expect(
      screen.getByText(
        '/tmp/ylabs-duplicate-entity-name-review-decision-validation.json',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'yarn --cwd server research-entity:duplicate-name-review --limit=10000 --plan-limit=20 --accepted-decisions=/tmp/ylabs-duplicate-entity-name-review-accepted-decisions.json --output /tmp/ylabs-duplicate-entity-name-review-decision-validation.json',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('Duplicate-name validation: loaded · 0 valid · 0 invalid · 5 unreviewed'),
    ).toBeTruthy();
    expect(screen.getByText('Suspicious users: 2 · 2 excluded by Lane A · 0 need review')).toBeTruthy();
    expect(screen.getByText('Lane A sample coverage: complete')).toBeTruthy();
    expect(
      screen.getByText(
        'Review any sampled users not covered by the Lane A copy filter before production copy.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Same-PI dedupe review')).toBeTruthy();
    expect(
      screen.getByText(
        'Accepted same-PI dedupe decisions are validation-only; apply mode cannot be combined with --accepted-decisions until decision-filtered apply exists.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Same-PI plans: 29 groups · 29 duplicate entities')).toBeTruthy();
    expect(
      screen.getByText('Review flags: 29 cross-department · 10 high research-area merges · 1 funding-source'),
    ).toBeTruthy();
    expect(screen.getByText('/tmp/ylabs-research-entity-dedupe.json')).toBeTruthy();
    expect(
      screen.getByText(
        '/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions-template.json',
      ),
    ).toBeTruthy();
    expect(
      screen.getAllByText(
        'yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --accepted-decisions=/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions.json --allow-empty-decisions --decision-template-output /tmp/ylabs-research-entity-pi-dedupe-accepted-decisions-template.json --output /tmp/ylabs-research-entity-dedupe.json',
      ),
    ).toHaveLength(2);
    expect(
      screen.getByText('Same-PI validation: loaded · 0 valid · 0 invalid · 29 unreviewed'),
    ).toBeTruthy();
    expect(screen.getByText('Scraper integrity status: pass')).toBeTruthy();
    expect(screen.getByText('Latest scraper integrity gate artifact passed with 2 warnings.')).toBeTruthy();
    expect(screen.getByText('Warnings: 2')).toBeTruthy();
    expect(screen.getByText('Data quality recommendation')).toBeTruthy();
    expect(
      screen.getByText(
        'SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --progress --output /tmp/ylabs-beta-quality.json',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Scraper integrity recommendation')).toBeTruthy();
    expect(
      screen.getByText(
        'Source review: 6/6 report artifacts available · 313 actionable conflicts',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Priority review 226 · Context review 87 · Metadata review 132',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('Conflict scope: 206 single-source · 107 cross-source'),
    ).toBeTruthy();
    expect(screen.getByText('Stale fields: userType 149 · name 86')).toBeTruthy();
    expect(
      screen.getByText(
        'Stale policies: stale_identity_or_routing_review 494 · stale_funding_context_review 47',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('Cross-source fields: fullDescription 12 · shortDescription 11'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Cross-source policies: description_policy_review 23 · routing_or_entity_type_review 18',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('Stale validation: 0/6 loaded · 6 missing · 0 invalid · 0 unreviewed'),
    ).toBeTruthy();
    expect(
      screen.getByText('Cross-source validation: 1/2 loaded · 1 missing · 0 invalid · 3 unreviewed'),
    ).toBeTruthy();
    expect(screen.getByText('Next stale validation probe: department-undergrad-research')).toBeTruthy();
    expect(
      screen.getByText(
        'SCRAPER_ENV=beta yarn --cwd server observations:stale-conflict-review --source=department-undergrad-research --queue=priority_review --limit=1000 --sample-size=20 --accepted-decisions=/tmp/ylabs-stale-observation-conflicts-department-undergrad-research-priority_review-accepted-decisions.json --allow-empty-decisions --output /tmp/ylabs-stale-observation-conflicts-department-undergrad-research-priority_review-decision-validation.json',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Next cross-source validation probe: ysm-atoz-index')).toBeTruthy();
    expect(
      screen.getByText(
        'SCRAPER_ENV=beta yarn --cwd server observations:cross-source-conflict-review --source=ysm-atoz-index --queue=priority_review --limit=1000 --sample-size=20 --accepted-decisions=/tmp/ylabs-cross-source-observation-conflicts-ysm-atoz-index-priority_review-accepted-decisions.json --allow-empty-decisions --output /tmp/ylabs-cross-source-observation-conflicts-ysm-atoz-index-priority_review-decision-validation.json',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Stale decision handoff: department-undergrad-research')).toBeTruthy();
    expect(
      screen.getByText(
        '/tmp/ylabs-stale-observation-conflicts-department-undergrad-research-priority_review-accepted-decisions-template.json',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        '/tmp/ylabs-stale-observation-conflicts-department-undergrad-research-priority_review-decision-validation.json',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Validation artifact: missing')).toBeTruthy();
    expect(
      screen.getByText('Cross-source decision handoff: department-undergrad-research'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        '/tmp/ylabs-cross-source-observation-conflicts-department-undergrad-research-priority_review-accepted-decisions-template.json',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        '/tmp/ylabs-cross-source-observation-conflicts-department-undergrad-research-priority_review-decision-validation.json',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('Validation artifact: loaded · 0 valid · 0 invalid · 3 unreviewed'),
    ).toBeTruthy();
    expect(screen.getByText('additive_metadata 132 · identity_or_routing 129')).toBeTruthy();
    expect(screen.getByText('Launch trust status: blocked')).toBeTruthy();
    expect(
      screen.getByText(
        'Latest launch trust contract artifact has 15 held rows and 0 public visibility violations.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Held rows: 15')).toBeTruthy();
    expect(screen.getByText('Launch trust recommendation')).toBeTruthy();
    expect(
      screen.getByText(
        'yarn --cwd server beta:repair-queue --collection=all --stage=source_description --mode=dry-run --retry-blocked --limit=500 --output /tmp/ylabs-beta-repair-source-description.json',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Launch review exceptions')).toBeTruthy();
    expect(screen.getByText('Review exceptions: 92')).toBeTruthy();
    expect(screen.getByText('Unreviewed decisions: 92')).toBeTruthy();
    expect(screen.getByText('Valid decisions: 0')).toBeTruthy();
    expect(screen.getByText('Invalid decisions: 0')).toBeTruthy();
    expect(screen.getByText('Launch acquisition status: blocked')).toBeTruthy();
    expect(
      screen.getByText(
        'Launch acquisition report has no deterministic PI/action repair candidates; remaining rows need new source evidence, materializer logic, or manual disambiguation.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Scanned blockers: 75')).toBeTruthy();
    expect(screen.getByText('PI blockers: 65')).toBeTruthy();
    expect(screen.getByText('Action blockers: 10')).toBeTruthy();
    expect(screen.getByText('Exact PI matches: 0')).toBeTruthy();
    expect(screen.getByText('Route candidates: 0')).toBeTruthy();
    expect(screen.getByText('Missing official profile URLs: 61')).toBeTruthy();
    expect(screen.getByText('Ambiguous/mismatched user cases: 21')).toBeTruthy();
    expect(screen.getByText('Production copy status: review_required')).toBeTruthy();
    expect(
      screen.getByText(
        'Latest Lane A dry-run artifact has no apply blockers; operator review, restore point, rollback test, and smoke gates are still required.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Excluded synthetic users: 2')).toBeTruthy();
    expect(screen.getByText('Collection categories: 3')).toBeTruthy();
  });

  it('shows stale saved data-quality gates as manual work', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        generatedAt: '2026-05-29T22:30:00.000Z',
        trustTiers: {
          research: [],
          programs: [],
        },
        reasonCounts: {
          research: [],
          programs: [],
        },
        queues: [],
        gates: {
          dataQuality: {
            status: 'manual',
            command: 'yarn --cwd server beta:data-quality --include-samples',
            note: 'Saved data-quality artifact is stale; rerun the gate before promotion.',
            artifactAgeHours: 216,
          },
          scraperIntegrity: {
            status: 'unknown',
            command: 'yarn --cwd server scraper:integrity-gate --include-samples',
            latestRuns: [],
          },
        },
        sourceFreshness: {
          windowDays: 30,
          riskCounts: { ok: 0, warn: 0, error: 0 },
          rows: [],
        },
      },
    });

    render(<AdminOperatorBoard />);

    await waitFor(() => {
      expect(screen.getByText('Data quality status: manual')).toBeTruthy();
    });
    expect(
      screen.getByText('Saved data-quality artifact is stale; rerun the gate before promotion.'),
    ).toBeTruthy();
    expect(screen.getByText('Artifact age: 216 hours')).toBeTruthy();
  });
});
