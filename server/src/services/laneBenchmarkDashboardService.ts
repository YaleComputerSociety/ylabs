import {
  LaneScorecardSnapshot,
  LANE_SCORECARD_SNAPSHOT_COLLECTION,
} from '../models/laneScorecardSnapshot';
import { buildLaneBenchmarkTrend, type LaneBenchmarkTrendDto } from './laneBenchmarkTrendCore';

export const LANE_BENCHMARK_HISTORY_LIMIT = 20;
export const LANE_BENCHMARK_REFRESH_COMMAND =
  'yarn --cwd server lane:scorecard --apply --confirm-lane-scorecard';

const LANE_BENCHMARK_RUN_PROJECTION =
  'measuredAt codeSha sourceName pagesServed pagesMissed emitted knownWrong byField outputFingerprint gold';

export interface LaneBenchmarkDashboard {
  benchmarks: LaneBenchmarkTrendDto[];
  historyLimit: number;
  measurementCollection: string;
  refreshCommand: string;
}

export async function getLaneBenchmarkDashboard(): Promise<LaneBenchmarkDashboard> {
  const benchmarkIds = ((await LaneScorecardSnapshot.distinct('benchmarkId')) as unknown[])
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .sort();
  const trends = await Promise.all(
    benchmarkIds.map(async (benchmarkId) => {
      const rows = await LaneScorecardSnapshot.find({ benchmarkId }, LANE_BENCHMARK_RUN_PROJECTION)
        .sort({ measuredAt: -1 })
        .limit(LANE_BENCHMARK_HISTORY_LIMIT)
        .lean();
      return buildLaneBenchmarkTrend(benchmarkId, rows as Record<string, unknown>[]);
    }),
  );
  return {
    benchmarks: trends.filter((trend): trend is LaneBenchmarkTrendDto => trend !== null),
    historyLimit: LANE_BENCHMARK_HISTORY_LIMIT,
    measurementCollection: LANE_SCORECARD_SNAPSHOT_COLLECTION,
    refreshCommand: LANE_BENCHMARK_REFRESH_COMMAND,
  };
}
