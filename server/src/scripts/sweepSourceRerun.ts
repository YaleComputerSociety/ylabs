import fs from 'fs';
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
  buildRerunScrapeArgs,
  OVERRIDE_HOLD_FLAG,
  rerunActivityRefusals,
  rerunSourceProblems,
} from './opsSweepCore';
import {
  gitRunnerIn,
  readSweepCodeFreshness,
  SWEEP_TARGET_SHA_VARIABLE,
} from './sweepCodeFreshness';
import { heldSweepSourceLocks } from './weeklyDevelopmentSweep';
import {
  weeklySweepChildEnvironment,
  weeklySweepEnvironmentProblems,
} from './weeklyDevelopmentSweepCore';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const LOG_PREFIX = '[sweep-rerun]';

export interface SweepSourceRerunArgs {
  sources: string[];
  overrideHold: boolean;
}

export function parseSweepSourceRerunArgs(argv: string[]): SweepSourceRerunArgs {
  const args = argv.filter((arg) => arg !== '--');
  const unknown = args.filter((arg) => arg.startsWith('--') && arg !== OVERRIDE_HOLD_FLAG);
  if (unknown.length > 0)
    throw new Error(`Unknown scrape:sweep:rerun-source option ${unknown.join(', ')}`);
  return {
    sources: [...new Set(args.filter((arg) => !arg.startsWith('--')))],
    overrideHold: args.includes(OVERRIDE_HOLD_FLAG),
  };
}

async function readActivityRefusals(sources: string[]): Promise<string[]> {
  await connectScriptMongo(process.env.MONGODBURL!);
  try {
    const [newestWeeklySweep, heldLockSources, runningScrapeRuns] = await Promise.all([
      WeeklySweepRun.findOne({}).sort({ startedAt: -1 }).select('status startedAt').lean(),
      heldSweepSourceLocks(),
      ScrapeRun.find({ sourceName: { $in: sources }, status: 'running' })
        .select('sourceName status startedAt heartbeatAt')
        .lean(),
    ]);
    return rerunActivityRefusals(sources, {
      newestWeeklySweep,
      heldLockSources,
      runningScrapeRuns,
      now: new Date(),
    });
  } finally {
    await mongoose.disconnect();
  }
}

function refuse(reasons: string[]): number {
  for (const reason of reasons) console.error(`${LOG_PREFIX} REFUSING TO START: ${reason}`);
  return 1;
}

export async function runSweepSourceRerun(argv: string[]): Promise<number> {
  const args = parseSweepSourceRerunArgs(argv);
  const problems = [
    ...weeklySweepEnvironmentProblems(process.env),
    ...rerunSourceProblems(args.sources, args.overrideHold),
  ];
  if (problems.length > 0) return refuse(problems);

  const freshness = readSweepCodeFreshness({
    git: gitRunnerIn(REPO_ROOT),
    targetSha: process.env[SWEEP_TARGET_SHA_VARIABLE],
  });
  if (!freshness.ok) return refuse([freshness.refusal ?? 'the code freshness check failed']);
  console.log(
    `${LOG_PREFIX} code ${freshness.codeSha} contains ${freshness.newestLaneCommitSha}, the newest beta commit touching the scrapers or the materializer`,
  );

  const activityRefusals = await readActivityRefusals(args.sources);
  if (activityRefusals.length > 0) return refuse(activityRefusals);

  const jobDir = fs.mkdtempSync(
    path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'ylabs-sweep-rerun-'),
  );
  const childEnv = {
    ...weeklySweepChildEnvironment(process.env, jobDir),
    SEARCH_INDEX_WRITES: 'deferred',
  };
  for (const sourceName of args.sources) {
    const yarnArgs = buildRerunScrapeArgs(sourceName, path.join(jobDir, `${sourceName}.json`));
    console.log(`${LOG_PREFIX} running: yarn ${yarnArgs.join(' ')}`);
    const result = spawnSync('yarn', yarnArgs, { cwd: REPO_ROOT, env: childEnv, stdio: 'inherit' });
    if (result.error) console.error(`${LOG_PREFIX} ${sanitizeLogValue(result.error)}`);
    const exitCode = result.status ?? 1;
    console.log(
      `SWEEP_RERUN_RESULT ${JSON.stringify({ sourceName, exitCode, codeSha: freshness.codeSha })}`,
    );
    if (exitCode !== 0) {
      console.error(`${LOG_PREFIX} ${sourceName} exited ${exitCode}; not running the rest`);
      return exitCode;
    }
  }
  return 0;
}

if (isDirectScriptInvocation(import.meta.url, 'sweepSourceRerun')) {
  runSweepSourceRerun(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`${LOG_PREFIX} failed: ${sanitizeLogValue(error)}`);
      process.exitCode = 1;
    });
}
