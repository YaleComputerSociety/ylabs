import { describe, expect, it } from 'vitest';

import { parseScraperOptions, selectOnlyFromTargetReport } from '../cli';

const report = {
  llmMicrositeCandidates: {
    count: 4,
    slugs: ['lab-a', 'lab-b', 'lab-c', 'lab-d'],
    samples: [],
  },
  departmentPageCandidates: {
    count: 1,
    slugs: ['department-a'],
    samples: [],
  },
};

describe('selectOnlyFromTargetReport', () => {
  it('selects bucket slugs and applies one-based batches', () => {
    expect(
      selectOnlyFromTargetReport(report, {
        targetBucket: 'llmMicrositeCandidates',
        batch: 2,
        batchSize: 2,
      }),
    ).toEqual(['lab-c', 'lab-d']);
  });

  it('rejects missing or invalid buckets with clear errors', () => {
    expect(() =>
      selectOnlyFromTargetReport(report, {
        targetBucket: 'sourceUrlBackfillCandidates',
        batch: 1,
        batchSize: 50,
      }),
    ).toThrow('Target bucket "sourceUrlBackfillCandidates" was not found');

    expect(() =>
      selectOnlyFromTargetReport(report, {
        targetBucket: 'llmMicrositeCandidates',
        batch: 0,
        batchSize: 50,
      }),
    ).toThrow('--batch must be a number greater than or equal to 1');
  });

  it('parses visibility gate mode and rejects invalid values', () => {
    expect(
      parseScraperOptions({
        'visibility-gate-mode': 'dry-run',
        'allow-visibility-demotions': true,
      }),
    ).toMatchObject({
      visibilityGateMode: 'dry-run',
      allowVisibilityDemotions: true,
    });

    expect(() => parseScraperOptions({ 'visibility-gate-mode': 'preview' })).toThrow(
      '--visibility-gate-mode must be either dry-run or apply',
    );
  });
});
