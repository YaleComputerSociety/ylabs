import { describe, expect, it } from 'vitest';
import {
  countRegressions,
  judgeIntegrityGateResult,
  judgeLaneScorecardResult,
  judgeTrustContractResult,
  stageCountBaselineFromRuns,
} from '../sweepStageJudgement';

describe('counting stage judgement (#4852)', () => {
  it('fails only a count that rose over its baseline', () => {
    expect(
      countRegressions(
        { duplicatePeople: 5, duplicateAccessSignals: 1, newlyMeasured: 9 },
        { duplicatePeople: 3, duplicateAccessSignals: 2 },
      ),
    ).toEqual([{ name: 'duplicatePeople', previous: 3, current: 5 }]);
  });

  it('records standing counts without a baseline', () => {
    expect(countRegressions({ duplicatePeople: 5 }, undefined)).toEqual([]);
    expect(judgeIntegrityGateResult({ counts: { duplicatePeople: 5 } }, undefined)).toEqual({
      counts: { duplicatePeople: 5 },
      regressions: [],
    });
  });

  it('refuses an integrity-gate artifact without counts', () => {
    expect(() => judgeIntegrityGateResult({ status: 'failure' }, undefined)).toThrow(/no counts/);
    expect(() => judgeIntegrityGateResult({ counts: { duplicatePeople: 'x' } }, undefined)).toThrow(
      /not a count/,
    );
  });

  it('counts every trust-contract repair lane, absent ones as zero', () => {
    const judgement = judgeTrustContractResult(
      {
        counts: { publicVisibilityViolations: 1 },
        repairLanes: [
          { stage: 'pi_identity', count: 4 },
          { stage: 'source_description', count: 2 },
        ],
      },
      { violations: 7, 'repairLane:pi_identity': 3, publicVisibilityViolations: 0 },
    );
    expect(judgement.counts).toEqual({
      publicVisibilityViolations: 1,
      violations: 6,
      'repairLane:source_description': 2,
      'repairLane:pi_identity': 4,
      'repairLane:action_evidence': 0,
      'repairLane:suppression': 0,
      'repairLane:review_exception': 0,
    });
    expect(judgement.regressions).toEqual([
      { name: 'publicVisibilityViolations', previous: 0, current: 1 },
      { name: 'repairLane:pi_identity', previous: 3, current: 4 },
    ]);
    expect(() => judgeTrustContractResult({ counts: {} }, undefined)).toThrow(/repairLanes/);
  });

  it('keeps unscored benchmarks apart from scored regressions', () => {
    const judgement = judgeLaneScorecardResult({
      unscored: [
        { benchmarkId: 'synthetic-a', reason: 'replay served none of the 3 frozen pages' },
      ],
      regressions: [
        {
          benchmarkId: 'synthetic-b',
          field: 'deadline',
          metric: 'recall',
          previous: 0.9,
          current: 0.7,
        },
      ],
      results: [],
    });
    expect(judgement.unscored).toEqual([
      { benchmarkId: 'synthetic-a', reason: 'replay served none of the 3 frozen pages' },
    ]);
    expect(judgement.regressions).toEqual([
      { name: 'synthetic-b deadline recall', previous: 0.9, current: 0.7 },
    ]);
    expect(
      judgeLaneScorecardResult({
        unscored: [{ benchmarkId: 'synthetic-a', reason: 'x' }],
        results: [],
      }).regressions,
    ).toEqual([]);
    expect(() => judgeLaneScorecardResult({ results: [] })).toThrow(/unscored/);
  });

  it('takes each count from the most recent run that recorded it', () => {
    expect(
      stageCountBaselineFromRuns([
        {
          stages: [
            { name: 'integrity-gate' },
            { name: 'trust-contract', counts: { violations: 4 } },
          ],
        },
        {
          stages: [
            { name: 'integrity-gate', counts: { duplicatePeople: 2, duplicateAccessSignals: 1 } },
            { name: 'trust-contract', counts: { violations: 9, publicVisibilityViolations: 0 } },
          ],
        },
        { stages: [{ name: 'integrity-gate', counts: { duplicatePeople: 7, retiredCount: 3 } }] },
      ]),
    ).toEqual({
      'integrity-gate': { duplicatePeople: 2, duplicateAccessSignals: 1, retiredCount: 3 },
      'trust-contract': { violations: 4, publicVisibilityViolations: 0 },
    });
  });
});
