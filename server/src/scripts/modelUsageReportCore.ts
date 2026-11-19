import { ModelCallUsage } from '../models/modelCallUsage';
import { estimatedCostUsd } from '../utils/modelPricing';

export interface ModelUsageReportArgs {
  environment: string;
  sinceDays: number;
}

export interface ModelUsageReportRow {
  caller: string;
  model: string;
  calls: number;
  failedCalls: number;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number | null;
}

export interface ModelUsageReport {
  since: Date;
  rows: ModelUsageReportRow[];
  totalCalls: number;
  totalEstimatedCostUsd: number;
  unpricedModels: string[];
}

export interface ModelUsageGroup {
  _id: { caller: string; model: string };
  calls: number;
  failedCalls: number;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
}

const DEFAULT_SINCE_DAYS = 30;

const optionValue = (argv: string[], index: number, name: string): string | undefined => {
  const token = argv[index];
  if (token === name) return argv[index + 1] ?? '';
  if (token.startsWith(`${name}=`)) return token.slice(name.length + 1);
  return undefined;
};

export function parseModelUsageReportArgs(argv: string[]): ModelUsageReportArgs {
  const args: ModelUsageReportArgs = { environment: 'development', sinceDays: DEFAULT_SINCE_DAYS };
  for (let index = 0; index < argv.length; index += 1) {
    const environment = optionValue(argv, index, '--environment');
    if (environment !== undefined) args.environment = environment;
    const sinceDays = optionValue(argv, index, '--since-days');
    if (sinceDays !== undefined) args.sinceDays = Number(sinceDays);
  }
  if (!Number.isFinite(args.sinceDays) || args.sinceDays <= 0) {
    throw new Error('--since-days must be a positive number');
  }
  return args;
}

export function summarizeModelUsage(groups: ModelUsageGroup[], since: Date): ModelUsageReport {
  const rows = groups.map((group): ModelUsageReportRow => ({
    caller: group._id.caller,
    model: group._id.model,
    calls: group.calls,
    failedCalls: group.failedCalls,
    promptTokens: group.promptTokens,
    cachedPromptTokens: group.cachedPromptTokens,
    completionTokens: group.completionTokens,
    estimatedCostUsd: estimatedCostUsd(group._id.model, group),
  }));
  rows.sort(
    (left, right) =>
      (right.estimatedCostUsd ?? 0) - (left.estimatedCostUsd ?? 0) ||
      right.calls - left.calls ||
      left.caller.localeCompare(right.caller),
  );
  return {
    since,
    rows,
    totalCalls: rows.reduce((sum, row) => sum + row.calls, 0),
    totalEstimatedCostUsd: rows.reduce((sum, row) => sum + (row.estimatedCostUsd ?? 0), 0),
    unpricedModels: [
      ...new Set(rows.filter((row) => row.estimatedCostUsd === null).map((row) => row.model)),
    ].sort(),
  };
}

export async function readModelUsageReport(since: Date): Promise<ModelUsageReport> {
  const groups = await ModelCallUsage.aggregate<ModelUsageGroup>([
    { $match: { calledAt: { $gte: since } } },
    {
      $group: {
        _id: { caller: '$caller', model: '$model' },
        calls: { $sum: 1 },
        failedCalls: { $sum: { $cond: ['$succeeded', 0, 1] } },
        promptTokens: { $sum: '$promptTokens' },
        cachedPromptTokens: { $sum: '$cachedPromptTokens' },
        completionTokens: { $sum: '$completionTokens' },
      },
    },
  ]);
  return summarizeModelUsage(groups, since);
}

const formatUsd = (value: number | null): string =>
  value === null ? 'unpriced' : `$${value.toFixed(value < 1 ? 4 : 2)}`;

export function formatModelUsageReport(report: ModelUsageReport): string[] {
  const lines = [`Model calls since ${report.since.toISOString().slice(0, 10)}`];
  for (const row of report.rows) {
    lines.push(
      [
        `  ${row.caller.padEnd(34)}`,
        row.model.padEnd(24),
        `calls ${String(row.calls).padStart(6)}`,
        `failed ${String(row.failedCalls).padStart(4)}`,
        `in ${row.promptTokens} (cached ${row.cachedPromptTokens})`,
        `out ${row.completionTokens}`,
        formatUsd(row.estimatedCostUsd),
      ].join(' '),
    );
  }
  lines.push(
    `  total calls ${report.totalCalls}, estimated ${formatUsd(report.totalEstimatedCostUsd)} at list prices`,
  );
  if (report.unpricedModels.length > 0) {
    lines.push(`  unpriced models: ${report.unpricedModels.join(', ')}`);
  }
  return lines;
}
