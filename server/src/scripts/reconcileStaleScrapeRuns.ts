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
  countCorrectionFor,
  needsCountCorrection,
  runRecordCountIsUnreliable,
  scrapeRunIdFilterValue,
  summarizeCountCorrections,
  type ScrapeRunCountCorrection,
  type ScrapeRunCountFacts,
} from './reconcileScrapeRunCountsCore';
import {
  assertReconcileStaleScrapeRunsApplyAllowed,
  planStaleScrapeRunReconciliation,
  resolveStaleScrapeRunThresholds,
  staleScrapeRunUpdate,
  summarizeStaleScrapeRunPlan,
} from './reconcileStaleScrapeRunsCore';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

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

/**
 * What each run with an untrustworthy count actually wrote (#6269). A run killed outright never
 * flushes its counters, so its record can claim nothing while its observations exist: of the
 * records reading 0 across this corpus's history, about half were false and about half were
 * true, which is why a crashed record's count is unknown rather than zero and has to be
 * recounted. The recount reads `observations` by `scrapeRunId`, cast to an ObjectId, and writes
 * only `reconciledObservationCount` and `reconciledAt`, leaving the run's own claim in place.
 */
async function reconcileRunCounts(input: {
  apply: boolean;
  now: Date;
  staleHeartbeatMs: number;
  sourceName?: string;
}) {
  const candidates = (await ScrapeRun.find(
    {
      ...(input.sourceName ? { sourceName: input.sourceName } : {}),
      status: { $in: ['interrupted', 'failure', 'running'] },
    },
    {
      sourceName: 1,
      status: 1,
      startedAt: 1,
      heartbeatAt: 1,
      finishedAt: 1,
      observationCount: 1,
      options: 1,
    },
  ).lean()) as unknown as ScrapeRunCountFacts[];
  const unreliable = candidates.filter((run) =>
    runRecordCountIsUnreliable(run, input.now.getTime(), input.staleHeartbeatMs),
  );

  const corrections: ScrapeRunCountCorrection[] = [];
  for (const run of unreliable) {
    const runId = scrapeRunIdFilterValue(run._id);
    if (!runId) continue;
    const actual = await Observation.countDocuments({ scrapeRunId: runId });
    const correction = countCorrectionFor(run, actual);
    if (needsCountCorrection(correction.reportedObservations, actual)) corrections.push(correction);
  }

  let recordsUpdated = 0;
  if (input.apply) {
    for (const correction of corrections) {
      const result = await ScrapeRun.updateOne(
        { _id: correction.runId },
        {
          $set: {
            reconciledObservationCount: correction.actualObservations,
            reconciledAt: input.now,
          },
        },
      );
      if ((result.matchedCount ?? 0) > 0) recordsUpdated += 1;
    }
  }

  return {
    runsExamined: candidates.length,
    runsWithUnreliableCounts: unreliable.length,
    ...summarizeCountCorrections(corrections),
    recordsUpdated: input.apply ? recordsUpdated : null,
    corrections,
  };
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

  const counts = await reconcileRunCounts({
    apply: options.apply,
    now,
    staleHeartbeatMs: thresholds.staleHeartbeatMs,
    sourceName: options.sourceName,
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
    counts,
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
