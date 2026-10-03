import path from 'path';
import {
  BETA_CONFIRMATION_WORD,
  PRODUCTION_CONFIRMATION_WORD,
  REMOTE_PHASE_RESULT_MARKER,
  RENDER_API_KEY_VARIABLE,
  RENDER_SERVICE_ID_VARIABLES,
  formatMirrorPlan,
  formatProductionPlan,
  formatRemotePhasePlan,
  mirrorApplyProblems,
  mirrorPlanProblems,
  parsePromoteBetaArgs,
  parsePromoteProductionArgs,
  productionPlanProblems,
  releaseHoldProblems,
  remotePhaseStartCommand,
  renderServiceProblems,
  renderSetupProblems,
  weeklyRunProblems,
  type MirrorReport,
  type ProductionPromotionReport,
  type PromotionTarget,
  type PullRequestHoldState,
  type RemotePhaseOptions,
} from './promoteCore';
import {
  createRenderJob,
  describeRenderService,
  waitForRenderJob,
  type FetchLike,
} from './renderOneOffJob';
import { formatWeeklySweepRun, type StoredWeeklySweepRun } from './weeklySweepRunsReportCore';

export const RENDER_JOB_POLL_INTERVAL_MS = 20_000;

export const RENDER_JOB_TIMEOUT_MS = 4 * 60 * 60 * 1000;

export interface PromoteDeps {
  env: NodeJS.ProcessEnv;
  log: (message: string) => void;
  error: (message: string) => void;
  runYarn: (args: string[], extraEnv?: Record<string, string>) => Promise<number | null>;
  readJson: (filePath: string) => unknown;
  workDir: string;
  prompt: (question: string) => Promise<string | null>;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface PromoteBetaDeps extends PromoteDeps {
  loadWeeklyRun: (runId?: string) => Promise<StoredWeeklySweepRun | null>;
  heldSweepLocks: () => Promise<string[]>;
}

export interface PromoteProductionDeps extends PromoteDeps {
  listMainPullRequests: () => Promise<PullRequestHoldState[]>;
}

function refuse(deps: PromoteDeps, problems: string[]): number {
  for (const problem of problems) deps.error(`refused: ${problem}`);
  return 1;
}

async function renderPreflight(
  deps: PromoteDeps,
  target: PromotionTarget,
): Promise<{ problems: string[]; serviceId?: string; dashboardUrl?: string }> {
  const setup = renderSetupProblems(target, deps.env);
  if (setup.length > 0) return { problems: setup };
  const serviceId = deps.env[RENDER_SERVICE_ID_VARIABLES[target]]!.trim();
  try {
    const service = await describeRenderService(
      { apiKey: deps.env[RENDER_API_KEY_VARIABLE]!.trim(), fetch: deps.fetch },
      serviceId,
    );
    deps.log(
      `Render ${target} operator service: ${service.name ?? serviceId} (${service.type ?? 'unknown type'}, branch ${service.branch ?? 'unknown'})`,
    );
    return {
      problems: renderServiceProblems(target, service),
      serviceId,
      dashboardUrl: service.dashboardUrl,
    };
  } catch (caught) {
    return { problems: [caught instanceof Error ? caught.message : String(caught)] };
  }
}

async function runRemotePhaseJob(
  deps: PromoteDeps,
  target: PromotionTarget,
  serviceId: string,
  dashboardUrl: string | undefined,
  options: RemotePhaseOptions,
): Promise<number> {
  const client = { apiKey: deps.env[RENDER_API_KEY_VARIABLE]!.trim(), fetch: deps.fetch };
  const job = await createRenderJob(client, serviceId, remotePhaseStartCommand(target, options));
  deps.log(`Started Render one-off job ${job.id} on ${serviceId}.`);
  if (dashboardUrl) deps.log(`Logs: ${dashboardUrl} -> One-off Jobs -> ${job.id}`);
  const finished = await waitForRenderJob(client, serviceId, job.id, {
    intervalMs: deps.pollIntervalMs ?? RENDER_JOB_POLL_INTERVAL_MS,
    timeoutMs: deps.timeoutMs ?? RENDER_JOB_TIMEOUT_MS,
    sleep: deps.sleep,
    now: deps.now,
    onStatus: (current) => deps.log(`  job ${current.id}: ${current.status ?? 'unknown'}`),
  });
  if (finished.status === 'succeeded') return 0;
  deps.error(
    `Render job ${finished.id} ended ${finished.status}. Read its log for the failed step: the ${REMOTE_PHASE_RESULT_MARKER} line names it.`,
  );
  return 1;
}

async function confirm(deps: PromoteDeps, question: string, expected: string): Promise<boolean> {
  const answer = await deps.prompt(question);
  if (answer === null) {
    deps.error('refused: no interactive terminal to confirm on');
    return false;
  }
  if (answer.trim() !== expected) {
    deps.error(`refused: confirmation did not match "${expected}"`);
    return false;
  }
  return true;
}

async function readReport<T>(
  deps: PromoteDeps,
  label: string,
  args: string[],
  outputPath: string,
  extraEnv?: Record<string, string>,
): Promise<{ report?: T; problem?: string }> {
  const exitCode = await deps.runYarn([...args, '--output', outputPath], extraEnv);
  if (exitCode !== 0) return { problem: `${label} exited ${exitCode}` };
  try {
    return { report: deps.readJson(outputPath) as T };
  } catch {
    return { problem: `${label} left no readable report at ${outputPath}` };
  }
}

export async function runPromoteBeta(argv: string[], deps: PromoteBetaDeps): Promise<number> {
  const args = parsePromoteBetaArgs(argv);
  const problems: string[] = [];

  if (args.allowWithoutWeeklyRun) {
    deps.log('Weekly run check skipped by --allow-without-weekly-run.');
  } else {
    const run = await deps.loadWeeklyRun(args.weeklyRunId);
    if (run) deps.log(`Weekly sweep run:\n${formatWeeklySweepRun(run)}`);
    problems.push(...weeklyRunProblems(run, new Date(deps.now?.() ?? Date.now())));
  }
  const heldLocks = await deps.heldSweepLocks();
  if (heldLocks.length > 0) {
    problems.push(`a Development writer holds a live scrape job lock on ${heldLocks.join(', ')}`);
  }

  const render = args.skipRemotePhase ? { problems: [] } : await renderPreflight(deps, 'beta');
  problems.push(...render.problems);

  const plan = await readReport<MirrorReport>(
    deps,
    'beta:refresh-from-development plan',
    ['beta:refresh-from-development'],
    path.join(deps.workDir, 'development-to-beta-plan.json'),
  );
  if (plan.problem) problems.push(plan.problem);
  if (plan.report) {
    deps.log(formatMirrorPlan(plan.report));
    problems.push(...mirrorPlanProblems(plan.report));
  }

  const remoteOptions = { confirmBetaBackup: Boolean(args.backupRef) };
  if (!args.skipRemotePhase) deps.log(formatRemotePhasePlan('beta', remoteOptions));

  if (args.dryRun) {
    for (const problem of problems) deps.error(`would refuse: ${problem}`);
    deps.log('Dry run: nothing was written to Beta and no Render job was started.');
    return problems.length > 0 ? 1 : 0;
  }
  if (!args.backupRef) {
    problems.push(
      '--backup-ref is required: name the Beta backup or restore point taken before this mirror',
    );
  }
  if (problems.length > 0) return refuse(deps, problems);

  deps.log(`Beta backup reference: ${args.backupRef}`);
  if (
    !args.yes &&
    !(await confirm(
      deps,
      `Type "${BETA_CONFIRMATION_WORD}" to replace Beta's mirrored collections with Development and run the Beta gate: `,
      BETA_CONFIRMATION_WORD,
    ))
  ) {
    return 1;
  }

  const applied = await readReport<MirrorReport>(
    deps,
    'beta:refresh-from-development apply',
    ['beta:refresh-from-development', '--apply', '--confirm-development-to-beta'],
    path.join(deps.workDir, 'development-to-beta-result.json'),
  );
  const applyProblems = applied.problem
    ? [applied.problem]
    : mirrorApplyProblems(applied.report ?? {});
  if (applyProblems.length > 0) return refuse(deps, applyProblems);
  deps.log('Mirror applied: Beta MongoDB now holds the Development copy.');

  if (args.skipRemotePhase) {
    deps.log(
      'Remote phase skipped: run the Beta gate and reindex from the Beta Render shell (docs/data-refresh-runbook.md Phase 3).',
    );
    return 0;
  }
  const exitCode = await runRemotePhaseJob(
    deps,
    'beta',
    render.serviceId!,
    render.dashboardUrl,
    remoteOptions,
  );
  if (exitCode === 0) {
    deps.log('Beta promoted: gate, strict checks, search reindex and readiness all passed.');
  } else {
    deps.error(
      'Beta MongoDB holds the new copy but a gate failed. Fix it in Development and run promote:beta again; never patch Beta.',
    );
  }
  return exitCode;
}

export async function runPromoteProduction(
  argv: string[],
  deps: PromoteProductionDeps,
): Promise<number> {
  const args = parsePromoteProductionArgs(argv, new Date(deps.now?.() ?? Date.now()));
  const problems: string[] = [];

  const namesExit = await deps.runYarn(['database:verify-names', '--pair', 'beta-to-production']);
  if (namesExit !== 0) problems.push('database:verify-names --pair beta-to-production failed');

  try {
    problems.push(...releaseHoldProblems(await deps.listMainPullRequests()));
  } catch (caught) {
    problems.push(
      `could not read the release hold from GitHub: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
  }

  const render = args.skipRemotePhase
    ? { problems: [] }
    : await renderPreflight(deps, 'production');
  problems.push(...render.problems);

  const plan = await readReport<ProductionPromotionReport>(
    deps,
    'production:promote-beta-copy plan',
    ['production:promote-beta-copy', '--dataset-version', args.datasetVersion],
    path.join(deps.workDir, 'production-promotion-plan.json'),
  );
  if (plan.problem) problems.push(plan.problem);
  if (plan.report) {
    deps.log(formatProductionPlan(plan.report));
    problems.push(...productionPlanProblems(plan.report));
  }
  if (!args.skipRemotePhase) {
    deps.log(formatRemotePhasePlan('production', { confirmBetaBackup: false }));
  }

  if (args.dryRun) {
    for (const problem of problems) deps.error(`would refuse: ${problem}`);
    deps.log('Dry run: nothing was written to Production and no Render job was started.');
    return problems.length > 0 ? 1 : 0;
  }
  if (problems.length > 0) return refuse(deps, problems);

  if (
    !(await confirm(
      deps,
      `Type "${PRODUCTION_CONFIRMATION_WORD}" to replace Production's promoted collections with Beta (${args.datasetVersion}): `,
      PRODUCTION_CONFIRMATION_WORD,
    ))
  ) {
    return 1;
  }

  const applyExit = await deps.runYarn(
    [
      'production:promote-beta-copy',
      '--apply',
      '--dataset-version',
      args.datasetVersion,
      '--output',
      path.join(deps.workDir, 'production-promotion-apply.json'),
    ],
    { CONFIRM_LANE_A_COPY: 'true', CONFIRM_PROD_SCRAPE: 'true' },
  );
  if (applyExit !== 0) {
    return refuse(deps, [
      `production:promote-beta-copy --apply exited ${applyExit}; its staged swap rolls back a failed copy`,
    ]);
  }
  deps.log('Production MongoDB promoted.');

  if (args.skipRemotePhase) {
    deps.log(
      'Remote phase skipped: re-gate, reindex and smoke from the Production Render shell (docs/data-refresh-runbook.md Phase 5).',
    );
    return 0;
  }
  const exitCode = await runRemotePhaseJob(
    deps,
    'production',
    render.serviceId!,
    render.dashboardUrl,
    { confirmBetaBackup: false },
  );
  if (exitCode === 0) {
    deps.log(
      'Production promoted: gate, search reindex and smoke passed. Next: mark the main promotion pull request ready and merge it (docs/release-process.md step 6).',
    );
  } else {
    deps.error(
      'Production MongoDB holds the new copy but the gate, reindex or smoke failed. Keep the Mongo result, fix the failed step from the Production Render shell, and do not merge main yet.',
    );
  }
  return exitCode;
}
