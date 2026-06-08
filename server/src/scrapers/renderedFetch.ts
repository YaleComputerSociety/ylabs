import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { assertPublicHttpUrl } from './../utils/ssrfGuard';
import type {
  ScraperFetchAttemptMetrics,
  ScraperFetchMetric,
  ScraperFetchMetrics,
  ScraperFetchMode,
  ScraperMetrics,
} from './types';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_BRIDGE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'scraplingBridge.py',
);

export interface RenderedFetchMetricOverrides {
  blocked?: boolean;
  blockedReason?: string;
  selectorBreakage?: boolean;
}

export interface RenderedFetchRequest {
  url: string;
  waitSelector?: string;
  timeoutMs?: number;
  mode?: string;
}

export interface RenderedFetchResult {
  url: string;
  html: string;
  statusCode?: number;
  blocked?: boolean;
  blockedReason?: string;
  fetchMode?: ScraperFetchMode;
}

export type RenderedFetcher = (
  request: RenderedFetchRequest,
) => Promise<RenderedFetchResult | null>;

export interface ScraplingRenderedFetcherOptions {
  enabled?: boolean;
  pythonCommand?: string;
  bridgePath?: string;
  mode?: 'dynamic' | 'stealthy';
  timeoutMs?: number;
}

export interface MeasuredRenderedFetch<T, TFetchMode extends string = ScraperFetchMode> {
  result: T | null;
  metrics: ScraperFetchAttemptMetrics<TFetchMode>;
  metric: ScraperFetchAttemptMetrics<TFetchMode>;
}

export function measureRenderedFetch<T, TFetchMode extends string = ScraperFetchMode>(
  fetchMode: TFetchMode,
  fetcher: () => Promise<T>,
  classify?: (result: T) => RenderedFetchMetricOverrides,
): Promise<MeasuredRenderedFetch<T, TFetchMode>>;

export function measureRenderedFetch<T, TFetchMode extends string = ScraperFetchMode>(
  target: string,
  fetchMode: TFetchMode,
  fetcher: () => Promise<T>,
  options?: { selectorName?: string },
): Promise<MeasuredRenderedFetch<T, TFetchMode>>;

export async function measureRenderedFetch<T, TFetchMode extends string = ScraperFetchMode>(
  first: TFetchMode | string,
  second: (() => Promise<T>) | TFetchMode,
  third?: (() => Promise<T>) | ((result: T) => RenderedFetchMetricOverrides),
  _fourth?: { selectorName?: string },
): Promise<MeasuredRenderedFetch<T, TFetchMode>> {
  const fetchMode = (typeof second === 'function' ? first : second) as TFetchMode;
  const fetcher = (typeof second === 'function' ? second : third) as () => Promise<T>;
  const classify = (typeof second === 'function' ? third : undefined) as
    | ((result: T) => RenderedFetchMetricOverrides)
    | undefined;
  const startedAt = nowMs();
  const memoryStartBytes = currentMemoryBytes();

  try {
    const result = await fetcher();
    const overrides = classify ? classify(result) : inferRenderedFetchOverrides(result);
    const metrics = buildFetchAttemptMetrics({
      fetchMode,
      success: !overrides.blocked && !overrides.selectorBreakage,
      startedAt,
      memoryStartBytes,
      ...overrides,
    });
    return { result, metrics, metric: metrics };
  } catch {
    const metrics = buildFetchAttemptMetrics({
      fetchMode,
      success: false,
      startedAt,
      memoryStartBytes,
      blocked: false,
      selectorBreakage: false,
    });
    return { result: null, metrics, metric: metrics };
  }
}

export function buildFetchAttemptMetrics<TFetchMode extends string = ScraperFetchMode>(args: {
  fetchMode: TFetchMode;
  success: boolean;
  startedAt: number;
  memoryStartBytes?: number;
  blocked?: boolean;
  blockedReason?: string;
  selectorBreakage?: boolean;
}): ScraperFetchAttemptMetrics<TFetchMode> {
  const memoryEndBytes = currentMemoryBytes();
  const memoryDeltaBytes =
    typeof args.memoryStartBytes === 'number' && typeof memoryEndBytes === 'number'
      ? memoryEndBytes - args.memoryStartBytes
      : undefined;

  return {
    success: args.success,
    latencyMs: Math.max(0, Math.round(nowMs() - args.startedAt)),
    fetchMode: args.fetchMode,
    memoryDeltaBytes,
    blocked: args.blocked ?? false,
    blockedReason: args.blockedReason,
    selectorBreakage: args.selectorBreakage ?? false,
  };
}

export const buildFetchMetric = buildFetchAttemptMetrics;

export function fetchAttemptsToMetrics<TFetchMode extends string = ScraperFetchMode>(
  attempts: ScraperFetchMetric<TFetchMode>[],
): ScraperMetrics<TFetchMode> & ScraperFetchMetrics<TFetchMode> {
  const byMode: ScraperFetchMetrics<TFetchMode>['summary']['byMode'] = {};

  for (const attempt of attempts) {
    const bucket = byMode[attempt.fetchMode] || {
      total: 0,
      succeeded: 0,
      blocked: 0,
      selectorBreakages: 0,
      averageLatencyMs: 0,
    };
    bucket.total++;
    if (attempt.success) bucket.succeeded++;
    if (attempt.blocked) bucket.blocked++;
    if (attempt.selectorBreakage) bucket.selectorBreakages++;
    bucket.averageLatencyMs += attempt.latencyMs;
    byMode[attempt.fetchMode] = bucket;
  }

  for (const bucket of Object.values(byMode) as Array<{
    total: number;
    averageLatencyMs: number;
  }>) {
    if (bucket && bucket.total > 0) {
      bucket.averageLatencyMs = Math.round(bucket.averageLatencyMs / bucket.total);
    }
  }

  const memoryDeltas = attempts
    .map((attempt) => attempt.memoryDeltaBytes)
    .filter((value): value is number => typeof value === 'number');

  return {
    fetchAttempts: attempts,
    attempts,
    summary: {
      total: attempts.length,
      succeeded: attempts.filter((attempt) => attempt.success).length,
      failed: attempts.filter((attempt) => !attempt.success).length,
      blocked: attempts.filter((attempt) => attempt.blocked).length,
      selectorBreakages: attempts.filter((attempt) => attempt.selectorBreakage).length,
      averageLatencyMs: average(attempts.map((attempt) => attempt.latencyMs)),
      averageMemoryDeltaBytes:
        memoryDeltas.length > 0 ? average(memoryDeltas) : undefined,
      byMode,
    },
  };
}

export const summarizeFetchMetrics = fetchAttemptsToMetrics;

export function createScraplingRenderedFetcher(
  options: ScraplingRenderedFetcherOptions = {},
): RenderedFetcher | null {
  const enabled = options.enabled ?? process.env.SCRAPLING_RENDERER_ENABLED === 'true';
  if (!enabled) return null;

  const pythonCommand =
    options.pythonCommand || process.env.SCRAPLING_PYTHON_COMMAND || 'python3';
  const bridgePath =
    options.bridgePath || process.env.SCRAPLING_BRIDGE_PATH || DEFAULT_BRIDGE_PATH;
  const defaultMode =
    options.mode ||
    (process.env.SCRAPLING_FETCH_MODE as 'dynamic' | 'stealthy' | undefined) ||
    'dynamic';
  const defaultTimeoutMs =
    options.timeoutMs ||
    numberFromEnv(process.env.SCRAPLING_TIMEOUT_MS) ||
    DEFAULT_TIMEOUT_MS;

  return async (request) => {
    // SSRF guard: request.url originates from DB-stored / scraped values. Block private/metadata
    // hosts before handing the URL to the headless Python fetcher. (The renderer follows its own
    // redirects, so this validates the seed host — the injection point — not every hop.)
    await assertPublicHttpUrl(request.url);
    const timeoutMs = request.timeoutMs || defaultTimeoutMs;
    const args = [
      bridgePath,
      '--url',
      request.url,
      '--mode',
      request.mode || defaultMode,
      '--timeout-ms',
      String(timeoutMs),
    ];
    if (request.waitSelector) args.push('--wait-selector', request.waitSelector);

    try {
      const { stdout } = await execFileAsync(pythonCommand, args, {
        timeout: timeoutMs + 5_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      const parsed = JSON.parse(stdout) as {
        url?: string;
        html?: string;
        statusCode?: number;
        blocked?: boolean;
        blockedReason?: string;
      };
      return {
        url: parsed.url || request.url,
        html: parsed.html || '',
        statusCode: parsed.statusCode,
        blocked: parsed.blocked,
        blockedReason: parsed.blockedReason,
        fetchMode: 'scrapling',
      };
    } catch (err: any) {
      return {
        url: request.url,
        html: '',
        blocked: false,
        blockedReason: err?.message || String(err),
        fetchMode: 'scrapling',
      };
    }
  };
}

function inferRenderedFetchOverrides(result: unknown): RenderedFetchMetricOverrides {
  if (!result || typeof result !== 'object') return { selectorBreakage: true };
  const page = result as Partial<RenderedFetchResult>;
  return {
    blocked: page.blocked ?? false,
    blockedReason: page.blockedReason,
    selectorBreakage: !page.blocked && typeof page.html === 'string' && page.html.trim() === '',
  };
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function currentMemoryBytes(): number | undefined {
  return typeof process !== 'undefined' && typeof process.memoryUsage === 'function'
    ? process.memoryUsage().rss
    : undefined;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function numberFromEnv(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
