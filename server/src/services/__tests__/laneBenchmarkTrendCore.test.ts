import { describe, expect, it } from 'vitest';
import { buildLaneBenchmarkTrend, classifyLaneBenchmarkChange } from '../laneBenchmarkTrendCore';

const row = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  measuredAt: new Date('2026-09-28T00:00:00Z'),
  codeSha: 'aaa',
  sourceName: 'lab-microsite-undergrad-llm',
  pagesServed: 265,
  pagesMissed: 2,
  emitted: 180,
  knownWrong: 0,
  byField: [
    { field: 'undergradEvidenceQuote', emitted: 9, labeledEntityEmitted: 3, knownWrong: 0 },
    { field: 'fullDescription', emitted: 20, labeledEntityEmitted: 2, knownWrong: 0 },
  ],
  outputFingerprint: 'fp-1',
  gold: [
    {
      field: 'undergradEvidenceQuote',
      labeled: 37,
      truePositive: 9,
      falsePositive: 0,
      falseNegative: 2,
      trueNegative: 26,
      precision: 1,
      recall: 9 / 11,
    },
  ],
  ...overrides,
});

describe('buildLaneBenchmarkTrend', () => {
  it('reads the latest and previous replay and sums the labeled population across fields', () => {
    const trend = buildLaneBenchmarkTrend('undergrad-llm-gold-v2', [
      row(),
      row({
        measuredAt: new Date('2026-09-27T00:00:00Z'),
        codeSha: 'bbb',
        outputFingerprint: 'fp-0',
      }),
    ]);
    expect(trend).toMatchObject({
      benchmarkId: 'undergrad-llm-gold-v2',
      sourceName: 'lab-microsite-undergrad-llm',
      runs: 2,
      change: 'code-changed',
      latest: { measuredAt: '2026-09-28T00:00:00.000Z', labeledEntityEmitted: 5, pagesMissed: 2 },
    });
    expect(trend?.latest.gold[0]).toMatchObject({ precision: 1, truePositive: 9 });
  });

  it('returns nothing for a benchmark with no replay yet', () => {
    expect(buildLaneBenchmarkTrend('empty', [])).toBeNull();
  });

  it('keeps an undefined rate null rather than zero', () => {
    const trend = buildLaneBenchmarkTrend('x', [
      row({ gold: [{ field: 'f', labeled: 1, trueNegative: 1, precision: null, recall: null }] }),
    ]);
    expect(trend?.latest.gold[0]).toMatchObject({ precision: null, recall: null, truePositive: 0 });
  });
});

describe('classifyLaneBenchmarkChange', () => {
  const dto = (codeSha: string | null, outputFingerprint: string) =>
    buildLaneBenchmarkTrend('x', [row({ codeSha, outputFingerprint })])!.latest;

  it.each([
    ['a first replay', dto('aaa', 'fp-1'), null, 'first-run'],
    ['the same output', dto('aaa', 'fp-1'), dto('bbb', 'fp-1'), 'unchanged'],
    ['new output from new code', dto('aaa', 'fp-2'), dto('bbb', 'fp-1'), 'code-changed'],
    ['new output from the same code', dto('aaa', 'fp-2'), dto('aaa', 'fp-1'), 'input-leak'],
    ['new output with no recorded code', dto(null, 'fp-2'), dto('aaa', 'fp-1'), 'unattributed'],
  ] as const)('reads %s', (_label, latest, previous, expected) => {
    expect(classifyLaneBenchmarkChange(latest, previous)).toBe(expected);
  });
});
