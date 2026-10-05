import { weeklySweepModes, type WeeklySweepMode } from '../models/storedVocabularies';
import { weeklySweepRunModes, type StoredWeeklySweepRun } from './weeklySweepRunsReportCore';

export type PromotionTarget = 'beta' | 'production';

export const WEEKLY_RUN_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;

export const PRODUCTION_CONFIRMATION_WORD = 'production';

export const BETA_CONFIRMATION_WORD = 'yes';

export const REMOTE_PHASE_RESULT_MARKER = 'PROMOTE_REMOTE_PHASE_RESULT';

export const RENDER_SERVICE_ID_VARIABLES: Record<PromotionTarget, string> = {
  beta: 'RENDER_BETA_OPERATOR_SERVICE_ID',
  production: 'RENDER_PRODUCTION_OPERATOR_SERVICE_ID',
};

export const RENDER_API_KEY_VARIABLE = 'RENDER_API_KEY';

const DATASET_VERSION_PATTERN = /^prod-promote-\d{4}-\d{2}-\d{2}-lane-a-beta-copy$/;

export interface PromoteBetaArgs {
  dryRun: boolean;
  yes: boolean;
  weeklyRunIds: string[];
  allowWithoutWeeklyRun: boolean;
  backupRef?: string;
  skipRemotePhase: boolean;
}

export interface PromoteProductionArgs {
  dryRun: boolean;
  datasetVersion: string;
  skipRemotePhase: boolean;
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1]?.trim();
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

export function parsePromoteBetaArgs(argv: string[]): PromoteBetaArgs {
  const args: PromoteBetaArgs = {
    dryRun: false,
    yes: false,
    weeklyRunIds: [],
    allowWithoutWeeklyRun: false,
    skipRemotePhase: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--yes') args.yes = true;
    else if (arg === '--allow-without-weekly-run') args.allowWithoutWeeklyRun = true;
    else if (arg === '--skip-remote-phase') args.skipRemotePhase = true;
    else if (arg === '--weekly-run') args.weeklyRunIds.push(readValue(argv, index++, arg));
    else if (arg === '--backup-ref') args.backupRef = readValue(argv, index++, arg);
    else throw new Error(`Unknown promote:beta argument: ${arg}`);
  }
  return args;
}

export function datasetVersionFor(date: Date): string {
  return `prod-promote-${date.toISOString().slice(0, 10)}-lane-a-beta-copy`;
}

export function parsePromoteProductionArgs(
  argv: string[],
  now: Date = new Date(),
): PromoteProductionArgs {
  const args: PromoteProductionArgs = {
    dryRun: false,
    datasetVersion: datasetVersionFor(now),
    skipRemotePhase: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--skip-remote-phase') args.skipRemotePhase = true;
    else if (arg === '--dataset-version') args.datasetVersion = readValue(argv, index++, arg);
    else if (arg === '--yes') {
      throw new Error(
        `promote:production never accepts --yes; type "${PRODUCTION_CONFIRMATION_WORD}" at the prompt`,
      );
    } else throw new Error(`Unknown promote:production argument: ${arg}`);
  }
  if (!DATASET_VERSION_PATTERN.test(args.datasetVersion)) {
    throw new Error(
      `--dataset-version must look like prod-promote-YYYY-MM-DD-lane-a-beta-copy; got ${args.datasetVersion}`,
    );
  }
  return args;
}

export const WEEKLY_RUN_LOOKBACK = 20;

export interface WeeklyModeCoverage {
  mode: WeeklySweepMode;
  run: StoredWeeklySweepRun;
}

export interface WeeklyRunCoverage {
  covered: WeeklyModeCoverage[];
  problems: string[];
}

export const weeklyRunLabel = (run: StoredWeeklySweepRun): string =>
  `run ${run._id ? String(run._id) : 'unknown'} started ${new Date(run.startedAt).toISOString()}`;

function weeklyModeProblems(mode: WeeklySweepMode, run: StoredWeeklySweepRun, now: Date): string[] {
  const label = `${mode} ${weeklyRunLabel(run)}`;
  const problems: string[] = [];
  if (run.status !== 'succeeded') problems.push(`${label} status is ${run.status}`);
  if (run.exitCode !== 0) problems.push(`${label} exit code is ${run.exitCode ?? 'missing'}`);
  if ((run.codeDrift ?? []).length > 0) {
    problems.push(`${label} recorded ${run.codeDrift?.length} code-drift refusal(s)`);
  }
  if ((run.refusals ?? []).length > 0) {
    problems.push(`${label} recorded refusals: ${run.refusals?.join('; ')}`);
  }
  const record = (run.modes ?? []).find((entry) => entry?.mode === mode);
  if (!record) problems.push(`${label} recorded no outcome for ${mode}`);
  else if (record.exitCode !== 0 || !record.summaryFound) {
    problems.push(`${label} exited ${record.exitCode ?? 'missing'} or left no summary`);
  }
  const finishedAt = run.finishedAt ? new Date(run.finishedAt) : null;
  if (!finishedAt) problems.push(`${label} has no finish time`);
  else if (now.getTime() - finishedAt.getTime() > WEEKLY_RUN_MAX_AGE_MS) {
    problems.push(`${label} finished ${finishedAt.toISOString()}, more than 8 days ago`);
  }
  return problems;
}

export function weeklyRunCoverage(
  newestFirst: StoredWeeklySweepRun[],
  now: Date = new Date(),
): WeeklyRunCoverage {
  const covered: WeeklyModeCoverage[] = [];
  const problems: string[] = [];
  for (const mode of weeklySweepModes) {
    const run = newestFirst.find((candidate) => weeklySweepRunModes(candidate).includes(mode));
    if (!run) {
      problems.push(`no weekly_sweep_runs record in Development covers ${mode}`);
      continue;
    }
    const modeProblems = weeklyModeProblems(mode, run, now);
    problems.push(...modeProblems);
    if (modeProblems.length === 0) covered.push({ mode, run });
  }
  return { covered, problems };
}

export function missingWeeklyRunIds(
  requestedIds: string[],
  found: StoredWeeklySweepRun[],
): string[] {
  const foundIds = new Set(found.map((run) => String(run._id)));
  return requestedIds.filter((id) => !foundIds.has(id));
}

interface CollectionCounts {
  name?: string;
  sourceCount?: number;
  sourceCopyCount?: number;
  targetCount?: number;
}

export interface MirrorReport {
  mode?: string;
  status?: string;
  sourceEnvironment?: string;
  targetEnvironment?: string;
  includesObservations?: boolean;
  collections?: CollectionCounts[];
}

export function mirrorPlanProblems(report: MirrorReport): string[] {
  const problems: string[] = [];
  if (report.sourceEnvironment !== 'development') {
    problems.push(`mirror source is ${report.sourceEnvironment ?? 'missing'}, not development`);
  }
  if (report.targetEnvironment !== 'beta') {
    problems.push(`mirror target is ${report.targetEnvironment ?? 'missing'}, not beta`);
  }
  if (!report.collections?.length) problems.push('mirror plan lists no collections');
  return problems;
}

export function mirrorApplyProblems(report: MirrorReport): string[] {
  const problems = mirrorPlanProblems(report);
  if (report.status !== 'applied') problems.push(`mirror status is ${report.status ?? 'missing'}`);
  return problems;
}

function formatCollectionTable(collections: CollectionCounts[]): string {
  const width = Math.max(10, ...collections.map((row) => (row.name ?? '').length));
  const header = `  ${'collection'.padEnd(width)}  ${'copy'.padStart(9)}  ${'target now'.padStart(10)}`;
  const rows = collections.map(
    (row) =>
      `  ${(row.name ?? '?').padEnd(width)}  ${String(row.sourceCopyCount ?? '-').padStart(9)}  ${String(row.targetCount ?? '-').padStart(10)}`,
  );
  return [header, ...rows].join('\n');
}

export function formatMirrorPlan(report: MirrorReport): string {
  return [
    `Development -> Beta mirror plan (${report.collections?.length ?? 0} collections, observations ${report.includesObservations ? 'included' : 'stay in Development'})`,
    formatCollectionTable(report.collections ?? []),
  ].join('\n');
}

export interface ProductionPromotionReport {
  sourceEnvironment?: string;
  targetEnvironment?: string;
  sourceDatabase?: string;
  targetDatabase?: string;
  datasetVersion?: string;
  includesObservations?: boolean;
  includesScrapeRuns?: boolean;
  syntheticReferenceBlockersClear?: boolean;
  applyBlockers?: string[];
  excludedBetaLoginAccounts?: number;
  excludedSyntheticUsers?: number;
  productionAccountCarry?: { inserted?: number; refreshed?: number; rekeyed?: number };
  collections?: CollectionCounts[];
}

export function productionPlanProblems(report: ProductionPromotionReport): string[] {
  const problems: string[] = [];
  if (report.sourceEnvironment !== 'beta') problems.push('promotion source is not beta');
  if (report.targetEnvironment !== 'production')
    problems.push('promotion target is not production');
  if (report.syntheticReferenceBlockersClear !== true) {
    problems.push('synthetic-user reference blockers are not clear');
  }
  if ((report.applyBlockers ?? []).length > 0) {
    problems.push(`apply blockers: ${report.applyBlockers?.join(' ')}`);
  }
  if (report.includesObservations) problems.push('plan would promote observations');
  if (report.includesScrapeRuns) problems.push('plan would promote scrape_runs');
  if (!report.collections?.length) problems.push('promotion plan lists no collections');
  return problems;
}

export function formatProductionPlan(report: ProductionPromotionReport): string {
  const carry = report.productionAccountCarry ?? {};
  return [
    `Beta -> Production promotion plan ${report.datasetVersion ?? ''} (${report.sourceDatabase ?? '?'} -> ${report.targetDatabase ?? '?'})`,
    `  Production logins carried: inserted ${carry.inserted ?? '-'}, refreshed ${carry.refreshed ?? '-'}, rekeyed ${carry.rekeyed ?? '-'}`,
    `  Beta logins left behind: ${report.excludedBetaLoginAccounts ?? '-'}; synthetic rows excluded: ${report.excludedSyntheticUsers ?? '-'}`,
    '  Stop if "inserted" is 0 while Production has logged-in users (docs/release-process.md).',
    formatCollectionTable(report.collections ?? []),
  ].join('\n');
}

export interface PullRequestHoldState {
  number: number;
  isDraft: boolean;
  labels: Array<{ name: string }>;
}

export function releaseHoldProblems(pullRequests: PullRequestHoldState[]): string[] {
  return pullRequests
    .filter((pr) => pr.labels.some((label) => label.name.toLowerCase() === 'hold'))
    .map((pr) => `promotion pull request #${pr.number} to main carries the hold label`);
}

export interface RemotePhaseStep {
  label: string;
  cwd: 'server' | 'repo';
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface RemotePhaseOptions {
  confirmBetaBackup: boolean;
}

const VISIBILITY_GATE_ARGS = [
  'student-visibility:gate',
  '--collection=all',
  '--apply',
  '--confirm-student-visibility-apply',
  '--max-apply=100000',
];

export function remotePhaseSteps(
  target: PromotionTarget,
  options: RemotePhaseOptions = { confirmBetaBackup: false },
): RemotePhaseStep[] {
  if (target === 'beta') {
    return [
      {
        label: 'verify database names',
        cwd: 'server',
        command: 'yarn',
        args: ['database:verify-names', '--serving', 'beta'],
      },
      { label: 'visibility gate', cwd: 'server', command: 'yarn', args: VISIBILITY_GATE_ARGS },
      {
        label: 'data quality',
        cwd: 'server',
        command: 'yarn',
        args: [
          'beta:data-quality',
          '--strict',
          '--include-samples',
          '--output',
          '/tmp/ylabs-beta-data-quality.json',
        ],
      },
      {
        label: 'integrity gate',
        cwd: 'server',
        command: 'yarn',
        args: ['scraper:integrity-gate', '--include-samples'],
      },
      {
        label: 'trust contract',
        cwd: 'server',
        command: 'yarn',
        args: [
          'launch:trust-contract',
          '--collection=all',
          '--mode=student-ready-only',
          '--strict',
        ],
      },
      {
        label: 'search reindex',
        cwd: 'repo',
        command: 'node',
        args: ['scripts/reindex-search-index.mjs', 'beta', '--apply'],
      },
      {
        label: 'beta readiness',
        cwd: 'server',
        command: 'yarn',
        args: [
          'beta:readiness',
          ...(options.confirmBetaBackup ? ['--confirm-beta-backup'] : []),
          '--output',
          '/tmp/ylabs-beta-readiness-final.json',
        ],
      },
    ];
  }
  return [
    {
      label: 'verify database names',
      cwd: 'server',
      command: 'yarn',
      args: ['database:verify-names', '--serving', 'production'],
    },
    { label: 'visibility gate', cwd: 'server', command: 'yarn', args: VISIBILITY_GATE_ARGS },
    {
      label: 'search reindex',
      cwd: 'repo',
      command: 'node',
      args: ['scripts/reindex-search-index.mjs', 'production', '--apply'],
      env: { CONFIRM_PROD_SCRAPE: 'true' },
    },
    {
      label: 'production smoke',
      cwd: 'repo',
      command: 'yarn',
      args: ['security:smoke:production'],
    },
  ];
}

export function remotePhaseEnvironmentProblems(
  target: PromotionTarget,
  env: NodeJS.ProcessEnv,
): string[] {
  const expected =
    target === 'beta'
      ? { scraperEnv: 'beta', prefix: 'beta' }
      : { scraperEnv: 'production', prefix: 'prod' };
  const problems: string[] = [];
  if (env.SCRAPER_ENV !== expected.scraperEnv) {
    problems.push(`SCRAPER_ENV must be ${expected.scraperEnv} on this service`);
  }
  if (env.MEILISEARCH_INDEX_PREFIX !== expected.prefix) {
    problems.push(`MEILISEARCH_INDEX_PREFIX must be ${expected.prefix} on this service`);
  }
  for (const name of ['MONGODBURL', 'MEILISEARCH_HOST', 'OPENAI_API_KEY']) {
    if (!env[name]?.trim()) problems.push(`${name} is not set on this service`);
  }
  if (!env.MEILISEARCH_WRITE_API_KEY?.trim() && !env.MEILISEARCH_API_KEY?.trim()) {
    problems.push('MEILISEARCH_WRITE_API_KEY is not set on this service');
  }
  if (target === 'production' && !env.PFR3_MEILI_RESTORE_POINT?.trim()) {
    problems.push(
      'PFR3_MEILI_RESTORE_POINT is not set; record the Production Meilisearch restore point first',
    );
  }
  return problems;
}

export function remotePhaseStartCommand(
  target: PromotionTarget,
  options: RemotePhaseOptions = { confirmBetaBackup: false },
): string {
  return [
    'yarn --cwd server promote:remote-phase',
    `--environment ${target}`,
    ...(target === 'beta' && options.confirmBetaBackup ? ['--confirm-beta-backup'] : []),
  ].join(' ');
}

export interface RemotePhaseArgs {
  environment: PromotionTarget;
  confirmBetaBackup: boolean;
}

export function parseRemotePhaseArgs(argv: string[]): RemotePhaseArgs {
  let environment: PromotionTarget | undefined;
  let confirmBetaBackup = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--confirm-beta-backup') confirmBetaBackup = true;
    else if (arg === '--environment') {
      const value = readValue(argv, index++, arg);
      if (value !== 'beta' && value !== 'production') {
        throw new Error(`--environment must be beta or production; got ${value}`);
      }
      environment = value;
    } else throw new Error(`Unknown promote:remote-phase argument: ${arg}`);
  }
  if (!environment) throw new Error('--environment beta|production is required');
  if (confirmBetaBackup && environment !== 'beta') {
    throw new Error('--confirm-beta-backup applies only to --environment beta');
  }
  return { environment, confirmBetaBackup };
}

export function formatRemotePhasePlan(
  target: PromotionTarget,
  options: RemotePhaseOptions,
): string {
  return [
    `Render one-off job on the ${target} operator service:`,
    `  start command: ${remotePhaseStartCommand(target, options)}`,
    ...remotePhaseSteps(target, options).map(
      (step, index) => `  ${index + 1}. ${step.label}: ${step.command} ${step.args.join(' ')}`,
    ),
  ].join('\n');
}

export function renderSetupProblems(target: PromotionTarget, env: NodeJS.ProcessEnv): string[] {
  const problems: string[] = [];
  if (!env[RENDER_API_KEY_VARIABLE]?.trim()) problems.push(`${RENDER_API_KEY_VARIABLE} is not set`);
  const serviceVariable = RENDER_SERVICE_ID_VARIABLES[target];
  const serviceId = env[serviceVariable]?.trim();
  if (!serviceId) problems.push(`${serviceVariable} is not set`);
  else if (!/^(srv|crn)-[a-z0-9]+$/.test(serviceId)) {
    problems.push(`${serviceVariable} must be a Render service id (srv-... or crn-...)`);
  }
  return problems;
}

export const OPERATOR_SERVICE_BRANCHES: Record<PromotionTarget, string> = {
  beta: 'beta',
  production: 'main',
};

export function renderServiceProblems(
  target: PromotionTarget,
  service: { suspended?: string; branch?: string; rootDir?: string },
): string[] {
  const problems: string[] = [];
  if (service.suspended && service.suspended !== 'not_suspended') {
    problems.push(`the ${target} operator service is ${service.suspended}`);
  }
  if (service.rootDir) {
    problems.push(
      `the ${target} operator service root directory is "${service.rootDir}"; it must be the repository root so "yarn --cwd server" resolves`,
    );
  }
  const branch = OPERATOR_SERVICE_BRANCHES[target];
  if (service.branch && service.branch !== branch) {
    problems.push(`the ${target} operator service deploys ${service.branch}, expected ${branch}`);
  }
  return problems;
}
