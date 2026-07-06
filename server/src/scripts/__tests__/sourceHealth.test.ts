import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildSourceHealthOutput,
  buildSourceHealthReviewSummary,
  parseSourceHealthArgs,
  resolveSourceHealthRowsWithReviewArtifacts,
  writeSourceHealthOutput,
} from '../sourceHealth';

describe('sourceHealth CLI helpers', () => {
  it('parses window strict disabled-source and output flags', () => {
    expect(
      parseSourceHealthArgs([
        '--days=14',
        '--include-disabled',
        '--strict',
        '--output',
        '/tmp/ylabs-source-health.json',
      ]),
    ).toEqual({
      days: 14,
      includeDisabled: true,
      strict: true,
      output: '/tmp/ylabs-source-health.json',
    });
    expect(() => parseSourceHealthArgs(['prod'])).toThrow(
      /Unknown source health argument: prod/,
    );
    expect(() => parseSourceHealthArgs(['--days=bad'])).toThrow(
      /--days requires a positive integer/,
    );
    expect(() => parseSourceHealthArgs(['--days=9007199254740992'])).toThrow(
      /--days requires a positive integer/,
    );
    expect(() => parseSourceHealthArgs(['--output', '--strict'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseSourceHealthArgs(['--output=--strict'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseSourceHealthArgs(['--output=/var/tmp/source-health.json'])).toThrow(
      /--output must write under/,
    );
    expect(() => parseSourceHealthArgs(['--output=/tmp/source-health.txt'])).toThrow(
      /--output must point to a \.json report file/,
    );
  });

  it('writes the source health artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-source-health-'));
    const output = path.join(dir, 'source-health.json');
    writeSourceHealthOutput(
      {
        generatedAt: '2026-05-29T23:30:00.000Z',
        windowDays: 30,
        sources: 2,
        riskCounts: { ok: 1, warn: 1, error: 0 },
        rows: [],
      },
      output,
    );

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      windowDays: 30,
      sources: 2,
      riskCounts: { ok: 1, warn: 1, error: 0 },
    });
    expect(() =>
      writeSourceHealthOutput({ generatedAt: '2026-05-29T23:30:00.000Z' }, '/var/tmp/source-health.json'),
    ).toThrow(/--output must write under/);
  });

  it('wraps source-health artifacts with target metadata and parsed options', () => {
    const output = buildSourceHealthOutput(
      {
        generatedAt: '2026-05-29T23:30:00.000Z',
        windowDays: 30,
        sources: 2,
        riskCounts: { ok: 1, warn: 1, error: 0 },
        rows: [],
      },
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          days: 30,
          includeDisabled: false,
          strict: false,
          output: '/tmp/ylabs-source-health.json',
        },
      },
    );

    expect(output).toEqual({
      generatedAt: '2026-05-29T23:30:00.000Z',
      windowDays: 30,
      sources: 2,
      riskCounts: { ok: 1, warn: 1, error: 0 },
      rows: [],
      environment: 'beta',
      db: 'Beta',
      options: {
        days: 30,
        includeDisabled: false,
        strict: false,
        output: '/tmp/ylabs-source-health.json',
      },
    });
  });

  it('marks materialization conflict warning rows resolved when the saved report has no active conflicts', () => {
    const rows = resolveSourceHealthRowsWithReviewArtifacts(
      [
        {
          sourceName: 'centers-institutes-index',
          displayName: 'Centers and institutes',
          enabled: true,
          coverageKnown: true,
          expectedArtifactTypes: ['ResearchEntity'],
          recentRuns: { total: 1, success: 1, partial: 0, failure: 0, running: 0 },
          latestRun: {
            id: 'run-1',
            status: 'success',
            observationCount: 10,
            materializationErrors: 0,
            materializationConflicts: 4,
          },
          risk: 'warn',
          action: 'Inspect partial run or materialization conflicts.',
          nextCommand: 'SCRAPER_ENV=beta yarn --cwd server scrape report --run run-1',
          reviewArtifact: {
            required: true,
            reason: 'materialization_conflicts',
            command: 'SCRAPER_ENV=beta yarn --cwd server scrape report --run run-1',
            outputPath: '/tmp/report-1.json',
            materializationConflicts: 4,
            materializationErrors: 0,
          },
        },
      ],
      (reportPath) =>
        reportPath === '/tmp/report-1.json'
          ? {
              quality: {
                materializationConflictReview: {
                  available: true,
                  activeObservationConflictCount: 0,
                  actionableConflictCount: 0,
                  sameSourceConflictCount: 0,
                  crossSourceConflictCount: 0,
                },
              },
            }
          : undefined,
    );

    expect(rows[0]).toMatchObject({
      risk: 'ok',
      action: expect.stringMatching(/historical conflict counter is resolved/i),
    });
    expect(rows[0].nextCommand).toBeUndefined();
    expect(rows[0].reviewArtifact).toBeUndefined();
  });

  it('keeps materialization conflict warning rows when saved reports still have active conflicts', () => {
    const rows = resolveSourceHealthRowsWithReviewArtifacts(
      [
        {
          sourceName: 'department-undergrad-research',
          displayName: 'Department undergraduate research',
          enabled: true,
          coverageKnown: true,
          expectedArtifactTypes: ['ResearchEntity'],
          recentRuns: { total: 1, success: 1, partial: 0, failure: 0, running: 0 },
          risk: 'warn',
          action: 'Inspect partial run or materialization conflicts.',
          reviewArtifact: {
            required: true,
            reason: 'materialization_conflicts',
            command: 'SCRAPER_ENV=beta yarn --cwd server scrape report --run run-2',
            outputPath: '/tmp/report-2.json',
            materializationConflicts: 3,
            materializationErrors: 0,
          },
        },
      ],
      (reportPath) =>
        reportPath === '/tmp/report-2.json'
          ? {
              quality: {
                materializationConflictReview: {
                  available: true,
                  activeObservationConflictCount: 1,
                },
              },
            }
          : undefined,
    );

    expect(rows[0]).toMatchObject({
      risk: 'warn',
      reviewArtifact: {
        reason: 'materialization_conflicts',
        outputPath: '/tmp/report-2.json',
      },
    });
  });

  it('marks active materialization conflicts resolved only when every active review queue has clean validation', () => {
    const rows = resolveSourceHealthRowsWithReviewArtifacts(
      [
        {
          sourceName: 'ysm-atoz-index',
          displayName: 'YSM A-Z',
          enabled: true,
          coverageKnown: true,
          expectedArtifactTypes: ['ResearchEntity'],
          recentRuns: { total: 1, success: 1, partial: 0, failure: 0, running: 0 },
          risk: 'warn',
          action: 'Inspect partial run or materialization conflicts.',
          reviewArtifact: {
            required: true,
            reason: 'materialization_conflicts',
            command: 'SCRAPER_ENV=beta yarn --cwd server scrape report --run run-ysm',
            outputPath: '/tmp/ysm-report.json',
            materializationConflicts: 6,
            materializationErrors: 0,
          },
        },
      ],
      (reportPath) => {
        if (reportPath === '/tmp/ysm-report.json') {
          return {
            quality: {
              materializationConflictReview: {
                available: true,
                activeObservationConflictCount: 3,
                sameSourceConflictCount: 1,
                crossSourceConflictCount: 2,
                categoryCounts: [
                  { category: 'identity_or_routing', count: 2 },
                  { category: 'additive_metadata', count: 1 },
                ],
              },
            },
          };
        }
        if (
          reportPath ===
            '/tmp/ylabs-stale-observation-conflicts-ysm-atoz-index-priority_review.json' ||
          reportPath ===
            '/tmp/ylabs-stale-observation-conflicts-ysm-atoz-index-metadata_review.json'
        ) {
          return { plannedGroups: 0 };
        }
        if (
          reportPath ===
          '/tmp/ylabs-cross-source-observation-conflicts-ysm-atoz-index-priority_review.json'
        ) {
          return { plannedGroups: 2 };
        }
        if (
          reportPath ===
          '/tmp/ylabs-cross-source-observation-conflicts-ysm-atoz-index-metadata_review.json'
        ) {
          return { plannedGroups: 1 };
        }
        if (
          reportPath ===
            '/tmp/ylabs-cross-source-observation-conflicts-ysm-atoz-index-priority_review-decision-validation.json' ||
          reportPath ===
            '/tmp/ylabs-cross-source-observation-conflicts-ysm-atoz-index-metadata_review-decision-validation.json'
        ) {
          return {
            reviewDecisionValidation: {
              invalidDecisionCount: 0,
              unreviewedPlanCount: 0,
              validDecisionCount: 1,
            },
          };
        }
        return undefined;
      },
    );

    expect(rows[0]).toMatchObject({
      risk: 'ok',
      action: expect.stringMatching(/complete valid review decisions/i),
    });
    expect(rows[0].reviewArtifact).toBeUndefined();
  });

  it('does not require cross-source review artifacts for same-source-only active conflicts', () => {
    const rows = resolveSourceHealthRowsWithReviewArtifacts(
      [
        {
          sourceName: 'official-profile-pi-backfill',
          displayName: 'Official profile PI backfill',
          enabled: true,
          coverageKnown: true,
          expectedArtifactTypes: ['Observation'],
          recentRuns: { total: 1, success: 1, partial: 0, failure: 0, running: 0 },
          risk: 'warn',
          action: 'Inspect partial run or materialization conflicts.',
          reviewArtifact: {
            required: true,
            reason: 'materialization_conflicts',
            command: 'SCRAPER_ENV=beta yarn --cwd server scrape report --run run-profile',
            outputPath: '/tmp/profile-report.json',
            materializationConflicts: 2,
            materializationErrors: 0,
          },
        },
      ],
      (reportPath) => {
        if (reportPath === '/tmp/profile-report.json') {
          return {
            quality: {
              materializationConflictReview: {
                available: true,
                activeObservationConflictCount: 2,
                sameSourceConflictCount: 2,
                crossSourceConflictCount: 0,
                categoryCounts: [
                  { category: 'identity_or_routing', count: 1 },
                  { category: 'other', count: 1 },
                ],
              },
            },
          };
        }
        if (
          reportPath ===
          '/tmp/ylabs-stale-observation-conflicts-official-profile-pi-backfill-priority_review.json'
        ) {
          return { plannedGroups: 0 };
        }
        if (
          reportPath ===
          '/tmp/ylabs-stale-observation-conflicts-official-profile-pi-backfill-context_review.json'
        ) {
          return { plannedGroups: 1 };
        }
        if (
          reportPath ===
          '/tmp/ylabs-stale-observation-conflicts-official-profile-pi-backfill-context_review-decision-validation.json'
        ) {
          return {
            reviewDecisionValidation: {
              invalidDecisionCount: 0,
              unreviewedPlanCount: 0,
              validDecisionCount: 1,
            },
          };
        }
        return undefined;
      },
    );

    expect(rows[0]).toMatchObject({
      risk: 'ok',
      action: expect.stringMatching(/complete valid review decisions/i),
    });
  });

  it('keeps active materialization conflict warnings when any active review queue is not fully validated', () => {
    const rows = resolveSourceHealthRowsWithReviewArtifacts(
      [
        {
          sourceName: 'department-undergrad-research',
          displayName: 'Department undergraduate research',
          enabled: true,
          coverageKnown: true,
          expectedArtifactTypes: ['ResearchEntity'],
          recentRuns: { total: 1, success: 1, partial: 0, failure: 0, running: 0 },
          risk: 'warn',
          action: 'Inspect partial run or materialization conflicts.',
          reviewArtifact: {
            required: true,
            reason: 'materialization_conflicts',
            command: 'SCRAPER_ENV=beta yarn --cwd server scrape report --run run-dept',
            outputPath: '/tmp/dept-report.json',
            materializationConflicts: 6,
            materializationErrors: 0,
          },
        },
      ],
      (reportPath) => {
        if (reportPath === '/tmp/dept-report.json') {
          return {
            quality: {
              materializationConflictReview: {
                available: true,
                activeObservationConflictCount: 2,
                sameSourceConflictCount: 0,
                crossSourceConflictCount: 2,
                categoryCounts: [{ category: 'additive_metadata', count: 2 }],
              },
            },
          };
        }
        if (
          reportPath ===
          '/tmp/ylabs-stale-observation-conflicts-department-undergrad-research-metadata_review.json'
        ) {
          return { plannedGroups: 0 };
        }
        if (
          reportPath ===
          '/tmp/ylabs-cross-source-observation-conflicts-department-undergrad-research-metadata_review.json'
        ) {
          return { plannedGroups: 2 };
        }
        if (
          reportPath ===
          '/tmp/ylabs-cross-source-observation-conflicts-department-undergrad-research-metadata_review-decision-validation.json'
        ) {
          return {
            reviewDecisionValidation: {
              invalidDecisionCount: 0,
              unreviewedPlanCount: 1,
            },
          };
        }
        return undefined;
      },
    );

    expect(rows[0]).toMatchObject({
      risk: 'warn',
      reviewArtifact: {
        reason: 'materialization_conflicts',
        outputPath: '/tmp/dept-report.json',
      },
    });
  });

  it('summarizes saved scraper conflict report reviews for warning rows', () => {
    const summary = buildSourceHealthReviewSummary(
      [
        {
          sourceName: 'department-undergrad-research',
          risk: 'warn',
          nextCommand: 'yarn scrape report --run run-1 --output /tmp/report-1.json',
          reviewArtifact: {
            required: true,
            reason: 'materialization_conflicts',
            command: 'yarn scrape report --run run-1 --output /tmp/report-1.json',
            outputPath: '/tmp/report-1.json',
            materializationConflicts: 4,
            materializationErrors: 0,
          },
        },
        {
          sourceName: 'visibility-repair-queue',
          risk: 'warn',
          nextCommand:
            'SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=all --mode=dry-run --limit=100 --output /tmp/repair.json',
        },
      ] as any[],
      (reportPath) => {
        if (reportPath === '/tmp/report-1.json') {
          return {
            quality: {
              materializationConflictReview: {
                available: true,
                activeObservationConflictCount: 3,
                actionableConflictCount: 2,
                sameSourceConflictCount: 1,
                crossSourceConflictCount: 2,
                categoryCounts: [
                  { category: 'content', count: 1 },
                  { category: 'identity_or_routing', count: 1 },
                ],
              },
            },
          };
        }
        if (
          reportPath ===
          '/tmp/ylabs-cross-source-observation-conflicts-department-undergrad-research-priority_review.json'
        ) {
          return {
            candidateGroups: 2,
            plannedGroups: 1,
            planTruncated: true,
            fieldCounts: [{ field: 'fullDescription', count: 2 }],
            policyBucketCounts: [{ policyBucket: 'description_policy_review', count: 2 }],
          };
        }
        if (
          reportPath ===
          '/tmp/ylabs-stale-observation-conflicts-department-undergrad-research-priority_review-decision-validation.json'
        ) {
          return {
            reviewDecisionValidation: {
              totalDecisions: 3,
              validDecisionCount: 2,
              invalidDecisionCount: 1,
              unreviewedPlanCount: 4,
            },
          };
        }
        if (
          reportPath ===
          '/tmp/ylabs-cross-source-observation-conflicts-department-undergrad-research-priority_review-decision-validation.json'
        ) {
          return {
            reviewDecisionValidation: {
              totalDecisions: 2,
              validDecisionCount: 2,
              invalidDecisionCount: 0,
              unreviewedPlanCount: 0,
            },
          };
        }
        return undefined;
      },
    );

    expect(summary).toMatchObject({
      warningRows: 2,
      materializationConflictRows: 1,
      reportArtifacts: {
        available: 1,
        missing: 0,
        withConflictReview: 1,
      },
      activeObservationConflictCount: 3,
      actionableConflictCount: 2,
      sameSourceConflictCount: 1,
      crossSourceConflictCount: 2,
      reviewArtifactStatus: {
        staleObservationReview: {
          total: 1,
          available: 0,
          missing: 1,
          missingCommands: [
            {
              sourceName: 'department-undergrad-research',
              command:
                'SCRAPER_ENV=beta yarn --cwd server observations:stale-conflict-review --source=department-undergrad-research --queue=priority_review --limit=1000 --sample-size=20 --plan-limit=1000 --output /tmp/ylabs-stale-observation-conflicts-department-undergrad-research-priority_review.json',
              outputPath:
                '/tmp/ylabs-stale-observation-conflicts-department-undergrad-research-priority_review.json',
              sameSourceConflictCount: 1,
              reviewQueue: 'priority_review',
              acceptedDecisionTemplate: {
                outputPath:
                  '/tmp/ylabs-stale-observation-conflicts-department-undergrad-research-priority_review-accepted-decisions-template.json',
                expectedArtifactFields: [
                  'decisions[].planId',
                  'decisions[].keepObservationId',
                  'decisions[].supersedeObservationIds',
                  'decisions[].decision',
                ],
                command:
                  'SCRAPER_ENV=beta yarn --cwd server observations:stale-conflict-review --source=department-undergrad-research --queue=priority_review --limit=1000 --sample-size=20 --plan-limit=1000 --decision-template-output /tmp/ylabs-stale-observation-conflicts-department-undergrad-research-priority_review-accepted-decisions-template.json --output /tmp/ylabs-stale-observation-conflicts-department-undergrad-research-priority_review.json',
              },
              acceptedDecisionValidation: {
                inputPath:
                  '/tmp/ylabs-stale-observation-conflicts-department-undergrad-research-priority_review-accepted-decisions.json',
                outputPath:
                  '/tmp/ylabs-stale-observation-conflicts-department-undergrad-research-priority_review-decision-validation.json',
                expectedArtifactField: 'reviewDecisionValidation',
                artifactAvailable: true,
                totalDecisions: 3,
                validDecisionCount: 2,
                invalidDecisionCount: 1,
                unreviewedPlanCount: 4,
                acceptedDecisionFields: [
                  'planId',
                  'decision',
                  'keepObservationId',
                  'supersedeObservationIds',
                  'reviewedBy',
                ],
                command:
                  'SCRAPER_ENV=beta yarn --cwd server observations:stale-conflict-review --source=department-undergrad-research --queue=priority_review --limit=1000 --sample-size=20 --plan-limit=1000 --accepted-decisions=/tmp/ylabs-stale-observation-conflicts-department-undergrad-research-priority_review-accepted-decisions.json --allow-empty-decisions --output /tmp/ylabs-stale-observation-conflicts-department-undergrad-research-priority_review-decision-validation.json',
              },
            },
          ],
        },
        crossSourceObservationReview: {
          total: 1,
          available: 1,
          missing: 0,
          missingCommands: [],
        },
      },
      reviewDecisionValidationStatus: {
        staleObservationReview: {
          total: 1,
          available: 1,
          missing: 0,
          totalDecisions: 3,
          validDecisionCount: 2,
          invalidDecisionCount: 1,
          unreviewedPlanCount: 4,
          withInvalidDecisions: 1,
          withUnreviewedPlans: 1,
          missingCommands: [],
        },
        crossSourceObservationReview: {
          total: 1,
          available: 1,
          missing: 0,
          totalDecisions: 2,
          validDecisionCount: 2,
          invalidDecisionCount: 0,
          unreviewedPlanCount: 0,
          withInvalidDecisions: 0,
          withUnreviewedPlans: 0,
          missingCommands: [],
        },
      },
      categoryCounts: [
        { category: 'content', count: 1 },
        { category: 'identity_or_routing', count: 1 },
      ],
    });
    expect(summary.rows).toEqual([
      expect.objectContaining({
        sourceName: 'department-undergrad-research',
        reportAvailable: true,
        conflictReviewAvailable: true,
        activeObservationConflictCount: 3,
        actionableConflictCount: 2,
        staleObservationReview: expect.objectContaining({
          command: expect.stringContaining('--plan-limit=1000'),
          acceptedDecisionTemplate: expect.objectContaining({
            command: expect.stringContaining('--plan-limit=1000'),
            outputPath:
              '/tmp/ylabs-stale-observation-conflicts-department-undergrad-research-priority_review-accepted-decisions-template.json',
          }),
          acceptedDecisionValidation: expect.objectContaining({
            command: expect.stringContaining('--plan-limit=1000'),
            expectedArtifactField: 'reviewDecisionValidation',
            inputPath:
              '/tmp/ylabs-stale-observation-conflicts-department-undergrad-research-priority_review-accepted-decisions.json',
            artifactAvailable: true,
            totalDecisions: 3,
            validDecisionCount: 2,
            invalidDecisionCount: 1,
            unreviewedPlanCount: 4,
          }),
        }),
        crossSourceObservationReview: expect.objectContaining({
          command: expect.stringContaining('--plan-limit=1000'),
          outputPath:
            '/tmp/ylabs-cross-source-observation-conflicts-department-undergrad-research-priority_review.json',
          crossSourceConflictCount: 2,
          reviewQueue: 'priority_review',
          acceptedDecisionTemplate: expect.objectContaining({
            command: expect.stringContaining('--plan-limit=1000'),
            outputPath:
              '/tmp/ylabs-cross-source-observation-conflicts-department-undergrad-research-priority_review-accepted-decisions-template.json',
            expectedArtifactFields: [
              'decisions[].planId',
              'decisions[].sourceNames',
              'decisions[].observationIdsBySource',
              'decisions[].decision',
              'decisions[].preferredSourceName',
            ],
          }),
          acceptedDecisionValidation: expect.objectContaining({
            command: expect.stringContaining('--plan-limit=1000'),
            inputPath:
              '/tmp/ylabs-cross-source-observation-conflicts-department-undergrad-research-priority_review-accepted-decisions.json',
            outputPath:
              '/tmp/ylabs-cross-source-observation-conflicts-department-undergrad-research-priority_review-decision-validation.json',
            expectedArtifactField: 'reviewDecisionValidation',
            artifactAvailable: true,
            totalDecisions: 2,
            validDecisionCount: 2,
            invalidDecisionCount: 0,
            unreviewedPlanCount: 0,
            acceptedDecisionFields: [
              'planId',
              'decision',
              'preferredSourceName',
              'sourceNames',
              'observationIdsBySource',
              'reviewedBy',
            ],
          }),
          artifactAvailable: true,
          candidateGroups: 2,
          plannedGroups: 1,
          planTruncated: true,
          fieldCounts: [{ field: 'fullDescription', count: 2 }],
          policyBucketCounts: [{ policyBucket: 'description_policy_review', count: 2 }],
        }),
      }),
      expect.objectContaining({
        sourceName: 'visibility-repair-queue',
        reportAvailable: false,
        conflictReviewAvailable: false,
      }),
    ]);
  });

  it('partitions conflict review categories into operator review queues', () => {
    const summary = buildSourceHealthReviewSummary(
      [
        {
          sourceName: 'ysm-atoz-index',
          risk: 'warn',
          reviewArtifact: {
            required: true,
            reason: 'materialization_conflicts',
            command: 'yarn scrape report --run run-ysm --output /tmp/ysm-report.json',
            outputPath: '/tmp/ysm-report.json',
            materializationConflicts: 64,
            materializationErrors: 0,
          },
        },
        {
          sourceName: 'nih-reporter',
          risk: 'warn',
          reviewArtifact: {
            required: true,
            reason: 'materialization_conflicts',
            command: 'yarn scrape report --run run-nih --output /tmp/nih-report.json',
            outputPath: '/tmp/nih-report.json',
            materializationConflicts: 19,
            materializationErrors: 0,
          },
        },
      ] as any[],
      (reportPath) => {
        if (reportPath === '/tmp/ysm-report.json') {
          return {
            quality: {
              materializationConflictReview: {
                available: true,
                activeObservationConflictCount: 4,
                actionableConflictCount: 3,
                sameSourceConflictCount: 2,
                crossSourceConflictCount: 2,
                categoryCounts: [
                  { category: 'access_evidence', count: 2 },
                  { category: 'content', count: 1 },
                  { category: 'additive_metadata', count: 1 },
                ],
              },
            },
          };
        }
        if (reportPath === '/tmp/nih-report.json') {
          return {
            quality: {
              materializationConflictReview: {
                available: true,
                activeObservationConflictCount: 3,
                actionableConflictCount: 3,
                sameSourceConflictCount: 3,
                crossSourceConflictCount: 0,
                categoryCounts: [
                  { category: 'funding_context', count: 2 },
                  { category: 'other', count: 1 },
                ],
              },
            },
          };
        }
        return undefined;
      },
    );

    expect(summary).toMatchObject({
      priorityReviewConflictCount: 3,
      contextReviewConflictCount: 3,
      metadataReviewConflictCount: 1,
      sameSourceConflictCount: 5,
      crossSourceConflictCount: 2,
      reviewQueues: [
        {
          queue: 'priority_review',
          label: 'Identity, access, or student-facing content',
          count: 3,
          categories: [
            { category: 'access_evidence', count: 2 },
            { category: 'content', count: 1 },
          ],
        },
        {
          queue: 'context_review',
          label: 'Funding or uncategorized context',
          count: 3,
          categories: [
            { category: 'funding_context', count: 2 },
            { category: 'other', count: 1 },
          ],
        },
        {
          queue: 'metadata_review',
          label: 'Additive metadata merge review',
          count: 1,
          categories: [{ category: 'additive_metadata', count: 1 }],
        },
      ],
    });
    expect(summary.rows).toEqual([
      expect.objectContaining({
        sourceName: 'ysm-atoz-index',
        primaryReviewQueue: 'priority_review',
        priorityReviewConflictCount: 3,
        contextReviewConflictCount: 0,
        metadataReviewConflictCount: 1,
        sameSourceConflictCount: 2,
        crossSourceConflictCount: 2,
        staleObservationReviews: [
          expect.objectContaining({
            reviewQueue: 'priority_review',
            outputPath:
              '/tmp/ylabs-stale-observation-conflicts-ysm-atoz-index-priority_review.json',
          }),
          expect.objectContaining({
            reviewQueue: 'metadata_review',
            outputPath:
              '/tmp/ylabs-stale-observation-conflicts-ysm-atoz-index-metadata_review.json',
          }),
        ],
        crossSourceObservationReviews: [
          expect.objectContaining({
            reviewQueue: 'priority_review',
            outputPath:
              '/tmp/ylabs-cross-source-observation-conflicts-ysm-atoz-index-priority_review.json',
          }),
          expect.objectContaining({
            reviewQueue: 'metadata_review',
            outputPath:
              '/tmp/ylabs-cross-source-observation-conflicts-ysm-atoz-index-metadata_review.json',
          }),
        ],
        staleObservationReview: expect.objectContaining({
          command:
            'SCRAPER_ENV=beta yarn --cwd server observations:stale-conflict-review --source=ysm-atoz-index --queue=priority_review --limit=1000 --sample-size=20 --plan-limit=1000 --output /tmp/ylabs-stale-observation-conflicts-ysm-atoz-index-priority_review.json',
          outputPath:
            '/tmp/ylabs-stale-observation-conflicts-ysm-atoz-index-priority_review.json',
          sameSourceConflictCount: 2,
          reviewQueue: 'priority_review',
          artifactAvailable: false,
        }),
      }),
      expect.objectContaining({
        sourceName: 'nih-reporter',
        primaryReviewQueue: 'context_review',
        priorityReviewConflictCount: 0,
        contextReviewConflictCount: 3,
        metadataReviewConflictCount: 0,
        sameSourceConflictCount: 3,
        crossSourceConflictCount: 0,
        staleObservationReview: expect.objectContaining({
          command:
            'SCRAPER_ENV=beta yarn --cwd server observations:stale-conflict-review --source=nih-reporter --queue=context_review --limit=1000 --sample-size=20 --plan-limit=1000 --output /tmp/ylabs-stale-observation-conflicts-nih-reporter-context_review.json',
          outputPath:
            '/tmp/ylabs-stale-observation-conflicts-nih-reporter-context_review.json',
          sameSourceConflictCount: 3,
          reviewQueue: 'context_review',
          artifactAvailable: false,
        }),
      }),
    ]);
    expect(summary.reviewArtifactStatus.staleObservationReview).toMatchObject({
      total: 3,
      missing: 3,
    });
    expect(summary.reviewArtifactStatus.crossSourceObservationReview).toMatchObject({
      total: 2,
      missing: 2,
    });
  });

  it('aggregates available review artifact field and policy rollups', () => {
    const summary = buildSourceHealthReviewSummary(
      [
        {
          sourceName: 'ysm-atoz-index',
          risk: 'warn',
          reviewArtifact: {
            required: true,
            reason: 'materialization_conflicts',
            command: 'yarn scrape report --run run-ysm --output /tmp/ysm-report.json',
            outputPath: '/tmp/ysm-report.json',
            materializationConflicts: 3,
            materializationErrors: 0,
          },
        },
        {
          sourceName: 'dept-faculty-roster',
          risk: 'warn',
          reviewArtifact: {
            required: true,
            reason: 'materialization_conflicts',
            command: 'yarn scrape report --run run-roster --output /tmp/roster-report.json',
            outputPath: '/tmp/roster-report.json',
            materializationConflicts: 4,
            materializationErrors: 0,
          },
        },
      ] as any[],
      (reportPath) => {
        if (reportPath === '/tmp/ysm-report.json') {
          return {
            quality: {
              materializationConflictReview: {
                available: true,
                sameSourceConflictCount: 2,
                crossSourceConflictCount: 1,
                categoryCounts: [{ category: 'content', count: 3 }],
              },
            },
          };
        }
        if (reportPath === '/tmp/roster-report.json') {
          return {
            quality: {
              materializationConflictReview: {
                available: true,
                sameSourceConflictCount: 3,
                crossSourceConflictCount: 0,
                categoryCounts: [{ category: 'identity_or_routing', count: 4 }],
              },
            },
          };
        }
        if (
          reportPath ===
          '/tmp/ylabs-stale-observation-conflicts-ysm-atoz-index-priority_review.json'
        ) {
          return {
            fieldCounts: [{ field: 'name', count: 2 }],
            policyBucketCounts: [
              { policyBucket: 'stale_identity_or_routing_review', count: 2 },
            ],
          };
        }
        if (
          reportPath ===
          '/tmp/ylabs-cross-source-observation-conflicts-ysm-atoz-index-priority_review.json'
        ) {
          return {
            fieldCounts: [{ field: 'fullDescription', count: 4 }],
            policyBucketCounts: [{ policyBucket: 'description_policy_review', count: 4 }],
          };
        }
        if (
          reportPath ===
          '/tmp/ylabs-stale-observation-conflicts-dept-faculty-roster-priority_review.json'
        ) {
          return {
            fieldCounts: [
              { field: 'name', count: 3 },
              { field: 'title', count: 1 },
            ],
            policyBucketCounts: [
              { policyBucket: 'stale_identity_or_routing_review', count: 1 },
              { policyBucket: 'stale_metadata_merge_review', count: 1 },
            ],
          };
        }
        return undefined;
      },
    );

    expect(summary).toMatchObject({
      reviewArtifactRollups: {
        staleObservationReview: {
          fieldCounts: [
            { field: 'name', count: 5 },
            { field: 'title', count: 1 },
          ],
          policyBucketCounts: [
            { policyBucket: 'stale_identity_or_routing_review', count: 3 },
            { policyBucket: 'stale_metadata_merge_review', count: 1 },
          ],
        },
        crossSourceObservationReview: {
          fieldCounts: [{ field: 'fullDescription', count: 4 }],
          policyBucketCounts: [{ policyBucket: 'description_policy_review', count: 4 }],
        },
      },
    });
  });
});
