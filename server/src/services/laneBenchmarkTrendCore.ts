import { benchmarksToReplay } from '../scripts/laneScorecardCore';

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
  supersedes: string | null;
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

type ComparableRun = Pick<LaneBenchmarkRunDto, 'outputFingerprint' | 'codeSha'>;

export function classifyLaneBenchmarkChange(
  latest: ComparableRun,
  previous: ComparableRun | null,
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
  supersedes: string | null = null,
): LaneBenchmarkTrendDto | null {
  const [latestRow, previousRow] = rowsNewestFirst;
  if (!latestRow) return null;
  const latest = toLaneBenchmarkRunDto(latestRow);
  const previous = previousRow ? toLaneBenchmarkRunDto(previousRow) : null;
  return {
    benchmarkId,
    sourceName: text(latestRow.sourceName),
    supersedes,
    runs,
    latest,
    previous,
    change: classifyLaneBenchmarkChange(latest, previous),
  };
}

export interface StoredLaneBenchmarkRef {
  benchmarkId: string;
  sourceName?: string | null;
  supersedes?: string | null;
}

export interface LaneBenchmarkAwaitingReplayDto {
  benchmarkId: string;
  sourceName: string;
  supersedes: string | null;
}

export interface LaneBenchmarkPanelEntries {
  benchmarks: LaneBenchmarkTrendDto[];
  awaitingReplay: LaneBenchmarkAwaitingReplayDto[];
  supersededCount: number;
}

/**
 * The panel shows the benchmarks a sweep replays, so a recapture replaces its predecessor
 * here exactly as it does in `lane:scorecard`. A replaced capture froze different input,
 * so its replays are not comparable with the successor's and are left out rather than merged.
 */
export function laneBenchmarkPanelEntries(
  stored: readonly StoredLaneBenchmarkRef[],
  scoredRunsNewestFirst: ReadonlyMap<string, readonly Record<string, unknown>[]>,
): LaneBenchmarkPanelEntries {
  const { replay, superseded } = benchmarksToReplay(stored);
  const benchmarks: LaneBenchmarkTrendDto[] = [];
  const awaitingReplay: LaneBenchmarkAwaitingReplayDto[] = [];
  for (const benchmark of [...replay].sort((a, b) => a.benchmarkId.localeCompare(b.benchmarkId))) {
    const runs = scoredRunsNewestFirst.get(benchmark.benchmarkId) ?? [];
    const supersedes = benchmark.supersedes || null;
    const trend = buildLaneBenchmarkTrend(
      benchmark.benchmarkId,
      runs.slice(0, 2),
      runs.length,
      supersedes,
    );
    if (trend) benchmarks.push(trend);
    else
      awaitingReplay.push({
        benchmarkId: benchmark.benchmarkId,
        sourceName: text(benchmark.sourceName),
        supersedes,
      });
  }
  return { benchmarks, awaitingReplay, supersededCount: superseded.length };
}
