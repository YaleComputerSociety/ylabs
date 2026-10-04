import { classifyLaneBenchmarkChange, type LaneBenchmarkChange } from './laneBenchmarkTrendCore';

export interface EngineBenchmarkRunDto {
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

export interface EngineBenchmarkTrendDto {
  benchmarkId: string;
  stage: string;
  runs: number;
  latest: EngineBenchmarkRunDto;
  previous: EngineBenchmarkRunDto | null;
  change: EngineBenchmarkChange;
}

export type EngineBenchmarkChange = LaneBenchmarkChange | 'input-incomplete';

/**
 * Whether a fingerprint change can be read as a code change at all.
 *
 * A row whose input the capture did not fully freeze, or a quarantine set that moved
 * between capture and replay, means the input moved too, so the change is unattributable.
 * Reported as a frozen-input leak rather than as a regression (#3591), because a
 * measurement that calls an input change a regression is worse than none: it trains the
 * reader to ignore it.
 */
export function fingerprintChangeIsAttributable(snapshot: {
  rowsWithIncompleteInput: number;
  invalidatedRunSetChanged: boolean;
}): boolean {
  return snapshot.rowsWithIncompleteInput === 0 && !snapshot.invalidatedRunSetChanged;
}

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export function toEngineBenchmarkRunDto(row: Record<string, unknown>): EngineBenchmarkRunDto {
  return {
    measuredAt: row.measuredAt instanceof Date ? row.measuredAt.toISOString() : null,
    codeSha: text(row.codeSha) || null,
    rowsReplayed: count(row.rowsReplayed),
    rowsWithIncompleteInput: count(row.rowsWithIncompleteInput),
    invalidatedRunSetChanged: row.invalidatedRunSetChanged === true,
    resolved: count(row.resolved),
    cleared: count(row.cleared),
    knownWrong: count(row.knownWrong),
    labelsMatched: count(row.labelsMatched),
    labelCount: count(row.labelCount),
    outputFingerprint: text(row.outputFingerprint),
  };
}

export function classifyEngineBenchmarkChange(
  latest: EngineBenchmarkRunDto,
  previous: EngineBenchmarkRunDto | null,
): EngineBenchmarkChange {
  const change = classifyLaneBenchmarkChange(latest, previous);
  if (change === 'first-run' || change === 'unchanged') return change;
  const attributable = [latest, previous].every(
    (run) => run !== null && fingerprintChangeIsAttributable(run),
  );
  return attributable ? change : 'input-incomplete';
}

export function buildEngineBenchmarkTrend(
  benchmarkId: string,
  stage: string,
  rowsNewestFirst: readonly Record<string, unknown>[],
  runs: number,
): EngineBenchmarkTrendDto | null {
  const [latestRow, previousRow] = rowsNewestFirst;
  if (!latestRow) return null;
  const latest = toEngineBenchmarkRunDto(latestRow);
  const previous = previousRow ? toEngineBenchmarkRunDto(previousRow) : null;
  return {
    benchmarkId,
    stage,
    runs,
    latest,
    previous,
    change: classifyEngineBenchmarkChange(latest, previous),
  };
}
