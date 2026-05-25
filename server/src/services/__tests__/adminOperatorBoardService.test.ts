import { describe, expect, it } from 'vitest';
import {
  buildRecommendedNextActions,
  classifyOperatorQueueReason,
  derivePromotionStatus,
  summarizeDryRunPosture,
} from '../adminOperatorBoardService';

describe('adminOperatorBoardService', () => {
  it('separates blocking repair reasons from positive evidence signals', () => {
    expect(classifyOperatorQueueReason('missing_action_evidence')).toBe('blocking');
    expect(classifyOperatorQueueReason('profile_fallback_only')).toBe('blocking');
    expect(classifyOperatorQueueReason('not_undergraduate_relevant')).toBe('blocking');
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
});
