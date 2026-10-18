import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectScriptMongo } from '../db/connections';
import { ScrapeRun } from '../models/scrapeRun';
import { WeeklySweepRun } from '../models/weeklySweepRun';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { isDirectScriptInvocation } from './directScriptInvocation';
import {
  ATLAS_PROJECT_ID,
  buildPermissionProbePlan,
  comparableScrapeRunFilter,
  compareRerunWithBaseline,
  DEVELOPMENT_SEARCH_SYNC_SCRIPT,
  developmentTargetProblems,
  entrypointSupportsRerun,
  formatSweepStatus,
  parseOpsSweepArgs,
  permissionProbeStartCommand,
  readRenderApiKey,
  rerunActivityRefusals,
  rerunJobStartCommand,
  rerunSourceProblems,
  SWEEP_DATABASE_ROLE,
  SWEEP_ENTRYPOINT_PATH,
  SWEEP_RENDER_SERVICE_ID,
  type ScrapeRunCounts,
} from './opsSweepCore';
import {
  createRenderJob,
  isTerminalRenderJobStatus,
  listRenderDeploys,
  listRenderJobs,
  waitForRenderJob,
  type RenderClientOptions,
  type RenderJob,
} from './renderOneOffJob';
import { gitRunnerIn, SWEEP_TARGET_BRANCH } from './sweepCodeFreshness';
import { heldSweepSourceLocks } from './weeklyDevelopmentSweep';
import { RENDER_CRON_RUN_LIMIT_MS } from './weeklyDevelopmentSweepCore';
import type { StoredWeeklySweepRun } from './weeklySweepRunsReportCore';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(SERVER_DIR, '..');
const PROBE_RUNTIME_PATH = path.join(SERVER_DIR, 'src/scripts/sweepPermissionProbeRuntime.cjs');
const RENDER_CLI_CONFIG_PATH = path.join(os.homedir(), '.render', 'cli.yaml');
const RERUN_POLL_INTERVAL_MS = 60_000;
const PROBE_POLL_INTERVAL_MS = 15_000;
const PROBE_TIMEOUT_MS = 20 * 60_000;
const JOB_CLOCK_SKEW_MS = 2 * 60_000;
const LOG_PREFIX = '[ops:sweep]';

const git = gitRunnerIn(REPO_ROOT);

function log(message: string): void {
  console.log(`${LOG_PREFIX} ${message}`);
}

function fail(message: string): number {
  console.error(`${LOG_PREFIX} ${message}`);
  return 1;
}

function readBetaHeadSha(): string | null {
  const listed = git(['ls-remote', 'origin', `refs/heads/${SWEEP_TARGET_BRANCH}`]);
  if (listed.status !== 0) return null;
  return listed.stdout.split(/\s+/)[0] || null;
}

function renderClient(): RenderClientOptions {
  const configText = fs.existsSync(RENDER_CLI_CONFIG_PATH)
    ? fs.readFileSync(RENDER_CLI_CONFIG_PATH, 'utf8')
    : null;
  const apiKey = readRenderApiKey(process.env, configText);
  if (!apiKey) {
    throw new Error(`set RENDER_API_KEY or log in with the render CLI (${RENDER_CLI_CONFIG_PATH})`);
  }
  return { apiKey };
}

async function withDevelopment<T>(work: () => Promise<T>): Promise<T> {
  await connectScriptMongo(process.env.MONGODBURL!);
  try {
    return await work();
  } finally {
    await mongoose.disconnect();
  }
}

async function runStatus(): Promise<number> {
  const run = await withDevelopment(
    async () =>
      (await WeeklySweepRun.findOne({})
        .sort({ startedAt: -1 })
        .lean()) as unknown as StoredWeeklySweepRun | null,
  );
  console.log(formatSweepStatus({ run, betaHeadSha: readBetaHeadSha() }));
  return 0;
}

async function liveImageEntrypoint(client: RenderClientOptions): Promise<{
  commitId: string | null;
  entrypoint: string | null;
}> {
  const deploys = await listRenderDeploys(client, SWEEP_RENDER_SERVICE_ID);
  const commitId = deploys.find((deploy) => deploy.status === 'live')?.commitId ?? null;
  if (!commitId) return { commitId, entrypoint: null };
  git(['fetch', '--quiet', 'origin', SWEEP_TARGET_BRANCH]);
  const shown = git(['show', `${commitId}:${SWEEP_ENTRYPOINT_PATH}`]);
  return { commitId, entrypoint: shown.status === 0 ? shown.stdout : null };
}

async function readRerunGuards(sources: string[]): Promise<{
  refusals: string[];
  baselines: Map<string, ScrapeRunCounts | null>;
}> {
  return withDevelopment(async () => {
    const [newestWeeklySweep, heldLockSources, runningScrapeRuns] = await Promise.all([
      WeeklySweepRun.findOne({}).sort({ startedAt: -1 }).select('status startedAt').lean(),
      heldSweepSourceLocks(),
      ScrapeRun.find({ sourceName: { $in: sources }, status: 'running' })
        .select('sourceName status startedAt heartbeatAt')
        .lean(),
    ]);
    const baselines = new Map<string, ScrapeRunCounts | null>();
    for (const source of sources) {
      baselines.set(
        source,
        (await ScrapeRun.findOne(comparableScrapeRunFilter(source))
          .sort({ startedAt: -1 })
          .lean()) as ScrapeRunCounts | null,
      );
    }
    return {
      refusals: rerunActivityRefusals(sources, {
        newestWeeklySweep,
        heldLockSources,
        runningScrapeRuns,
        now: new Date(),
      }),
      baselines,
    };
  });
}

function inFlightJobRefusals(jobs: RenderJob[]): string[] {
  return jobs
    .filter((job) => !isTerminalRenderJobStatus(job.status))
    .map(
      (job) =>
        `Render one-off job ${job.id} on the sweep service is still ${job.status ?? 'unknown'}, so it may be writing Development`,
    );
}

async function runRerun(
  sources: string[],
  overrideHold: boolean,
  dryRun: boolean,
): Promise<number> {
  const sourceProblems = rerunSourceProblems(sources, overrideHold);
  if (sourceProblems.length > 0) return fail(`refusing: ${sourceProblems.join('; ')}`);
  const client = renderClient();

  const { commitId, entrypoint } = await liveImageEntrypoint(client);
  if (!entrypointSupportsRerun(entrypoint)) {
    return fail(
      `refusing: the live ylabs-scraper image (commit ${commitId ?? 'unknown'}) has no --rerun-source mode, so a job would not run current beta; wait for the image build that includes ${SWEEP_ENTRYPOINT_PATH} with that mode to go live (render deploys list ${SWEEP_RENDER_SERVICE_ID} -o json)`,
    );
  }
  log(`live image commit ${commitId} supports --rerun-source`);

  const { refusals, baselines } = await readRerunGuards(sources);
  refusals.push(...inFlightJobRefusals(await listRenderJobs(client, SWEEP_RENDER_SERVICE_ID)));
  if (refusals.length > 0) return fail(`refusing: ${refusals.join('; ')}`);
  for (const source of sources) {
    const baseline = baselines.get(source);
    log(
      baseline
        ? `${source}: last comparable run ${String(baseline._id)} (${new Date(baseline.startedAt!).toISOString()}), ${baseline.observationCount ?? 0} observations, ${baseline.entitiesUpdated ?? 0} entities updated`
        : `${source}: no earlier comparable run`,
    );
  }

  const startCommand = rerunJobStartCommand(sources, overrideHold);
  if (dryRun) {
    log(
      `dry run: would start a one-off job on ${SWEEP_RENDER_SERVICE_ID} running: ${startCommand}`,
    );
    return 0;
  }
  const requestedAt = new Date(Date.now() - JOB_CLOCK_SKEW_MS);
  const job = await createRenderJob(client, SWEEP_RENDER_SERVICE_ID, startCommand);
  log(`started Render one-off job ${job.id}: ${startCommand}`);
  let finished: RenderJob;
  try {
    finished = await waitForRenderJob(client, SWEEP_RENDER_SERVICE_ID, job.id, {
      intervalMs: RERUN_POLL_INTERVAL_MS,
      timeoutMs: RENDER_CRON_RUN_LIMIT_MS + 30 * 60_000,
      onStatus: (current) => log(`job ${current.id}: ${current.status ?? 'unknown'}`),
    });
  } catch (error) {
    const baselineIds = sources
      .map((source) => `${source} ${String(baselines.get(source)?._id ?? 'none')}`)
      .join(', ');
    return fail(
      `stopped waiting for job ${job.id} (${error instanceof Error ? error.message : String(error)}); it may still be writing Development. Once it ends (render jobs list ${SWEEP_RENDER_SERVICE_ID} -o json), run \`yarn ${DEVELOPMENT_SEARCH_SYNC_SCRIPT}\` and compare its scrape runs, started after ${requestedAt.toISOString()}, against the baselines: ${baselineIds}`,
    );
  }

  const comparisons = await withDevelopment(async () => {
    const results = [];
    for (const source of sources) {
      const current = (await ScrapeRun.findOne({
        sourceName: source,
        startedAt: { $gte: requestedAt },
        'options.dryRun': false,
      })
        .sort({ startedAt: -1 })
        .lean()) as ScrapeRunCounts | null;
      results.push(
        compareRerunWithBaseline({ sourceName: source, baseline: baselines.get(source), current }),
      );
    }
    return results;
  });
  for (const comparison of comparisons) {
    log(`${comparison.sourceName}: ${comparison.verdict}`);
    for (const line of comparison.lines) log(`  ${line}`);
  }

  if (finished.status !== 'succeeded') {
    return fail(
      `job ${finished.id} ended ${finished.status}; the Development search index is not synced, run \`yarn ${DEVELOPMENT_SEARCH_SYNC_SCRIPT}\` once whatever it wrote has been read`,
    );
  }
  log(`syncing the Development search index: yarn ${DEVELOPMENT_SEARCH_SYNC_SCRIPT}`);
  const synced = spawnSync('yarn', [DEVELOPMENT_SEARCH_SYNC_SCRIPT], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  if (synced.status !== 0)
    return fail(`yarn ${DEVELOPMENT_SEARCH_SYNC_SCRIPT} exited ${synced.status}`);
  const problems = comparisons.filter((comparison) => comparison.problem);
  if (problems.length > 0) {
    return fail(
      `flagged: ${problems.map((problem) => `${problem.sourceName} ${problem.verdict}`).join(', ')}; read the run before trusting it`,
    );
  }
  return 0;
}

function readSweepRole(): unknown {
  const described = spawnSync(
    'atlas',
    [
      'customDbRoles',
      'describe',
      SWEEP_DATABASE_ROLE,
      '--projectId',
      ATLAS_PROJECT_ID,
      '-o',
      'json',
    ],
    { encoding: 'utf8' },
  );
  if (described.status !== 0) {
    throw new Error(
      `atlas customDbRoles describe ${SWEEP_DATABASE_ROLE} failed (${String(described.stderr).trim() || `exit ${described.status}`}); run atlas auth login and retry`,
    );
  }
  return JSON.parse(described.stdout);
}

async function runProbePermissions(dryRun: boolean): Promise<number> {
  const plan = buildPermissionProbePlan(
    readSweepRole() as Parameters<typeof buildPermissionProbePlan>[0],
  );
  const allowed = plan.checks.filter((check) => check.expect === 'allowed').length;
  log(
    `probe plan: ${allowed} granted actions and ${plan.checks.length - allowed} expected denials, as ${plan.expectedUser}`,
  );
  if (plan.unprobedActions.length > 0) log(`not probed: ${plan.unprobedActions.join(', ')}`);
  const startCommand = permissionProbeStartCommand(
    fs.readFileSync(PROBE_RUNTIME_PATH, 'utf8'),
    plan,
  );
  if (dryRun) {
    log(
      `dry run: would start a ${startCommand.length}-character probe job on ${SWEEP_RENDER_SERVICE_ID}`,
    );
    return 0;
  }
  const client = renderClient();
  const job = await createRenderJob(client, SWEEP_RENDER_SERVICE_ID, startCommand);
  log(`started Render one-off job ${job.id}`);
  let finished: RenderJob;
  try {
    finished = await waitForRenderJob(client, SWEEP_RENDER_SERVICE_ID, job.id, {
      intervalMs: PROBE_POLL_INTERVAL_MS,
      timeoutMs: PROBE_TIMEOUT_MS,
      onStatus: (current) => log(`job ${current.id}: ${current.status ?? 'unknown'}`),
    });
  } catch (error) {
    return fail(
      `stopped waiting for probe job ${job.id} (${error instanceof Error ? error.message : String(error)}); read its PERMISSION_PROBE_RESULT log line once it ends`,
    );
  }
  if (finished.status === 'succeeded') {
    log(`PASS: every granted action was allowed and every expected denial was denied`);
    return 0;
  }
  return fail(
    `FAIL: job ${finished.id} ended ${finished.status}; it exits 3 on an unexpected result and 4 when the authenticated user is not ${SWEEP_DATABASE_ROLE}, and its PERMISSION_PROBE_RESULT log line says which`,
  );
}

export async function runOpsSweep(argv: string[]): Promise<number> {
  const command = parseOpsSweepArgs(argv);
  const targetProblems = developmentTargetProblems(process.env);
  if (targetProblems.length > 0) return fail(`refusing: ${targetProblems.join('; ')}`);
  if (command.command === 'status') return runStatus();
  if (command.command === 'rerun') {
    return runRerun(command.sources, command.overrideHold, command.dryRun);
  }
  return runProbePermissions(command.dryRun);
}

if (isDirectScriptInvocation(import.meta.url, 'opsSweep')) {
  runOpsSweep(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(
        `${LOG_PREFIX} failed: ${sanitizeLogValue(error instanceof Error ? error.message : error)}`,
      );
      process.exitCode = 1;
    });
}
