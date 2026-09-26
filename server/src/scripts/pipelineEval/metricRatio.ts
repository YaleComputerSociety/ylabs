export type MetricRatio = number | null;

export const ratioOrNull = (numerator: number, denominator: number): MetricRatio =>
  denominator === 0 ? null : Number((numerator / denominator).toFixed(4));

export function harmonicMean(precision: MetricRatio, recall: MetricRatio): MetricRatio {
  if (precision === null || recall === null) return null;
  if (precision + recall === 0) return 0;
  return Number(((2 * precision * recall) / (precision + recall)).toFixed(4));
}
