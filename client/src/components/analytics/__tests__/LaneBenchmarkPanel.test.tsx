import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LaneBenchmarkPanel from '../LaneBenchmarkPanel';
import type { LaneBenchmarkResponse, LaneBenchmarkRun } from '../laneBenchmarkTypes';

const run = (overrides: Partial<LaneBenchmarkRun> = {}): LaneBenchmarkRun => ({
  measuredAt: '2026-09-28T03:00:00.000Z',
  codeSha: '8366d946cdb572c3',
  pagesServed: 265,
  pagesMissed: 2,
  emitted: 180,
  knownWrong: 0,
  labeledEntityEmitted: 5,
  outputFingerprint: 'fp-after',
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

const response = (benchmarks: LaneBenchmarkResponse['benchmarks']): LaneBenchmarkResponse => ({
  benchmarks,
  historyLimit: 20,
  measurementCollection: 'lane_scorecard_snapshots',
  refreshCommand: 'yarn --cwd server lane:scorecard --apply --confirm-lane-scorecard',
});

describe('LaneBenchmarkPanel', () => {
  it('shows each benchmark with its gold rates and the change from the previous replay', () => {
    render(
      <LaneBenchmarkPanel
        isLoading={false}
        error={null}
        laneBenchmarks={response([
          {
            benchmarkId: 'undergrad-llm-gold-v2',
            sourceName: 'lab-microsite-undergrad-llm',
            runs: 2,
            change: 'code-changed',
            latest: run(),
            previous: run({
              codeSha: 'fdf1464d4e457ba1',
              outputFingerprint: 'fp-before',
              gold: [
                {
                  ...run().gold[0],
                  truePositive: 7,
                  falsePositive: 1,
                  precision: 0.875,
                  recall: 7 / 11,
                },
              ],
            }),
          },
        ])}
      />,
    );
    expect(screen.getByText('undergrad-llm-gold-v2')).toBeInTheDocument();
    expect(screen.getByText('Output changed with the code')).toBeInTheDocument();
    expect(screen.getByText(/precision 100%/)).toBeInTheDocument();
    expect(screen.getByText('+12.5 pts')).toBeInTheDocument();
    expect(screen.getByText('265 served, 2 missed')).toBeInTheDocument();
  });

  it('names a changed output under unchanged code as a leaked frozen input', () => {
    render(
      <LaneBenchmarkPanel
        isLoading={false}
        error={null}
        laneBenchmarks={response([
          {
            benchmarkId: 'dept-roster',
            sourceName: 'dept-faculty-roster',
            runs: 2,
            change: 'input-leak',
            latest: run({ gold: [] }),
            previous: run({ gold: [], outputFingerprint: 'fp-other' }),
          },
        ])}
      />,
    );
    expect(screen.getByText(/the frozen input leaked/)).toBeInTheDocument();
  });

  it('shows the loading, error and empty states', () => {
    const { rerender } = render(
      <LaneBenchmarkPanel isLoading error={null} laneBenchmarks={null} />,
    );
    expect(screen.getByText('Loading lane benchmarks.')).toBeInTheDocument();
    rerender(
      <LaneBenchmarkPanel
        isLoading={false}
        error="Failed to load lane benchmarks"
        laneBenchmarks={null}
      />,
    );
    expect(screen.getByText('Failed to load lane benchmarks')).toBeInTheDocument();
    rerender(<LaneBenchmarkPanel isLoading={false} error={null} laneBenchmarks={response([])} />);
    expect(screen.getByText('No benchmark has been replayed yet.')).toBeInTheDocument();
  });
});
