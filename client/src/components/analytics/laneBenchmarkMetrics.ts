import type {
  EngineBenchmarkChange,
  LaneBenchmarkChange,
  LaneBenchmarkGold,
  LaneBenchmarkRun,
} from './laneBenchmarkTypes';

export const LANE_BENCHMARK_CHANGE_LABEL: Record<LaneBenchmarkChange, string> = {
  'first-run': 'First replay',
  unchanged: 'Same output as the previous replay',
  'code-changed': 'Output changed with the code',
  'input-leak': 'Output changed with the same code: the frozen input leaked',
  unattributed: 'Output changed, but a replay recorded no code version',
};

export const ENGINE_BENCHMARK_CHANGE_LABEL: Record<EngineBenchmarkChange, string> = {
  ...LANE_BENCHMARK_CHANGE_LABEL,
  'input-incomplete': 'Output changed, but a replay read input the capture did not freeze',
};

export const formatRate = (value: number | null): string =>
  value === null ? 'n/a' : `${(value * 100).toFixed(0)}%`;

export const formatCounts = (numerator: number, denominator: number): string =>
  `${numerator} of ${denominator}`;

const pointsBetween = (now: number | null | undefined, before: number | null | undefined) =>
  typeof now === 'number' && typeof before === 'number'
    ? Math.round((now - before) * 1000) / 10
    : null;

/**
 * The change in a gold rate from the previous replay, in percentage points. A rate that was
 * undefined on either side has no change, which is not the same as no movement.
 */
export function goldRateDelta(
  field: string,
  key: 'precision' | 'recall',
  latest: readonly LaneBenchmarkGold[],
  previous: readonly LaneBenchmarkGold[] | undefined,
): number | null {
  const now = latest.find((entry) => entry.field === field)?.[key];
  const before = previous?.find((entry) => entry.field === field)?.[key];
  return pointsBetween(now, before);
}

const knownWrongRate = (run: LaneBenchmarkRun): number | null =>
  run.labeledEntityEmitted > 0 ? run.knownWrong / run.labeledEntityEmitted : null;

export const knownWrongRateDelta = (
  latest: LaneBenchmarkRun,
  previous: LaneBenchmarkRun | null,
): number | null => pointsBetween(knownWrongRate(latest), previous && knownWrongRate(previous));

export const pagesMissedDelta = (
  latest: LaneBenchmarkRun,
  previous: LaneBenchmarkRun | null,
): number | null => (previous ? latest.pagesMissed - previous.pagesMissed : null);

export const formatCountDelta = (delta: number | null): string =>
  delta === null ? '' : `${delta > 0 ? '+' : ''}${delta}`;

export const formatPointDelta = (points: number | null): string =>
  points === null ? '' : `${points > 0 ? '+' : ''}${points.toFixed(1)} pts`;
