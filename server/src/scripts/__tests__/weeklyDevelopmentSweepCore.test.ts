import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { readSweepHeadSha } from '../runScraperSweep';
import {
  WEEKLY_SWEEP_CONFIRM_FLAG,
  WEEKLY_SWEEP_SUMMARY_MARKER,
  buildSnapshotCacheDropArgs,
  buildWeeklySweepArgs,
  findSweepSummaryPath,
  formatWeeklySweepSummaryLine,
  parseWeeklySweepArgs,
  weeklySweepChildEnvironment,
  weeklySweepEnvironmentProblems,
  weeklySweepExitCode,
} from '../weeklyDevelopmentSweepCore';

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

  it('accepts a dry run and a confirmed run', () => {
    expect(parseWeeklySweepArgs(['--dry-run'])).toEqual({ dryRun: true, confirmed: false });
    expect(parseWeeklySweepArgs([WEEKLY_SWEEP_CONFIRM_FLAG])).toEqual({
      dryRun: false,
      confirmed: true,
    });
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
    const ok = { exitCode: 0, summaryPath: '/s.json' };
    expect(
      weeklySweepExitCode([
        { mode: 'development-full', ...ok },
        { mode: 'fellowship-development-full', ...ok },
      ]),
    ).toBe(0);
    expect(
      weeklySweepExitCode([
        { mode: 'development-full', ...ok },
        { mode: 'fellowship-development-full', exitCode: 1, summaryPath: '/s.json' },
      ]),
    ).toBe(1);
    expect(
      weeklySweepExitCode([{ mode: 'development-full', exitCode: 0, summaryPath: null }]),
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
    ).toBe('def5678\n');
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
