import {
  LaneScorecardSnapshot,
  LANE_SCORECARD_SNAPSHOT_COLLECTION,
} from '../models/laneScorecardSnapshot';
import { LaneBenchmark } from '../models/laneBenchmark';
import {
  EngineBenchmarkSnapshot,
  ENGINE_BENCHMARK_SNAPSHOT_COLLECTION,
} from '../models/engineBenchmarkSnapshot';
import { benchmarksToReplay } from '../scripts/laneScorecardCore';
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
  'yarn --cwd server engine:benchmark --apply --confirm-engine-benchmark';

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
  const selection = benchmarksToReplay(stored);
  const [storedRuns, engine] = await Promise.all([
    Promise.all(
      selection.replay.map(async ({ benchmarkId }) => {
        const runs = await LaneScorecardSnapshot.find(
          { benchmarkId },
          LANE_BENCHMARK_RUN_PROJECTION,
        )
          .sort({ measuredAt: -1 })
          .lean();
        return [benchmarkId, runs as Record<string, unknown>[]] as const;
      }),
    ),
    getEngineBenchmarkDashboard(),
  ]);
  return {
    ...laneBenchmarkPanelEntries(selection, new Map(storedRuns)),
    measurementCollection: LANE_SCORECARD_SNAPSHOT_COLLECTION,
    refreshCommand: LANE_BENCHMARK_REFRESH_COMMAND,
    engine,
  };
}
