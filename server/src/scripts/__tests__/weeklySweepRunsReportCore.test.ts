import { describe, expect, it } from 'vitest';
import {
  buildWeeklySweepRunRecord,
  buildWeeklySweepRunStartRecord,
} from '../weeklyDevelopmentSweepCore';
import {
  DEFAULT_WEEKLY_SWEEP_RUNS_LIMIT,
  formatDuration,
  formatWeeklySweepRun,
  formatWeeklySweepRuns,
  formatWeeklySweepRunsComparison,
  parseWeeklySweepRunsReportArgs,
  slowestSteps,
} from '../weeklySweepRunsReportCore';
import { sweepSummaryFixture } from './fixtures/weeklySweepSummaryFixture';

const runOn = (day: string, sourceAMinutes: number, totalHours: number) =>
  buildWeeklySweepRunRecord({
    startedAt: new Date(`${day}T07:00:00Z`),
    finishedAt: new Date(new Date(`${day}T07:00:00Z`).getTime() + totalHours * 3_600_000),
    databaseName: 'Development',
    codeSha: 'abcdef1234567890',
    exitCode: 1,
    requestedModes: ['development-full', 'fellowship-development-full'],
    preflight: {
      ok: true,
      heldLockSources: [],
      storageBefore: {
        ok: true,
        usedMb: 2906,
        quotaMb: 5120,
        headroomMb: 2214,
        minHeadroomMb: 800,
      },
      snapshotCacheDropped: false,
    },
    outcomes: [
      {
        mode: 'development-full',
        exitCode: 1,
        summaryFound: true,
        summary: sweepSummaryFixture({
          rows: sweepSummaryFixture().rows.map((row) =>
            row.sourceName === 'source-a' ? { ...row, durationMs: sourceAMinutes * 60_000 } : row,
          ),
        }),
      },
      { mode: 'fellowship-development-full', exitCode: 1, summaryFound: false },
    ],
    corpusSnapshot: { status: 'skipped' },
  });

describe('parseWeeklySweepRunsReportArgs', () => {
  it('defaults to the last five runs in detail', () => {
    expect(parseWeeklySweepRunsReportArgs([])).toEqual({
      limit: DEFAULT_WEEKLY_SWEEP_RUNS_LIMIT,
      json: false,
      compare: false,
    });
  });

  it('accepts --limit in both forms, --json and --compare', () => {
    expect(parseWeeklySweepRunsReportArgs(['--limit', '3', '--compare'])).toEqual({
      limit: 3,
      json: false,
      compare: true,
    });
    expect(parseWeeklySweepRunsReportArgs(['--', '--limit=5', '--json'])).toMatchObject({
      limit: 5,
      json: true,
    });
  });

  it('refuses a non-positive limit and an unknown argument', () => {
    expect(() => parseWeeklySweepRunsReportArgs(['--limit', '0'])).toThrow(/positive integer/);
    expect(() => parseWeeklySweepRunsReportArgs(['--limit'])).toThrow(/positive integer/);
    expect(() => parseWeeklySweepRunsReportArgs(['--write'])).toThrow(/Unknown/);
  });
});

describe('formatDuration', () => {
  it('prints hours and minutes', () => {
    expect(formatDuration(8 * 3_600_000 + 5 * 60_000)).toBe('8h05m');
    expect(formatDuration(10 * 60_000)).toBe('10m');
    expect(formatDuration(undefined)).toBe('-');
  });
});

describe('formatWeeklySweepRun', () => {
  it('shows total time against the Render limit, slowest steps, failures and throttle losses', () => {
    const text = formatWeeklySweepRun(runOn('2026-10-11', 120, 8.5));
    expect(text).toContain(
      '2026-10-11 07:00 UTC  research+fellowship  failed  code abcdef123  took 8h30m of 12h00m (3h30m headroom)',
    );
    expect(text).toContain(
      'research: 6h00m, 1 ok / 1 failed / 0 not run, post-run succeeded (20m)',
    );
    expect(text).toContain('fellowship: exit 1, no summary');
    expect(text).toContain('storage: 2906/5120 MB before');
    expect(text).toContain('throttle: 7 recovered, 2 lost (source-b 2)');
    expect(text).toContain('slowest: source-a 2h00m, visibility-gate (post-run) 15m, source-b 10m');
    expect(text).toContain('failed: source-b (exit 1)');
  });

  it('flags a run that overran the Render limit', () => {
    expect(formatWeeklySweepRun(runOn('2026-10-11', 120, 13))).toContain(
      'OVER the 12h00m limit by 1h00m',
    );
  });

  const startedRun = () =>
    buildWeeklySweepRunStartRecord({
      startedAt: new Date('2026-10-11T07:00:00Z'),
      databaseName: 'Development',
      codeSha: 'abcdef1234567890',
      requestedModes: ['development-full'],
    });

  it('reports a run stopped at the Render limit as never finished', () => {
    const text = formatWeeklySweepRun(startedRun(), new Date('2026-10-11T19:30:00Z'));
    expect(text).toContain(
      '2026-10-11 07:00 UTC  research  running  code abcdef123  never finished',
    );
    expect(text).toContain('started 12h30m ago, past the 12h00m limit');
  });

  it('reports a run still inside the Render limit as running', () => {
    expect(formatWeeklySweepRuns([startedRun()], new Date('2026-10-11T10:00:00Z'))).toContain(
      'still running, 3h00m so far of 12h00m',
    );
  });

  it('says so when nothing is recorded', () => {
    expect(formatWeeklySweepRuns([])).toMatch(/No weekly sweep runs recorded/);
  });
});

describe('slowestSteps', () => {
  it('ranks sources and post-run stages together and caps the list', () => {
    expect(slowestSteps(runOn('2026-10-11', 120, 8), 2).map((step) => step.label)).toEqual([
      'source-a',
      'visibility-gate (post-run)',
    ]);
  });
});

describe('formatWeeklySweepRunsComparison', () => {
  it('lays out per-step durations oldest to newest with the latest change', () => {
    const table = formatWeeklySweepRunsComparison([
      runOn('2026-10-18', 150, 9),
      runOn('2026-10-11', 120, 8),
    ]);
    const lines = table.split('\n');
    expect(lines[0]).toMatch(
      /^step\s+2026-10-11 research\+fellowship\s+2026-10-18 research\+fellowship\s+change$/,
    );
    expect(lines[2]).toMatch(/^TOTAL\s+8h00m\s+9h00m\s+\+13%$/);
    expect(lines[3]).toMatch(/^source-a\s+2h00m\s+2h30m\s+\+25%$/);
    expect(table).toContain('visibility-gate (research post-run)');
  });

  it('compares a split run against the last run that covered the same modes and steps', () => {
    const researchOnly = (day: string, minutes: number, hours: number) => ({
      ...runOn(day, minutes, hours),
      requestedModes: ['development-full' as const],
    });
    const fellowshipOnly = {
      ...runOn('2026-10-17', 1, 2),
      requestedModes: ['fellowship-development-full' as const],
      sources: [],
      stages: [],
    };
    const table = formatWeeklySweepRunsComparison([
      researchOnly('2026-10-18', 150, 9),
      fellowshipOnly,
      researchOnly('2026-10-11', 120, 8),
    ]);
    const lines = table.split('\n');
    expect(lines[0]).toContain('2026-10-17 fellowship');
    expect(lines[2]).toMatch(/^TOTAL\s+8h00m\s+2h00m\s+9h00m\s+\+13%$/);
    expect(lines[3]).toMatch(/^source-a\s+2h00m\s+-\s+2h30m\s+\+25%$/);
  });

  it('labels a legacy row without requestedModes by the modes it recorded', () => {
    const legacy = { ...runOn('2026-10-11', 120, 8), requestedModes: undefined };
    expect(formatWeeklySweepRun(legacy)).toContain('UTC  research+fellowship  failed');
  });
});
