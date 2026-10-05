import { AsyncLocalStorage } from 'node:async_hooks';
import type { ScraperFetchMetrics, ScraperResult } from '../types';

export interface ThrottleRetryStats {
  refused: number;
  recovered: number;
  exhausted: number;
  retries: number;
}

export type ThrottleRetryOutcome = 'recovered' | 'exhausted';

export const emptyThrottleRetryStats = (): ThrottleRetryStats => ({
  refused: 0,
  recovered: 0,
  exhausted: 0,
  retries: 0,
});

const scopeStorage = new AsyncLocalStorage<ThrottleRetryStats>();

export async function withThrottleRetryScope<T>(
  run: () => Promise<T>,
): Promise<{ value: T; stats: ThrottleRetryStats }> {
  const stats = emptyThrottleRetryStats();
  const value = await scopeStorage.run(stats, run);
  return { value, stats };
}

export function recordThrottleRetryOutcome(outcome: ThrottleRetryOutcome, retries: number): void {
  const stats = scopeStorage.getStore();
  if (!stats) return;
  stats.refused += 1;
  stats[outcome] += 1;
  stats.retries += retries;
}

export function withThrottleRetryFetchMetrics(
  result: ScraperResult,
  stats: ThrottleRetryStats,
): ScraperResult {
  if (stats.refused === 0) return result;
  const fetchMetrics: ScraperFetchMetrics = result.fetchMetrics ?? {
    attempts: [],
    summary: {
      total: 0,
      succeeded: 0,
      failed: 0,
      blocked: 0,
      selectorBreakages: 0,
      averageLatencyMs: 0,
      byMode: {},
    },
  };
  return { ...result, fetchMetrics: { ...fetchMetrics, throttleRetry: stats } };
}
