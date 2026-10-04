import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { LaneBenchmark, LaneBenchmarkPage } from '../models/laneBenchmark';
import { ResearchEntity } from '../models/researchEntity';
import {
  beginBenchmarkCapture,
  finishBenchmarkCaptureWithCoverage,
} from '../scrapers/snapshotBenchmarkMode';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { liveFieldValueRefusals } from '../utils/researchEntityFieldValueRefusals';
import {
  assertBenchmarkableLane,
  assertLaneHonorsSourceConcurrency,
  currentCodeSha,
  runLaneDry,
  slugsForPlannedEntities,
} from './laneBenchmarkRun';
import type { BenchmarkLabel } from './laneScorecardCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const SCRIPT_NAME = 'lane:benchmark-capture';
export const CONFIRM_FLAG = '--confirm-lane-benchmark-capture';
const BENCHMARK_ID = /^[a-z0-9][a-z0-9-]{2,80}$/;

export interface CaptureArgs {
  sourceName: string;
  benchmarkId: string;
  only: string[];
  limit?: number;
  sourceConcurrency?: number;
  recapture?: string;
  markSuccessorOf?: string;
  withoutGold: boolean;
  dryRun: boolean;
  confirmed: boolean;
}

export interface StoredBenchmarkScope {
  benchmarkId: string;
  sourceName: string;
  only?: string[];
  limit?: number | null;
  goldLabels?: unknown[];
  plannedObservationCount?: number;
}

const scopeKey = (benchmark: Pick<StoredBenchmarkScope, 'sourceName' | 'only' | 'limit'>) =>
  JSON.stringify([
    benchmark.sourceName,
    [...(benchmark.only ?? [])].sort(),
    benchmark.limit ?? null,
  ]);

export function scopeOfStoredBenchmark(
  args: CaptureArgs,
  stored: StoredBenchmarkScope,
): CaptureArgs {
  return {
    ...args,
    sourceName: stored.sourceName,
    only: [...(stored.only ?? [])],
    limit: stored.limit ?? undefined,
  };
}

/**
 * Why a stored benchmark may not be replaced, or undefined when it may. A benchmark is
 * replaced at most once, so the scorecard has one successor to replay, and a hand-labelled
 * benchmark is never replaced by an unlabelled one unless the operator says so, because the
 * successor's pages are new and the labels judged the old ones.
 */
export function supersedeRefusal(
  superseded: StoredBenchmarkScope,
  existingSuccessorId: string | undefined,
  options: { withoutGold: boolean; successor?: StoredBenchmarkScope },
): string | undefined {
  if (existingSuccessorId) {
    return `Benchmark ${superseded.benchmarkId} is already superseded by ${existingSuccessorId}`;
  }
  if (options.successor) {
    if (options.successor.benchmarkId === superseded.benchmarkId) {
      return 'A benchmark cannot supersede itself';
    }
    if (scopeKey(options.successor) !== scopeKey(superseded)) {
      return `Benchmark ${options.successor.benchmarkId} has a different lane or scope from ${superseded.benchmarkId}, so it is not a recapture of it`;
    }
    return undefined;
  }
  if ((superseded.goldLabels?.length ?? 0) > 0 && !options.withoutGold) {
    return `Benchmark ${superseded.benchmarkId} carries hand-judged gold labels; recapture it with --without-gold and label the new benchmark with lane:benchmark-label against its own pages`;
  }
  return undefined;
}

export function parseCaptureArgs(argv: string[]): CaptureArgs {
  const args: Partial<CaptureArgs> & {
    only: string[];
    dryRun: boolean;
    confirmed: boolean;
    withoutGold: boolean;
  } = {
    only: [],
    dryRun: true,
    confirmed: false,
    withoutGold: false,
  };
  for (const arg of argv) {
    if (arg === '--apply') args.dryRun = false;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === CONFIRM_FLAG) args.confirmed = true;
    else if (arg.startsWith('--source=')) args.sourceName = arg.slice('--source='.length).trim();
    else if (arg.startsWith('--id=')) args.benchmarkId = arg.slice('--id='.length).trim();
    else if (arg.startsWith('--recapture='))
      args.recapture = arg.slice('--recapture='.length).trim();
    else if (arg.startsWith('--mark-successor-of='))
      args.markSuccessorOf = arg.slice('--mark-successor-of='.length).trim();
    else if (arg === '--without-gold') args.withoutGold = true;
    else if (arg.startsWith('--only='))
      args.only = arg
        .slice('--only='.length)
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    else if (arg.startsWith('--source-concurrency=')) {
      const concurrency = Number(arg.slice('--source-concurrency='.length));
      if (!Number.isInteger(concurrency) || concurrency < 1)
        throw new Error('--source-concurrency must be a positive integer');
      args.sourceConcurrency = concurrency;
    } else if (arg.startsWith('--limit=')) {
      const limit = Number(arg.slice('--limit='.length));
      if (!Number.isInteger(limit) || limit < 1)
        throw new Error('--limit must be a positive integer');
      args.limit = limit;
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  if (!args.benchmarkId || !BENCHMARK_ID.test(args.benchmarkId)) {
    throw new Error(
      `${SCRIPT_NAME} requires --id=<benchmark-id> of lowercase letters, digits and hyphens`,
    );
  }
  const supersededId = args.recapture ?? args.markSuccessorOf;
  if (args.recapture !== undefined && args.markSuccessorOf !== undefined) {
    throw new Error('--recapture and --mark-successor-of cannot be combined');
  }
  if (supersededId !== undefined) {
    if (!BENCHMARK_ID.test(supersededId)) {
      throw new Error(`${SCRIPT_NAME} requires a benchmark id to supersede`);
    }
    if (args.sourceName || args.only.length > 0 || args.limit !== undefined) {
      throw new Error(
        '--recapture and --mark-successor-of read the lane and scope from the stored benchmark, so --source, --only and --limit are refused',
      );
    }
    if (args.markSuccessorOf !== undefined && args.sourceConcurrency !== undefined) {
      throw new Error('--mark-successor-of captures nothing, so --source-concurrency is refused');
    }
    if (args.markSuccessorOf !== undefined && args.withoutGold) {
      throw new Error('--mark-successor-of captures nothing, so --without-gold is refused');
    }
    return { ...args, sourceName: '' } as CaptureArgs;
  }
  if (args.withoutGold) throw new Error('--without-gold applies only to --recapture');
  if (!args.sourceName) throw new Error(`${SCRIPT_NAME} requires --source=<lane>`);
  if (args.only.length === 0 && args.limit === undefined) {
    throw new Error(`${SCRIPT_NAME} requires --only or --limit, so the benchmark is a fixed scope`);
  }
  assertBenchmarkableLane(args.sourceName);
  if (args.sourceConcurrency !== undefined) assertLaneHonorsSourceConcurrency(args.sourceName);
  return args as CaptureArgs;
}

async function freezeLabels(slugs: readonly string[]): Promise<BenchmarkLabel[]> {
  const rows = (await ResearchEntity.find({ slug: { $in: [...slugs] } })
    .select('slug fieldValueRefusals')
    .lean()) as unknown as Array<{ slug: string; fieldValueRefusals?: unknown }>;
  const labels: BenchmarkLabel[] = [];
  for (const row of rows) {
    const byField = row.fieldValueRefusals as Record<string, unknown> | undefined;
    for (const field of Object.keys(byField ?? {})) {
      for (const refusal of liveFieldValueRefusals(byField, field)) {
        labels.push({ entityKey: row.slug, field, valueKey: refusal.valueKey, rule: refusal.rule });
      }
    }
  }
  return labels;
}

async function loadSupersededBenchmark(benchmarkId: string): Promise<StoredBenchmarkScope> {
  const stored = (await LaneBenchmark.findOne({ benchmarkId })
    .select('benchmarkId sourceName only limit goldLabels plannedObservationCount')
    .lean()) as unknown as StoredBenchmarkScope | null;
  if (!stored) throw new Error(`No benchmark ${benchmarkId} to supersede`);
  return stored;
}

async function existingSuccessorId(benchmarkId: string): Promise<string | undefined> {
  const successor = (await LaneBenchmark.findOne({ supersedes: benchmarkId })
    .select('benchmarkId')
    .lean()) as unknown as { benchmarkId: string } | null;
  return successor?.benchmarkId;
}

async function markSuccessor(args: CaptureArgs, supersededId: string): Promise<void> {
  const superseded = await loadSupersededBenchmark(supersededId);
  const successor = (await LaneBenchmark.findOne({ benchmarkId: args.benchmarkId })
    .select('benchmarkId sourceName only limit supersedes')
    .lean()) as unknown as (StoredBenchmarkScope & { supersedes?: string }) | null;
  if (!successor) throw new Error(`No benchmark ${args.benchmarkId} to mark as the successor`);
  if (successor.supersedes) {
    throw new Error(
      `Benchmark ${args.benchmarkId} already supersedes ${successor.supersedes}; a benchmark supersedes one other`,
    );
  }
  const refusal = supersedeRefusal(superseded, await existingSuccessorId(supersededId), {
    withoutGold: false,
    successor,
  });
  if (refusal) throw new Error(refusal);
  if (!args.dryRun) {
    await LaneBenchmark.updateOne(
      { benchmarkId: args.benchmarkId, supersedes: { $exists: false } },
      { $set: { supersedes: supersededId } },
    );
  }
  console.log(
    JSON.stringify(
      {
        script: SCRIPT_NAME,
        mode: args.dryRun ? 'dry-run' : 'apply',
        benchmarkId: args.benchmarkId,
        supersedes: supersededId,
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  let args = parseCaptureArgs(process.argv.slice(2));
  let supersededPlannedObservationCount: number | undefined;
  const guard = assertScriptApplyAllowed({
    apply: !args.dryRun,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (!args.dryRun && !args.confirmed)
    throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${args.dryRun ? 'dry-run' : 'apply'}`,
  );
  await initializeConnections();

  if (args.markSuccessorOf) {
    await markSuccessor(args, args.markSuccessorOf);
    await mongoose.disconnect();
    return;
  }
  if (args.recapture) {
    const superseded = await loadSupersededBenchmark(args.recapture);
    const refusal = supersedeRefusal(superseded, await existingSuccessorId(args.recapture), {
      withoutGold: args.withoutGold,
    });
    if (refusal) throw new Error(refusal);
    args = scopeOfStoredBenchmark(args, superseded);
    supersededPlannedObservationCount = superseded.plannedObservationCount;
    assertBenchmarkableLane(args.sourceName);
    if (args.sourceConcurrency !== undefined) assertLaneHonorsSourceConcurrency(args.sourceName);
  }

  if (await LaneBenchmark.exists({ benchmarkId: args.benchmarkId })) {
    throw new Error(
      `Benchmark ${args.benchmarkId} already exists; a benchmark is frozen once captured`,
    );
  }

  const capturedAt = new Date();
  beginBenchmarkCapture();
  let pages;
  let unfrozenRequestCount: number;
  let run;
  try {
    run = await runLaneDry({ ...args, referenceDate: capturedAt });
  } finally {
    ({ pages, unfrozenRequestCount } = finishBenchmarkCaptureWithCoverage());
  }
  if (run.truncated) throw new Error('The lane planned more values than the capture can hold');

  const slugById = await slugsForPlannedEntities(run.observations);
  const slugs = new Set<string>();
  for (const observation of run.observations) {
    if (observation.entityType !== 'researchEntity') continue;
    const slug =
      (typeof observation.entityKey === 'string' && observation.entityKey) ||
      slugById.get(String(observation.entityId ?? ''));
    if (slug) slugs.add(slug);
  }
  const labels = await freezeLabels([...slugs]);

  const report = {
    script: SCRIPT_NAME,
    mode: args.dryRun ? 'dry-run' : 'apply',
    benchmarkId: args.benchmarkId,
    sourceName: args.sourceName,
    ...(args.recapture ? { supersedes: args.recapture, supersededPlannedObservationCount } : {}),
    pageCount: pages.length,
    unfrozenRequestCount,
    plannedObservationCount: run.observations.length,
    researchEntitiesPlanned: slugs.size,
    labelCount: labels.length,
  };

  if (!args.dryRun) {
    if (pages.length === 0)
      throw new Error('The capture fetched no pages; refusing to store an empty benchmark');
    try {
      await LaneBenchmarkPage.insertMany(
        pages.map((page) => ({ ...page, benchmarkId: args.benchmarkId })),
        { ordered: true },
      );
      await LaneBenchmark.create({
        benchmarkId: args.benchmarkId,
        sourceName: args.sourceName,
        only: args.only,
        limit: args.limit,
        capturedAt,
        environment: guard.environment,
        databaseName: mongoose.connection.db?.databaseName ?? 'unknown',
        codeSha: currentCodeSha(),
        pageCount: pages.length,
        unfrozenRequestCount,
        plannedObservationCount: run.observations.length,
        labels,
        ...(args.recapture ? { supersedes: args.recapture } : {}),
      });
    } catch (error) {
      await LaneBenchmarkPage.deleteMany({ benchmarkId: args.benchmarkId });
      throw error;
    }
  }
  console.log(JSON.stringify(report, null, 2));
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
