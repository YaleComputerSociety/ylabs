import dotenv from 'dotenv';
import fs from 'fs';
import { hostname } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ScrapeRun } from '../models/scrapeRun';
import { isLocalProcessAlive } from '../scrapers/scrapeRunLiveness';
import {
  loadHeldScrapeLockSourceNames,
  loadRunningScrapeRuns,
} from '../scrapers/staleScrapeRunReaper';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  assertReconcileStaleScrapeRunsApplyAllowed,
  planStaleScrapeRunReconciliation,
  planWrittenCountRecount,
  RECOUNTABLE_SCRAPE_RUN_STATUSES,
  writtenCountRecountUpdate,
  type RecountableScrapeRun,
  resolveStaleScrapeRunThresholds,
  staleScrapeRunUpdate,
  summarizeStaleScrapeRunPlan,
} from './reconcileStaleScrapeRunsCore';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { writeReportFileSync } from '../utils/reportFileWriter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const SCRIPT_NAME = 'scrape-runs:reconcile-stale';
export const CONFIRM_FLAG = '--confirm-reconcile-stale-scrape-runs';

export interface ReconcileStaleScrapeRunsArgs {
  apply: boolean;
  confirmed: boolean;
  sourceName?: string;
  staleAfterMinutes?: number;
  legacyOlderThanHours?: number;
  heartbeatStaleOnly: boolean;
  recountWritten: boolean;
  startedBefore?: Date;
  output?: string;
}

function isoDate(flag: string, value: string | undefined): Date {
  const parsed = value && !value.startsWith('--') ? new Date(value) : undefined;
  if (!parsed || !Number.isFinite(parsed.getTime())) {
    throw new Error(`${flag} requires an ISO timestamp`);
  }
  return parsed;
}

function positiveNumber(flag: string, value: string | undefined): number {
  const parsed = Number(value);
  if (!value || !Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive number`);
  }
  return parsed;
}

export function parseReconcileStaleScrapeRunsArgs(argv: string[]): ReconcileStaleScrapeRunsArgs {
  const options: ReconcileStaleScrapeRunsArgs = {
    apply: false,
    confirmed: false,
    heartbeatStaleOnly: false,
    recountWritten: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      return argv[i];
    };
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg === '--heartbeat-stale-only') options.heartbeatStaleOnly = true;
    else if (arg === '--recount-written') options.recountWritten = true;
    else if (arg === '--started-before') options.startedBefore = isoDate(arg, next());
    else if (arg.startsWith('--started-before=')) {
      options.startedBefore = isoDate('--started-before', arg.slice('--started-before='.length));
    } else if (arg === '--source') {
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

  if (options.recountWritten) {
    await recountWrittenObservations(options);
    await mongoose.disconnect();
    return;
  }

  const now = new Date();
  const [runs, heldLockSourceNames] = await Promise.all([
    loadRunningScrapeRuns(options.sourceName),
    loadHeldScrapeLockSourceNames(now),
  ]);
  const plan = planStaleScrapeRunReconciliation({
    runs,
    heldLockSourceNames,
    now,
    localHost: hostname(),
    isLocalProcessAlive,
    thresholds,
    heartbeatStaleOnly: options.heartbeatStaleOnly,
    startedBefore: options.startedBefore,
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
    heartbeatStaleOnly: options.heartbeatStaleOnly,
    startedBefore: options.startedBefore?.toISOString() ?? null,
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
    writeReportFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  }
  await mongoose.disconnect();
}

export async function loadRecountableScrapeRuns(
  sourceName?: string,
): Promise<RecountableScrapeRun[]> {
  const docs = (await ScrapeRun.find({
    status: { $in: [...RECOUNTABLE_SCRAPE_RUN_STATUSES] },
    reconciledAt: { $exists: false },
    ...(sourceName ? { sourceName } : {}),
  })
    .select('_id sourceName status startedAt observationCount')
    .sort({ startedAt: 1 })
    .lean()) as unknown as Array<Record<string, any>>;
  return docs.map((doc) => ({
    id: String(doc._id),
    sourceName: String(doc.sourceName),
    status: String(doc.status),
    startedAt: new Date(doc.startedAt),
    observationCount: Number(doc.observationCount ?? 0),
  }));
}

// `observations.scrapeRunId` is an ObjectId and an aggregation pipeline is not cast by the model,
// so matching the id as a string counts 0 for every run, which reads exactly like "wrote nothing".
export async function countStoredObservationsByRun(runIds: string[]): Promise<Map<string, number>> {
  if (runIds.length === 0) return new Map();
  const rows = (await Observation.aggregate([
    { $match: { scrapeRunId: { $in: runIds.map((id) => new mongoose.Types.ObjectId(id)) } } },
    { $group: { _id: '$scrapeRunId', count: { $sum: 1 } } },
  ])) as Array<{ _id: unknown; count: number }>;
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

async function recountWrittenObservations(options: ReconcileStaleScrapeRunsArgs): Promise<void> {
  const now = new Date();
  const runs = await loadRecountableScrapeRuns(options.sourceName);
  const plan = planWrittenCountRecount(
    runs,
    await countStoredObservationsByRun(runs.map((run) => run.id)),
  );
  let reconciled = 0;
  if (options.apply) {
    for (const recount of plan.recounts) {
      const write = writtenCountRecountUpdate(recount, now);
      if (!write) continue;
      const result = await ScrapeRun.updateOne(write.filter, write.update);
      if ((result.matchedCount ?? 0) > 0) reconciled += 1;
    }
  }
  const report = {
    script: SCRIPT_NAME,
    mode: options.apply ? 'apply' : 'dry-run',
    action: 'recount-written',
    measuredAt: now.toISOString(),
    reconciled: options.apply ? reconciled : null,
    storedBelowRecordedNote:
      'stored below recorded, likely rollback/retire/supersede; reported only, no field written',
    ...plan,
  };
  console.log(JSON.stringify(report, null, 2));
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    writeReportFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
