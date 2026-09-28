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
  | 'first-run'
  | 'unchanged'
  | 'code-changed'
  | 'input-leak'
  | 'unattributed';

export interface LaneBenchmarkTrend {
  benchmarkId: string;
  sourceName: string;
  runs: number;
  latest: LaneBenchmarkRun;
  previous: LaneBenchmarkRun | null;
  change: LaneBenchmarkChange;
}

export interface LaneBenchmarkResponse {
  benchmarks: LaneBenchmarkTrend[];
  historyLimit: number;
  measurementCollection: string;
  refreshCommand: string;
}
