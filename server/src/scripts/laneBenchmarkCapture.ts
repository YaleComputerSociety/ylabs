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
import { POLICY_FETCH_BENCHMARK_NAMESPACE } from '../scrapers/utils/httpFetch';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { liveFieldValueRefusals } from '../utils/researchEntityFieldValueRefusals';
import {
  assertBenchmarkableLane,
  assertLaneHonorsSourceConcurrency,
  currentCodeSha,
  runLaneDry,
  slugsForPlannedEntities,
} from './laneBenchmarkRun';
import type { BenchmarkLabel, GoldLabel } from './laneScorecardCore';
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
  goldLabels?: GoldLabel[];
  goldLabeledAt?: Date;
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
  options: { successor?: StoredBenchmarkScope } = {},
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
  return undefined;
}

export interface FrozenPage {
  sourceName: string;
  requestKey: string;
  payload: unknown;
}

const judgedPageText = (pages: readonly FrozenPage[], judgedPageUrl: string) => {
  const page = pages.find(
    (candidate) =>
      candidate.sourceName === POLICY_FETCH_BENCHMARK_NAMESPACE &&
      candidate.requestKey === `page:v1:${judgedPageUrl}`,
  );
  if (!page) return undefined;
  const payload = page.payload as { html?: unknown; status?: unknown; failedStatus?: unknown };
  return JSON.stringify([
    payload.html ?? null,
    payload.status ?? null,
    payload.failedStatus ?? null,
  ]);
};

/**
 * The gold labels a recapture may keep. A label judged one frozen page, so it carries only
 * when the recapture froze that same page with the same text and status; any other label is
 * dropped and must be judged again against the new pages.
 */
export function carryUnchangedGoldLabels(
  labels: readonly GoldLabel[],
  supersededPages: readonly FrozenPage[],
  recapturedPages: readonly FrozenPage[],
): { carried: GoldLabel[]; dropped: number } {
  const carried: GoldLabel[] = [];
  for (const label of labels) {
    if (!label.judgedPageUrl) continue;
    const before = judgedPageText(supersededPages, label.judgedPageUrl);
    if (before !== undefined && before === judgedPageText(recapturedPages, label.judgedPageUrl)) {
      carried.push(label);
    }
  }
  return { carried, dropped: labels.length - carried.length };
}

/**
 * A successor that plans nothing where the benchmark it replaces planned values measures
 * nothing, so storing it would retire a benchmark's signal rather than refresh it. The lane
 * no longer reaches that scope, which needs a new benchmark rather than a recapture.
 */
export function emptySuccessorRefusal(
  supersededId: string,
  supersededPlanned: number | undefined,
  recapturedPlanned: number,
): string | undefined {
  if (recapturedPlanned > 0 || (supersededPlanned ?? 0) === 0) return undefined;
  return `The recapture of ${supersededId} planned no values where it planned ${supersededPlanned}, so it would measure nothing; capture a new scope instead`;
}

export function goldCarryRefusal(
  superseded: Pick<StoredBenchmarkScope, 'benchmarkId' | 'goldLabels'>,
  carriedCount: number,
  withoutGold: boolean,
): string | undefined {
  const labelCount = superseded.goldLabels?.length ?? 0;
  if (labelCount === 0 || carriedCount > 0 || withoutGold) return undefined;
  return `None of the ${labelCount} gold labels on ${superseded.benchmarkId} judged a page the recapture froze unchanged; pass --without-gold to store an unlabelled successor and label it with lane:benchmark-label`;
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
    .select('benchmarkId sourceName only limit goldLabels goldLabeledAt plannedObservationCount')
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
  let supersededBenchmark: StoredBenchmarkScope | undefined;
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
    const refusal = supersedeRefusal(superseded, await existingSuccessorId(args.recapture));
    if (refusal) throw new Error(refusal);
    args = scopeOfStoredBenchmark(args, superseded);
    supersededPlannedObservationCount = superseded.plannedObservationCount;
    supersededBenchmark = superseded;
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
  if (args.recapture) {
    const emptyRefusal = emptySuccessorRefusal(
      args.recapture,
      supersededPlannedObservationCount,
      run.observations.length,
    );
    if (emptyRefusal) throw new Error(emptyRefusal);
  }
  const labels = await freezeLabels([...slugs]);
  let goldCarry: { carried: GoldLabel[]; dropped: number } | undefined;
  if (supersededBenchmark && (supersededBenchmark.goldLabels?.length ?? 0) > 0) {
    const supersededPages = (await LaneBenchmarkPage.find({
      benchmarkId: supersededBenchmark.benchmarkId,
      sourceName: POLICY_FETCH_BENCHMARK_NAMESPACE,
    })
      .select('sourceName requestKey payload')
      .lean()) as unknown as FrozenPage[];
    goldCarry = carryUnchangedGoldLabels(
      supersededBenchmark.goldLabels ?? [],
      supersededPages,
      pages,
    );
    const carryRefusal = goldCarryRefusal(
      supersededBenchmark,
      goldCarry.carried.length,
      args.withoutGold,
    );
    if (carryRefusal) throw new Error(carryRefusal);
  }

  const report = {
    script: SCRIPT_NAME,
    mode: args.dryRun ? 'dry-run' : 'apply',
    benchmarkId: args.benchmarkId,
    sourceName: args.sourceName,
    ...(args.recapture ? { supersedes: args.recapture, supersededPlannedObservationCount } : {}),
    ...(goldCarry
      ? { goldLabelsCarried: goldCarry.carried.length, goldLabelsDropped: goldCarry.dropped }
      : {}),
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
        ...(goldCarry && goldCarry.carried.length > 0
          ? {
              goldLabels: goldCarry.carried,
              goldLabeledAt: supersededBenchmark?.goldLabeledAt ?? capturedAt,
            }
          : {}),
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
