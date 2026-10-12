import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LaneBenchmarkPanel from '../LaneBenchmarkPanel';
import type { EngineBenchmarkRun, LaneBenchmarkResponse } from '../laneBenchmarkTypes';

const engineRun = (overrides: Partial<EngineBenchmarkRun> = {}): EngineBenchmarkRun => ({
  measuredAt: '2026-09-29T06:25:02.652Z',
  codeSha: 'b23a29ddc4dc6c70',
  rowsReplayed: 147,
  rowsWithIncompleteInput: 0,
  invalidatedRunSetChanged: false,
  resolved: 4675,
  cleared: 3,
  knownWrong: 0,
  labelsMatched: 31,
  labelCount: 31,
  outputFingerprint: 'fp-after',
  ...overrides,
});

const response = (engine: LaneBenchmarkResponse['engine']): LaneBenchmarkResponse => ({
  benchmarks: [],
  measurementCollection: 'lane_scorecard_snapshots',
  refreshCommand: 'yarn --cwd server lane:scorecard --apply --confirm-lane-scorecard',
  engine,
});

describe('EngineBenchmarkRows', () => {
  it('shows each engine benchmark latest replay and its change from the previous one', () => {
    render(
      <LaneBenchmarkPanel
        isLoading={false}
        error={null}
        laneBenchmarks={response({
          measurementCollection: 'engine_benchmark_snapshots',
          refreshCommand: 'yarn --cwd server engine:benchmark',
          benchmarks: [
            {
              benchmarkId: 'engine-synthetic-arms',
              stage: 'resolve-and-gate',
              runs: 2,
              change: 'code-changed',
              latest: engineRun(),
              previous: engineRun({ resolved: 4600, labelsMatched: 29, codeSha: 'e7b36f2153b1' }),
            },
            {
              benchmarkId: 'engine-synthetic-leak',
              stage: 'resolve-and-gate',
              runs: 3,
              change: 'input-incomplete',
              latest: engineRun({ rowsWithIncompleteInput: 1 }),
              previous: engineRun(),
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('Is the engine getting better?')).toBeInTheDocument();
    expect(screen.getByText('engine-synthetic-arms')).toBeInTheDocument();
    expect(screen.getByText('Output changed with the code')).toBeInTheDocument();
    expect(screen.getByText('+75')).toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(
      screen.getByText('Output changed, but a replay read input the capture did not freeze'),
    ).toBeInTheDocument();
    expect(screen.getByText(/147 rows, 1\s+incomplete/)).toBeInTheDocument();
  });

  it('says so when no engine benchmark has been replayed', () => {
    render(
      <LaneBenchmarkPanel
        isLoading={false}
        error={null}
        laneBenchmarks={response({
          measurementCollection: 'engine_benchmark_snapshots',
          refreshCommand: 'yarn --cwd server engine:benchmark',
          benchmarks: [],
        })}
      />,
    );

    expect(screen.getByText('No engine benchmark has been replayed yet.')).toBeInTheDocument();
  });

  it('says how many one-off probe benchmarks are left off the engine panel', () => {
    render(
      <LaneBenchmarkPanel
        isLoading={false}
        error={null}
        laneBenchmarks={response({
          measurementCollection: 'engine_benchmark_snapshots',
          refreshCommand: 'yarn --cwd server engine:benchmark',
          benchmarks: [],
          oneOffBenchmarkCount: 4,
        })}
      />,
    );

    expect(screen.getByText(/4 one-off probe benchmarks are not shown/)).toBeInTheDocument();
  });
});
