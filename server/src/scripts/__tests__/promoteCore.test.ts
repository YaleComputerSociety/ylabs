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
  renderSetupProblems,
  weeklyRunProblems,
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

describe('weeklyRunProblems', () => {
  it('accepts a recent run whose two modes both succeeded', () => {
    expect(weeklyRunProblems(succeededRun(), NOW)).toEqual([]);
  });

  it('refuses when no run was recorded', () => {
    expect(weeklyRunProblems(null, NOW)).toEqual([
      'no weekly_sweep_runs record found in Development',
    ]);
  });

  it('refuses a failed, drifted, stale or half-run sweep', () => {
    const problems = weeklyRunProblems(
      succeededRun({
        status: 'failed',
        exitCode: 1,
        finishedAt: new Date('2026-09-20T00:00:00Z'),
        codeDrift: [{ mode: 'development-full', stage: 'visibility-gate', message: 'moved' }],
        modes: [{ mode: 'development-full', exitCode: 0, summaryFound: true }],
      }),
      NOW,
    );
    expect(problems).toEqual([
      'latest weekly run status is failed',
      'latest weekly run exit code is 1',
      'latest weekly run recorded 1 code-drift refusal(s)',
      'fellowship-development-full did not run',
      'latest weekly run finished 2026-09-20T00:00:00.000Z, more than 8 days ago',
    ]);
  });

  it('refuses a mode that left no summary', () => {
    const problems = weeklyRunProblems(
      succeededRun({
        modes: [
          { mode: 'development-full', exitCode: 0, summaryFound: false },
          { mode: 'fellowship-development-full', exitCode: 0, summaryFound: true },
        ],
      }),
      NOW,
    );
    expect(problems).toEqual(['development-full exited 0 or left no summary']);
  });
});

describe('argument parsing', () => {
  it('parses promote:beta flags', () => {
    expect(
      parsePromoteBetaArgs(['--dry-run', '--yes', '--weekly-run', 'abc', '--backup-ref', 'snap-1']),
    ).toEqual({
      dryRun: true,
      yes: true,
      weeklyRunId: 'abc',
      allowWithoutWeeklyRun: false,
      backupRef: 'snap-1',
      skipRemotePhase: false,
    });
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
    });
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
        syntheticReferenceBlockersClear: false,
        applyBlockers: ['empty source accounts'],
        includesObservations: true,
        includesScrapeRuns: true,
        collections: [{ name: 'accounts' }],
      }),
    ).toEqual([
      'synthetic-user reference blockers are not clear',
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
  });

  it('confirms the production reindex and smokes after it', () => {
    const steps = remotePhaseSteps('production');
    expect(steps.map((step) => step.label)).toEqual([
      'verify database names',
      'visibility gate',
      'search reindex',
      'production smoke',
    ]);
    expect(steps[2].env).toEqual({ CONFIRM_PROD_SCRAPE: 'true' });
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
