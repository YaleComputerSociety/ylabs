export interface BarChartDatum {
  label: string;
  value: number;
  note?: string;
}

interface BarChartProps {
  data: BarChartDatum[];
  ariaLabel: string;
  valueFormatter?: (value: number) => string;
  emptyMessage?: string;
}

const CHART_STYLES = `
.yr-chart {
  --chart-fill: #2a78d6;
  --chart-track: #e1e0d9;
  --chart-value-ink: var(--yr-ink, #0b0b0b);
  --chart-label-ink: var(--yr-muted, #52514e);
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  margin: 0;
}
[data-theme='dark'] .yr-chart {
  --chart-fill: #3987e5;
  --chart-track: #2c2c2a;
}
.yr-chart-row {
  display: grid;
  grid-template-columns: minmax(6rem, 9rem) 1fr auto;
  align-items: center;
  gap: 0.75rem;
}
.yr-chart-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8125rem;
  color: var(--chart-label-ink);
}
.yr-chart-track {
  position: relative;
  height: 0.75rem;
  border-radius: 9999px;
  background: var(--chart-track);
  overflow: hidden;
}
.yr-chart-bar {
  display: block;
  height: 100%;
  border-radius: 9999px;
  background: var(--chart-fill);
  transition: width 200ms ease-out;
}
.yr-chart-value {
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--chart-value-ink);
  white-space: nowrap;
}
.yr-chart-value-note {
  margin-left: 0.35rem;
  font-weight: 400;
  color: var(--chart-label-ink);
}
`;

const defaultFormatter = (value: number): string => value.toLocaleString();

const BarChart = ({ data, ariaLabel, valueFormatter, emptyMessage }: BarChartProps) => {
  const format = valueFormatter ?? defaultFormatter;

  if (data.length === 0) {
    return <p className="text-sm text-gray-500">{emptyMessage ?? 'No data to chart.'}</p>;
  }

  const maxValue = data.reduce((max, datum) => Math.max(max, datum.value), 0);

  return (
    <figure className="yr-chart" role="group" aria-label={ariaLabel}>
      <style href="yr-chart-styles" precedence="medium">
        {CHART_STYLES}
      </style>
      {data.map((datum) => {
        const ratio = maxValue > 0 ? datum.value / maxValue : 0;
        const width = datum.value > 0 ? Math.max(ratio * 100, 2) : 0;
        const valueText = datum.note
          ? `${format(datum.value)} (${datum.note})`
          : format(datum.value);
        return (
          <div className="yr-chart-row" key={datum.label}>
            <span className="yr-chart-label" title={datum.label}>
              {datum.label}
            </span>
            <span className="yr-chart-track" title={`${datum.label}: ${valueText}`}>
              <span className="yr-chart-bar" style={{ width: `${width}%` }} />
            </span>
            <span className="yr-chart-value">
              {format(datum.value)}
              {datum.note ? <span className="yr-chart-value-note">{datum.note}</span> : null}
            </span>
          </div>
        );
      })}
    </figure>
  );
};

export default BarChart;
