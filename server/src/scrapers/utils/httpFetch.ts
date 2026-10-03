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
import { HostConcurrencyLimiter, hostnameForLimiter } from './hostConcurrencyLimiter';
import {
  benchmarkCacheRead,
  benchmarkCacheWrite,
  isBenchmarkReplayActive,
  refuseBenchmarkReplayNetwork,
} from '../snapshotBenchmarkMode';

export const SCRAPER_USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';

export interface FetchedHttpPage {
  url: string;
  html: string;
  status: number;
  setCookies?: string[];
}

export interface HttpRequestResult {
  status: number;
  data: string;
  finalUrl: string;
  retryAfterMs?: number;
  setCookies?: string[];
}

export interface HttpRequestConfig {
  timeoutMs: number;
  headers: Record<string, string>;
  maxRedirects: number;
  method?: 'GET' | 'POST';
  body?: string;
}

export type HttpRequestFn = (url: string, config: HttpRequestConfig) => Promise<HttpRequestResult>;

export interface HostRateLimiterOptions {
  maxConcurrency?: number;
  minIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

export class HostRateLimiter {
  private readonly slots: HostConcurrencyLimiter;

  constructor(options: HostRateLimiterOptions = {}) {
    this.slots = new HostConcurrencyLimiter(options.maxConcurrency ?? 2, {
      minIntervalMs: options.minIntervalMs ?? 400,
      now: options.now,
      sleep: options.sleep,
    });
  }

  async run<T>(host: string, fn: () => Promise<T>): Promise<T> {
    const release = await this.slots.acquire(host);
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export const DEFAULT_RETRYABLE_STATUSES: ReadonlySet<number> = new Set([
  403, 408, 425, 429, 500, 502, 503, 504,
]);

const sharedHostLimiter = new HostRateLimiter();

export interface RetryPolicyOptions {
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  retryableStatuses?: ReadonlySet<number>;
  sleep?: (ms: number) => Promise<void>;
  jitter?: () => number;
}

export interface FetchPageWithPolicyOptions extends RetryPolicyOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRedirects?: number;
  limiter?: HostRateLimiter;
  request?: HttpRequestFn;
  assertUrl?: (url: string) => Promise<{ toString(): string }>;
}

interface ResolvedRetryPolicy {
  maxRetries: number;
  retryable: ReadonlySet<number>;
  sleep: (ms: number) => Promise<void>;
  backoffMs: (attempt: number) => number;
  statusRetryDelayMs: (attempt: number, retryAfterMs: number | undefined) => number;
}

function resolveRetryPolicy(options: RetryPolicyOptions): ResolvedRetryPolicy {
  const jitter = options.jitter ?? Math.random;
  const base = options.baseBackoffMs ?? 500;
  const maxBackoff = options.maxBackoffMs ?? 8_000;
  const backoffMs = (attempt: number): number =>
    Math.min(maxBackoff, base * 2 ** attempt + Math.floor(jitter() * base));
  return {
    maxRetries: options.maxRetries ?? 3,
    retryable: options.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES,
    sleep: options.sleep ?? realSleep,
    backoffMs,
    statusRetryDelayMs: (attempt, retryAfterMs) =>
      retryAfterMs !== undefined ? Math.min(retryAfterMs, maxBackoff) : backoffMs(attempt),
  };
}

function parseRetryAfterMs(header: unknown): number | undefined {
  if (typeof header !== 'string' || !header.trim()) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

function setCookieHeaders(header: unknown): string[] | undefined {
  if (Array.isArray(header)) return header.map(String);
  return typeof header === 'string' && header ? [header] : undefined;
}

const defaultAxiosRequest: HttpRequestFn = async (url, config) => {
  const agents = ssrfSafeAgents();
  const res =
    config.method === 'POST'
      ? await axios.request({
          url,
          method: 'POST',
          data: config.body ?? '',
          timeout: config.timeoutMs,
          headers: config.headers,
          maxRedirects: config.maxRedirects,
          httpAgent: agents.httpAgent,
          httpsAgent: agents.httpsAgent,
          responseType: 'text',
          validateStatus: () => true,
          transitional: { clarifyTimeoutError: true } as never,
        })
      : await axios.get(url, {
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
    setCookies: setCookieHeaders(res.headers?.['set-cookie']),
  };
};

function hostOf(url: string): string {
  return hostnameForLimiter(url) ?? url;
}

export const POLICY_FETCH_BENCHMARK_NAMESPACE = 'policy-fetch';

export class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`Request failed with status code ${status}`);
    this.name = 'HttpStatusError';
  }
}

interface FrozenFailedPage {
  failedStatus: number;
}

function isFrozenFailedPage(payload: unknown): payload is FrozenFailedPage {
  return typeof (payload as FrozenFailedPage).failedStatus === 'number';
}

export async function fetchPageWithPolicy(
  url: string,
  options: FetchPageWithPolicyOptions = {},
): Promise<FetchedHttpPage> {
  const benchmarkKey = `page:v1:${url}`;
  const frozen = benchmarkCacheRead(POLICY_FETCH_BENCHMARK_NAMESPACE, benchmarkKey);
  if (frozen.handled && frozen.payload) {
    if (isFrozenFailedPage(frozen.payload)) throw new HttpStatusError(frozen.payload.failedStatus);
    return frozen.payload as FetchedHttpPage;
  }
  if (isBenchmarkReplayActive()) refuseBenchmarkReplayNetwork();
  let page: FetchedHttpPage;
  try {
    page = await fetchPageLive(url, options);
  } catch (error) {
    if (error instanceof HttpStatusError) {
      benchmarkCacheWrite(POLICY_FETCH_BENCHMARK_NAMESPACE, benchmarkKey, {
        failedStatus: error.status,
      } satisfies FrozenFailedPage);
    }
    throw error;
  }
  benchmarkCacheWrite(POLICY_FETCH_BENCHMARK_NAMESPACE, benchmarkKey, page);
  return page;
}

// A postback body carries per-session view state, so no replay could key it: a form post is
// never frozen, and replay refuses it like any other unfrozen request.
export async function postFormWithPolicy(
  url: string,
  form: URLSearchParams,
  options: FetchPageWithPolicyOptions = {},
): Promise<FetchedHttpPage> {
  if (isBenchmarkReplayActive()) refuseBenchmarkReplayNetwork();
  return fetchPageLive(url, options, { method: 'POST', body: form.toString() });
}

interface FormSubmission {
  method: 'POST';
  body: string;
}

async function fetchPageLive(
  url: string,
  options: FetchPageWithPolicyOptions,
  submission?: FormSubmission,
): Promise<FetchedHttpPage> {
  const assertUrl = options.assertUrl ?? assertPublicHttpUrl;
  const safeUrl = (await assertUrl(url)).toString();
  const host = hostOf(safeUrl);
  const limiter = options.limiter ?? sharedHostLimiter;
  const request = options.request ?? defaultAxiosRequest;
  const { maxRetries, retryable, sleep, backoffMs, statusRetryDelayMs } =
    resolveRetryPolicy(options);

  const headers = options.headers ?? { 'User-Agent': SCRAPER_USER_AGENT };
  const config: HttpRequestConfig = {
    timeoutMs: options.timeoutMs ?? 10_000,
    headers: submission
      ? { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }
      : headers,
    maxRedirects: options.maxRedirects ?? 5,
    ...submission,
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
      return {
        url: result.finalUrl || safeUrl,
        html: result.data ?? '',
        status: result.status,
        ...(result.setCookies?.length ? { setCookies: result.setCookies } : {}),
      };
    }
    if (retryable.has(result.status) && attempt < maxRetries) {
      await sleep(statusRetryDelayMs(attempt, result.retryAfterMs));
      continue;
    }
    throw new HttpStatusError(result.status);
  }
  throw lastError ?? new Error('fetchPageWithPolicy exhausted retries');
}

interface HttpStatusRejection {
  response: { status: number; headers?: Record<string, unknown> };
}

function httpStatusRejection(error: unknown): HttpStatusRejection | undefined {
  const response = (error as { response?: { status?: unknown } } | null)?.response;
  return typeof response?.status === 'number' ? (error as HttpStatusRejection) : undefined;
}

// Only a status is retried, so a replay refusal or a timeout fails at once, and the final
// rejection is rethrown unchanged so the caller's own failure handling still reads it.
export async function retryOnRetryableStatus<T>(
  send: () => Promise<T>,
  options: RetryPolicyOptions = {},
): Promise<T> {
  const { maxRetries, retryable, sleep, statusRetryDelayMs } = resolveRetryPolicy(options);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await send();
    } catch (error) {
      const rejection = httpStatusRejection(error);
      if (!rejection || !retryable.has(rejection.response.status) || attempt >= maxRetries) {
        throw error;
      }
      const retryAfterMs = parseRetryAfterMs(rejection.response.headers?.['retry-after']);
      await sleep(statusRetryDelayMs(attempt, retryAfterMs));
    }
  }
}

export interface PublicHttpHopResponse {
  status: number;
  body: string;
  location?: string;
}

export type PublicHttpHopRequest = (
  url: string,
  config: { timeoutMs: number; headers: Record<string, string> },
) => Promise<PublicHttpHopResponse>;

export interface PublicHttpResponse extends PublicHttpHopResponse {
  finalUrl: string;
}

export interface FetchPublicHttpUrlOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRedirects?: number;
  assertUrl?: (url: string) => Promise<URL>;
  request?: PublicHttpHopRequest;
}

const isRedirectStatus = (status: number): boolean => status >= 300 && status < 400;

const defaultPublicHttpHopRequest: PublicHttpHopRequest = async (url, config) => {
  const agents = ssrfSafeAgents();
  const res = await axios.get(url, {
    timeout: config.timeoutMs,
    headers: config.headers,
    maxRedirects: 0,
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
    responseType: 'text',
    transformResponse: [(data) => data],
    validateStatus: () => true,
    transitional: { clarifyTimeoutError: true } as never,
  });
  const location = res.headers?.location;
  return {
    status: res.status,
    body: typeof res.data === 'string' ? res.data : String(res.data ?? ''),
    ...(typeof location === 'string' && location ? { location } : {}),
  };
};

export async function fetchPublicHttpUrl(
  url: string,
  options: FetchPublicHttpUrlOptions = {},
): Promise<PublicHttpResponse> {
  const assertUrl = options.assertUrl ?? assertPublicHttpUrl;
  const request = options.request ?? defaultPublicHttpHopRequest;
  const maxRedirects = options.maxRedirects ?? 5;
  const config = {
    timeoutMs: options.timeoutMs ?? 25_000,
    headers: options.headers ?? { 'User-Agent': SCRAPER_USER_AGENT },
  };

  let current = url;
  for (let redirects = 0; ; redirects += 1) {
    const safeUrl = (await assertUrl(current)).toString();
    const response = await request(safeUrl, config);
    if (!isRedirectStatus(response.status) || !response.location || redirects >= maxRedirects) {
      return { ...response, finalUrl: safeUrl };
    }
    current = new URL(response.location, safeUrl).toString();
  }
}
