import {
  LaneScorecardSnapshot,
  LANE_SCORECARD_SNAPSHOT_COLLECTION,
} from '../models/laneScorecardSnapshot';
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
      const [latestTwo, runs] = await Promise.all([
        LaneScorecardSnapshot.find({ benchmarkId }, LANE_BENCHMARK_RUN_PROJECTION)
          .sort({ measuredAt: -1 })
          .limit(2)
          .lean(),
        LaneScorecardSnapshot.countDocuments({ benchmarkId }),
      ]);
      return buildLaneBenchmarkTrend(benchmarkId, latestTwo as Record<string, unknown>[], runs);
    }),
  );
  return {
    benchmarks: trends.filter((trend): trend is LaneBenchmarkTrendDto => trend !== null),
    measurementCollection: LANE_SCORECARD_SNAPSHOT_COLLECTION,
    refreshCommand: LANE_BENCHMARK_REFRESH_COMMAND,
  };
}
