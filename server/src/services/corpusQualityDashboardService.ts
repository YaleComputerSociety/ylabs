import {
  CorpusQualitySnapshot,
  CORPUS_QUALITY_SNAPSHOT_COLLECTION,
} from '../models/corpusQualitySnapshot';
import {
  readCorpusQualityLiveMetrics,
  type CorpusQualityLiveMetrics,
} from './corpusQualityLiveMetrics';

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
  latest: Record<string, unknown> | null;
  history: Array<Record<string, unknown>>;
  snapshotOnlyMetrics: readonly string[];
  measurementCollection: string;
  refreshCommand: string;
}

export async function getCorpusQualityDashboard(): Promise<CorpusQualityDashboard> {
  const [live, history] = await Promise.all([
    readCorpusQualityLiveMetrics(),
    CorpusQualitySnapshot.find({})
      .sort({ measuredAt: -1 })
      .limit(CORPUS_QUALITY_HISTORY_LIMIT)
      .lean(),
  ]);

  return {
    live,
    latest: (history[0] as Record<string, unknown>) || null,
    history: [...history].reverse() as Array<Record<string, unknown>>,
    snapshotOnlyMetrics: CORPUS_QUALITY_SNAPSHOT_ONLY_METRICS,
    measurementCollection: CORPUS_QUALITY_SNAPSHOT_COLLECTION,
    refreshCommand: CORPUS_QUALITY_REFRESH_COMMAND,
  };
}
