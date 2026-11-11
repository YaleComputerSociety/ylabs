/**
 * Rolls back ONE scrape run whose observations were written but never materialized: marks the
 * run invalidated, retires its live observations with a rollback record, and restores exactly the
 * observations its inserts superseded (#5735). Refuses when anything outside the run has built on
 * it, because then the pre-run state is no longer the right state to restore. Dry-run by default.
 *
 *   yarn --cwd server observations:rollback-scrape-run --run=<id> --note='<why>'
 *   yarn --cwd server observations:rollback-scrape-run --run=<id> --note='<why>' \
 *     --snapshot=./tmp/<file>.json --apply --confirm-rollback-scrape-run
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ScrapeRun } from '../models/scrapeRun';
import { resetInvalidatedScrapeRunCache } from '../scrapers/invalidatedScrapeRuns';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env'), quiet: true });

const SCRIPT_NAME = 'observations:rollback-scrape-run';
const CONFIRM_FLAG = '--confirm-rollback-scrape-run';
const MAX_NOTE_LENGTH = 500;
const ID_BATCH_SIZE = 5_000;

export interface RollbackScrapeRunArgs {
  runId: string;
  note: string;
  snapshot?: string;
  apply: boolean;
  confirmed: boolean;
}

export function parseRollbackScrapeRunArgs(argv: string[]): RollbackScrapeRunArgs {
  const value = (name: string) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  for (const arg of argv) {
    if (!/^--(run|note|snapshot)=/.test(arg) && arg !== '--apply' && arg !== CONFIRM_FLAG) {
      throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
    }
  }
  if (argv.filter((arg) => arg.startsWith('--run=')).length !== 1) {
    throw new Error(`${SCRIPT_NAME} rolls back exactly one run: pass --run=<id> once`);
  }
  const runId = String(value('run') ?? '').trim();
  if (!/^[0-9a-f]{24}$/i.test(runId)) throw new Error('--run must be a 24-character scrape run id');
  const note = String(value('note') ?? '').trim();
  if (!note) throw new Error('--note is required: record why the run is rolled back');
  if (note.length > MAX_NOTE_LENGTH)
    throw new Error(`--note must be at most ${MAX_NOTE_LENGTH} characters`);
  const apply = argv.includes('--apply');
  const snapshot = value('snapshot');
  if (apply && !snapshot) throw new Error(`${SCRIPT_NAME} --apply requires --snapshot=<path>`);
  return {
    runId: runId.toLowerCase(),
    note,
    ...(snapshot ? { snapshot: resolveSafeJsonReportOutputPath(snapshot) } : {}),
    apply,
    confirmed: argv.includes(CONFIRM_FLAG),
  };
}

export type RollbackRefusal =
  | 'RUN_NOT_FOUND'
  | 'RUN_STILL_RUNNING'
  | 'RUN_WAS_MATERIALIZED'
  | 'RUN_SUPERSEDED_FROM_OUTSIDE'
  | 'LATER_WRITES_TO_SOURCE';

export interface RollbackScrapeRunPlan {
  sourceName?: string;
  status?: string;
  alreadyInvalidated: boolean;
  runObservations: number;
  liveRunObservations: number;
  restorableObservations: number;
  runObservationsSupersededFromOutside: number;
  laterObservationsFromSource: number;
  refusals: RollbackRefusal[];
}

export interface RollbackScrapeRunResult extends RollbackScrapeRunPlan {
  applied: boolean;
  invalidatedRun: boolean;
  retiredRunObservations: number;
  restoredObservations: number;
}

interface RunDocument {
  _id: mongoose.Types.ObjectId;
  sourceId?: mongoose.Types.ObjectId;
  sourceName?: string;
  status?: string;
  startedAt?: Date;
  invalidated?: boolean;
  entitiesCreated?: number;
  entitiesUpdated?: number;
  entitiesArchived?: number;
  postMaterializationMetrics?: unknown;
}

function runWasMaterialized(run: RunDocument): boolean {
  const written =
    (run.entitiesCreated ?? 0) + (run.entitiesUpdated ?? 0) + (run.entitiesArchived ?? 0);
  return written > 0 || run.postMaterializationMetrics != null;
}

function batches<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += ID_BATCH_SIZE) {
    out.push(items.slice(start, start + ID_BATCH_SIZE));
  }
  return out;
}

async function countAcrossBatches(
  ids: readonly mongoose.Types.ObjectId[],
  filterFor: (batch: mongoose.Types.ObjectId[]) => Record<string, unknown>,
): Promise<number> {
  let total = 0;
  for (const batch of batches(ids)) total += await Observation.countDocuments(filterFor(batch));
  return total;
}

function restorableFilter(
  run: RunDocument,
  batch: mongoose.Types.ObjectId[],
): Record<string, unknown> {
  return {
    scrapeRunId: { $ne: run._id },
    superseded: true,
    supersededBy: { $in: batch },
    'rollback.rolledBackAt': { $exists: false },
  };
}

async function planRollback(
  run: RunDocument,
  runObservationIds: mongoose.Types.ObjectId[],
  runObservationIdSet: ReadonlySet<string>,
): Promise<RollbackScrapeRunPlan> {
  const refusals: RollbackRefusal[] = [];
  if (run.status === 'running') refusals.push('RUN_STILL_RUNNING');
  if (runWasMaterialized(run)) refusals.push('RUN_WAS_MATERIALIZED');

  const supersededRunRows = (await Observation.find(
    { scrapeRunId: run._id, supersededBy: { $type: 'objectId' } },
    { supersededBy: 1 },
  ).lean()) as Array<{ supersededBy?: unknown }>;
  const supersededFromOutside = supersededRunRows.filter(
    (row) => !runObservationIdSet.has(String(row.supersededBy)),
  ).length;
  if (supersededFromOutside > 0) refusals.push('RUN_SUPERSEDED_FROM_OUTSIDE');

  const laterObservationsFromSource =
    run.startedAt && (run.sourceId || run.sourceName)
      ? await Observation.countDocuments({
          ...(run.sourceId ? { sourceId: run.sourceId } : { sourceName: run.sourceName }),
          scrapeRunId: { $ne: run._id },
          createdAt: { $gte: run.startedAt },
        })
      : 0;
  if (laterObservationsFromSource > 0) refusals.push('LATER_WRITES_TO_SOURCE');

  return {
    sourceName: run.sourceName,
    status: run.status,
    alreadyInvalidated: run.invalidated === true,
    runObservations: runObservationIds.length,
    liveRunObservations: await Observation.countDocuments({
      scrapeRunId: run._id,
      superseded: { $ne: true },
    }),
    restorableObservations: await countAcrossBatches(runObservationIds, (batch) =>
      restorableFilter(run, batch),
    ),
    runObservationsSupersededFromOutside: supersededFromOutside,
    laterObservationsFromSource,
    refusals,
  };
}

async function writeSnapshot(
  snapshotPath: string,
  run: RunDocument,
  runObservationIds: mongoose.Types.ObjectId[],
): Promise<void> {
  const liveRunIds: string[] = [];
  const restorableIds: string[] = [];
  for (const row of (await Observation.find(
    { scrapeRunId: run._id, superseded: { $ne: true } },
    { _id: 1 },
  ).lean()) as Array<{ _id: unknown }>) {
    liveRunIds.push(String(row._id));
  }
  for (const batch of batches(runObservationIds)) {
    for (const row of (await Observation.find(restorableFilter(run, batch), {
      _id: 1,
      supersededBy: 1,
    }).lean()) as Array<{ _id: unknown; supersededBy?: unknown }>) {
      restorableIds.push(String(row._id));
    }
  }
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(
    snapshotPath,
    `${JSON.stringify({ takenAt: new Date(), runId: String(run._id), liveRunIds, restorableIds })}\n`,
    { mode: 0o600 },
  );
}

/**
 * Order matters for a crash mid-apply: the run is fenced first so no materialize reads its
 * observations, and the restore keys on `supersededBy`, which it clears last, so a re-run after
 * any partial apply still finds every row it has yet to restore.
 */
export async function rollbackScrapeRun(
  args: Pick<RollbackScrapeRunArgs, 'runId' | 'note' | 'snapshot' | 'apply'>,
): Promise<RollbackScrapeRunResult> {
  const notApplied = {
    applied: false,
    invalidatedRun: false,
    retiredRunObservations: 0,
    restoredObservations: 0,
  };
  const run = (await ScrapeRun.findById(args.runId).lean()) as RunDocument | null;
  if (!run) {
    return {
      alreadyInvalidated: false,
      runObservations: 0,
      liveRunObservations: 0,
      restorableObservations: 0,
      runObservationsSupersededFromOutside: 0,
      laterObservationsFromSource: 0,
      refusals: ['RUN_NOT_FOUND'],
      ...notApplied,
    };
  }
  const runObservationIds = (
    (await Observation.find({ scrapeRunId: run._id }, { _id: 1 }).lean()) as Array<{
      _id: mongoose.Types.ObjectId;
    }>
  ).map((row) => row._id);
  const runObservationIdSet = new Set(runObservationIds.map(String));
  const plan = await planRollback(run, runObservationIds, runObservationIdSet);
  if (!args.apply || plan.refusals.length > 0) return { ...plan, ...notApplied };

  if (args.snapshot) await writeSnapshot(args.snapshot, run, runObservationIds);

  const invalidation = await ScrapeRun.updateOne(
    { _id: run._id, invalidated: { $ne: true } },
    { $set: { invalidated: true } },
  );
  resetInvalidatedScrapeRunCache();

  const reason = `${SCRIPT_NAME}: ${args.note}`.slice(0, MAX_NOTE_LENGTH);
  const retired = await Observation.updateMany(
    { scrapeRunId: run._id, superseded: { $ne: true } },
    { $set: { superseded: true, rollback: { rolledBackAt: new Date(), reason } } },
  );

  let restored = 0;
  for (const batch of batches(runObservationIds)) {
    const result = await Observation.updateMany(restorableFilter(run, batch), {
      $set: { superseded: false },
      $unset: { supersededBy: 1 },
    });
    restored += result.modifiedCount ?? 0;
  }

  return {
    ...plan,
    applied: true,
    invalidatedRun: (invalidation.modifiedCount ?? 0) === 1,
    retiredRunObservations: retired.modifiedCount ?? 0,
    restoredObservations: restored,
  };
}

async function main(): Promise<void> {
  const args = parseRollbackScrapeRunArgs(process.argv.slice(2));
  if (args.apply && !args.confirmed)
    throw new Error(`${SCRIPT_NAME} --apply requires ${CONFIRM_FLAG}`);
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();
  try {
    const result = await rollbackScrapeRun(args);
    console.log(JSON.stringify({ mode: args.apply ? 'apply' : 'dry-run', ...result }));
    if (result.refusals.length > 0) {
      throw new Error(`${SCRIPT_NAME} refused: ${result.refusals.join(', ')}`);
    }
  } finally {
    await mongoose.disconnect();
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
