export interface CorpusQualityRatio {
  n: number;
  of: number;
}

/**
 * A stored measurement as the endpoint serves it: measured fields only, no
 * Mongo bookkeeping, and no coverage block because every coverage number the
 * panel renders is read live.
 */
export interface CorpusQualitySnapshotRow {
  measuredAt: string;
  environment: string;
  richness: {
    hasResearchWebsite: CorpusQualityRatio;
    hasTopic: CorpusQualityRatio;
    hasSourceUrl: CorpusQualityRatio;
    topicTotal: CorpusQualityRatio;
    noResearchWebsiteAndNoTopics: CorpusQualityRatio;
  };
  description: {
    fullDescriptionUseful: CorpusQualityRatio;
    shortDescriptionUseful: CorpusQualityRatio;
    leadSentenceStatesResearch: CorpusQualityRatio;
    shortDescriptionIsAreaEchoOnly: CorpusQualityRatio;
    nameIsGenericFacultyResearchTitle: CorpusQualityRatio;
  };
  integrity: {
    publicDescriptionInvariantFails: CorpusQualityRatio;
  };
}

export interface CorpusQualityLiveMetrics {
  computedAt: string;
  coverage: {
    entities: number;
    archived: number;
    studentReady: number;
    byTier: Array<{ tier: string; count: number }>;
    studentReadyBySchool: Array<{ school: string; count: number }>;
  };
  richness: {
    hasResearchWebsite: CorpusQualityRatio;
    hasTopic: CorpusQualityRatio;
    hasSourceUrl: CorpusQualityRatio;
    topicTotal: CorpusQualityRatio;
    noResearchWebsiteAndNoTopics: CorpusQualityRatio;
  };
  description: {
    nameIsGenericFacultyResearchTitle: CorpusQualityRatio;
  };
}

export interface CorpusQualityResponse {
  live: CorpusQualityLiveMetrics;
  latest: CorpusQualitySnapshotRow | null;
  history: CorpusQualitySnapshotRow[];
  snapshotOnlyMetrics: string[];
  measurementCollection: string;
  refreshCommand: string;
}

export type CorpusQualityMetricDirection = 'higher-is-better' | 'lower-is-better';

export interface CorpusQualityMetricRow {
  label: string;
  hint: string;
  direction: CorpusQualityMetricDirection;
  current: CorpusQualityRatio;
  previous?: CorpusQualityRatio;
  /** Computed on this request, rather than read from the latest measurement. */
  live: boolean;
}
