import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
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
} from './runScraperSweep';
import {
  evaluateStorageHeadroom,
  measureClusterStorage,
  resolveSweepPreflightConfig,
  type StorageHeadroomVerdict,
} from './scraperSweepPreflight';
import { WeeklySweepRun } from '../models/weeklySweepRun';
import {
  WEEKLY_SWEEP_MODES,
  buildCorpusSnapshotArgs,
  buildSnapshotCacheDropArgs,
  buildWeeklySweepArgs,
  buildWeeklySweepRunRecord,
  buildWeeklySweepRunStartRecord,
  findSweepSummaryPath,
  formatWeeklySweepSummaryLine,
  parseWeeklySweepArgs,
  weeklySweepChildEnvironment,
  weeklySweepEnvironmentProblems,
  weeklySweepExitCode,
  type WeeklySweepArgs,
  weeklySweepStorageReading,
  type WeeklySweepCorpusSnapshotRecord,
  type WeeklySweepModeOutcome,
  type WeeklySweepPreflightRecord,
} from './weeklyDevelopmentSweepCore';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

async function heldSweepSourceLocks(): Promise<string[]> {
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

function runSweeps(jobDir: string): WeeklySweepModeOutcome[] {
  return WEEKLY_SWEEP_MODES.map((mode) => {
    const modeDir = path.join(jobDir, mode);
    fs.mkdirSync(modeDir, { recursive: true });
    console.log(`[weekly-sweep] starting ${mode}`);
    const exitCode = runYarn(
      buildWeeklySweepArgs(mode),
      weeklySweepChildEnvironment(process.env, modeDir),
    );
    const summaryPath = findSweepSummaryPath(modeDir, mode);
    let summary: unknown;
    if (summaryPath) {
      summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
      console.log(formatWeeklySweepSummaryLine(mode, summary));
    } else {
      console.error(`[weekly-sweep] ${mode} wrote no summary.json`);
    }
    console.log(`[weekly-sweep] ${mode} exited ${exitCode}`);
    return { mode, exitCode, summaryFound: Boolean(summaryPath), summary };
  });
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
  const codeSha = readSweepHeadSha(REPO_ROOT);
  console.log(`[weekly-sweep] code ${codeSha ?? 'unknown'}`);
  const jobDir = fs.mkdtempSync(
    path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'ylabs-weekly-sweep-'),
  );
  if (args.dryRun) {
    if (!(await preflight(args, jobDir)).ok) return 1;
    for (const mode of WEEKLY_SWEEP_MODES) {
      console.log(`[weekly-sweep] would run: yarn ${buildWeeklySweepArgs(mode).join(' ')}`);
    }
    return 0;
  }

  const startedAt = new Date();
  const runId = await recordWeeklySweepRunStarted({ startedAt, codeSha });
  if (!runId) return 1;
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
    preflightRecord = await preflight(args, jobDir);
    if (preflightRecord.ok) {
      outcomes = runSweeps(jobDir);
      exitCode = weeklySweepExitCode(outcomes);
      if (exitCode === 0) corpusSnapshot = takeCorpusSnapshot();
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
    preflight: preflightRecord,
    outcomes,
    corpusSnapshot,
    ...(error ? { error } : {}),
  });
  return recorded ? exitCode : 1;
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
