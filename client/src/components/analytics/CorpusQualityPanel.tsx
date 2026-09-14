import BarChart from './charts/BarChart';
import { formatDateTime, formatNumber } from './analyticsPresentation';
import {
  corpusQualityMetricRows,
  formatMean,
  formatRatio,
  metricTrend,
  trendPointsLabel,
  type CorpusQualityTrend,
} from './corpusQualityMetrics';
import { CorpusQualityMetricRow, CorpusQualityResponse } from './corpusQualityTypes';

const TREND_LABEL: Record<CorpusQualityTrend, string> = {
  better: 'better than the previous measurement',
  worse: 'worse than the previous measurement',
  flat: 'unchanged since the previous measurement',
  unknown: '',
};

const TREND_MARK: Record<CorpusQualityTrend, string> = {
  better: '▲',
  worse: '▼',
  flat: '■',
  unknown: '',
};

const TREND_CLASS: Record<CorpusQualityTrend, string> = {
  better: 'text-emerald-700',
  worse: 'text-rose-700',
  flat: 'text-gray-500',
  unknown: 'text-gray-400',
};

const MetricRow = ({ row }: { row: CorpusQualityMetricRow }) => {
  const trend = metricTrend(row);
  const points = trendPointsLabel(row);

  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--yr-line)] py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">{row.label}</p>
        <p className="text-xs text-gray-500">{row.hint}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold tabular-nums text-gray-900">
          {formatRatio(row.current)}
        </p>
        {trend !== 'unknown' && (
          <p className={`text-xs ${TREND_CLASS[trend]}`}>
            <span aria-hidden="true">{TREND_MARK[trend]} </span>
            <span className="sr-only">{TREND_LABEL[trend]}, </span>
            {points}
          </p>
        )}
      </div>
    </div>
  );
};

export interface CorpusQualityPanelProps {
  corpusQuality: CorpusQualityResponse | null;
  isLoading: boolean;
  error: string | null;
}

const CorpusQualityPanel = ({ corpusQuality, isLoading, error }: CorpusQualityPanelProps) => {
  if (isLoading) {
    return (
      <p className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4 text-sm text-gray-500">
        Loading corpus quality.
      </p>
    );
  }

  if (error || !corpusQuality) {
    return (
      <p className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4 text-sm text-rose-700">
        {error || 'Corpus quality is unavailable.'}
      </p>
    );
  }

  const { coverageNow, latest, history, refreshCommand } = corpusQuality;

  if (!latest) {
    return (
      <p className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4 text-sm text-gray-600">
        No quality measurement has been recorded for this environment yet, so the{' '}
        {formatNumber(coverageNow.studentReady)} student-ready rows above are counted but not
        assessed. Run{' '}
        <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">{refreshCommand}</code> to take
        the first measurement.
      </p>
    );
  }

  const previous = history.length > 1 ? history[history.length - 2] : null;
  const rows = corpusQualityMetricRows(latest, previous);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="overflow-hidden rounded-lg border border-[var(--yr-line)] bg-[var(--yr-panel)] shadow-md">
        <div className="border-b border-[var(--yr-line)] p-4">
          <h3 className="text-lg font-semibold text-gray-800">
            What the student-ready corpus actually serves
          </h3>
          <p className="text-sm text-gray-500">
            Counted over the {formatNumber(latest.coverage.studentReady)} rows served when this was
            measured, {formatDateTime(latest.measuredAt)} on {latest.environment}. Every metric
            keeps its denominator, so a growing corpus cannot read as improving quality. Research
            areas average {formatMean(latest.richness.searchTopicTotal)}.
            {previous
              ? ` Change is against the previous measurement, ${formatDateTime(previous.measuredAt)}.`
              : ' No earlier measurement exists yet, so no change is shown.'}
          </p>
        </div>
        <div className="px-4 pb-2">
          {rows.map((row) => (
            <MetricRow key={row.label} row={row} />
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--yr-line)] bg-[var(--yr-panel)] shadow-md">
        <div className="border-b border-[var(--yr-line)] p-4">
          <h3 className="text-lg font-semibold text-gray-800">Student-Ready by School</h3>
          <p className="text-sm text-gray-500">
            Where the served corpus reaches, measured {formatDateTime(latest.measuredAt)}
          </p>
        </div>
        <div className="p-4">
          <BarChart
            ariaLabel="Student-ready research entities by school"
            emptyMessage="No school breakdown recorded."
            showShareOfTotal
            valueFormatter={(value) => formatNumber(value)}
            data={latest.coverage.studentReadyBySchool.slice(0, 12).map((row) => ({
              label: row.school,
              value: row.count,
            }))}
          />
        </div>
      </div>
    </div>
  );
};

export default CorpusQualityPanel;
