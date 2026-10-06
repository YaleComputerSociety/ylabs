import { describe, expect, it } from 'vitest';
import {
  SWEEP_ENGINE_BENCHMARK_ID,
  classifyEngineBenchmarkChange,
  sweepEngineBenchmarkKeys,
  toEngineBenchmarkRunDto,
} from '../engineBenchmarkTrendCore';

const run = (overrides: Record<string, unknown>) =>
  toEngineBenchmarkRunDto({
    measuredAt: new Date('2026-09-01T00:00:00.000Z'),
    codeSha: 'aaa',
    rowsWithIncompleteInput: 0,
    invalidatedRunSetChanged: false,
    outputFingerprint: 'fingerprint-a',
    ...overrides,
  });

describe('classifyEngineBenchmarkChange', () => {
  it('reads the first stored replay as a first run', () => {
    expect(classifyEngineBenchmarkChange(run({}), null)).toBe('first-run');
  });

  it('reads an unchanged fingerprint as unchanged even when the input was incomplete', () => {
    expect(classifyEngineBenchmarkChange(run({ rowsWithIncompleteInput: 2 }), run({}))).toBe(
      'unchanged',
    );
  });

  it('attributes a fingerprint change to the code only when both replays read fully frozen input', () => {
    expect(
      classifyEngineBenchmarkChange(run({ codeSha: 'bbb', outputFingerprint: 'b' }), run({})),
    ).toBe('code-changed');
    expect(classifyEngineBenchmarkChange(run({ outputFingerprint: 'b' }), run({}))).toBe(
      'input-leak',
    );
  });

  it('refuses to attribute a change when either replay read unfrozen input or a moved quarantine set', () => {
    expect(
      classifyEngineBenchmarkChange(
        run({ codeSha: 'bbb', outputFingerprint: 'b', rowsWithIncompleteInput: 1 }),
        run({}),
      ),
    ).toBe('input-incomplete');
    expect(
      classifyEngineBenchmarkChange(
        run({ codeSha: 'bbb', outputFingerprint: 'b' }),
        run({ invalidatedRunSetChanged: true }),
      ),
    ).toBe('input-incomplete');
  });
});

describe('sweepEngineBenchmarkKeys', () => {
  it('keeps the benchmark the sweep replays and counts each one-off probe once', () => {
    const { replayed, oneOffBenchmarkCount } = sweepEngineBenchmarkKeys([
      { benchmarkId: 'probe-a', stage: 'resolve-and-gate' },
      { benchmarkId: 'probe-a', stage: 'other-stage' },
      { benchmarkId: SWEEP_ENGINE_BENCHMARK_ID, stage: 'resolve-and-gate' },
      { benchmarkId: 'probe-b', stage: 'resolve-and-gate' },
    ]);

    expect(replayed).toEqual([
      { benchmarkId: SWEEP_ENGINE_BENCHMARK_ID, stage: 'resolve-and-gate' },
    ]);
    expect(oneOffBenchmarkCount).toBe(2);
  });
});
