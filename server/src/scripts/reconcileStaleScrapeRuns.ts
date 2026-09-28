import dotenv from 'dotenv';
import fs from 'fs';
import { hostname } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ScrapeJobLock } from '../models/scrapeJobLock';
import { ScrapeRun } from '../models/scrapeRun';
import { isLocalProcessAlive } from '../scrapers/scrapeRunLiveness';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  assertReconcileStaleScrapeRunsApplyAllowed,
  planStaleScrapeRunReconciliation,
  resolveStaleScrapeRunThresholds,
  staleScrapeRunUpdate,
  summarizeStaleScrapeRunPlan,
  type RunningScrapeRunFacts,
} from './reconcileStaleScrapeRunsCore';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'scrape-runs:reconcile-stale';
export const CONFIRM_FLAG = '--confirm-reconcile-stale-scrape-runs';

export interface ReconcileStaleScrapeRunsArgs {
  apply: boolean;
  confirmed: boolean;
  sourceName?: string;
  staleAfterMinutes?: number;
  legacyOlderThanHours?: number;
  output?: string;
}

function positiveNumber(flag: string, value: string | undefined): number {
  const parsed = Number(value);
  if (!value || !Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive number`);
  }
  return parsed;
}

export function parseReconcileStaleScrapeRunsArgs(argv: string[]): ReconcileStaleScrapeRunsArgs {
  const options: ReconcileStaleScrapeRunsArgs = { apply: false, confirmed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      return argv[i];
    };
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg === '--source') {
      const value = next();
      if (!value || value.startsWith('--')) throw new Error('--source requires a source name');
      options.sourceName = value;
    } else if (arg === '--stale-after-minutes') {
      options.staleAfterMinutes = positiveNumber(arg, next());
    } else if (arg === '--legacy-older-than-hours') {
      options.legacyOlderThanHours = positiveNumber(arg, next());
    } else if (arg === '--output') options.output = resolveSafeJsonReportOutputPath(next());
    else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  if (options.apply && !options.confirmed) {
    throw new Error(`${SCRIPT_NAME} --apply requires ${CONFIRM_FLAG}`);
  }
  return options;
}

async function loadRunningRuns(sourceName?: string): Promise<RunningScrapeRunFacts[]> {
  const docs = (await ScrapeRun.find({
    status: 'running',
    ...(sourceName ? { sourceName } : {}),
  })
    .select('_id sourceName startedAt heartbeatAt owner')
    .sort({ startedAt: 1 })
    .lean()) as unknown as Array<Record<string, any>>;
  return docs.map((doc) => ({
    id: String(doc._id),
    sourceName: String(doc.sourceName),
    startedAt: new Date(doc.startedAt),
    ...(doc.heartbeatAt ? { heartbeatAt: new Date(doc.heartbeatAt) } : {}),
    ...(doc.owner ? { owner: doc.owner } : {}),
  }));
}

async function loadHeldLockSourceNames(now: Date): Promise<Set<string>> {
  const locks = (await ScrapeJobLock.find({ locked: true, leaseExpiresAt: { $gt: now } })
    .select('sourceName')
    .lean()) as unknown as Array<{ sourceName?: string }>;
  return new Set(locks.map((lock) => String(lock.sourceName)));
}

async function main(): Promise<void> {
  const options = parseReconcileStaleScrapeRunsArgs(process.argv.slice(2));
  const thresholds = resolveStaleScrapeRunThresholds(options);
  const guard = assertReconcileStaleScrapeRunsApplyAllowed({
    apply: options.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${options.apply ? 'apply' : 'dry-run'}`,
  );
  await initializeConnections();

  const now = new Date();
  const [runs, heldLockSourceNames] = await Promise.all([
    loadRunningRuns(options.sourceName),
    loadHeldLockSourceNames(now),
  ]);
  const plan = planStaleScrapeRunReconciliation({
    runs,
    heldLockSourceNames,
    now,
    localHost: hostname(),
    isLocalProcessAlive,
    thresholds,
  });

  let closed = 0;
  let changedSinceRead = 0;
  if (options.apply) {
    for (const reap of plan.reap) {
      const { filter, update } = staleScrapeRunUpdate(reap, { now, detectedBy: SCRIPT_NAME });
      const result = await ScrapeRun.updateOne(filter, update);
      if ((result.matchedCount ?? 0) > 0) closed += 1;
      else changedSinceRead += 1;
    }
  }

  const report = {
    script: SCRIPT_NAME,
    mode: options.apply ? 'apply' : 'dry-run',
    measuredAt: now.toISOString(),
    thresholds,
    heldLockSources: [...heldLockSourceNames].sort(),
    ...summarizeStaleScrapeRunPlan(plan),
    closed: options.apply ? closed : null,
    changedSinceRead: options.apply ? changedSinceRead : null,
    reap: plan.reap,
    keep: plan.keep,
  };
  console.log(JSON.stringify(report, null, 2));
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  }
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
