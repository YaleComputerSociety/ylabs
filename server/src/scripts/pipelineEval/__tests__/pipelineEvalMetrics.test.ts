import { describe, expect, it } from 'vitest';
import {
  buildChurnMetrics,
  scoreAccuracy,
  scoreDedupe,
  type GroundTruthPair,
  type ScorableEntity,
} from '../pipelineEvalMetrics';

describe('scoreAccuracy', () => {
  it('counts tiers and student_ready from the stored tier', () => {
    const entities: ScorableEntity[] = [
      { studentVisibilityTier: 'student_ready' },
      { studentVisibilityTier: 'student_ready' },
      { studentVisibilityTier: 'operator_review' },
      { studentVisibilityTier: 'suppressed' },
    ];
    const result = scoreAccuracy(entities);
    expect(result.entityCount).toBe(4);
    expect(result.studentReady).toBe(2);
    expect(result.studentReadyRate).toBe(0.5);
    expect(result.byTier).toEqual({ student_ready: 2, operator_review: 1, suppressed: 1 });
  });

  it('treats a missing tier as unknown', () => {
    const result = scoreAccuracy([{}]);
    expect(result.byTier).toEqual({ unknown: 1 });
    expect(result.studentReady).toBe(0);
  });
});

describe('buildChurnMetrics', () => {
  it('sums minted-then-merged from present canonical-pointer tombstones', () => {
    const churn = buildChurnMetrics({
      liveEntityCount: 900,
      redirects: 100,
      shellsWithCanonicalGroup: 10,
      archivedMerged: 90,
      releaseQueueItems: 300,
      referenceRepairAudits: 500,
    });
    expect(churn.mintedThenMerged).toBe(100);
    expect(churn.mintedThenMergedRate).toBe(0.1);
    expect(churn.redirects).toBe(100);
  });

  it('is zero-safe with an empty corpus', () => {
    const churn = buildChurnMetrics({
      liveEntityCount: 0,
      redirects: 0,
      shellsWithCanonicalGroup: 0,
      archivedMerged: 0,
      releaseQueueItems: 0,
      referenceRepairAudits: 0,
    });
    expect(churn.mintedThenMergedRate).toBe(0);
  });
});

describe('scoreDedupe', () => {
  it('computes precision, recall, and f1 against ground truth', () => {
    const groundTruth: GroundTruthPair[] = [
      { mergedKey: 'a', canonicalKey: 'x' },
      { mergedKey: 'b', canonicalKey: 'x' },
      { mergedKey: 'c', canonicalKey: 'y' },
    ];
    const predicted: GroundTruthPair[] = [
      { mergedKey: 'a', canonicalKey: 'x' },
      { mergedKey: 'b', canonicalKey: 'x' },
      { mergedKey: 'q', canonicalKey: 'z' },
    ];
    const score = scoreDedupe(predicted, groundTruth);
    expect(score.truePositives).toBe(2);
    expect(score.precision).toBeCloseTo(0.6667, 3);
    expect(score.recall).toBeCloseTo(0.6667, 3);
    expect(score.f1).toBeCloseTo(0.6667, 3);
  });

  it('returns zeros when nothing is predicted', () => {
    const score = scoreDedupe([], [{ mergedKey: 'a', canonicalKey: 'x' }]);
    expect(score.precision).toBe(0);
    expect(score.recall).toBe(0);
    expect(score.f1).toBe(0);
  });
});
