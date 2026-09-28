import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { LaneBenchmark, LaneBenchmarkPage } from '../models/laneBenchmark';
import { LaneScorecardSnapshot } from '../models/laneScorecardSnapshot';
import {
  BenchmarkReplayNetworkError,
  beginBenchmarkReplay,
  finishBenchmarkReplay,
  MODEL_RESPONSE_NAMESPACE,
  type CapturedPage,
} from '../scrapers/snapshotBenchmarkMode';
import {
  isRenderedFetchMetadataKey,
  RENDERED_FETCH_BENCHMARK_NAMESPACE,
} from '../scrapers/renderedFetch';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  currentCodeSha,
  runClockFieldsFor,
  runLaneDry,
  slugsForPlannedEntities,
} from './laneBenchmarkRun';
import {
  scoreGoldLabels,
  scoreLaneReplay,
  summarizeGoldRuns,
  summarizeLiveModelRuns,
  type BenchmarkLabel,
  type GoldLabel,
} from './laneScorecardCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'lane:scorecard';
export const CONFIRM_FLAG = '--confirm-lane-scorecard';

export interface LaneScorecardArgs {
  dryRun: boolean;
  confirmed: boolean;
  benchmarkId?: string;
  output?: string;
  liveModelRuns?: number;
}

export function parseLaneScorecardArgs(argv: string[]): LaneScorecardArgs {
  const options: LaneScorecardArgs = {
    dryRun: true,
    confirmed: false,
  };
  let liveModel = false;
  let runs = 3;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg === '--live-model') liveModel = true;
    else if (arg.startsWith('--runs=')) {
      runs = Number(arg.slice('--runs='.length));
      if (!Number.isInteger(runs) || runs < 2)
        throw new Error('--runs must be an integer of 2 or more');
    } else if (arg.startsWith('--benchmark='))
      options.benchmarkId = arg.slice('--benchmark='.length).trim();
    else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  if (liveModel) {
    if (!options.dryRun) {
      throw new Error(`${SCRIPT_NAME} --live-model reports a noise band and never stores a row`);
    }
    options.liveModelRuns = runs;
  }
  return options;
}

interface StoredBenchmark {
  benchmarkId: string;
  sourceName: string;
  only?: string[];
  limit?: number;
  labels?: BenchmarkLabel[];
  goldLabels?: GoldLabel[];
  plannedObservationCount?: number;
}

/**
 * A replay that plans nothing where its capture planned values measured the environment,
 * not the lane: an LLM lane with no API key emits zero and says so in a log line. Stored,
 * that row reads as a lane with no known-wrong values at all.
 */
export function emptyReplayReason(
  benchmark: Pick<StoredBenchmark, 'plannedObservationCount'>,
  score: { emitted: number; refusedAtIngest: number },
): string | undefined {
  const captured = benchmark.plannedObservationCount ?? 0;
  if (captured === 0 || score.emitted + score.refusedAtIngest > 0) return undefined;
  return `replay planned no values where the capture planned ${captured}`;
}

/**
 * A replay is compared only once it has resolved something from the frozen input (#3590). A
 * lane that served none of its captured pages, or a rendered lane that served none of its
 * captured renders, measured a renderer or fetch path that never engaged, and scoring it would
 * read an instrument fault as a lane change.
 */
export function unresolvedReplayReason(
  pages: readonly Pick<CapturedPage, 'sourceName' | 'requestKey'>[],
  replay: { pagesServed: number; servedByNamespace: Record<string, number> },
): string | undefined {
  const frozenPages = pages.filter((page) => !isRenderedFetchMetadataKey(page.requestKey));
  if (frozenPages.length > 0 && replay.pagesServed === 0) {
    return `replay served none of the ${frozenPages.length} frozen pages`;
  }
  const frozenRenders = frozenPages.filter(
    (page) => page.sourceName === RENDERED_FETCH_BENCHMARK_NAMESPACE,
  ).length;
  if (
    frozenRenders > 0 &&
    (replay.servedByNamespace[RENDERED_FETCH_BENCHMARK_NAMESPACE] ?? 0) === 0
  ) {
    return `replay served none of the ${frozenRenders} frozen renders, so the renderer never engaged`;
  }
  return undefined;
}

/**
 * A lane that requests a page or render its capture never froze is refused at the network
 * boundary. That refusal is this benchmark's instrument fault, so it is reported as unscored
 * rather than aborting the sweep before any other benchmark stores its row.
 */
export async function replayBenchmark(
  benchmark: StoredBenchmark,
  pages: readonly CapturedPage[],
  replayOptions: { liveModel?: boolean } = {},
) {
  beginBenchmarkReplay(pages, replayOptions);
  let run;
  let replay;
  try {
    run = await runLaneDry({
      sourceName: benchmark.sourceName,
      only: benchmark.only ?? [],
      limit: benchmark.limit,
    });
  } catch (error) {
    if (!(error instanceof BenchmarkReplayNetworkError)) throw error;
    return {
      refusedReason: 'replay requested a page or render the capture never froze, so the lane aborted',
    } as const;
  } finally {
    replay = finishBenchmarkReplay();
  }
  const slugByEntityId = await slugsForPlannedEntities(run.observations);
  const score = scoreLaneReplay(
    run.observations,
    benchmark.labels ?? [],
    slugByEntityId,
    runClockFieldsFor(benchmark.sourceName),
  );
  const gold = scoreGoldLabels(run.observations, benchmark.goldLabels ?? [], slugByEntityId);
  return { refusedReason: undefined, score, gold, replay, truncated: run.truncated };
}

async function main(): Promise<void> {
  const options = parseLaneScorecardArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: !options.dryRun,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (!options.dryRun && !options.confirmed)
    throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${options.dryRun ? 'dry-run' : 'apply'}`,
  );
  await initializeConnections();

  const benchmarks = (await LaneBenchmark.find(
    options.benchmarkId ? { benchmarkId: options.benchmarkId } : {},
  )
    .sort({ benchmarkId: 1 })
    .lean()) as unknown as StoredBenchmark[];
  if (options.benchmarkId && benchmarks.length === 0) {
    throw new Error(`No benchmark ${options.benchmarkId}`);
  }

  const codeSha = currentCodeSha();
  const databaseName = mongoose.connection.db?.databaseName ?? 'unknown';
  const results: Array<Record<string, unknown>> = [];
  const unscored: Array<{ benchmarkId: string; reason: string }> = [];
  for (const benchmark of benchmarks) {
    const pages = (await LaneBenchmarkPage.find({ benchmarkId: benchmark.benchmarkId })
      .select('sourceName requestKey payload fetchedAt')
      .lean()) as unknown as CapturedPage[];
    if (options.liveModelRuns) {
      if (!pages.some((page) => page.sourceName === MODEL_RESPONSE_NAMESPACE)) continue;
      const scores = [];
      const golds = [];
      const replays = [];
      let refusedReason: string | undefined;
      for (let runIndex = 0; runIndex < options.liveModelRuns; runIndex += 1) {
        const run = await replayBenchmark(benchmark, pages, { liveModel: true });
        if (run.refusedReason) {
          refusedReason = run.refusedReason;
          break;
        }
        scores.push(run.score);
        golds.push(run.gold);
        replays.push(run.replay);
      }
      if (refusedReason) {
        unscored.push({ benchmarkId: benchmark.benchmarkId, reason: refusedReason });
        continue;
      }
      results.push({
        benchmarkId: benchmark.benchmarkId,
        sourceName: benchmark.sourceName,
        codeSha,
        replays,
        liveModel: summarizeLiveModelRuns(scores),
        ...(benchmark.goldLabels?.length ? { liveModelGold: summarizeGoldRuns(golds) } : {}),
      });
      continue;
    }
    const replayed = await replayBenchmark(benchmark, pages);
    if (replayed.refusedReason) {
      unscored.push({ benchmarkId: benchmark.benchmarkId, reason: replayed.refusedReason });
      continue;
    }
    const { score, gold, replay, truncated } = replayed;
    const emptyReason =
      emptyReplayReason(benchmark, score) ?? unresolvedReplayReason(pages, replay);
    if (emptyReason) {
      unscored.push({ benchmarkId: benchmark.benchmarkId, reason: emptyReason });
      continue;
    }
    const snapshot = {
      measuredAt: new Date(),
      environment: guard.environment,
      databaseName,
      benchmarkId: benchmark.benchmarkId,
      sourceName: benchmark.sourceName,
      codeSha,
      pagesServed: replay.pagesServed,
      pagesMissed: replay.pagesMissed,
      ...score,
      gold,
    };
    if (!options.dryRun) await LaneScorecardSnapshot.create(snapshot);
    results.push({ ...snapshot, networkBlocks: replay.networkBlocks, truncated });
  }

  const report = {
    script: SCRIPT_NAME,
    mode: options.liveModelRuns ? 'live-model' : options.dryRun ? 'dry-run' : 'apply',
    benchmarks: results.length,
    stored: options.dryRun ? 0 : results.length,
    unscored,
    results,
  };
  console.log(JSON.stringify(report, null, 2));
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  }
  await mongoose.disconnect();
  if (unscored.length > 0) process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
