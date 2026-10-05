export interface LaneBenchmarkGold {
  field: string;
  labeled: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
  precision: number | null;
  recall: number | null;
}

export interface LaneBenchmarkRun {
  measuredAt: string | null;
  codeSha: string | null;
  pagesServed: number;
  pagesMissed: number;
  emitted: number;
  knownWrong: number;
  labeledEntityEmitted: number;
  outputFingerprint: string;
  gold: LaneBenchmarkGold[];
}

export type LaneBenchmarkChange =
  'first-run' | 'unchanged' | 'code-changed' | 'input-leak' | 'unattributed';

export interface LaneBenchmarkTrend {
  benchmarkId: string;
  sourceName: string;
  runs: number;
  latest: LaneBenchmarkRun;
  previous: LaneBenchmarkRun | null;
  change: LaneBenchmarkChange;
}

export interface EngineBenchmarkRun {
  measuredAt: string | null;
  codeSha: string | null;
  rowsReplayed: number;
  rowsWithIncompleteInput: number;
  invalidatedRunSetChanged: boolean;
  resolved: number;
  cleared: number;
  knownWrong: number;
  labelsMatched: number;
  labelCount: number;
  outputFingerprint: string;
}

export type EngineBenchmarkChange = LaneBenchmarkChange | 'input-incomplete';

export interface EngineBenchmarkTrend {
  benchmarkId: string;
  stage: string;
  runs: number;
  latest: EngineBenchmarkRun;
  previous: EngineBenchmarkRun | null;
  change: EngineBenchmarkChange;
}

export interface EngineBenchmarkResponse {
  benchmarks: EngineBenchmarkTrend[];
  measurementCollection: string;
  refreshCommand: string;
}

export interface LaneBenchmarkResponse {
  benchmarks: LaneBenchmarkTrend[];
  measurementCollection: string;
  refreshCommand: string;
  engine?: EngineBenchmarkResponse;
}
