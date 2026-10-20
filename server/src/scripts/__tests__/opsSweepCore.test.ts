import { describe, expect, it } from 'vitest';
import {
  buildPermissionProbePlan,
  buildRerunScrapeArgs,
  comparableScrapeRunFilter,
  compareRerunWithBaseline,
  developmentTargetProblems,
  entrypointSupportsRerun,
  entrypointSupportsResume,
  resumeJobStartCommand,
  resumeRefusals,
  formatSweepStatus,
  parseOpsSweepArgs,
  permissionProbeStartCommand,
  readRenderApiKey,
  rerunActivityRefusals,
  rerunJobStartCommand,
  rerunSourceProblems,
  SWEEP_DATABASE_ROLE,
} from '../opsSweepCore';
import type { StoredWeeklySweepRun } from '../weeklySweepRunsReportCore';

const DEV_URL = 'mongodb+srv://cluster.example.net/Development';
const NOW = new Date('2026-10-18T12:00:00Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const idleActivity = { heldLockSources: [], runningScrapeRuns: [], now: NOW };

describe('parseOpsSweepArgs', () => {
  it('parses the three commands', () => {
    expect(parseOpsSweepArgs(['status'])).toEqual({ command: 'status' });
    expect(parseOpsSweepArgs(['--', 'rerun', 'nih-reporter', 'nih-reporter', '--dry-run'])).toEqual(
      { command: 'rerun', sources: ['nih-reporter'], overrideHold: false, dryRun: true },
    );
    expect(parseOpsSweepArgs(['rerun', 'nih-reporter', '--override-hold']).command).toBe('rerun');
    expect(parseOpsSweepArgs(['probe-permissions'])).toEqual({
      command: 'probe-permissions',
      dryRun: false,
    });
  });

  it('refuses unknown commands, unknown flags and a rerun with no source', () => {
    expect(() => parseOpsSweepArgs([])).toThrow(/Usage/);
    expect(() => parseOpsSweepArgs(['rerun'])).toThrow(/at least one source/);
    expect(() => parseOpsSweepArgs(['rerun', 'nih-reporter', '--force-llm'])).toThrow(
      /Unknown option --force-llm/,
    );
    expect(() => parseOpsSweepArgs(['status', '--override-hold'])).toThrow(/Unknown option/);
  });
});

describe('developmentTargetProblems', () => {
  it('accepts Development', () => {
    expect(developmentTargetProblems({ MONGODBURL: DEV_URL, SCRAPER_ENV: 'development' })).toEqual(
      [],
    );
  });

  it('refuses any other database or scraper environment', () => {
    expect(
      developmentTargetProblems({ MONGODBURL: DEV_URL.replace('Development', 'Beta') }),
    ).toEqual(['MONGODBURL must name database Development; resolved Beta']);
    expect(developmentTargetProblems({ MONGODBURL: DEV_URL, SCRAPER_ENV: 'production' })).toEqual([
      'SCRAPER_ENV must resolve to development; resolved production',
    ]);
    expect(developmentTargetProblems({})).toEqual([
      'MONGODBURL must name database Development; resolved none',
    ]);
  });
});

describe('rerunSourceProblems', () => {
  it('accepts research and fellowship sweep sources', () => {
    expect(rerunSourceProblems(['nih-reporter', 'yale-reu-programs'], false)).toEqual([]);
  });

  it('refuses a held source unless the hold is overridden', () => {
    const [problem] = rerunSourceProblems(['lab-microsite-description-llm'], false);
    expect(problem).toMatch(/lab-microsite-description-llm is held/);
    expect(problem).toMatch(/#5020/);
    expect(rerunSourceProblems(['lab-microsite-description-llm'], true)).toEqual([]);
  });

  it('refuses a held writer lane even with the override, because the sweep never runs it', () => {
    const problems = rerunSourceProblems(['coverage-synthesis-llm'], true);
    expect(problems).toEqual([
      'coverage-synthesis-llm is not a weekly sweep source, so there are no sweep flags to rerun it with',
    ]);
  });

  it('refuses manual-only, unknown and unsafe names', () => {
    expect(rerunSourceProblems(['undergrad-research-posting'], false)[0]).toMatch(/manual-only/);
    expect(rerunSourceProblems(['no-such-lane'], false)[0]).toMatch(/not a weekly sweep source/);
    expect(rerunSourceProblems(['nih-reporter;rm'], false)[0]).toMatch(/is not a source name/);
    expect(rerunSourceProblems([], false)).toEqual(['no source was named']);
  });
});

describe('rerunActivityRefusals', () => {
  it('lets a rerun start when nothing else is writing', () => {
    expect(
      rerunActivityRefusals(['nih-reporter'], {
        ...idleActivity,
        newestWeeklySweep: { _id: 'w1', status: 'succeeded', startedAt: minutesAgo(30) },
      }),
    ).toEqual([]);
  });

  it('refuses while a weekly sweep is running', () => {
    const refusals = rerunActivityRefusals(['nih-reporter'], {
      ...idleActivity,
      newestWeeklySweep: { _id: 'w1', status: 'running', startedAt: minutesAgo(90) },
    });
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatch(/weekly sweep run w1 is running/);
  });

  it('ignores a running row past the Render limit, which Render already stopped', () => {
    expect(
      rerunActivityRefusals(['nih-reporter'], {
        ...idleActivity,
        newestWeeklySweep: { _id: 'w1', status: 'running', startedAt: minutesAgo(13 * 60) },
      }),
    ).toEqual([]);
  });

  it('refuses while a sweep source lock is held', () => {
    expect(
      rerunActivityRefusals(['nih-reporter'], {
        ...idleActivity,
        heldLockSources: ['yale-directory'],
      }),
    ).toEqual(['another writer holds a live scrape job lock on yale-directory']);
  });

  it('refuses a live run of the same source and ignores stale or other-source runs', () => {
    const refusals = rerunActivityRefusals(['nih-reporter'], {
      ...idleActivity,
      runningScrapeRuns: [
        { _id: 'r1', sourceName: 'nih-reporter', status: 'running', heartbeatAt: minutesAgo(2) },
        { _id: 'r2', sourceName: 'nih-reporter', status: 'running', heartbeatAt: minutesAgo(60) },
        { _id: 'r3', sourceName: 'yale-directory', status: 'running', heartbeatAt: minutesAgo(1) },
      ],
    });
    expect(refusals).toEqual(['a run of nih-reporter (r1) is running with a live heartbeat']);
  });
});

describe('rerun commands', () => {
  it('uses the development-full sweep flags and never --force-llm', () => {
    const args = buildRerunScrapeArgs('nih-reporter', '/tmp/nih.json');
    expect(args).toEqual([
      '--cwd',
      'server',
      'scrape',
      'run',
      '--source',
      'nih-reporter',
      '--ignore-work-planner',
      '--exhaustive',
      '--auto-materialize',
      '--output',
      '/tmp/nih.json',
    ]);
    expect(buildRerunScrapeArgs('yale-reu-programs', '/tmp/x.json')).not.toContain('--force-llm');
  });

  it('starts the job through the entrypoint rerun mode', () => {
    expect(rerunJobStartCommand(['nih-reporter', 'doe-osti'], false)).toBe(
      '/usr/bin/tini -- /app/deploy/sweep-runner/entrypoint.sh --rerun-source nih-reporter doe-osti',
    );
    expect(rerunJobStartCommand(['lab-microsite-description-llm'], true)).toMatch(
      / --override-hold$/,
    );
    expect(() => rerunJobStartCommand(['a b'], false)).toThrow(/refusing/);
  });

  it('recognises an image whose entrypoint has the rerun mode', () => {
    expect(entrypointSupportsRerun('if [ "${1:-}" = "--rerun-source" ]; then')).toBe(true);
    expect(entrypointSupportsRerun('exec yarn --cwd server scrape:sweep:weekly-development')).toBe(
      false,
    );
    expect(entrypointSupportsRerun(null)).toBe(false);
  });

  it('compares only with exhaustive, non-dry, unscoped runs', () => {
    expect(comparableScrapeRunFilter('nih-reporter')).toMatchObject({
      sourceName: 'nih-reporter',
      status: 'success',
      'options.dryRun': false,
      'options.exhaustive': true,
      'options.only': { $exists: false },
      'options.limit': { $exists: false },
    });
  });
});

describe('compareRerunWithBaseline', () => {
  const baseline = {
    _id: 'b1',
    startedAt: minutesAgo(600),
    observationCount: 4511,
    entitiesUpdated: 752,
  };
  const run = (overrides: Record<string, unknown>) => ({
    _id: 'c1',
    status: 'success',
    observationCount: 4511,
    entitiesUpdated: 752,
    ...overrides,
  });

  it('passes a run within the measured noise', () => {
    const comparison = compareRerunWithBaseline({
      sourceName: 'nih-reporter',
      baseline,
      current: run({ observationCount: 4445, entitiesUpdated: 741 }),
    });
    expect(comparison.verdict).toBe('ok');
    expect(comparison.problem).toBe(false);
  });

  it('flags an observation drop over 25%', () => {
    const comparison = compareRerunWithBaseline({
      sourceName: 'nih-reporter',
      baseline,
      current: run({ observationCount: 3000 }),
    });
    expect(comparison.verdict).toBe('regression');
    expect(comparison.problem).toBe(true);
    expect(comparison.lines.at(-1)).toMatch(/observations dropped/);
  });

  it('flags an entities-updated drop over 25%', () => {
    const comparison = compareRerunWithBaseline({
      sourceName: 'nih-reporter',
      baseline,
      current: run({ entitiesUpdated: 500 }),
    });
    expect(comparison.verdict).toBe('regression');
    expect(comparison.lines.at(-1)).toMatch(/entities updated dropped/);
  });

  it('ignores a large relative drop on a handful of rows', () => {
    expect(
      compareRerunWithBaseline({
        sourceName: 'doe-osti',
        baseline: { observationCount: 12, entitiesUpdated: 4 },
        current: run({ observationCount: 12, entitiesUpdated: 1 }),
      }).verdict,
    ).toBe('ok');
  });

  it('flags a run that produced nothing, a failed run and a missing run', () => {
    expect(
      compareRerunWithBaseline({ sourceName: 'x', baseline, current: run({ observationCount: 0 }) })
        .verdict,
    ).toBe('produced-nothing');
    expect(
      compareRerunWithBaseline({ sourceName: 'x', baseline, current: run({ status: 'failure' }) })
        .verdict,
    ).toBe('failed');
    const missing = compareRerunWithBaseline({ sourceName: 'x', baseline, current: null });
    expect(missing.verdict).toBe('missing');
    expect(missing.problem).toBe(true);
  });

  it('reports a first comparable run without flagging it', () => {
    const comparison = compareRerunWithBaseline({
      sourceName: 'x',
      baseline: null,
      current: run({}),
    });
    expect(comparison.verdict).toBe('no-baseline');
    expect(comparison.problem).toBe(false);
  });
});

describe('formatSweepStatus', () => {
  const finished = {
    _id: 'w1',
    startedAt: new Date('2026-10-16T04:00:49Z'),
    status: 'degraded',
    durationMs: 22_593_186,
    codeSha: '9ab8ce89855b7eec8dc3e89bb57338dbae5565c3',
    searchIndex: { status: 'resync-required', remedy: 'yarn development:search:sync' },
    sources: [
      { mode: 'development-full', sourceName: 'nih-reporter', status: 'success' },
      {
        mode: 'development-full',
        sourceName: 'nsf-award-search',
        status: 'failed',
        error: 'exited 1',
      },
    ],
    stages: [
      {
        mode: 'development-full',
        name: 'lane-scorecard',
        status: 'failed',
        failureKind: 'regression',
        error: 'a count rose',
      },
    ],
  } as unknown as StoredWeeklySweepRun;

  it('prints status, failures, duration, code against beta and the index state', () => {
    expect(
      formatSweepStatus({
        run: finished,
        betaHeadSha: '8043cccc749834144a7c0bcc8861a5d56d8b62ca',
        now: NOW,
      }),
    ).toBe(`Newest weekly sweep w1
  status: degraded
  started: 2026-10-16 04:00 UTC
  duration: 6h17m
  code: 9ab8ce898; beta HEAD is now 8043cccc7
  search index: resync-required; remedy \`yarn development:search:sync\`
  failed sources: 1
    nsf-award-search (development-full): exited 1
  failed stages: 1
    lane-scorecard (development-full) [regression]: a count rose`);
  });

  it('says when the sweep ran beta HEAD and when a running row outlived the limit', () => {
    const current = formatSweepStatus({
      run: { ...finished, sources: [], stages: [] },
      betaHeadSha: finished.codeSha!,
      now: NOW,
    });
    expect(current).toMatch(/code: 9ab8ce898, which is beta HEAD/);
    expect(current).toMatch(/failed sources: none/);
    const stopped = formatSweepStatus({
      run: { ...finished, status: 'running', startedAt: minutesAgo(13 * 60) },
      betaHeadSha: null,
      now: NOW,
    });
    expect(stopped).toMatch(/past Render's 12h00m limit/);
    expect(stopped).toMatch(/beta HEAD could not be read/);
    expect(formatSweepStatus({ run: null, betaHeadSha: null })).toMatch(/No weekly_sweep_runs row/);
  });
});

describe('readRenderApiKey', () => {
  it('prefers RENDER_API_KEY and falls back to the render CLI config', () => {
    const config =
      'version: 1\napi:\n    key: rnd_from_cli\n    host: https://api.render.com/v1/\n';
    expect(readRenderApiKey({ RENDER_API_KEY: ' rnd_env ' }, config)).toBe('rnd_env');
    expect(readRenderApiKey({}, config)).toBe('rnd_from_cli');
    expect(readRenderApiKey({}, 'version: 1\n')).toBeNull();
    expect(readRenderApiKey({}, null)).toBeNull();
  });
});

describe('buildPermissionProbePlan', () => {
  const role = {
    roleName: SWEEP_DATABASE_ROLE,
    inheritedRoles: [],
    actions: [
      { action: 'FIND', resources: [{ db: 'Development', collection: '' }] },
      { action: 'INSERT', resources: [{ db: 'Development', collection: 'scrape_runs' }] },
      { action: 'UPDATE', resources: [{ db: 'Development', collection: 'scrape_runs' }] },
      { action: 'REMOVE', resources: [{ db: 'Development', collection: 'scrape_runs' }] },
      { action: 'LIST_DATABASES', resources: [{ cluster: true }] },
      { action: 'COLL_STATS', resources: [{ db: 'Development', collection: '' }] },
    ],
  };

  it('probes every granted action and the expected denials', () => {
    const plan = buildPermissionProbePlan(role);
    expect(plan.expectedUser).toBe(SWEEP_DATABASE_ROLE);
    const described = plan.checks.map(
      (check) => `${check.expect} ${check.action} ${check.db}.${check.collection ?? ''}`,
    );
    expect(described).toEqual([
      'allowed find Development.__ops_sweep_permission_probe',
      'allowed insert Development.scrape_runs',
      'allowed listDatabases admin.',
      'allowed remove Development.scrape_runs',
      'allowed update Development.scrape_runs',
      'denied update Development.accounts',
      'denied createIndex Development.__ops_sweep_permission_probe',
      'denied drop Development.__ops_sweep_permission_probe',
      'denied find Beta.research_entities',
      'denied update Beta.research_entities',
      'denied find Prod.research_entities',
      'denied update Prod.research_entities',
    ]);
    expect(plan.unprobedActions).toEqual(['COLL_STATS']);
  });

  it('refuses a role that grants an expected denial, inherits roles, or is the wrong role', () => {
    expect(() =>
      buildPermissionProbePlan({
        ...role,
        actions: [{ action: 'UPDATE', resources: [{ db: 'Development', collection: 'accounts' }] }],
      }),
    ).toThrow(/grants what it must not: update Development.accounts/);
    expect(() =>
      buildPermissionProbePlan({
        ...role,
        inheritedRoles: [{ db: 'admin', role: 'readWriteAnyDatabase' }],
      }),
    ).toThrow(/inherits/);
    expect(() => buildPermissionProbePlan({ ...role, roleName: 'other' })).toThrow(/expected/);
  });

  it('encodes the runtime and plan into one node -e start command', () => {
    const plan = buildPermissionProbePlan(role);
    const command = permissionProbeStartCommand('function runPermissionProbeJob(plan) {}', plan);
    const encoded = command.match(/Buffer\.from\('([^']+)','base64'\)/)?.[1];
    const decoded = Buffer.from(encoded!, 'base64').toString('utf8');
    expect(command.startsWith('node -e "eval(')).toBe(true);
    expect(decoded).toContain('function runPermissionProbeJob(plan) {}');
    expect(decoded).toContain(`runPermissionProbeJob(${JSON.stringify(plan)});`);
  });
});

describe('ops:sweep resume (#5209)', () => {
  const RUN_ID = 'f'.repeat(24);
  const SHA = 'a'.repeat(40);
  const now = new Date('2026-10-20T12:00:00.000Z');
  const stopped = {
    _id: RUN_ID,
    status: 'running',
    codeSha: SHA,
    startedAt: new Date(now.getTime() - 13 * 60 * 60_000),
  };

  it('parses resume with an optional run id and the dry-run flag', () => {
    expect(parseOpsSweepArgs(['resume'])).toEqual({ command: 'resume', dryRun: false });
    expect(parseOpsSweepArgs(['resume', RUN_ID, '--dry-run'])).toEqual({
      command: 'resume',
      runId: RUN_ID,
      dryRun: true,
    });
    expect(() => parseOpsSweepArgs(['resume', 'nope'])).toThrow('24 hex');
    expect(() => parseOpsSweepArgs(['resume', RUN_ID, RUN_ID])).toThrow('at most one');
  });

  it('allows a resume only of an unfinished run past the Render limit with nothing else writing', () => {
    expect(resumeRefusals({ run: stopped, heldLockSources: [], now })).toEqual([]);
    expect(resumeRefusals({ run: null, heldLockSources: [], now })).toHaveLength(1);
    expect(
      resumeRefusals({
        run: { ...stopped, startedAt: new Date(now.getTime() - 60 * 60_000) },
        heldLockSources: [],
        now,
      })[0],
    ).toContain('may still be running');
    expect(
      resumeRefusals({ run: { ...stopped, status: 'failed' }, heldLockSources: [], now })[0],
    ).toContain('only an unfinished run');
    expect(
      resumeRefusals({ run: { ...stopped, codeSha: null }, heldLockSources: [], now })[0],
    ).toContain('no commit');
    expect(resumeRefusals({ run: stopped, heldLockSources: ['nih-reporter'], now })[0]).toContain(
      'nih-reporter',
    );
  });

  it('builds the entrypoint resume command and detects an image that supports it', () => {
    expect(resumeJobStartCommand(RUN_ID, SHA)).toBe(
      `/usr/bin/tini -- /app/deploy/sweep-runner/entrypoint.sh --resume-weekly-run ${RUN_ID} ${SHA} --confirm-weekly-development-sweep`,
    );
    expect(() => resumeJobStartCommand(RUN_ID, 'abc; rm -rf /')).toThrow('refusing');
    expect(entrypointSupportsResume('if [ "${1:-}" = "--resume-weekly-run" ]; then')).toBe(true);
    expect(entrypointSupportsResume('if [ "${1:-}" = "--rerun-source" ]; then')).toBe(false);
  });
});
