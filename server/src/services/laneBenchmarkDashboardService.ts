import {
  LaneScorecardSnapshot,
  LANE_SCORECARD_SNAPSHOT_COLLECTION,
} from '../models/laneScorecardSnapshot';
import { LaneBenchmark } from '../models/laneBenchmark';
import {
  EngineBenchmarkSnapshot,
  ENGINE_BENCHMARK_SNAPSHOT_COLLECTION,
} from '../models/engineBenchmarkSnapshot';
import { allowedReplayMisses, staleReplayReason } from '../scripts/laneScorecardCore';
import { buildLaneBenchmarkTrend, type LaneBenchmarkTrendDto } from './laneBenchmarkTrendCore';
import {
  buildEngineBenchmarkTrend,
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
  measurementCollection: string;
  refreshCommand: string;
}

export interface LaneBenchmarkDashboard {
  benchmarks: LaneBenchmarkTrendDto[];
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
  const trends = await Promise.all(
    pairs.map(async ({ benchmarkId, stage }) => {
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
    measurementCollection: ENGINE_BENCHMARK_SNAPSHOT_COLLECTION,
    refreshCommand: ENGINE_BENCHMARK_REFRESH_COMMAND,
  };
}

export async function getLaneBenchmarkDashboard(): Promise<LaneBenchmarkDashboard> {
  const benchmarkIds = ((await LaneScorecardSnapshot.distinct('benchmarkId')) as unknown[])
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .sort();
  const [trends, engine] = await Promise.all([
    Promise.all(
      benchmarkIds.map(async (benchmarkId) => {
        const [benchmark, allRuns] = await Promise.all([
          LaneBenchmark.findOne({ benchmarkId }).select('unfrozenRequestCount codeSha').lean(),
          LaneScorecardSnapshot.find({ benchmarkId }, LANE_BENCHMARK_RUN_PROJECTION)
            .sort({ measuredAt: -1 })
            .lean(),
        ]);
        // A stored row that missed more than its capture left unfrozen measured a changed prompt
        // or drifted targets rather than the lane, so it is left out of the trend it would
        // otherwise read as a collapse (#3816).
        const runs = allRuns as Record<string, unknown>[];
        const allowed = allowedReplayMisses(benchmark ?? {}, runs);
        const scored = runs.filter(
          (run) => !staleReplayReason(Number(run.pagesMissed ?? 0), allowed),
        );
        return buildLaneBenchmarkTrend(benchmarkId, scored.slice(0, 2), scored.length);
      }),
    ),
    getEngineBenchmarkDashboard(),
  ]);
  return {
    benchmarks: trends.filter((trend): trend is LaneBenchmarkTrendDto => trend !== null),
    measurementCollection: LANE_SCORECARD_SNAPSHOT_COLLECTION,
    refreshCommand: LANE_BENCHMARK_REFRESH_COMMAND,
    engine,
  };
}
