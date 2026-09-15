import {
  CorpusQualitySnapshot,
  CORPUS_QUALITY_SNAPSHOT_COLLECTION,
} from '../models/corpusQualitySnapshot';
import {
  readCorpusQualityLiveMetrics,
  type CorpusQualityLiveMetrics,
} from './corpusQualityLiveMetrics';
import {
  CORPUS_QUALITY_SNAPSHOT_DTO_PROJECTION,
  toCorpusQualitySnapshotDto,
  type CorpusQualitySnapshotDto,
} from './corpusQualitySnapshotDto';

export const CORPUS_QUALITY_HISTORY_LIMIT = 60;
export const CORPUS_QUALITY_REFRESH_COMMAND = 'yarn --cwd server corpus:snapshot';

/**
 * Metrics the live aggregation cannot answer, because each needs the roster
 * resolved and the public description representation built per row. Named here
 * so the panel can say which rows are current and which are as-of a
 * measurement, rather than implying the whole panel shares one freshness.
 */
export const CORPUS_QUALITY_SNAPSHOT_ONLY_METRICS = [
  'leadSentenceStatesResearch',
  'shortDescriptionIsAreaEchoOnly',
  'publicDescriptionInvariantFails',
] as const;

export interface CorpusQualityDashboard {
  live: CorpusQualityLiveMetrics;
  latest: CorpusQualitySnapshotDto | null;
  history: CorpusQualitySnapshotDto[];
  snapshotOnlyMetrics: readonly string[];
  measurementCollection: string;
  refreshCommand: string;
}

export async function getCorpusQualityDashboard(): Promise<CorpusQualityDashboard> {
  const [live, rows] = await Promise.all([
    readCorpusQualityLiveMetrics(),
    CorpusQualitySnapshot.find({}, CORPUS_QUALITY_SNAPSHOT_DTO_PROJECTION)
      .sort({ measuredAt: -1 })
      .limit(CORPUS_QUALITY_HISTORY_LIMIT)
      .lean(),
  ]);
  const measurements = rows.map((row) =>
    toCorpusQualitySnapshotDto(row as Record<string, unknown>),
  );

  return {
    live,
    latest: measurements[0] || null,
    history: [...measurements].reverse(),
    snapshotOnlyMetrics: CORPUS_QUALITY_SNAPSHOT_ONLY_METRICS,
    measurementCollection: CORPUS_QUALITY_SNAPSHOT_COLLECTION,
    refreshCommand: CORPUS_QUALITY_REFRESH_COMMAND,
  };
}
