import { AsyncLocalStorage } from 'node:async_hooks';
import type { ScraperFetchMetrics, ScraperResult } from '../types';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { isTransientMongoError, type TransientMongoErrorOptions } from './transientMongoError';

export const DATABASE_WRITE_RETRY_BACKOFF_MS: readonly number[] = [1_000, 5_000, 15_000, 30_000];

export interface DatabaseWriteRetryStats {
  refused: number;
  recovered: number;
  exhausted: number;
  retries: number;
}

export const emptyDatabaseWriteRetryStats = (): DatabaseWriteRetryStats => ({
  refused: 0,
  recovered: 0,
  exhausted: 0,
  retries: 0,
});

const scopeStorage = new AsyncLocalStorage<DatabaseWriteRetryStats>();

export async function withDatabaseWriteRetryScope<T>(
  run: () => Promise<T>,
): Promise<{ value: T; stats: DatabaseWriteRetryStats }> {
  const stats = emptyDatabaseWriteRetryStats();
  const value = await scopeStorage.run(stats, run);
  return { value, stats };
}

function recordDatabaseWriteRetryOutcome(
  outcome: 'recovered' | 'exhausted',
  retries: number,
): void {
  const stats = scopeStorage.getStore();
  if (!stats) return;
  stats.refused += 1;
  stats[outcome] += 1;
  stats.retries += retries;
}

export function withDatabaseWriteRetryFetchMetrics(
  result: ScraperResult,
  stats: DatabaseWriteRetryStats,
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
  return { ...result, fetchMetrics: { ...fetchMetrics, databaseWriteRetry: stats } };
}

export interface DatabaseWriteRetryOptions extends TransientMongoErrorOptions {
  label: string;
  backoffMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface DatabaseWriteAttempt {
  attempt: number;
  isTransient: (error: unknown) => boolean;
}

/**
 * Runs `operation` until it settles, retrying a transient MongoDB failure with bounded
 * backoff. The operation must be safe to repeat: it is told its attempt number so it can
 * skip the part of the work an earlier attempt already landed.
 */
export async function retryTransientDatabaseWrite<T>(
  operation: (attempt: DatabaseWriteAttempt) => Promise<T>,
  options: DatabaseWriteRetryOptions,
): Promise<T> {
  const backoffMs = options.backoffMs ?? DATABASE_WRITE_RETRY_BACKOFF_MS;
  const sleep = options.sleep ?? defaultSleep;
  const isTransient = (error: unknown) => isTransientMongoError(error, options);
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const value = await operation({ attempt, isTransient });
      if (attempt > 1) {
        recordDatabaseWriteRetryOutcome('recovered', attempt - 1);
        console.warn(
          `[db-write-retry] ${options.label} recovered after ${attempt - 1} retr${attempt === 2 ? 'y' : 'ies'}`,
        );
      }
      return value;
    } catch (error) {
      if (!isTransient(error)) {
        if (attempt > 1) recordDatabaseWriteRetryOutcome('exhausted', attempt - 1);
        throw error;
      }
      const delay = backoffMs[attempt - 1];
      if (delay === undefined) {
        recordDatabaseWriteRetryOutcome('exhausted', attempt - 1);
        console.error(
          `[db-write-retry] ${options.label} still failing after ${attempt} attempt(s); giving up:`,
          sanitizeLogValue(error instanceof Error ? error.message : error),
        );
        throw error;
      }
      console.warn(
        `[db-write-retry] ${options.label} hit a transient database error on attempt ${attempt}; retrying in ${delay}ms:`,
        sanitizeLogValue(error instanceof Error ? error.message : error),
      );
      await sleep(delay);
    }
  }
}
