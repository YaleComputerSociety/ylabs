import {
  LaneScorecardSnapshot,
  LANE_SCORECARD_SNAPSHOT_COLLECTION,
} from '../models/laneScorecardSnapshot';
import { LaneBenchmark } from '../models/laneBenchmark';
import { allowedReplayMisses, staleReplayReason } from '../scripts/laneScorecardCore';
import { buildLaneBenchmarkTrend, type LaneBenchmarkTrendDto } from './laneBenchmarkTrendCore';

export const LANE_BENCHMARK_REFRESH_COMMAND =
  'yarn --cwd server lane:scorecard --apply --confirm-lane-scorecard';

const LANE_BENCHMARK_RUN_PROJECTION =
  'measuredAt codeSha sourceName pagesServed pagesMissed emitted knownWrong byField outputFingerprint gold';

export interface LaneBenchmarkDashboard {
  benchmarks: LaneBenchmarkTrendDto[];
  measurementCollection: string;
  refreshCommand: string;
}

export async function getLaneBenchmarkDashboard(): Promise<LaneBenchmarkDashboard> {
  const benchmarkIds = ((await LaneScorecardSnapshot.distinct('benchmarkId')) as unknown[])
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .sort();
  const trends = await Promise.all(
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
  );
  return {
    benchmarks: trends.filter((trend): trend is LaneBenchmarkTrendDto => trend !== null),
    measurementCollection: LANE_SCORECARD_SNAPSHOT_COLLECTION,
    refreshCommand: LANE_BENCHMARK_REFRESH_COMMAND,
  };
}
