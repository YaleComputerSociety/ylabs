import { formatDateTime, formatNumber } from './analyticsPresentation';
import EngineBenchmarkRows from './EngineBenchmarkRows';
import {
  LANE_BENCHMARK_CHANGE_LABEL,
  formatCountDelta,
  formatCounts,
  formatPointDelta,
  formatRate,
  goldRateDelta,
  knownWrongRateDelta,
  pagesMissedDelta,
} from './laneBenchmarkMetrics';
import type {
  LaneBenchmarkChange,
  LaneBenchmarkResponse,
  LaneBenchmarkTrend,
} from './laneBenchmarkTypes';

const CHANGE_CLASS: Record<LaneBenchmarkChange, string> = {
  'first-run': 'text-muted',
  unchanged: 'text-muted',
  'code-changed': 'text-ink',
  'input-leak': 'text-rose-700',
  unattributed: 'text-amber-700',
};

const deltaClass = (delta: number, higherIsBetter: boolean): string =>
  delta === 0 ? 'text-muted' : delta > 0 === higherIsBetter ? 'text-emerald-700' : 'text-rose-700';

const Delta = ({
  delta,
  label,
  higherIsBetter,
}: {
  delta: number | null;
  label: string;
  higherIsBetter: boolean;
}) =>
  delta === null ? null : (
    <span className={`ml-1 ${deltaClass(delta, higherIsBetter)}`}>{label}</span>
  );

const BenchmarkRow = ({ trend }: { trend: LaneBenchmarkTrend }) => {
  const { latest, previous } = trend;
  const knownWrongDelta = knownWrongRateDelta(latest, previous);
  const missedDelta = pagesMissedDelta(latest, previous);
  return (
    <div className="border-b border-[var(--yr-line)] py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{trend.benchmarkId}</p>
          <p className="text-xs text-muted">
            {trend.sourceName} · {formatNumber(trend.runs)} stored replays · last{' '}
            {formatDateTime(latest.measuredAt)}
            {latest.codeSha ? ` at ${latest.codeSha.slice(0, 9)}` : ''}
          </p>
        </div>
        <p className={`text-xs ${CHANGE_CLASS[trend.change]}`}>
          {LANE_BENCHMARK_CHANGE_LABEL[trend.change]}
        </p>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-muted">Known wrong</dt>
          <dd className="tabular-nums text-ink">
            {formatCounts(latest.knownWrong, latest.labeledEntityEmitted)} labeled
            <Delta
              delta={knownWrongDelta}
              label={formatPointDelta(knownWrongDelta)}
              higherIsBetter={false}
            />
          </dd>
        </div>
        <div>
          <dt className="text-muted">Input coverage</dt>
          <dd className="tabular-nums text-ink">
            {formatNumber(latest.pagesServed)} served, {formatNumber(latest.pagesMissed)} missed
            <Delta
              delta={missedDelta}
              label={`${formatCountDelta(missedDelta)} missed`}
              higherIsBetter={false}
            />
          </dd>
        </div>
        {latest.gold.map((gold) => {
          const precisionDelta = goldRateDelta(
            gold.field,
            'precision',
            latest.gold,
            previous?.gold,
          );
          const recallDelta = goldRateDelta(gold.field, 'recall', latest.gold, previous?.gold);
          return (
            <div key={gold.field} className="col-span-2">
              <dt className="text-muted">
                {gold.field}, {formatNumber(gold.labeled)} hand-labeled
              </dt>
              <dd className="tabular-nums text-ink">
                precision {formatRate(gold.precision)} (
                {formatCounts(gold.truePositive, gold.truePositive + gold.falsePositive)})
                <Delta
                  delta={precisionDelta}
                  label={formatPointDelta(precisionDelta)}
                  higherIsBetter
                />
                {' · '}recall {formatRate(gold.recall)} (
                {formatCounts(gold.truePositive, gold.truePositive + gold.falseNegative)})
                <Delta delta={recallDelta} label={formatPointDelta(recallDelta)} higherIsBetter />
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
};

export interface LaneBenchmarkPanelProps {
  laneBenchmarks: LaneBenchmarkResponse | null;
  isLoading: boolean;
  error: string | null;
}

const LaneBenchmarkPanel = ({ laneBenchmarks, isLoading, error }: LaneBenchmarkPanelProps) => {
  if (isLoading) {
    return (
      <p className="rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4 text-sm text-muted">
        Loading lane benchmarks.
      </p>
    );
  }

  if (error || !laneBenchmarks) {
    return (
      <p className="rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4 text-sm text-rose-700">
        {error || 'Lane benchmarks are unavailable.'}
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel)] shadow-yr-raised">
      <div className="border-b border-[var(--yr-line)] p-4">
        <h3 className="text-lg font-semibold text-ink">Is each lane getting better?</h3>
        <p className="text-sm text-muted">
          Each lane replayed on a frozen benchmark, so a change here comes from code, not from the
          corpus moving. Known wrong counts only what a refusal names; precision and recall come
          from hand-judged labels. Changes compare against the previous stored replay.
        </p>
        <p className="mt-1 text-xs text-muted">
          Refreshed each Development sweep, or by{' '}
          <code className="rounded bg-panel-muted px-1 py-0.5">
            {laneBenchmarks.refreshCommand}
          </code>
          .
        </p>
      </div>
      <div className="px-4 pb-2">
        {laneBenchmarks.benchmarks.length === 0 ? (
          <p className="py-3 text-sm text-muted">No benchmark has been replayed yet.</p>
        ) : (
          laneBenchmarks.benchmarks.map((trend) => (
            <BenchmarkRow key={trend.benchmarkId} trend={trend} />
          ))
        )}
      </div>
      {laneBenchmarks.engine ? <EngineBenchmarkRows engine={laneBenchmarks.engine} /> : null}
    </div>
  );
};

export default LaneBenchmarkPanel;
