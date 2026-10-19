import { describe, expect, it } from 'vitest';
import {
  datasetVersionFor,
  mirrorApplyProblems,
  mirrorPlanProblems,
  parsePromoteBetaArgs,
  parsePromoteProductionArgs,
  parseRemotePhaseArgs,
  productionPlanProblems,
  releaseHoldProblems,
  remotePhaseEnvironmentProblems,
  remotePhaseStartCommand,
  remotePhaseSteps,
  renderServiceProblems,
  searchReindexResultFile,
  summarizeSearchReindexResult,
  renderSetupProblems,
  missingWeeklyRunIds,
  weeklyRunCoverage,
  operatorBuildDecision,
} from '../promoteCore';
import type { StoredWeeklySweepRun } from '../weeklySweepRunsReportCore';

const NOW = new Date('2026-10-05T12:00:00Z');

const succeededRun = (overrides: Partial<StoredWeeklySweepRun> = {}): StoredWeeklySweepRun => ({
  startedAt: new Date('2026-10-04T07:00:00Z'),
  finishedAt: new Date('2026-10-04T16:00:00Z'),
  status: 'succeeded',
  exitCode: 0,
  codeDrift: [],
  refusals: [],
  modes: [
    { mode: 'development-full', exitCode: 0, summaryFound: true },
    { mode: 'fellowship-development-full', exitCode: 0, summaryFound: true },
  ],
  ...overrides,
});

const researchOnly = (overrides: Partial<StoredWeeklySweepRun> = {}): StoredWeeklySweepRun =>
  succeededRun({
    _id: 'research1',
    requestedModes: ['development-full'],
    modes: [{ mode: 'development-full', exitCode: 0, summaryFound: true }],
    ...overrides,
  });

const fellowshipOnly = (overrides: Partial<StoredWeeklySweepRun> = {}): StoredWeeklySweepRun =>
  succeededRun({
    _id: 'fellowship1',
    startedAt: new Date('2026-10-03T07:00:00Z'),
    finishedAt: new Date('2026-10-03T09:00:00Z'),
    requestedModes: ['fellowship-development-full'],
    modes: [{ mode: 'fellowship-development-full', exitCode: 0, summaryFound: true }],
    ...overrides,
  });

describe('weeklyRunCoverage', () => {
  it('accepts one recent run whose two modes both succeeded', () => {
    const run = succeededRun({ _id: 'both1' });
    const coverage = weeklyRunCoverage([run], NOW);
    expect(coverage.problems).toEqual([]);
    expect(coverage.covered.map((entry) => [entry.mode, entry.run._id])).toEqual([
      ['development-full', 'both1'],
      ['fellowship-development-full', 'both1'],
    ]);
  });

  it('accepts two split runs, each covering its own mode', () => {
    const coverage = weeklyRunCoverage([researchOnly(), fellowshipOnly()], NOW);
    expect(coverage.problems).toEqual([]);
    expect(coverage.covered.map((entry) => entry.run._id)).toEqual(['research1', 'fellowship1']);
  });

  it('judges each mode by the newest run covering it, not an older success', () => {
    const coverage = weeklyRunCoverage(
      [
        researchOnly({ _id: 'research2', status: 'failed', exitCode: 1 }),
        fellowshipOnly(),
        researchOnly(),
      ],
      NOW,
    );
    expect(coverage.problems).toEqual([
      'development-full run research2 started 2026-10-04T07:00:00.000Z status is failed',
      'development-full run research2 started 2026-10-04T07:00:00.000Z exit code is 1',
    ]);
    expect(coverage.covered.map((entry) => entry.mode)).toEqual(['fellowship-development-full']);
  });

  it('refuses when no run was recorded, or a mode has no covering run', () => {
    expect(weeklyRunCoverage([], NOW).problems).toEqual([
      'no weekly_sweep_runs record in Development covers development-full',
      'no weekly_sweep_runs record in Development covers fellowship-development-full',
    ]);
    expect(weeklyRunCoverage([researchOnly()], NOW).problems).toEqual([
      'no weekly_sweep_runs record in Development covers fellowship-development-full',
    ]);
  });

  it('refuses a drifted, stale, or summary-less mode', () => {
    const problems = weeklyRunCoverage(
      [
        researchOnly({
          finishedAt: new Date('2026-09-20T00:00:00Z'),
          codeDrift: [{ mode: 'development-full', stage: 'visibility-gate', message: 'moved' }],
          modes: [{ mode: 'development-full', exitCode: 0, summaryFound: false }],
        }),
        fellowshipOnly(),
      ],
      NOW,
    ).problems;
    const label = 'development-full run research1 started 2026-10-04T07:00:00.000Z';
    expect(problems).toEqual([
      `${label} recorded 1 code-drift refusal(s)`,
      `${label} exited 0 or left no summary`,
      `${label} finished 2026-09-20T00:00:00.000Z, more than 8 days ago`,
    ]);
  });

  it('reads a legacy row without requestedModes as covering every mode', () => {
    const legacy = succeededRun({ _id: 'legacy1', requestedModes: undefined });
    expect(weeklyRunCoverage([legacy], NOW).problems).toEqual([]);
  });

  it('refuses on a newer legacy row that never recorded an outcome instead of an older success', () => {
    const unfinished = succeededRun({
      _id: 'legacy2',
      startedAt: new Date('2026-10-04T07:00:00Z'),
      finishedAt: undefined,
      status: 'running',
      exitCode: undefined,
      requestedModes: [],
      modes: [],
    });
    const olderSuccess = succeededRun({
      _id: 'legacy1',
      startedAt: new Date('2026-09-29T07:00:00Z'),
      finishedAt: new Date('2026-09-29T16:00:00Z'),
      requestedModes: undefined,
    });
    const coverage = weeklyRunCoverage([unfinished, olderSuccess], NOW);
    expect(coverage.covered).toEqual([]);
    expect(coverage.problems.length).toBeGreaterThan(0);
    expect(coverage.problems.every((problem) => problem.includes('legacy2'))).toBe(true);
  });

  it('names a requested run id that was not found', () => {
    expect(missingWeeklyRunIds(['research1', 'gone'], [researchOnly()])).toEqual(['gone']);
  });
});

describe('argument parsing', () => {
  it('parses promote:beta flags', () => {
    expect(
      parsePromoteBetaArgs([
        '--dry-run',
        '--yes',
        '--weekly-run',
        'abc',
        '--weekly-run',
        'def',
        '--backup-ref',
        'snap-1',
      ]),
    ).toEqual({
      dryRun: true,
      yes: true,
      weeklyRunIds: ['abc', 'def'],
      allowWithoutWeeklyRun: false,
      backupRef: 'snap-1',
      skipRemotePhase: false,
      fullSearchRebuild: false,
    });
    expect(parsePromoteBetaArgs(['--full-search-rebuild']).fullSearchRebuild).toBe(true);
    expect(parsePromoteProductionArgs(['--full-search-rebuild']).fullSearchRebuild).toBe(true);
    expect(() => parsePromoteBetaArgs(['--backup-ref'])).toThrow('--backup-ref requires a value');
    expect(() => parsePromoteBetaArgs(['--apply'])).toThrow('Unknown promote:beta argument');
  });

  it('derives the production dataset version from the date and rejects --yes', () => {
    expect(datasetVersionFor(NOW)).toBe('prod-promote-2026-10-05-lane-a-beta-copy');
    expect(parsePromoteProductionArgs([], NOW).datasetVersion).toBe(
      'prod-promote-2026-10-05-lane-a-beta-copy',
    );
    expect(() => parsePromoteProductionArgs(['--yes'], NOW)).toThrow('never accepts --yes');
    expect(() =>
      parsePromoteProductionArgs(['--dataset-version', 'prod-promote-facet-fix'], NOW),
    ).toThrow('--dataset-version must look like');
  });

  it('parses the remote phase and keeps the backup flag to beta', () => {
    expect(parseRemotePhaseArgs(['--environment', 'beta', '--confirm-beta-backup'])).toEqual({
      environment: 'beta',
      confirmBetaBackup: true,
      fullSearchRebuild: false,
    });
    expect(
      parseRemotePhaseArgs(['--environment', 'production', '--full-search-rebuild'])
        .fullSearchRebuild,
    ).toBe(true);
    expect(() => parseRemotePhaseArgs([])).toThrow('--environment beta|production is required');
    expect(() =>
      parseRemotePhaseArgs(['--environment', 'production', '--confirm-beta-backup']),
    ).toThrow('applies only to --environment beta');
    expect(() => parseRemotePhaseArgs(['--environment', 'development'])).toThrow(
      'must be beta or production',
    );
  });
});

describe('plan checks', () => {
  it('requires a Development to Beta mirror that reports applied', () => {
    const plan = {
      sourceEnvironment: 'development',
      targetEnvironment: 'beta',
      collections: [{ name: 'research_entities', sourceCopyCount: 10, targetCount: 9 }],
    };
    expect(mirrorPlanProblems(plan)).toEqual([]);
    expect(mirrorApplyProblems(plan)).toEqual(['mirror status is missing']);
    expect(mirrorApplyProblems({ ...plan, status: 'applied' })).toEqual([]);
    expect(mirrorPlanProblems({ ...plan, targetEnvironment: 'production' })).toEqual([
      'mirror target is production, not beta',
    ]);
  });

  it('refuses a production plan with blockers or an evidence trail', () => {
    expect(
      productionPlanProblems({
        sourceEnvironment: 'beta',
        targetEnvironment: 'production',
        accountReferenceBlockersClear: false,
        applyBlockers: ['empty source accounts'],
        includesObservations: true,
        includesScrapeRuns: true,
        collections: [{ name: 'accounts' }],
      }),
    ).toEqual([
      'promoted corpus rows still carry account _id references',
      'apply blockers: empty source accounts',
      'plan would promote observations',
      'plan would promote scrape_runs',
    ]);
  });

  it('holds production on a hold label but not on draft state', () => {
    expect(
      releaseHoldProblems([
        { number: 7, isDraft: true, labels: [] },
        { number: 8, isDraft: false, labels: [{ name: 'Hold' }] },
      ]),
    ).toEqual(['promotion pull request #8 to main carries the hold label']);
  });
});

describe('remote phase', () => {
  it('runs the Beta gate before the reindex and readiness last', () => {
    const labels = remotePhaseSteps('beta', { confirmBetaBackup: true }).map((step) => step.label);
    expect(labels).toEqual([
      'verify database names',
      'retarget saved plans',
      'visibility gate',
      'data quality',
      'integrity gate',
      'trust contract',
      'search reindex',
      'beta readiness',
    ]);
    const readiness = remotePhaseSteps('beta', { confirmBetaBackup: true }).at(-1)!;
    expect(readiness.args).toContain('--confirm-beta-backup');
    expect(remotePhaseSteps('beta').at(-1)!.args).not.toContain('--confirm-beta-backup');
    const trust = remotePhaseSteps('beta').find((step) => step.label === 'trust contract')!;
    expect(trust.args).toContain('--fail-on-public-visibility-violation');
    expect(trust.args).not.toContain('--strict');
  });

  it('confirms the production reindex and smokes after it', () => {
    const steps = remotePhaseSteps('production');
    expect(steps.map((step) => step.label)).toEqual([
      'verify database names',
      'retarget saved plans',
      'visibility gate',
      'search reindex',
      'production smoke',
    ]);
    expect(steps.find((step) => step.label === 'search reindex')!.env).toEqual({
      CONFIRM_PROD_SCRAPE: 'true',
    });
  });

  it('re-points saved plans to merge survivors in each environment before the gate (#5208)', () => {
    for (const target of ['beta', 'production'] as const) {
      const step = remotePhaseSteps(target).find((s) => s.label === 'retarget saved plans')!;
      expect(step.args).toEqual([
        'research-plans:retarget-merged',
        '--apply',
        '--confirm-research-plan-retarget',
      ]);
    }
    expect(
      remotePhaseSteps('production').find((s) => s.label === 'retarget saved plans')!.env,
    ).toEqual({ CONFIRM_PROD_SCRAPE: 'true' });
  });

  it('lets the reindex choose its mode unless a full rebuild is forced, and records its result', () => {
    for (const target of ['beta', 'production'] as const) {
      const step = remotePhaseSteps(target).find((s) => s.label === 'search reindex')!;
      expect(step.args).not.toContain('--full');
      expect(step.args).toEqual(
        expect.arrayContaining(['--apply', '--output', searchReindexResultFile(target)]),
      );
      expect(step.resultFile).toBe(searchReindexResultFile(target));
      const forced = remotePhaseSteps(target, {
        confirmBetaBackup: false,
        fullSearchRebuild: true,
      }).find((s) => s.label === 'search reindex')!;
      expect(forced.args).toContain('--full');
    }
    expect(
      remotePhaseStartCommand('production', { confirmBetaBackup: false, fullSearchRebuild: true }),
    ).toBe('yarn --cwd server promote:remote-phase --environment production --full-search-rebuild');
  });

  it('summarizes the reindex result for the phase report', () => {
    expect(
      summarizeSearchReindexResult(
        JSON.stringify({
          mode: 'incremental',
          modeReason: 'match',
          addedDocumentCount: 4,
          updatedDocumentCount: 30,
          deletedDocumentCount: 1,
          unchangedDocumentCount: 9550,
          environment: 'beta',
        }),
      ),
    ).toEqual({
      mode: 'incremental',
      modeReason: 'match',
      addedDocumentCount: 4,
      updatedDocumentCount: 30,
      deletedDocumentCount: 1,
      unchangedDocumentCount: 9550,
    });
    expect(summarizeSearchReindexResult('not json')).toBeUndefined();
    expect(summarizeSearchReindexResult('{}')).toBeUndefined();
  });

  it('builds the start command the Render job runs', () => {
    expect(remotePhaseStartCommand('beta', { confirmBetaBackup: true })).toBe(
      'yarn --cwd server promote:remote-phase --environment beta --confirm-beta-backup',
    );
    expect(remotePhaseStartCommand('production')).toBe(
      'yarn --cwd server promote:remote-phase --environment production',
    );
  });

  it('refuses a service whose environment does not match its target', () => {
    const betaEnv = {
      SCRAPER_ENV: 'beta',
      MEILISEARCH_INDEX_PREFIX: 'beta',
      MONGODBURL: 'set',
      MEILISEARCH_HOST: 'set',
      MEILISEARCH_WRITE_API_KEY: 'set',
      OPENAI_API_KEY: 'set',
    };
    expect(remotePhaseEnvironmentProblems('beta', betaEnv)).toEqual([]);
    expect(remotePhaseEnvironmentProblems('production', betaEnv)).toEqual([
      'SCRAPER_ENV must be production on this service',
      'MEILISEARCH_INDEX_PREFIX must be prod on this service',
      'PFR3_MEILI_RESTORE_POINT is not set; record the Production Meilisearch restore point first',
    ]);
    expect(
      remotePhaseEnvironmentProblems('beta', { ...betaEnv, MEILISEARCH_WRITE_API_KEY: '' }),
    ).toEqual(['MEILISEARCH_WRITE_API_KEY is not set on this service']);
  });
});

describe('Render setup', () => {
  it('names each missing variable without echoing a value', () => {
    expect(renderSetupProblems('beta', {})).toEqual([
      'RENDER_API_KEY is not set',
      'RENDER_BETA_OPERATOR_SERVICE_ID is not set',
    ]);
    expect(
      renderSetupProblems('production', {
        RENDER_API_KEY: 'rnd_secret',
        RENDER_PRODUCTION_OPERATOR_SERVICE_ID: 'not-an-id',
      }),
    ).toEqual([
      'RENDER_PRODUCTION_OPERATOR_SERVICE_ID must be a Render service id (srv-... or crn-...)',
    ]);
  });

  it('refuses a suspended, nested or wrong-branch operator service', () => {
    expect(
      renderServiceProblems('production', {
        suspended: 'suspended',
        rootDir: 'server',
        branch: 'beta',
      }),
    ).toEqual([
      'the production operator service is suspended',
      'the production operator service root directory is "server"; it must be the repository root so "yarn --cwd server" resolves',
      'the production operator service deploys beta, expected main',
    ]);
    expect(
      renderServiceProblems('beta', { suspended: 'not_suspended', rootDir: '', branch: 'beta' }),
    ).toEqual([]);
  });
});

describe('operatorBuildDecision', () => {
  const head = 'c'.repeat(40);

  it('needs no deploy when the live build is the branch head', () => {
    expect(operatorBuildDecision('beta', head, head)).toMatchObject({ needsDeploy: false });
  });

  it('needs a deploy when the live build is older or missing', () => {
    expect(operatorBuildDecision('production', head, 'd'.repeat(40))).toMatchObject({
      needsDeploy: true,
      headCommit: head,
    });
    expect(operatorBuildDecision('production', head, undefined).needsDeploy).toBe(true);
  });
});

describe('production restore point on the remote phase', () => {
  it('passes --meili-restore-point to the job as PFR3_MEILI_RESTORE_POINT', () => {
    const args = parsePromoteProductionArgs(
      ['--meili-restore-point', 'meili-dump-20261018-184026162'],
      new Date('2026-10-18T00:00:00Z'),
    );
    expect(
      remotePhaseStartCommand('production', {
        confirmBetaBackup: false,
        meiliRestorePoint: args.meiliRestorePoint,
      }),
    ).toBe(
      'PFR3_MEILI_RESTORE_POINT=meili-dump-20261018-184026162 yarn --cwd server promote:remote-phase --environment production',
    );
  });

  it('refuses a restore point that could carry shell syntax', () => {
    expect(() =>
      parsePromoteProductionArgs(['--meili-restore-point', 'x;rm -rf /'], new Date()),
    ).toThrow('--meili-restore-point must be');
  });
});
