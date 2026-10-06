import {
  LaneScorecardSnapshot,
  LANE_SCORECARD_SNAPSHOT_COLLECTION,
} from '../models/laneScorecardSnapshot';
import { LaneBenchmark } from '../models/laneBenchmark';
import {
  EngineBenchmarkSnapshot,
  ENGINE_BENCHMARK_SNAPSHOT_COLLECTION,
} from '../models/engineBenchmarkSnapshot';
import {
  allowedReplayMisses,
  benchmarksToReplay,
  staleReplayReason,
} from '../scripts/laneScorecardCore';
import {
  laneBenchmarkPanelEntries,
  type LaneBenchmarkAwaitingReplayDto,
  type LaneBenchmarkTrendDto,
} from './laneBenchmarkTrendCore';
import {
  buildEngineBenchmarkTrend,
  sweepEngineBenchmarkKeys,
  type EngineBenchmarkTrendDto,
} from './engineBenchmarkTrendCore';

export const LANE_BENCHMARK_REFRESH_COMMAND =
  'yarn --cwd server lane:scorecard --apply --confirm-lane-scorecard';

const LANE_BENCHMARK_RUN_PROJECTION =
  'measuredAt codeSha sourceName pagesServed pagesMissed emitted knownWrong byField outputFingerprint gold';

export const ENGINE_BENCHMARK_REFRESH_COMMAND =
  'yarn --cwd server engine:benchmark --benchmark=<benchmark-id> --apply --confirm-engine-benchmark';

const ENGINE_BENCHMARK_RUN_PROJECTION =
  'measuredAt codeSha rowsReplayed rowsWithIncompleteInput invalidatedRunSetChanged resolved cleared knownWrong labelsMatched labelCount outputFingerprint';

export interface EngineBenchmarkDashboard {
  benchmarks: EngineBenchmarkTrendDto[];
  oneOffBenchmarkCount: number;
  measurementCollection: string;
  refreshCommand: string;
}

export interface LaneBenchmarkDashboard {
  benchmarks: LaneBenchmarkTrendDto[];
  awaitingReplay: LaneBenchmarkAwaitingReplayDto[];
  supersededCount: number;
  measurementCollection: string;
  refreshCommand: string;
  engine: EngineBenchmarkDashboard;
}

async function getEngineBenchmarkDashboard(): Promise<EngineBenchmarkDashboard> {
  const keys = (await EngineBenchmarkSnapshot.aggregate([
    { $group: { _id: { benchmarkId: '$benchmarkId', stage: '$stage' } } },
  ])) as { _id: { benchmarkId?: unknown; stage?: unknown } }[];
  const pairs = keys
    .map(({ _id }) => ({ benchmarkId: _id.benchmarkId, stage: _id.stage }))
    .filter(
      (pair): pair is { benchmarkId: string; stage: string } =>
        typeof pair.benchmarkId === 'string' &&
        pair.benchmarkId.length > 0 &&
        typeof pair.stage === 'string',
    )
    .sort((a, b) => a.benchmarkId.localeCompare(b.benchmarkId) || a.stage.localeCompare(b.stage));
  const { replayed, oneOffBenchmarkCount } = sweepEngineBenchmarkKeys(pairs);
  const trends = await Promise.all(
    replayed.map(async ({ benchmarkId, stage }) => {
      const [rows, runs] = await Promise.all([
        EngineBenchmarkSnapshot.find({ benchmarkId, stage }, ENGINE_BENCHMARK_RUN_PROJECTION)
          .sort({ measuredAt: -1 })
          .limit(2)
          .lean(),
        EngineBenchmarkSnapshot.countDocuments({ benchmarkId, stage }),
      ]);
      return buildEngineBenchmarkTrend(benchmarkId, stage, rows as Record<string, unknown>[], runs);
    }),
  );
  return {
    benchmarks: trends.filter((trend): trend is EngineBenchmarkTrendDto => trend !== null),
    oneOffBenchmarkCount,
    measurementCollection: ENGINE_BENCHMARK_SNAPSHOT_COLLECTION,
    refreshCommand: ENGINE_BENCHMARK_REFRESH_COMMAND,
  };
}

export async function getLaneBenchmarkDashboard(): Promise<LaneBenchmarkDashboard> {
  const stored = (await LaneBenchmark.find({})
    .select('benchmarkId sourceName supersedes unfrozenRequestCount codeSha')
    .lean()) as unknown as Array<{
    benchmarkId: string;
    sourceName?: string;
    supersedes?: string;
    unfrozenRequestCount?: number;
    codeSha?: string;
  }>;
  const { replay: current } = benchmarksToReplay(stored);
  const [scoredRuns, engine] = await Promise.all([
    Promise.all(
      current.map(async (benchmark) => {
        const allRuns = await LaneScorecardSnapshot.find(
          { benchmarkId: benchmark.benchmarkId },
          LANE_BENCHMARK_RUN_PROJECTION,
        )
          .sort({ measuredAt: -1 })
          .lean();
        // A stored row that missed more than its capture left unfrozen measured a changed prompt
        // or drifted targets rather than the lane, so it is left out of the trend it would
        // otherwise read as a collapse (#3816).
        const runs = allRuns as Record<string, unknown>[];
        const allowed = allowedReplayMisses(benchmark, runs);
        const scored = runs.filter(
          (run) => !staleReplayReason(Number(run.pagesMissed ?? 0), allowed),
        );
        return [benchmark.benchmarkId, scored] as const;
      }),
    ),
    getEngineBenchmarkDashboard(),
  ]);
  return {
    ...laneBenchmarkPanelEntries(stored, new Map(scoredRuns)),
    measurementCollection: LANE_SCORECARD_SNAPSHOT_COLLECTION,
    refreshCommand: LANE_BENCHMARK_REFRESH_COMMAND,
    engine,
  };
}
