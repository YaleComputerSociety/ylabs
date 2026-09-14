export interface CorpusQualityRatio {
  n: number;
  of: number;
}

export interface CorpusQualitySnapshotRow {
  measuredAt: string;
  environment: string;
  databaseName: string;
  surface: string;
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

export interface CorpusQualityResponse {
  coverageNow: {
    entities: number;
    archived: number;
    studentReady: number;
    byTier: Array<{ tier: string; count: number }>;
  };
  latest: CorpusQualitySnapshotRow | null;
  history: CorpusQualitySnapshotRow[];
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
}
