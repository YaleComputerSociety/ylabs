/**
 * Shared, SSRF-guarded page fetch with per-host politeness and retry.
 *
 * Microsite scrapes parallelize per-entity work with a host-blind pool, so many
 * lanes hit the same origin at once and rate-based WAFs (notably medicine.yale.edu)
 * answer with 403. This wraps the axios recipe with a per-host limiter (bounded
 * concurrency + minimum inter-request interval) and exponential backoff that
 * retries 403/429/5xx, honoring Retry-After. Callers keep their own contract:
 * throw after retries are exhausted, or catch and map to null.
 */
import axios from 'axios';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';

export interface FetchedHttpPage {
  url: string;
  html: string;
  status: number;
}

export interface HttpRequestResult {
  status: number;
  data: string;
  finalUrl: string;
  retryAfterMs?: number;
}

export type HttpRequestFn = (
  url: string,
  config: { timeoutMs: number; headers: Record<string, string>; maxRedirects: number },
) => Promise<HttpRequestResult>;

export interface HostRateLimiterOptions {
  maxConcurrency?: number;
  minIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface HostState {
  active: number;
  lastStartAt: number;
  waiters: Array<() => void>;
}

const realSleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

export class HostRateLimiter {
  private readonly maxConcurrency: number;
  private readonly minIntervalMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly hosts = new Map<string, HostState>();

  constructor(options: HostRateLimiterOptions = {}) {
    this.maxConcurrency = Math.max(1, options.maxConcurrency ?? 2);
    this.minIntervalMs = Math.max(0, options.minIntervalMs ?? 400);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? realSleep;
  }

  async run<T>(host: string, fn: () => Promise<T>): Promise<T> {
    await this.acquire(host);
    try {
      return await fn();
    } finally {
      this.release(host);
    }
  }

  private stateFor(host: string): HostState {
    let state = this.hosts.get(host);
    if (!state) {
      state = { active: 0, lastStartAt: Number.NEGATIVE_INFINITY, waiters: [] };
      this.hosts.set(host, state);
    }
    return state;
  }

  private async acquire(host: string): Promise<void> {
    const state = this.stateFor(host);
    while (state.active >= this.maxConcurrency) {
      await new Promise<void>((resolve) => state.waiters.push(resolve));
    }
    state.active += 1;
    const waitMs = state.lastStartAt + this.minIntervalMs - this.now();
    if (waitMs > 0) await this.sleep(waitMs);
    state.lastStartAt = this.now();
  }

  private release(host: string): void {
    const state = this.stateFor(host);
    state.active = Math.max(0, state.active - 1);
    const next = state.waiters.shift();
    if (next) next();
  }
}

export const DEFAULT_RETRYABLE_STATUSES: ReadonlySet<number> = new Set([
  403, 408, 425, 429, 500, 502, 503, 504,
]);

const sharedHostLimiter = new HostRateLimiter();

export interface FetchPageWithPolicyOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRedirects?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  retryableStatuses?: ReadonlySet<number>;
  limiter?: HostRateLimiter;
  sleep?: (ms: number) => Promise<void>;
  jitter?: () => number;
  request?: HttpRequestFn;
  assertUrl?: (url: string) => Promise<{ toString(): string }>;
}

function parseRetryAfterMs(header: unknown): number | undefined {
  if (typeof header !== 'string' || !header.trim()) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

const defaultAxiosRequest: HttpRequestFn = async (url, config) => {
  const agents = ssrfSafeAgents();
  const res = await axios.get(url, {
    timeout: config.timeoutMs,
    headers: config.headers,
    maxRedirects: config.maxRedirects,
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
    responseType: 'text',
    validateStatus: () => true,
    transitional: { clarifyTimeoutError: true } as never,
  });
  const finalUrl =
    typeof res.request?.res?.responseUrl === 'string' ? res.request.res.responseUrl : url;
  return {
    status: res.status,
    data: typeof res.data === 'string' ? res.data : String(res.data ?? ''),
    finalUrl,
    retryAfterMs: parseRetryAfterMs(res.headers?.['retry-after']),
  };
};

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export async function fetchPageWithPolicy(
  url: string,
  options: FetchPageWithPolicyOptions = {},
): Promise<FetchedHttpPage> {
  const assertUrl = options.assertUrl ?? assertPublicHttpUrl;
  const safeUrl = (await assertUrl(url)).toString();
  const host = hostOf(safeUrl);
  const limiter = options.limiter ?? sharedHostLimiter;
  const request = options.request ?? defaultAxiosRequest;
  const sleep = options.sleep ?? realSleep;
  const jitter = options.jitter ?? Math.random;
  const maxRetries = options.maxRetries ?? 3;
  const retryable = options.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES;
  const base = options.baseBackoffMs ?? 500;
  const maxBackoff = options.maxBackoffMs ?? 8_000;

  const backoffMs = (attempt: number): number =>
    Math.min(maxBackoff, base * 2 ** attempt + Math.floor(jitter() * base));

  const config = {
    timeoutMs: options.timeoutMs ?? 10_000,
    headers: options.headers ?? { 'User-Agent': 'ylabs-scraper/1.0 (+https://yalelabs.io)' },
    maxRedirects: options.maxRedirects ?? 5,
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let result: HttpRequestResult;
    try {
      result = await limiter.run(host, () => request(safeUrl, config));
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries) throw error;
      await sleep(backoffMs(attempt));
      continue;
    }
    if (result.status >= 200 && result.status < 300) {
      return { url: result.finalUrl || safeUrl, html: result.data ?? '', status: result.status };
    }
    if (retryable.has(result.status) && attempt < maxRetries) {
      await sleep(result.retryAfterMs ?? backoffMs(attempt));
      continue;
    }
    throw new Error(`Request failed with status code ${result.status}`);
  }
  throw lastError ?? new Error('fetchPageWithPolicy exhausted retries');
}
