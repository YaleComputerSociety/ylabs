import { describe, expect, it } from 'vitest';
import {
  formatModelUsageReport,
  parseModelUsageReportArgs,
  summarizeModelUsage,
} from '../modelUsageReportCore';

const since = new Date('2026-11-01T00:00:00.000Z');

describe('summarizeModelUsage', () => {
  it('prices each caller at list prices, bills cached input at the cached rate, and ranks by cost', () => {
    const report = summarizeModelUsage(
      [
        {
          _id: { caller: 'card-synthesis', model: 'gpt-5-mini' },
          calls: 10,
          failedCalls: 1,
          promptTokens: 1_000_000,
          cachedPromptTokens: 0,
          completionTokens: 0,
        },
        {
          _id: { caller: 'coverage-synthesis-llm', model: 'gpt-5-mini' },
          calls: 4,
          failedCalls: 0,
          promptTokens: 2_000_000,
          cachedPromptTokens: 1_000_000,
          completionTokens: 1_000_000,
        },
      ],
      since,
    );

    expect(report.rows.map((row) => [row.caller, row.estimatedCostUsd])).toEqual([
      ['coverage-synthesis-llm', 0.25 + 0.025 + 2],
      ['card-synthesis', 0.25],
    ]);
    expect(report.totalCalls).toBe(14);
    expect(report.totalEstimatedCostUsd).toBeCloseTo(2.525);
    expect(report.unpricedModels).toEqual([]);
  });

  it('reports a model with no list price as unpriced rather than free', () => {
    const report = summarizeModelUsage(
      [
        {
          _id: { caller: 'card-synthesis', model: 'gpt-next' },
          calls: 1,
          failedCalls: 0,
          promptTokens: 10,
          cachedPromptTokens: 0,
          completionTokens: 10,
        },
      ],
      since,
    );

    expect(report.rows[0].estimatedCostUsd).toBeNull();
    expect(report.unpricedModels).toEqual(['gpt-next']);
    expect(formatModelUsageReport(report).join('\n')).toContain('unpriced models: gpt-next');
  });
});

describe('parseModelUsageReportArgs', () => {
  it('defaults to Development over the last 30 days', () => {
    expect(parseModelUsageReportArgs([])).toEqual({ environment: 'development', sinceDays: 30 });
  });

  it('reads both option spellings and refuses a non-positive window', () => {
    expect(parseModelUsageReportArgs(['--environment', 'beta', '--since-days=7'])).toEqual({
      environment: 'beta',
      sinceDays: 7,
    });
    expect(() => parseModelUsageReportArgs(['--since-days', '0'])).toThrow('--since-days');
  });
});
