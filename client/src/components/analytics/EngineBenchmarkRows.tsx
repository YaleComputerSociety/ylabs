import { formatDateTime, formatNumber } from './analyticsPresentation';
import {
  ENGINE_BENCHMARK_CHANGE_LABEL,
  formatCountDelta,
  formatCounts,
} from './laneBenchmarkMetrics';
import type {
  EngineBenchmarkChange,
  EngineBenchmarkResponse,
  EngineBenchmarkTrend,
} from './laneBenchmarkTypes';

const CHANGE_CLASS: Record<EngineBenchmarkChange, string> = {
  'first-run': 'text-muted',
  unchanged: 'text-muted',
  'code-changed': 'text-ink',
  'input-leak': 'text-rose-700',
  'input-incomplete': 'text-amber-700',
  unattributed: 'text-amber-700',
};

const deltaClass = (delta: number, higherIsBetter: boolean): string =>
  delta === 0 ? 'text-muted' : delta > 0 === higherIsBetter ? 'text-emerald-700' : 'text-rose-700';

const CountDelta = ({
  now,
  before,
  higherIsBetter,
}: {
  now: number;
  before: number | undefined;
  higherIsBetter: boolean;
}) => {
  if (before === undefined) return null;
  const delta = now - before;
  return (
    <span className={`ml-1 ${deltaClass(delta, higherIsBetter)}`}>{formatCountDelta(delta)}</span>
  );
};

const EngineBenchmarkRow = ({ trend }: { trend: EngineBenchmarkTrend }) => {
  const { latest, previous } = trend;
  return (
    <div className="border-b border-[var(--yr-line)] py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{trend.benchmarkId}</p>
          <p className="text-xs text-muted">
            {trend.stage} · {formatNumber(trend.runs)} stored replays · last{' '}
            {formatDateTime(latest.measuredAt)}
            {latest.codeSha ? ` at ${latest.codeSha.slice(0, 9)}` : ''}
          </p>
        </div>
        <p className={`text-xs ${CHANGE_CLASS[trend.change]}`}>
          {ENGINE_BENCHMARK_CHANGE_LABEL[trend.change]}
        </p>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-muted">Resolved</dt>
          <dd className="tabular-nums text-ink">
            {formatNumber(latest.resolved)} values
            <CountDelta now={latest.resolved} before={previous?.resolved} higherIsBetter />
          </dd>
        </div>
        <div>
          <dt className="text-muted">Known wrong</dt>
          <dd className="tabular-nums text-ink">
            {formatNumber(latest.knownWrong)}
            <CountDelta
              now={latest.knownWrong}
              before={previous?.knownWrong}
              higherIsBetter={false}
            />
          </dd>
        </div>
        <div>
          <dt className="text-muted">Labels matched</dt>
          <dd className="tabular-nums text-ink">
            {formatCounts(latest.labelsMatched, latest.labelCount)}
            <CountDelta
              now={latest.labelsMatched}
              before={previous?.labelsMatched}
              higherIsBetter
            />
          </dd>
        </div>
        <div>
          <dt className="text-muted">Input coverage</dt>
          <dd className="tabular-nums text-ink">
            {formatNumber(latest.rowsReplayed)} rows, {formatNumber(latest.rowsWithIncompleteInput)}{' '}
            incomplete
          </dd>
        </div>
      </dl>
    </div>
  );
};

const EngineBenchmarkRows = ({ engine }: { engine: EngineBenchmarkResponse }) => (
  <div className="border-t border-[var(--yr-line)] p-4">
    <h4 className="text-base font-semibold text-ink">Is the engine getting better?</h4>
    <p className="text-sm text-muted">
      The resolver and visibility gate replayed on frozen rows. A change is read as a code change
      only when both replays read fully frozen input.
    </p>
    <p className="mt-1 text-xs text-muted">
      Refreshed each Development sweep, or by{' '}
      <code className="rounded bg-panel-muted px-1 py-0.5">{engine.refreshCommand}</code>.
    </p>
    {engine.oneOffBenchmarkCount ? (
      <p className="mt-1 text-xs text-muted">
        Showing the benchmark each sweep replays. {formatNumber(engine.oneOffBenchmarkCount)}{' '}
        one-off probe {engine.oneOffBenchmarkCount === 1 ? 'benchmark is' : 'benchmarks are'} not
        shown.
      </p>
    ) : null}
    {engine.benchmarks.length === 0 ? (
      <p className="py-3 text-sm text-muted">No engine benchmark has been replayed yet.</p>
    ) : (
      engine.benchmarks.map((trend) => (
        <EngineBenchmarkRow key={`${trend.benchmarkId}:${trend.stage}`} trend={trend} />
      ))
    )}
  </div>
);

export default EngineBenchmarkRows;
