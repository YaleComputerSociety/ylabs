import {
  CorpusQualitySnapshot,
  CORPUS_QUALITY_SNAPSHOT_COLLECTION,
} from '../models/corpusQualitySnapshot';
import { readCorpusCoverageCounts } from './corpusQualityReport';
import type { CorpusQualityCorpusCounts } from './corpusQualityReportCore';

export const CORPUS_QUALITY_HISTORY_LIMIT = 60;

export interface CorpusQualityDashboard {
  coverageNow: CorpusQualityCorpusCounts;
  latest: Record<string, unknown> | null;
  history: Array<Record<string, unknown>>;
  measurementCollection: string;
  refreshCommand: string;
}

export const CORPUS_QUALITY_REFRESH_COMMAND = 'yarn --cwd server corpus:snapshot';

export async function getCorpusQualityDashboard(): Promise<CorpusQualityDashboard> {
  const [coverageNow, history] = await Promise.all([
    readCorpusCoverageCounts(),
    CorpusQualitySnapshot.find({})
      .sort({ measuredAt: -1 })
      .limit(CORPUS_QUALITY_HISTORY_LIMIT)
      .lean(),
  ]);

  return {
    coverageNow,
    latest: (history[0] as Record<string, unknown>) || null,
    history: [...history].reverse() as Array<Record<string, unknown>>,
    measurementCollection: CORPUS_QUALITY_SNAPSHOT_COLLECTION,
    refreshCommand: CORPUS_QUALITY_REFRESH_COMMAND,
  };
}
