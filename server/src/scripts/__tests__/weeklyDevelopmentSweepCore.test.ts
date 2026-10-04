import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { readSweepHeadSha } from '../runScraperSweep';
import {
  WEEKLY_SWEEP_CONFIRM_FLAG,
  WEEKLY_SWEEP_SUMMARY_MARKER,
  buildCorpusSnapshotArgs,
  buildSnapshotCacheDropArgs,
  buildWeeklySweepArgs,
  buildWeeklySweepRunRecord,
  codeFreshnessRefusalPreflight,
  formatWeeklySweepRefusalLine,
  WEEKLY_SWEEP_REFUSED_MARKER,
  RENDER_CRON_RUN_LIMIT_MS,
  WEEKLY_SWEEP_ERROR_TEXT_LIMIT,
  findSweepSummaryPath,
  formatWeeklySweepSummaryLine,
  parseWeeklySweepArgs,
  weeklySweepChildEnvironment,
  weeklySweepEnvironmentProblems,
  weeklySweepExitCode,
  weeklySweepRunStatus,
} from '../weeklyDevelopmentSweepCore';
import { sweepSummaryFixture } from './fixtures/weeklySweepSummaryFixture';

const DEVELOPMENT_URL = 'mongodb+srv://user:pass@cluster.example.net/Development';

const completeEnv = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  SCRAPER_ENV: 'development',
  MONGODBURL: DEVELOPMENT_URL,
  OPENAI_API_KEY: 'synthetic-openai',
  YALIES_API_KEY: 'synthetic-yalies',
  ...overrides,
});

const tempDirs: string[] = [];
const makeTempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-sweep-test-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('parseWeeklySweepArgs', () => {
  it('refuses to run without either the confirmation or a dry run', () => {
    expect(() => parseWeeklySweepArgs([])).toThrow(WEEKLY_SWEEP_CONFIRM_FLAG);
  });

  it('accepts a dry run and a confirmed run, defaulting to both modes', () => {
    expect(parseWeeklySweepArgs(['--dry-run'])).toEqual({
      dryRun: true,
      confirmed: false,
      modes: ['development-full', 'fellowship-development-full'],
    });
    expect(parseWeeklySweepArgs([WEEKLY_SWEEP_CONFIRM_FLAG])).toEqual({
      dryRun: false,
      confirmed: true,
      modes: ['development-full', 'fellowship-development-full'],
    });
  });

  it('narrows the run to the requested modes, in sweep order, in either flag form', () => {
    expect(
      parseWeeklySweepArgs([WEEKLY_SWEEP_CONFIRM_FLAG, '--mode', 'fellowship-development-full'])
        .modes,
    ).toEqual(['fellowship-development-full']);
    expect(
      parseWeeklySweepArgs([
        '--dry-run',
        '--mode=fellowship-development-full',
        '--mode',
        'development-full',
        '--mode',
        'development-full',
      ]).modes,
    ).toEqual(['development-full', 'fellowship-development-full']);
  });

  it('rejects an unknown or missing mode', () => {
    expect(() => parseWeeklySweepArgs(['--dry-run', '--mode', 'beta-fetch'])).toThrow(
      '--mode must be one of',
    );
    expect(() => parseWeeklySweepArgs(['--dry-run', '--mode'])).toThrow('(missing)');
  });

  it('rejects an unknown argument', () => {
    expect(() => parseWeeklySweepArgs(['--dry-run', '--apply-beta'])).toThrow('Unknown');
  });
});

describe('weeklySweepEnvironmentProblems', () => {
  it('accepts a Development-only environment carrying every required secret', () => {
    expect(weeklySweepEnvironmentProblems(completeEnv())).toEqual([]);
  });

  it('names each missing secret, including the LLM key the extractor lanes read', () => {
    const problems = weeklySweepEnvironmentProblems(
      completeEnv({ OPENAI_API_KEY: '', YALIES_API_KEY: undefined }),
    );
    expect(problems).toEqual([
      'OPENAI_API_KEY is required and is not set',
      'YALIES_API_KEY is required and is not set',
    ]);
  });

  it('refuses a database other than Development', () => {
    const problems = weeklySweepEnvironmentProblems(
      completeEnv({ MONGODBURL: 'mongodb+srv://user:pass@cluster.example.net/Beta' }),
    );
    expect(problems).toEqual(['MONGODBURL must name database Development; resolved Beta']);
  });

  it('refuses a non-development scraper environment', () => {
    expect(weeklySweepEnvironmentProblems(completeEnv({ SCRAPER_ENV: 'production' }))).toContain(
      'SCRAPER_ENV must resolve to development; resolved production',
    );
  });

  it('refuses to run beside Beta or Production credentials', () => {
    const problems = weeklySweepEnvironmentProblems(
      completeEnv({ BETA_MONGODBURL: 'set', PRODUCTION_MONGODBURL: 'set' }),
    );
    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toContain('BETA_MONGODBURL is set');
    expect(problems.join('\n')).toContain('PRODUCTION_MONGODBURL is set');
  });
});

describe('weeklySweepChildEnvironment', () => {
  it('enables Development writes, pins the environment, and scopes the temp directory', () => {
    const env = weeklySweepChildEnvironment(
      completeEnv({ SCRAPER_ENV: 'dev', MEILISEARCH_INDEX_PREFIX: 'beta' }),
      '/tmp/job/development-full',
    );
    expect(env.SCRAPER_ENV).toBe('development');
    expect(env.ALLOW_NON_PROD_SCRAPER_WRITES).toBe('true');
    expect(env.CONFIRM_PROD_SCRAPE).toBe('false');
    expect(env.TMPDIR).toBe('/tmp/job/development-full');
    expect(env.MEILISEARCH_INDEX_PREFIX).toBeUndefined();
  });
});

describe('command builders', () => {
  it('runs each sweep mode fresh with its own confirmation', () => {
    expect(buildWeeklySweepArgs('development-full')).toEqual([
      '--cwd',
      'server',
      'scrape:sweep',
      '--mode=development-full',
      '--confirm-development-full-sweep',
      '--restart',
    ]);
    expect(buildWeeklySweepArgs('fellowship-development-full')).toContain(
      '--confirm-fellowship-sweep',
    );
  });

  it('drops the fetch cache through the prune command the sweep already uses', () => {
    const args = buildSnapshotCacheDropArgs('/tmp/job/drop.json');
    expect(args.slice(0, 3)).toEqual(['--cwd', 'server', 'observations:prune-dead']);
    expect(args.at(-1)).toBe('--drop-snapshot-cache');
  });
});

describe('findSweepSummaryPath', () => {
  it('returns null when the sweep wrote no summary', () => {
    const dir = makeTempDir();
    fs.mkdirSync(path.join(dir, 'ylabs-development-full-sweep-2026-10-04T07-00-00-000Z'));
    expect(findSweepSummaryPath(dir, 'development-full')).toBeNull();
    expect(findSweepSummaryPath(path.join(dir, 'missing'), 'development-full')).toBeNull();
  });

  it('finds the summary of the mode it was asked about, not another mode', () => {
    const dir = makeTempDir();
    const own = path.join(dir, 'ylabs-development-full-sweep-2026-10-04T07-00-00-000Z');
    const other = path.join(
      dir,
      'ylabs-fellowship-development-full-sweep-2026-10-04T08-00-00-000Z',
    );
    for (const sweepDir of [own, other]) {
      fs.mkdirSync(sweepDir);
      fs.writeFileSync(path.join(sweepDir, 'summary.json'), '{}');
    }
    expect(findSweepSummaryPath(dir, 'development-full')).toBe(path.join(own, 'summary.json'));
  });
});

describe('weeklySweepExitCode', () => {
  it('succeeds only when every mode exited zero and left a summary', () => {
    const ok = { exitCode: 0, summaryFound: true };
    expect(
      weeklySweepExitCode([
        { mode: 'development-full', ...ok },
        { mode: 'fellowship-development-full', ...ok },
      ]),
    ).toBe(0);
    expect(
      weeklySweepExitCode([
        { mode: 'development-full', ...ok },
        { mode: 'fellowship-development-full', exitCode: 1, summaryFound: true },
      ]),
    ).toBe(1);
    expect(
      weeklySweepExitCode([{ mode: 'development-full', exitCode: 0, summaryFound: false }]),
    ).toBe(1);
  });
});

describe('formatWeeklySweepSummaryLine', () => {
  it('writes one greppable line holding the mode and the summary', () => {
    const line = formatWeeklySweepSummaryLine('development-full', { failed: 0 });
    expect(line.startsWith(`${WEEKLY_SWEEP_SUMMARY_MARKER} `)).toBe(true);
    expect(JSON.parse(line.slice(WEEKLY_SWEEP_SUMMARY_MARKER.length + 1))).toEqual({
      mode: 'development-full',
      summary: { failed: 0 },
    });
  });
});

describe('readSweepHeadSha', () => {
  it('prefers the git checkout', () => {
    expect(
      readSweepHeadSha('/repo', { RENDER_GIT_COMMIT: 'a'.repeat(40) }, () => ({
        status: 0,
        stdout: 'def5678\n',
      })),
    ).toBe('def5678');
  });

  it('falls back to the commit an image was built from when there is no git metadata', () => {
    expect(
      readSweepHeadSha('/repo', { RENDER_GIT_COMMIT: ` ${'b'.repeat(40)} ` }, () => ({
        status: 128,
        stdout: '',
      })),
    ).toBe('b'.repeat(40));
    expect(readSweepHeadSha('/repo', {}, () => ({ status: 128, stdout: '' }))).toBeNull();
  });
});

describe('buildWeeklySweepRunRecord', () => {
  const startedAt = new Date('2026-10-04T07:00:00Z');
  const finishedAt = new Date('2026-10-04T15:30:00Z');
  const okPreflight = {
    ok: true,
    heldLockSources: [],
    storageBefore: { ok: false, usedMb: 4600, quotaMb: 5120, headroomMb: 520, minHeadroomMb: 800 },
    storageAfter: { ok: true, usedMb: 1200, quotaMb: 5120, headroomMb: 3920, minHeadroomMb: 800 },
    snapshotCacheDropped: true,
  };
  const recordFrom = (overrides: Partial<Parameters<typeof buildWeeklySweepRunRecord>[0]> = {}) =>
    buildWeeklySweepRunRecord({
      startedAt,
      finishedAt,
      databaseName: 'Development',
      codeSha: 'abc123',
      exitCode: 1,
      requestedModes: ['development-full', 'fellowship-development-full'],
      preflight: okPreflight,
      outcomes: [
        {
          mode: 'development-full',
          exitCode: 1,
          summaryFound: true,
          summary: sweepSummaryFixture(),
        },
        {
          mode: 'fellowship-development-full',
          exitCode: 0,
          summaryFound: true,
          summary: sweepSummaryFixture({
            mode: 'fellowship-development-full',
            rows: [],
            phases: [],
            postRun: undefined,
            throttleRetry: { recovered: 3, exhausted: 1, exhaustedSources: ['source-b'] },
            codeDrift: [
              {
                stage: 'source:x',
                startedSha: 'abc123',
                currentSha: 'def456',
                message: 'checkout moved',
              },
            ],
          }),
        },
      ],
      corpusSnapshot: { status: 'skipped' },
      ...overrides,
    });

  it('records a stale-code refusal as a refused run naming the lane commit it lacks', () => {
    const codeFreshness = {
      ok: false,
      codeSha: 'old0000',
      targetSha: 'old0000',
      newestLaneCommitSha: 'lane1111',
      refusal: 'the sweep would run old0000, which does not contain lane1111',
    };
    const record = recordFrom({
      codeSha: 'old0000',
      exitCode: 1,
      preflight: codeFreshnessRefusalPreflight(codeFreshness),
      outcomes: [],
    });

    expect(record.status).toBe('refused');
    expect(record.codeSha).toBe('old0000');
    expect(record.refusals).toEqual([codeFreshness.refusal]);
    expect(record.preflight.codeFreshness).toEqual(codeFreshness);
    expect(record.modes).toEqual([]);
    expect(formatWeeklySweepRefusalLine(codeFreshness)).toBe(
      `${WEEKLY_SWEEP_REFUSED_MARKER} ${JSON.stringify(codeFreshness)}`,
    );
  });

  it('records the commit a fresh run checked and that the search index needs a re-sync', () => {
    const codeFreshness = {
      ok: true,
      codeSha: 'abc123',
      targetSha: 'abc123',
      newestLaneCommitSha: 'lane1111',
    };
    const record = recordFrom({
      preflight: { ...okPreflight, codeFreshness },
      searchIndex: { status: 'resync-required', remedy: 'yarn development:search:rebuild' },
    });

    expect(record.preflight.codeFreshness).toEqual(codeFreshness);
    expect(record.searchIndex).toEqual({
      status: 'resync-required',
      remedy: 'yarn development:search:rebuild',
    });
  });

  it('flattens each source, stage and phase into queryable rows with their timings', () => {
    const record = recordFrom();
    expect(
      record.sources.map((source) => [source.mode, source.sourceName, source.durationMs]),
    ).toEqual([
      ['development-full', 'source-a', 7_200_000],
      ['development-full', 'source-b', 600_000],
    ]);
    expect(record.sources[0]).toMatchObject({
      phase: 'discovery',
      status: 'succeeded',
      exitCode: 0,
      observationCount: 120,
      throttleRecovered: 7,
      startedAt: new Date('2026-10-04T07:01:00.000Z'),
    });
    expect(record.stages).toEqual([
      {
        mode: 'development-full',
        name: 'visibility-gate',
        status: 'succeeded',
        exitCode: 0,
        durationMs: 900_000,
      },
    ]);
    expect(record.phases).toEqual([
      {
        mode: 'development-full',
        phase: 'discovery',
        startedAt: new Date('2026-10-04T07:01:00.000Z'),
        finishedAt: new Date('2026-10-04T09:01:00.000Z'),
        durationMs: 7_200_000,
      },
    ]);
    expect(record.modes[0]).toMatchObject({
      mode: 'development-full',
      durationMs: 6 * 60 * 60 * 1000,
      sourceCount: 2,
      failed: 1,
      postRunStatus: 'succeeded',
      postRunDurationMs: 1_200_000,
      throttleRecovered: 7,
      throttleExhausted: 2,
    });
  });

  it('keeps rows small by dropping artifact paths and stage deltas and capping error text', () => {
    const record = recordFrom();
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain('artifactPath');
    expect(serialized).not.toContain('mergeDelta');
    expect(record.sources[1].error).toHaveLength(WEEKLY_SWEEP_ERROR_TEXT_LIMIT);
    expect(recordFrom({ error: 'y'.repeat(5_000) }).error).toHaveLength(
      WEEKLY_SWEEP_ERROR_TEXT_LIMIT,
    );
  });

  it('measures total wall time against the Render cron limit', () => {
    const record = recordFrom();
    expect(record.durationMs).toBe(8.5 * 60 * 60 * 1000);
    expect(record.renderLimit).toEqual({
      limitMs: RENDER_CRON_RUN_LIMIT_MS,
      withinLimit: true,
      headroomMs: 3.5 * 60 * 60 * 1000,
    });
    const overrun = recordFrom({ finishedAt: new Date('2026-10-04T20:00:00Z') });
    expect(overrun.renderLimit.withinLimit).toBe(false);
    expect(overrun.renderLimit.headroomMs).toBe(-60 * 60 * 1000);
  });

  it('totals throttle retries across modes and records code drift as a refusal', () => {
    const record = recordFrom();
    expect(record.throttleRetry).toEqual({
      recovered: 10,
      exhausted: 3,
      exhaustedSources: ['source-b'],
    });
    expect(record.codeDrift).toEqual([
      {
        mode: 'fellowship-development-full',
        stage: 'source:x',
        startedSha: 'abc123',
        currentSha: 'def456',
        message: 'checkout moved',
      },
    ]);
    expect(record.refusals).toEqual(['checkout moved']);
    expect(record.preflight.storageBefore?.usedMb).toBe(4600);
    expect(record.preflight.storageAfter?.usedMb).toBe(1200);
    expect(record.status).toBe('failed');
  });

  it('records a preflight refusal as refused with its reason, distinct from a failed sweep', () => {
    const refused = recordFrom({
      preflight: {
        ok: false,
        heldLockSources: ['source-a'],
        snapshotCacheDropped: false,
        refusal: 'held lock',
      },
      outcomes: [],
    });
    expect(refused.status).toBe('refused');
    expect(refused.refusals).toEqual(['held lock']);
    expect(refused.sources).toEqual([]);
    expect(refused.throttleRetry).toEqual({ recovered: 0, exhausted: 0, exhaustedSources: [] });
  });

  it('records a thrown error as failed even when the preflight never completed', () => {
    const record = recordFrom({
      preflight: { ok: false, heldLockSources: [], snapshotCacheDropped: false },
      outcomes: [],
      error: 'connection reset',
    });
    expect(record.status).toBe('failed');
    expect(record.error).toBe('connection reset');
  });

  it('tolerates a mode that wrote no summary', () => {
    const record = recordFrom({
      outcomes: [{ mode: 'development-full', exitCode: 1, summaryFound: false }],
    });
    expect(record.modes).toEqual([
      {
        mode: 'development-full',
        exitCode: 1,
        summaryFound: false,
        sourceCount: 0,
        succeeded: 0,
        failed: 0,
        notRun: 0,
        producedNothing: 0,
        throttleRecovered: 0,
        throttleExhausted: 0,
      },
    ]);
  });
});

describe('weeklySweepRunStatus', () => {
  it('maps preflight, exit code, and error to one status', () => {
    expect(weeklySweepRunStatus(true, 0)).toBe('succeeded');
    expect(weeklySweepRunStatus(true, 1)).toBe('failed');
    expect(weeklySweepRunStatus(false, 1)).toBe('refused');
    expect(weeklySweepRunStatus(true, 0, 'boom')).toBe('failed');
  });
});

describe('buildCorpusSnapshotArgs', () => {
  it('takes the snapshot through the existing corpus:snapshot command against development', () => {
    expect(buildCorpusSnapshotArgs()).toEqual([
      '--cwd',
      'server',
      'corpus:snapshot',
      '--environment',
      'development',
    ]);
  });
});
