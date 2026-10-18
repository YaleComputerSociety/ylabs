import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectScriptMongo } from '../db/connections';
import { findHeldScrapeJobLock } from '../scrapers/scrapeJobLock';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { isDirectScriptInvocation } from './directScriptInvocation';
import {
  FELLOWSHIP_SWEEP_SOURCES,
  RESEARCH_SWEEP_SOURCES,
  declareMaterializationReadScopeForChildren,
  readSweepHeadSha,
  sweepSearchIndexOutcome,
} from './runScraperSweep';
import {
  gitRunnerIn,
  readSweepCodeFreshness,
  SWEEP_TARGET_SHA_VARIABLE,
  type SweepCodeFreshness,
} from './sweepCodeFreshness';
import {
  evaluateStorageHeadroom,
  measureClusterStorage,
  resolveSweepPreflightConfig,
  type StorageHeadroomVerdict,
} from './scraperSweepPreflight';
import { WeeklySweepRun } from '../models/weeklySweepRun';
import {
  checkpointPathForMode,
  parseSweepCheckpoint,
  readSweepCheckpoint,
  writeSweepCheckpointAtomic,
} from './scraperSweepCheckpoint';
import {
  buildCorpusSnapshotArgs,
  buildSnapshotCacheDropArgs,
  buildWeeklySweepArgs,
  buildWeeklySweepRunRecord,
  buildWeeklySweepRunStartRecord,
  codeFreshnessRefusalPreflight,
  findSweepSummaryPath,
  formatWeeklySweepRefusalLine,
  formatWeeklySweepSummaryLine,
  parseWeeklySweepArgs,
  planWeeklySweepResume,
  weeklySweepCheckpointFieldPath,
  WEEKLY_SWEEP_CHECKPOINT_MIRROR_INTERVAL_MS,
  weeklySweepChildEnvironment,
  weeklySweepRunDeadline,
  weeklySweepEnvironmentProblems,
  weeklySweepExitCode,
  weeklySweepVerdict,
  formatWeeklySweepDegradedLines,
  type WeeklySweepArgs,
  weeklySweepStorageReading,
  type WeeklySweepCorpusSnapshotRecord,
  type WeeklySweepMode,
  type WeeklySweepModeOutcome,
  type WeeklySweepPreflightRecord,
  type WeeklySweepResumeModePlan,
  type WeeklySweepResumableRun,
  type WeeklySweepRunResume,
} from './weeklyDevelopmentSweepCore';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export async function heldSweepSourceLocks(): Promise<string[]> {
  const names = [...RESEARCH_SWEEP_SOURCES, ...FELLOWSHIP_SWEEP_SOURCES].map(
    (source) => source.name,
  );
  const held: string[] = [];
  for (const sourceName of names) {
    if (await findHeldScrapeJobLock({ environment: 'development', sourceName })) {
      held.push(sourceName);
    }
  }
  return held;
}

async function storageHeadroom(): Promise<StorageHeadroomVerdict> {
  const storage = await measureClusterStorage(mongoose.connection);
  return evaluateStorageHeadroom(storage, resolveSweepPreflightConfig());
}

function runYarn(args: string[], env: NodeJS.ProcessEnv): number | null {
  const result = spawnSync('yarn', args, { cwd: REPO_ROOT, env, stdio: 'inherit' });
  if (result.error) console.error(`[weekly-sweep] ${sanitizeLogValue(result.error)}`);
  return result.status;
}

async function preflight(
  args: WeeklySweepArgs,
  jobDir: string,
): Promise<WeeklySweepPreflightRecord> {
  await connectScriptMongo(process.env.MONGODBURL!);
  try {
    const heldLockSources = await heldSweepSourceLocks();
    if (heldLockSources.length > 0) {
      const refusal = `another writer holds a live scrape job lock on ${heldLockSources.join(', ')}`;
      console.error(`[weekly-sweep] refusing: ${refusal}`);
      return { ok: false, heldLockSources, snapshotCacheDropped: false, refusal };
    }
    console.log('[weekly-sweep] no live scrape job lock on any sweep source');

    let headroom = await storageHeadroom();
    const storageBefore = weeklySweepStorageReading(headroom);
    console.log(`[weekly-sweep] storage: ${headroom.message}`);
    if (headroom.ok)
      return { ok: true, heldLockSources, storageBefore, snapshotCacheDropped: false };
    if (args.dryRun) {
      console.log('[weekly-sweep] a real run would drop the scrape_snapshots fetch cache here');
      return { ok: true, heldLockSources, storageBefore, snapshotCacheDropped: false };
    }
    const childEnv = weeklySweepChildEnvironment(process.env, jobDir);
    declareMaterializationReadScopeForChildren(childEnv);
    const dropStatus = runYarn(
      buildSnapshotCacheDropArgs(path.join(jobDir, 'snapshot-cache-drop.json')),
      childEnv,
    );
    if (dropStatus !== 0) {
      const refusal = 'the snapshot cache drop failed';
      console.error(`[weekly-sweep] refusing: ${refusal}`);
      return { ok: false, heldLockSources, storageBefore, snapshotCacheDropped: false, refusal };
    }
    headroom = await storageHeadroom();
    const storageAfter = weeklySweepStorageReading(headroom);
    console.log(`[weekly-sweep] storage after dropping the fetch cache: ${headroom.message}`);
    return {
      ok: headroom.ok,
      heldLockSources,
      storageBefore,
      storageAfter,
      snapshotCacheDropped: true,
      ...(headroom.ok ? {} : { refusal: 'storage is still short after dropping the fetch cache' }),
    };
  } finally {
    await mongoose.disconnect();
  }
}

function runYarnAsync(args: string[], env: NodeJS.ProcessEnv): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn('yarn', args, { cwd: REPO_ROOT, env, stdio: 'inherit' });
    child.on('error', (error) => {
      console.error(`[weekly-sweep] ${sanitizeLogValue(error)}`);
      resolve(null);
    });
    child.on('close', (code) => resolve(code));
  });
}

async function setRunFields(runId: mongoose.Types.ObjectId, fields: Record<string, unknown>) {
  try {
    await WeeklySweepRun.updateOne({ _id: runId }, { $set: fields });
  } catch (error) {
    console.error(
      `[weekly-sweep] could not save resume state on run ${String(runId)}: ${sanitizeLogValue(error)}`,
    );
  }
}

async function mirrorCheckpoint(
  runId: mongoose.Types.ObjectId,
  mode: WeeklySweepMode,
  checkpointPath: string,
): Promise<void> {
  const checkpoint = readSweepCheckpoint(checkpointPath);
  if (!checkpoint) return;
  const field = weeklySweepCheckpointFieldPath(mode);
  await setRunFields(runId, {
    [`${field}.checkpoint`]: checkpoint,
    [`${field}.mirroredAt`]: new Date(),
  });
}

/**
 * Runs each mode and keeps the run row resumable: while a mode runs, its checkpoint is copied
 * onto the row, and once it ends its summary is, so a run stopped at the Render limit can be
 * continued in a fresh container by `--resume-run` (#5209). Saving resume state is best-effort
 * and never fails the sweep.
 */
async function runSweeps(
  jobDir: string,
  plans: WeeklySweepResumeModePlan[],
  runId: mongoose.Types.ObjectId,
  resume: boolean,
): Promise<WeeklySweepModeOutcome[]> {
  let mirroring = false;
  try {
    await connectScriptMongo(process.env.MONGODBURL!);
    mirroring = true;
  } catch (error) {
    console.error(
      `[weekly-sweep] could not connect to save resume state, so this run cannot be resumed: ${sanitizeLogValue(error)}`,
    );
  }
  const outcomes: WeeklySweepModeOutcome[] = [];
  try {
    for (const plan of plans) {
      const { mode } = plan;
      if (plan.completedOutcome) {
        console.log(`[weekly-sweep] ${mode} already finished in the interrupted run; reusing it`);
        if (plan.completedOutcome.summary) {
          console.log(formatWeeklySweepSummaryLine(mode, plan.completedOutcome.summary));
        }
        outcomes.push(plan.completedOutcome);
        continue;
      }
      const modeDir = path.join(jobDir, mode);
      fs.mkdirSync(modeDir, { recursive: true });
      const checkpointPath = checkpointPathForMode(mode, modeDir, REPO_ROOT);
      const restored = plan.checkpoint ? parseSweepCheckpoint(plan.checkpoint) : undefined;
      if (restored) {
        // The recorded pid belongs to the stopped container, and the same number can name an
        // unrelated live process in this one, which would read as a sweep still holding it.
        writeSweepCheckpointAtomic(checkpointPath, {
          ...restored,
          ownerPid: 0,
          restoredFromRunRecord: true,
        });
        const done = Object.values(restored.steps).filter((step) => step.status === 'done').length;
        console.log(`[weekly-sweep] restored ${mode} checkpoint with ${done} finished steps`);
      }
      console.log(`[weekly-sweep] starting ${mode}`);
      const mirror = mirroring
        ? setInterval(() => {
            void mirrorCheckpoint(runId, mode, checkpointPath);
          }, WEEKLY_SWEEP_CHECKPOINT_MIRROR_INTERVAL_MS)
        : undefined;
      let exitCode: number | null;
      try {
        exitCode = await runYarnAsync(
          buildWeeklySweepArgs(mode, { resume: resume && Boolean(restored) }),
          weeklySweepChildEnvironment(
            process.env,
            modeDir,
            weeklySweepRunDeadline(performance.timeOrigin),
          ),
        );
      } finally {
        if (mirror) clearInterval(mirror);
      }
      const summaryPath = findSweepSummaryPath(modeDir, mode);
      let summary: unknown;
      if (summaryPath) {
        summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
        console.log(formatWeeklySweepSummaryLine(mode, summary));
      } else {
        console.error(`[weekly-sweep] ${mode} wrote no summary.json`);
      }
      console.log(`[weekly-sweep] ${mode} exited ${exitCode}`);
      const outcome = { mode, exitCode, summaryFound: Boolean(summaryPath), summary };
      if (mirroring) {
        await setRunFields(runId, {
          [weeklySweepCheckpointFieldPath(mode)]: {
            completed: outcome.summaryFound,
            exitCode,
            summaryFound: outcome.summaryFound,
            summary,
          },
        });
      }
      outcomes.push(outcome);
    }
  } finally {
    if (mirroring) await mongoose.disconnect();
  }
  return outcomes;
}

function takeCorpusSnapshot(): WeeklySweepCorpusSnapshotRecord {
  console.log('[weekly-sweep] taking a corpus quality snapshot');
  const exitCode = runYarn(buildCorpusSnapshotArgs(), {
    ...process.env,
    SCRAPER_ENV: 'development',
  });
  if (exitCode !== 0) console.error(`[weekly-sweep] corpus snapshot exited ${exitCode}`);
  return { status: exitCode === 0 ? 'written' : 'failed', exitCode };
}

async function writeWeeklySweepRun<T>(
  write: (databaseName: string) => Promise<T>,
): Promise<T | null> {
  try {
    await connectScriptMongo(process.env.MONGODBURL!);
    try {
      return await write(mongoose.connection.db?.databaseName ?? '');
    } finally {
      await mongoose.disconnect();
    }
  } catch (error) {
    console.error(`[weekly-sweep] could not record the run: ${sanitizeLogValue(error)}`);
    return null;
  }
}

function recordWeeklySweepRunStarted(
  input: Omit<Parameters<typeof buildWeeklySweepRunStartRecord>[0], 'databaseName'>,
): Promise<mongoose.Types.ObjectId | null> {
  return writeWeeklySweepRun(async (databaseName) => {
    const created = await WeeklySweepRun.create(
      buildWeeklySweepRunStartRecord({ ...input, databaseName }),
    );
    console.log(
      `[weekly-sweep] recorded run ${String(created._id)} as running in weekly_sweep_runs`,
    );
    return created._id;
  });
}

async function loadResumableRun(runId: string): Promise<WeeklySweepResumableRun | null> {
  return writeWeeklySweepRun(
    async () =>
      (await WeeklySweepRun.findById(runId)
        .select('status finishedAt codeSha requestedModes checkpoints startedAt resumes preflight')
        .lean()) as WeeklySweepResumableRun | null,
  );
}

async function recordWeeklySweepRunFinished(
  runId: mongoose.Types.ObjectId,
  input: Omit<Parameters<typeof buildWeeklySweepRunRecord>[0], 'databaseName' | 'finishedAt'>,
): Promise<boolean> {
  const recorded = await writeWeeklySweepRun(async (databaseName) => {
    const record = buildWeeklySweepRunRecord({
      ...input,
      finishedAt: new Date(),
      databaseName,
    });
    const run = await WeeklySweepRun.findById(runId).orFail();
    run.overwrite(record);
    await run.save();
    console.log(
      `[weekly-sweep] recorded run ${String(runId)} as ${record.status} in weekly_sweep_runs`,
    );
    return true;
  });
  return recorded ?? false;
}

export async function runWeeklyDevelopmentSweep(argv: string[]): Promise<number> {
  const args = parseWeeklySweepArgs(argv);
  const problems = weeklySweepEnvironmentProblems(process.env);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[weekly-sweep] ${problem}`);
    return 1;
  }
  const codeFreshness = readSweepCodeFreshness({
    git: gitRunnerIn(REPO_ROOT),
    targetSha: process.env[SWEEP_TARGET_SHA_VARIABLE],
  });
  const codeSha = codeFreshness.codeSha ?? readSweepHeadSha(REPO_ROOT);
  console.log(`[weekly-sweep] code ${codeSha ?? 'unknown'}`);

  let resumed:
    | {
        run: WeeklySweepResumableRun & {
          startedAt?: Date;
          resumes?: WeeklySweepRunResume[];
          preflight?: { codeFreshness?: SweepCodeFreshness };
        };
        plans: WeeklySweepResumeModePlan[];
      }
    | undefined;
  if (args.resumeRunId) {
    const run = await loadResumableRun(args.resumeRunId);
    const plan = planWeeklySweepResume(run, codeSha);
    if (!plan.ok) {
      console.error(
        `[weekly-sweep] REFUSING TO RESUME run ${args.resumeRunId}: ${plan.refusal}. The run row is left as it is.`,
      );
      return 1;
    }
    resumed = { run: run as NonNullable<typeof resumed>['run'], plans: plan.modes };
    console.log(
      `[weekly-sweep] resuming run ${args.resumeRunId} at ${codeSha}: ${plan.modes
        .map(
          (mode) =>
            `${mode.mode} ${mode.completedOutcome ? 'finished' : mode.checkpoint ? 'from checkpoint' : 'from the start'}`,
        )
        .join(', ')}`,
    );
  } else {
    reportCodeFreshness(codeFreshness);
  }
  const modes = resumed ? resumed.plans.map((plan) => plan.mode) : args.modes;
  console.log(`[weekly-sweep] modes: ${modes.join(', ')}`);
  const jobDir = fs.mkdtempSync(
    path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'ylabs-weekly-sweep-'),
  );
  // A resume deliberately runs an older commit than beta's head, which the lane-freshness
  // check refuses; it is held to the interrupted run's own commit by planWeeklySweepResume.
  const freshness: SweepCodeFreshness = resumed
    ? (resumed.run.preflight?.codeFreshness ?? { ...codeFreshness, ok: true })
    : codeFreshness;
  if (args.dryRun) {
    if (!freshness.ok) return 1;
    if (!(await preflight({ ...args, modes }, jobDir)).ok) return 1;
    const dryRunPlans: WeeklySweepResumeModePlan[] =
      resumed?.plans ?? modes.map((mode) => ({ mode }));
    for (const plan of dryRunPlans) {
      console.log(
        plan.completedOutcome
          ? `[weekly-sweep] would reuse ${plan.mode}, which the interrupted run finished`
          : `[weekly-sweep] would run: yarn ${buildWeeklySweepArgs(plan.mode, { resume: Boolean(plan.checkpoint) }).join(' ')}`,
      );
    }
    return 0;
  }

  const startedAt = resumed?.run.startedAt ? new Date(resumed.run.startedAt) : new Date();
  const resumes: WeeklySweepRunResume[] = resumed
    ? [...(resumed.run.resumes ?? []), { at: new Date(), codeSha }]
    : [];
  const runId = resumed
    ? new mongoose.Types.ObjectId(args.resumeRunId)
    : await recordWeeklySweepRunStarted({
        startedAt,
        codeSha,
        requestedModes: modes,
      });
  if (!runId) return 1;
  if (resumed) {
    await writeWeeklySweepRun(() =>
      WeeklySweepRun.updateOne({ _id: runId }, { $set: { resumes } }),
    );
  }
  let preflightRecord: WeeklySweepPreflightRecord = {
    ok: false,
    heldLockSources: [],
    snapshotCacheDropped: false,
  };
  let outcomes: WeeklySweepModeOutcome[] = [];
  let corpusSnapshot: WeeklySweepCorpusSnapshotRecord = { status: 'skipped' };
  let exitCode = 1;
  let error: string | undefined;
  try {
    preflightRecord = freshness.ok
      ? { ...(await preflight({ ...args, modes }, jobDir)), codeFreshness: freshness }
      : codeFreshnessRefusalPreflight(freshness);
    if (resumed && !preflightRecord.ok) {
      console.error(
        `[weekly-sweep] the resume preflight refused (${preflightRecord.refusal ?? 'see above'}); run ${String(runId)} is left resumable`,
      );
      return 1;
    }
    if (preflightRecord.ok) {
      outcomes = await runSweeps(
        jobDir,
        resumed?.plans ?? modes.map((mode) => ({ mode })),
        runId,
        Boolean(resumed),
      );
      exitCode = weeklySweepExitCode(outcomes);
      if (exitCode === 0 && weeklySweepVerdict(outcomes) === 'degraded') {
        console.error('[weekly-sweep] DEGRADED: the sweep completed, and these failed:');
        for (const line of formatWeeklySweepDegradedLines(outcomes)) {
          console.error(`[weekly-sweep]   ${line}`);
        }
      }
      if (exitCode === 0) corpusSnapshot = takeCorpusSnapshot();
      reportSearchIndexOutcome();
    }
  } catch (caught) {
    error = sanitizeLogValue(caught);
    exitCode = 1;
    console.error(`[weekly-sweep] failed: ${error}`);
  }
  const recorded = await recordWeeklySweepRunFinished(runId, {
    startedAt,
    codeSha,
    exitCode,
    requestedModes: modes,
    preflight: preflightRecord,
    outcomes,
    corpusSnapshot,
    ...(outcomes.length > 0 ? { searchIndex: sweepSearchIndexOutcome() } : {}),
    ...(error ? { error } : {}),
    ...(resumes.length > 0 ? { resumes } : {}),
  });
  return recorded ? exitCode : 1;
}

function reportCodeFreshness(codeFreshness: SweepCodeFreshness): void {
  if (codeFreshness.ok) {
    console.log(
      `[weekly-sweep] code contains ${codeFreshness.newestLaneCommitSha}, the newest beta commit touching the scrapers or the materializer`,
    );
    return;
  }
  console.error(`[weekly-sweep] REFUSING TO START: ${codeFreshness.refusal}`);
  console.error(formatWeeklySweepRefusalLine(codeFreshness));
}

function reportSearchIndexOutcome(): void {
  const searchIndex = sweepSearchIndexOutcome();
  if (searchIndex.status !== 'resync-required') return;
  console.error(
    `[weekly-sweep] the Development search index was NOT updated by this run; run \`${searchIndex.remedy}\` from a checkout that reaches it (docs/data-refresh-runbook.md)`,
  );
}

if (isDirectScriptInvocation(import.meta.url, 'weeklyDevelopmentSweep')) {
  runWeeklyDevelopmentSweep(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`[weekly-sweep] failed: ${sanitizeLogValue(error)}`);
      process.exitCode = 1;
    });
}
