export interface LaneBenchmarkGoldDto {
  field: string;
  labeled: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
  precision: number | null;
  recall: number | null;
}

export interface LaneBenchmarkRunDto {
  measuredAt: string | null;
  codeSha: string | null;
  pagesServed: number;
  pagesMissed: number;
  emitted: number;
  knownWrong: number;
  labeledEntityEmitted: number;
  outputFingerprint: string;
  gold: LaneBenchmarkGoldDto[];
}

/**
 * Why the latest replay's output differs from the one before it. A fingerprint is a pure
 * function of the frozen input and the code, so a change with the same code means the input
 * was not frozen after all, which is an instrument fault and never a lane regression (#3591).
 */
export type LaneBenchmarkChange =
  'first-run' | 'unchanged' | 'code-changed' | 'input-leak' | 'unattributed';

export interface LaneBenchmarkTrendDto {
  benchmarkId: string;
  sourceName: string;
  runs: number;
  latest: LaneBenchmarkRunDto;
  previous: LaneBenchmarkRunDto | null;
  change: LaneBenchmarkChange;
}

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const rate = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object',
      )
    : [];

export function toLaneBenchmarkRunDto(row: Record<string, unknown>): LaneBenchmarkRunDto {
  const measuredAt = row.measuredAt instanceof Date ? row.measuredAt.toISOString() : null;
  return {
    measuredAt,
    codeSha: text(row.codeSha) || null,
    pagesServed: count(row.pagesServed),
    pagesMissed: count(row.pagesMissed),
    emitted: count(row.emitted),
    knownWrong: count(row.knownWrong),
    labeledEntityEmitted: records(row.byField).reduce(
      (sum, field) => sum + count(field.labeledEntityEmitted),
      0,
    ),
    outputFingerprint: text(row.outputFingerprint),
    gold: records(row.gold).map((entry) => ({
      field: text(entry.field),
      labeled: count(entry.labeled),
      truePositive: count(entry.truePositive),
      falsePositive: count(entry.falsePositive),
      falseNegative: count(entry.falseNegative),
      trueNegative: count(entry.trueNegative),
      precision: rate(entry.precision),
      recall: rate(entry.recall),
    })),
  };
}

export function classifyLaneBenchmarkChange(
  latest: LaneBenchmarkRunDto,
  previous: LaneBenchmarkRunDto | null,
): LaneBenchmarkChange {
  if (!previous) return 'first-run';
  if (latest.outputFingerprint === previous.outputFingerprint) return 'unchanged';
  if (!latest.codeSha || !previous.codeSha) return 'unattributed';
  return latest.codeSha === previous.codeSha ? 'input-leak' : 'code-changed';
}

/** Rows of one benchmark, newest first, as the `{ benchmarkId, measuredAt: -1 }` index returns them. */
export function buildLaneBenchmarkTrend(
  benchmarkId: string,
  rowsNewestFirst: readonly Record<string, unknown>[],
  runs: number,
): LaneBenchmarkTrendDto | null {
  const [latestRow, previousRow] = rowsNewestFirst;
  if (!latestRow) return null;
  const latest = toLaneBenchmarkRunDto(latestRow);
  const previous = previousRow ? toLaneBenchmarkRunDto(previousRow) : null;
  return {
    benchmarkId,
    sourceName: text(latestRow.sourceName),
    runs,
    latest,
    previous,
    change: classifyLaneBenchmarkChange(latest, previous),
  };
}
