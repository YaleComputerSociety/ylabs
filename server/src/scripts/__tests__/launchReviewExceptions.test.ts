import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildLaunchReviewExceptionCandidates,
  buildLaunchReviewExceptionDecisionTemplate,
  buildLaunchReviewExceptionOutput,
  buildLaunchReviewExceptionReview,
  parseLaunchReviewExceptionArgs,
  validateLaunchReviewExceptionDecisions,
  writeLaunchReviewExceptionOutput,
  type LaunchReviewExceptionCandidateInput,
} from '../launchReviewExceptions';
import type { StudentVisibilityGatePlan } from '../../services/studentVisibilityGateService';

const candidate = (
  overrides: Partial<LaunchReviewExceptionCandidateInput> = {},
): LaunchReviewExceptionCandidateInput => ({
  collection: 'programs',
  recordId: 'program-1',
  label: 'Formalization Only Fellowship',
  currentTier: 'operator_review',
  computedTier: 'operator_review',
  targetTier: 'operator_review',
  reasons: ['official_source', 'application_route', 'undergraduate_relevant', 'formalization_only'],
  ...overrides,
});

const gatePlan = (overrides: Partial<StudentVisibilityGatePlan> = {}): StudentVisibilityGatePlan => ({
  collection: 'research',
  recordId: 'research-1',
  label: 'Source Backed Lab',
  currentTier: 'student_ready',
  computedTier: 'student_ready',
  tier: 'student_ready',
  reasons: ['source_backed_description', 'concrete_next_step'],
  sourceNames: ['official-source'],
  nextRepairAction: 'No action needed.',
  ...overrides,
});

describe('launchReviewExceptions CLI helpers', () => {
  it('parses collection limit output template and accepted-decision flags', () => {
    expect(
      parseLaunchReviewExceptionArgs([
        '--collection=programs',
        '--limit=25',
        '--output=/tmp/ylabs-launch-review-exceptions.json',
        '--decision-template-output',
        '/tmp/ylabs-launch-review-exceptions-template.json',
        '--accepted-decisions=/tmp/ylabs-launch-review-exceptions-decisions.json',
        '--allow-empty-decisions',
      ]),
    ).toEqual({
      collection: 'programs',
      limit: 25,
      output: '/tmp/ylabs-launch-review-exceptions.json',
      decisionTemplateOutput: '/tmp/ylabs-launch-review-exceptions-template.json',
      acceptedDecisions: '/tmp/ylabs-launch-review-exceptions-decisions.json',
      allowEmptyDecisions: true,
    });
  });

  it('rejects malformed launch review exception arguments', () => {
    expect(() => parseLaunchReviewExceptionArgs(['--limit=bad'])).toThrow(
      /--limit must be a positive integer/,
    );
    expect(() => parseLaunchReviewExceptionArgs(['--limit=1e3'])).toThrow(
      /--limit must be a positive integer/,
    );
    expect(() => parseLaunchReviewExceptionArgs(['--output', '--collection=all'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseLaunchReviewExceptionArgs(['--output=--collection=all'])).toThrow(
      /--output requires a path/,
    );
    expect(() =>
      parseLaunchReviewExceptionArgs(['--decision-template-output', '--collection=all']),
    ).toThrow(/--decision-template-output requires a path/);
    expect(() =>
      parseLaunchReviewExceptionArgs(['--decision-template-output=--collection=all']),
    ).toThrow(/--decision-template-output requires a path/);
    expect(() =>
      parseLaunchReviewExceptionArgs(['--accepted-decisions', '--allow-empty-decisions']),
    ).toThrow(/--accepted-decisions requires a path/);
    expect(() =>
      parseLaunchReviewExceptionArgs(['--accepted-decisions=--allow-empty-decisions']),
    ).toThrow(/--accepted-decisions requires a path/);
  });

  it('builds a dry-run review artifact with apply blocked', () => {
    const review = buildLaunchReviewExceptionReview([candidate()]);

    expect(review).toMatchObject({
      mode: 'dry-run',
      applyBlocked: true,
      reviewExceptionCount: 1,
      planSummary: {
        plannedCount: 1,
        planTruncated: false,
        acceptedDecisionValues: [
          'keep_capped_formalization_only',
          'keep_capped_application_source_only',
          'promote_entry_route',
          'suppress_not_undergrad',
          'defer_review',
        ],
      },
      plans: [
        {
          planId: 'launch-review-exception:programs:program-1',
          collection: 'programs',
          recordId: 'program-1',
          requiredReviewerDecision:
            'Confirm whether official source evidence proves a real entry route or only formalization/funding.',
          applyBlocked: true,
        },
      ],
    });
  });

  it('only selects launch-blocking review-exception plans', () => {
    expect(
      buildLaunchReviewExceptionCandidates([
        gatePlan(),
        gatePlan({
          collection: 'programs',
          recordId: 'program-1',
          label: 'Formalization Only Fellowship',
          currentTier: 'operator_review',
          computedTier: 'operator_review',
          tier: 'operator_review',
          reasons: [
            'official_source',
            'application_route',
            'undergraduate_relevant',
            'formalization_only',
          ],
        }),
        gatePlan({
          recordId: 'research-2',
          label: 'Missing Description Lab',
          currentTier: 'operator_review',
          computedTier: 'operator_review',
          tier: 'operator_review',
          reasons: ['missing_description'],
        }),
        gatePlan({
          recordId: 'suppressed-1',
          label: 'Hidden Infrastructure',
          currentTier: 'suppressed',
          computedTier: 'suppressed',
          tier: 'suppressed',
          reasons: ['research_infrastructure_only'],
        }),
      ]),
    ).toEqual([
      expect.objectContaining({
        collection: 'programs',
        recordId: 'program-1',
        label: 'Formalization Only Fellowship',
        targetTier: 'operator_review',
        reasons: [
          'official_source',
          'application_route',
          'undergraduate_relevant',
          'formalization_only',
        ],
      }),
    ]);
  });

  it('writes reviewer decision templates without asserting decisions', () => {
    const template = buildLaunchReviewExceptionDecisionTemplate([
      candidate({ recordId: 'program-2', label: 'Portal Only Grant' }),
    ]);

    expect(template).toEqual({
      decisions: [
        expect.objectContaining({
          planId: 'launch-review-exception:programs:program-2',
          collection: 'programs',
          recordId: 'program-2',
          label: 'Portal Only Grant',
          acceptedDecisionValues: [
            'keep_capped_formalization_only',
            'keep_capped_application_source_only',
            'promote_entry_route',
            'suppress_not_undergrad',
            'defer_review',
          ],
          programEvidence: expect.objectContaining({
            programKind: '',
            entryMode: '',
            sourceUrl: '',
            applicationLink: '',
          }),
          decision: '',
          reviewedBy: '',
          reviewNote: '',
        }),
      ],
    });
  });

  it('validates accepted review-exception decisions against current plans', () => {
    const plans = buildLaunchReviewExceptionReview([
      candidate({ recordId: 'program-1' }),
      candidate({ recordId: 'program-2' }),
    ]).plans;

    const validation = validateLaunchReviewExceptionDecisions(
      plans,
      [
        {
          planId: 'launch-review-exception:programs:program-1',
          decision: 'keep_capped_formalization_only',
          reviewedBy: 'Codex autonomous review',
          reviewNote: 'Formalization-only funding remains capped.',
        },
        {
          planId: 'launch-review-exception:programs:missing',
          decision: 'defer_review',
          reviewedBy: 'Codex autonomous review',
        },
        {
          planId: 'launch-review-exception:programs:program-2',
          decision: 'unsupported',
          reviewedBy: '',
        },
      ],
      '/tmp/ylabs-launch-review-exceptions-decisions.json',
    );

    expect(validation).toMatchObject({
      artifactPath: '/tmp/ylabs-launch-review-exceptions-decisions.json',
      applyBlocked: true,
      totalDecisions: 3,
      validDecisionCount: 1,
      invalidDecisionCount: 2,
      unmatchedPlanDecisionCount: 1,
      unreviewedPlanCount: 1,
    });
  });

  it('requires promotion evidence for promote-entry-route decisions', () => {
    const plans = buildLaunchReviewExceptionReview([candidate({ recordId: 'program-1' })]).plans;

    const invalid = validateLaunchReviewExceptionDecisions(
      plans,
      [
        {
          planId: 'launch-review-exception:programs:program-1',
          decision: 'promote_entry_route',
          reviewedBy: 'reviewer',
          reviewNote: 'Looks promising.',
        },
      ],
      '/tmp/decisions.json',
    );

    expect(invalid.invalidDecisionCount).toBe(1);
    expect(invalid.decisions[0].errors).toContain(
      'promotionEvidenceUrl is required for promote_entry_route decisions',
    );

    const valid = validateLaunchReviewExceptionDecisions(
      plans,
      [
        {
          planId: 'launch-review-exception:programs:program-1',
          decision: 'promote_entry_route',
          reviewedBy: 'reviewer',
          reviewNote: 'Official source describes mentor matching.',
          promotionEvidenceUrl: 'https://science.yale.edu/program',
        } as any,
      ],
      '/tmp/decisions.json',
    );

    expect(valid.validDecisionCount).toBe(1);
  });

  it('writes the review artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-launch-review-'));
    const output = path.join(dir, 'launch-review.json');
    writeLaunchReviewExceptionOutput({ mode: 'dry-run', reviewExceptionCount: 1 }, output);

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      mode: 'dry-run',
      reviewExceptionCount: 1,
    });
  });

  it('wraps review artifacts with target metadata and parsed options', () => {
    const options = {
      collection: 'all' as const,
      limit: 500,
      output: '/tmp/ylabs-launch-review-exceptions.json',
      decisionTemplateOutput: '/tmp/ylabs-launch-review-exceptions-template.json',
      acceptedDecisions: '/tmp/ylabs-launch-review-exceptions-decisions.json',
      allowEmptyDecisions: true,
    };

    expect(
      buildLaunchReviewExceptionOutput(
        { environment: 'beta', db: 'Beta', options },
        {
          mode: 'dry-run',
          reviewExceptionCount: 92,
        },
        new Date('2026-06-01T02:45:00.000Z'),
      ),
    ).toEqual({
      generatedAt: '2026-06-01T02:45:00.000Z',
      environment: 'beta',
      db: 'Beta',
      options,
      mode: 'dry-run',
      reviewExceptionCount: 92,
    });
  });
});
