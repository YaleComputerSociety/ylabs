import { execFile } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { assertPublicHttpUrl, SsrfBlockedError, ssrfSafeAgents } from './../utils/ssrfGuard';
import { sanitizeLogValue } from '../utils/logSanitizer';
import type {
  ScraperFetchAttemptMetrics,
  ScraperFetchMetric,
  ScraperFetchMetrics,
  ScraperFetchMode,
  ScraperMetrics,
} from './types';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_RENDERED_FETCH_TIMEOUT_MS = 1_000;
const MAX_RENDERED_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_BRIDGE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'scraplingBridge.py',
);
const SCRAPER_DIR = dirname(fileURLToPath(import.meta.url));
const PYTHON_COMMAND_RE = /^python(?:3(?:\.\d{1,2})?)?$/;
const RENDERED_FETCH_MODES = new Set(['dynamic', 'stealthy']);
const MAX_RENDERED_FETCH_SELECTOR_LENGTH = 256;
const MAX_RENDERED_SEED_REDIRECT_CHECK_MS = 5_000;

const normalizeRenderedPythonCommand = (value: string): string => {
  const command = value.trim();
  if (!command) return 'python3';
  if (command.includes('/') || command.includes('\\') || !PYTHON_COMMAND_RE.test(command)) {
    throw new Error('Invalid rendered fetch Python command');
  }
  return basename(command);
};

const normalizeRenderedFetchBridgePath = (value: string): string => {
  const rawPath = value.trim();
  const bridgePath = rawPath ? (isAbsolute(rawPath) ? resolve(rawPath) : resolve(SCRAPER_DIR, rawPath)) : DEFAULT_BRIDGE_PATH;
  const scraperRoot = resolve(SCRAPER_DIR);
  if (bridgePath !== DEFAULT_BRIDGE_PATH && !bridgePath.startsWith(`${scraperRoot}/`)) {
    throw new Error('Invalid rendered fetch bridge path');
  }
  if (basename(bridgePath) !== 'scraplingBridge.py') {
    throw new Error('Invalid rendered fetch bridge script');
  }
  return bridgePath;
};

const normalizeRenderedFetchMode = (value: unknown): 'dynamic' | 'stealthy' => {
  return typeof value === 'string' && RENDERED_FETCH_MODES.has(value)
    ? (value as 'dynamic' | 'stealthy')
    : 'dynamic';
};

const normalizeRenderedFetchSelector = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const selector = value.trim();
  return selector.length > 0 && selector.length <= MAX_RENDERED_FETCH_SELECTOR_LENGTH ? selector : undefined;
};

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
  seedRedirectCheck?: (url: URL, timeoutMs: number) => Promise<boolean>;
}

const isHttpRedirectStatus = (statusCode: number | undefined): boolean =>
  typeof statusCode === 'number' && statusCode >= 300 && statusCode < 400;

const defaultRenderedSeedRedirectCheck = (
  url: URL,
  timeoutMs: number,
): Promise<boolean> =>
  new Promise((resolvePromise, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const agents = ssrfSafeAgents();
    const req = client.request(
      url,
      {
        method: 'GET',
        agent: url.protocol === 'https:' ? agents.httpsAgent : agents.httpAgent,
        timeout: Math.min(timeoutMs, MAX_RENDERED_SEED_REDIRECT_CHECK_MS),
        headers: {
          Range: 'bytes=0-0',
          'User-Agent': 'YaleResearchRenderedFetchPreflight/1.0',
        },
      },
      (response) => {
        response.destroy();
        resolvePromise(isHttpRedirectStatus(response.statusCode));
      },
    );

    req.on('timeout', () => {
      req.destroy(Object.assign(new Error('Timeout'), { name: 'AbortError' }));
    });
    req.on('error', reject);
    req.end();
  });

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

function boundedRenderedFetchTimeout(value: unknown, fallback: number): number {
  const parsed = Number(value);
  const fallbackParsed = Number(fallback);
  const safeFallback = Number.isFinite(fallbackParsed) && fallbackParsed > 0
    ? fallbackParsed
    : DEFAULT_TIMEOUT_MS;
  const candidate = Number.isFinite(parsed) && parsed > 0 ? parsed : safeFallback;
  return Math.min(
    Math.max(Math.floor(candidate), MIN_RENDERED_FETCH_TIMEOUT_MS),
    MAX_RENDERED_FETCH_TIMEOUT_MS,
  );
}

export function createScraplingRenderedFetcher(
  options: ScraplingRenderedFetcherOptions = {},
): RenderedFetcher | null {
  const enabled = options.enabled ?? process.env.SCRAPLING_RENDERER_ENABLED === 'true';
  if (!enabled) return null;

  const pythonCommand = normalizeRenderedPythonCommand(
    options.pythonCommand || process.env.SCRAPLING_PYTHON_COMMAND || 'python3',
  );
  const bridgePath = normalizeRenderedFetchBridgePath(
    options.bridgePath || process.env.SCRAPLING_BRIDGE_PATH || DEFAULT_BRIDGE_PATH,
  );
  const defaultMode =
    options.mode || normalizeRenderedFetchMode(process.env.SCRAPLING_FETCH_MODE);
  const defaultTimeoutMs =
    boundedRenderedFetchTimeout(
      options.timeoutMs || numberFromEnv(process.env.SCRAPLING_TIMEOUT_MS),
      DEFAULT_TIMEOUT_MS,
    );
  const seedRedirectCheck = options.seedRedirectCheck || defaultRenderedSeedRedirectCheck;

  return async (request) => {
    // SSRF guard: request.url originates from DB-stored / scraped values. Block private/metadata
    // hosts before handing the URL to the headless Python fetcher. Also fail closed if the seed
    // URL immediately redirects, because the Python renderer cannot use Node's connect-time
    // SSRF-safe lookup on redirect hops. The rendered result must still stay public and same-origin
    // so redirected internal/cross-origin content cannot be materialized.
    const seedUrl = await assertPublicHttpUrl(request.url);
    const safeRequestUrl = seedUrl.toString();
    const timeoutMs = boundedRenderedFetchTimeout(request.timeoutMs, defaultTimeoutMs);
    try {
      if (await seedRedirectCheck(seedUrl, timeoutMs)) {
        return {
          url: seedUrl.toString(),
          html: '',
          blocked: true,
          blockedReason: 'redirected-before-render',
          fetchMode: 'scrapling',
        };
      }
    } catch {
      return {
        url: seedUrl.toString(),
        html: '',
        blocked: true,
        blockedReason: 'rendered-seed-preflight-failed',
        fetchMode: 'scrapling',
      };
    }

    const args = [
      bridgePath,
      '--url',
      safeRequestUrl,
      '--mode',
      normalizeRenderedFetchMode(request.mode || defaultMode),
      '--timeout-ms',
      String(timeoutMs),
    ];
    const waitSelector = normalizeRenderedFetchSelector(request.waitSelector);
    if (waitSelector) args.push('--wait-selector', waitSelector);

    try {
      const { stdout } = await execFileAsync(pythonCommand, args, {
        timeout: timeoutMs + 5_000,
        maxBuffer: 10 * 1024 * 1024,
        shell: false,
      });
      const parsed = JSON.parse(stdout) as {
        url?: string;
        html?: string;
        statusCode?: number;
        blocked?: boolean;
        blockedReason?: string;
      };
      const renderedUrl = parsed.url || safeRequestUrl;
      let finalUrl: URL;
      try {
        finalUrl = await assertPublicHttpUrl(renderedUrl);
      } catch (error) {
        if (error instanceof SsrfBlockedError) {
          return {
            url: seedUrl.toString(),
            html: '',
            statusCode: parsed.statusCode,
            blocked: true,
            blockedReason: 'rendered-final-url-blocked',
            fetchMode: 'scrapling',
          };
        }
        throw error;
      }
      if (finalUrl.origin !== seedUrl.origin) {
        return {
          url: seedUrl.toString(),
          html: '',
          statusCode: parsed.statusCode,
          blocked: true,
          blockedReason: 'redirected-cross-origin',
          fetchMode: 'scrapling',
        };
      }
      return {
        url: finalUrl.toString(),
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
        blockedReason: sanitizeLogValue(err),
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
