import { describe, expect, it } from 'vitest';
import {
  buildLaneBenchmarkTrend,
  classifyLaneBenchmarkChange,
  laneBenchmarkPanelEntries,
} from '../laneBenchmarkTrendCore';
import { benchmarksToReplay } from '../../scripts/laneScorecardCore';

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
  it('reads the latest and previous replay, counts every stored replay, and sums the labeled population', () => {
    const trend = buildLaneBenchmarkTrend(
      'undergrad-llm-gold-v2',
      [
        row(),
        row({
          measuredAt: new Date('2026-09-27T00:00:00Z'),
          codeSha: 'bbb',
          outputFingerprint: 'fp-0',
        }),
      ],
      31,
    );
    expect(trend).toMatchObject({
      benchmarkId: 'undergrad-llm-gold-v2',
      sourceName: 'lab-microsite-undergrad-llm',
      runs: 31,
      change: 'code-changed',
      latest: { measuredAt: '2026-09-28T00:00:00.000Z', labeledEntityEmitted: 5, pagesMissed: 2 },
    });
    expect(trend?.latest.gold[0]).toMatchObject({ precision: 1, truePositive: 9 });
  });

  it('returns nothing for a benchmark with no replay yet', () => {
    expect(buildLaneBenchmarkTrend('empty', [], 0)).toBeNull();
  });

  it('keeps an undefined rate null rather than zero', () => {
    const trend = buildLaneBenchmarkTrend(
      'x',
      [row({ gold: [{ field: 'f', labeled: 1, trueNegative: 1, precision: null, recall: null }] })],
      1,
    );
    expect(trend?.latest.gold[0]).toMatchObject({ precision: null, recall: null, truePositive: 0 });
  });
});

describe('classifyLaneBenchmarkChange', () => {
  const dto = (codeSha: string | null, outputFingerprint: string) =>
    buildLaneBenchmarkTrend('x', [row({ codeSha, outputFingerprint })], 1)!.latest;

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

describe('laneBenchmarkPanelEntries', () => {
  const stored = [
    { benchmarkId: 'lane-a-v1', sourceName: 'lane-a', unfrozenRequestCount: 2 },
    {
      benchmarkId: 'lane-a-v2',
      sourceName: 'lane-a',
      supersedes: 'lane-a-v1',
      unfrozenRequestCount: 2,
    },
    { benchmarkId: 'lane-b-v1', sourceName: 'lane-b', unfrozenRequestCount: 2 },
    {
      benchmarkId: 'lane-b-v2',
      sourceName: 'lane-b',
      supersedes: 'lane-b-v1',
      unfrozenRequestCount: 2,
    },
  ];

  it('shows only the newest benchmark of each recapture chain and names what it replaces', () => {
    const entries = laneBenchmarkPanelEntries(
      benchmarksToReplay(stored),
      new Map([
        ['lane-a-v1', [row({ sourceName: 'lane-a' })]],
        ['lane-a-v2', [row({ sourceName: 'lane-a' })]],
        ['lane-b-v1', [row({ sourceName: 'lane-b' })]],
      ]),
    );

    expect(entries.benchmarks.map((trend) => trend.benchmarkId)).toEqual(['lane-a-v2']);
    expect(entries.benchmarks[0].supersedes).toBe('lane-a-v1');
    expect(entries.supersededCount).toBe(2);
  });

  it('lists a current benchmark with no replay yet instead of hiding it', () => {
    const entries = laneBenchmarkPanelEntries(
      benchmarksToReplay(stored),
      new Map([['lane-b-v1', [row({ sourceName: 'lane-b' })]]]),
    );

    expect(entries.benchmarks).toEqual([]);
    expect(entries.awaitingReplay).toEqual([
      { benchmarkId: 'lane-a-v2', sourceName: 'lane-a', supersedes: 'lane-a-v1' },
      { benchmarkId: 'lane-b-v2', sourceName: 'lane-b', supersedes: 'lane-b-v1' },
    ]);
  });

  it('builds the trend from the two newest scored runs and counts every scored run', () => {
    const entries = laneBenchmarkPanelEntries(
      benchmarksToReplay([
        { benchmarkId: 'lane-c', sourceName: 'lane-c', unfrozenRequestCount: 2 },
      ]),
      new Map([
        [
          'lane-c',
          [
            row({ codeSha: 'ccc', outputFingerprint: 'fp-3' }),
            row({ codeSha: 'bbb', outputFingerprint: 'fp-2' }),
            row({ codeSha: 'aaa', outputFingerprint: 'fp-1' }),
          ],
        ],
      ]),
    );

    expect(entries.benchmarks[0]).toMatchObject({
      runs: 3,
      supersedes: null,
      change: 'code-changed',
    });
    expect(entries.benchmarks[0].previous?.codeSha).toBe('bbb');
  });

  it('hides a current benchmark whose stored replays are all stale instead of calling it unreplayed', () => {
    const entries = laneBenchmarkPanelEntries(
      benchmarksToReplay([
        { benchmarkId: 'lane-d', sourceName: 'lane-d', unfrozenRequestCount: 0 },
      ]),
      new Map([['lane-d', [row({ pagesMissed: 5 }), row({ pagesMissed: 3 })]]]),
    );

    expect(entries.benchmarks).toEqual([]);
    expect(entries.awaitingReplay).toEqual([]);
  });

  it('leaves stale replays out of the trend and its run count', () => {
    const entries = laneBenchmarkPanelEntries(
      benchmarksToReplay([
        { benchmarkId: 'lane-e', sourceName: 'lane-e', unfrozenRequestCount: 2 },
      ]),
      new Map([
        [
          'lane-e',
          [
            row({ codeSha: 'ccc', pagesMissed: 9, outputFingerprint: 'fp-3' }),
            row({ codeSha: 'bbb', outputFingerprint: 'fp-2' }),
            row({ codeSha: 'aaa', outputFingerprint: 'fp-1' }),
          ],
        ],
      ]),
    );

    expect(entries.benchmarks[0]).toMatchObject({ runs: 2 });
    expect(entries.benchmarks[0].latest.codeSha).toBe('bbb');
  });
});
