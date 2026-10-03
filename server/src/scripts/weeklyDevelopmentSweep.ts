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
import {
  WEEKLY_SWEEP_MODES,
  buildSnapshotCacheDropArgs,
  buildWeeklySweepArgs,
  findSweepSummaryPath,
  formatWeeklySweepSummaryLine,
  parseWeeklySweepArgs,
  weeklySweepChildEnvironment,
  weeklySweepEnvironmentProblems,
  weeklySweepExitCode,
  type WeeklySweepArgs,
  type WeeklySweepModeOutcome,
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

async function preflight(args: WeeklySweepArgs, jobDir: string): Promise<boolean> {
  await connectScriptMongo(process.env.MONGODBURL!);
  try {
    const held = await heldSweepSourceLocks();
    if (held.length > 0) {
      console.error(
        `[weekly-sweep] refusing: another writer holds a live scrape job lock on ${held.join(', ')}`,
      );
      return false;
    }
    console.log('[weekly-sweep] no live scrape job lock on any sweep source');

    let headroom = await storageHeadroom();
    console.log(`[weekly-sweep] storage: ${headroom.message}`);
    if (headroom.ok) return true;
    if (args.dryRun) {
      console.log('[weekly-sweep] a real run would drop the scrape_snapshots fetch cache here');
      return true;
    }
    const childEnv = weeklySweepChildEnvironment(process.env, jobDir);
    declareMaterializationReadScopeForChildren(childEnv);
    const dropStatus = runYarn(
      buildSnapshotCacheDropArgs(path.join(jobDir, 'snapshot-cache-drop.json')),
      childEnv,
    );
    if (dropStatus !== 0) {
      console.error('[weekly-sweep] refusing: the snapshot cache drop failed');
      return false;
    }
    headroom = await storageHeadroom();
    console.log(`[weekly-sweep] storage after dropping the fetch cache: ${headroom.message}`);
    return headroom.ok;
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
    if (summaryPath) {
      console.log(
        formatWeeklySweepSummaryLine(mode, JSON.parse(fs.readFileSync(summaryPath, 'utf8'))),
      );
    } else {
      console.error(`[weekly-sweep] ${mode} wrote no summary.json`);
    }
    console.log(`[weekly-sweep] ${mode} exited ${exitCode}`);
    return { mode, exitCode, summaryPath };
  });
}

export async function runWeeklyDevelopmentSweep(argv: string[]): Promise<number> {
  const args = parseWeeklySweepArgs(argv);
  const problems = weeklySweepEnvironmentProblems(process.env);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[weekly-sweep] ${problem}`);
    return 1;
  }
  console.log(`[weekly-sweep] code ${readSweepHeadSha(REPO_ROOT) ?? 'unknown'}`);
  const jobDir = fs.mkdtempSync(
    path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'ylabs-weekly-sweep-'),
  );
  if (!(await preflight(args, jobDir))) return 1;
  if (args.dryRun) {
    for (const mode of WEEKLY_SWEEP_MODES) {
      console.log(`[weekly-sweep] would run: yarn ${buildWeeklySweepArgs(mode).join(' ')}`);
    }
    return 0;
  }
  return weeklySweepExitCode(runSweeps(jobDir));
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
