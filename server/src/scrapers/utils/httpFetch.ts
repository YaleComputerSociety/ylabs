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
import {
  HostConcurrencyLimiter,
  hostnameForLimiter,
  resolveHostRetryBudget,
} from './hostConcurrencyLimiter';
import {
  benchmarkCacheRead,
  benchmarkCacheWrite,
  isBenchmarkReplayActive,
  refuseBenchmarkReplayNetwork,
} from '../snapshotBenchmarkMode';
import { recordThrottleRetryOutcome } from './throttleRetryStats';

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
  maxTotalBackoffMs?: number;
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

export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_MAX_BACKOFF_MS = 8_000;

export interface ResolvedRetryPolicy {
  maxRetries: number;
  maxTransportRetries: number;
  maxTotalBackoffMs: number;
  retryable: ReadonlySet<number>;
  sleep: (ms: number) => Promise<void>;
  backoffMs: (attempt: number) => number;
  statusRetryDelayMs: (attempt: number, retryAfterMs: number | undefined) => number;
}

export function resolveRetryPolicy(
  options: RetryPolicyOptions,
  host?: string,
): ResolvedRetryPolicy {
  const hostBudget = resolveHostRetryBudget(host);
  const jitter = options.jitter ?? Math.random;
  const base = options.baseBackoffMs ?? 500;
  const maxBackoff = options.maxBackoffMs ?? hostBudget?.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const backoffMs = (attempt: number): number =>
    Math.min(maxBackoff, base * 2 ** attempt + Math.floor(jitter() * base));
  return {
    maxRetries: options.maxRetries ?? hostBudget?.maxRetries ?? DEFAULT_MAX_RETRIES,
    maxTransportRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    maxTotalBackoffMs:
      options.maxTotalBackoffMs ?? hostBudget?.maxTotalBackoffMs ?? Number.POSITIVE_INFINITY,
    retryable: options.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES,
    sleep: options.sleep ?? realSleep,
    backoffMs,
    statusRetryDelayMs: (attempt, retryAfterMs) =>
      retryAfterMs !== undefined ? Math.min(retryAfterMs, maxBackoff) : backoffMs(attempt),
  };
}

class RetryBackoffBudget {
  private retries = 0;
  private transportRetries = 0;
  private spentMs = 0;
  private statusRefusals = 0;

  constructor(readonly policy: ResolvedRetryPolicy) {}

  async waitAfterStatusRefusal(attempt: number, retryAfterMs?: number): Promise<boolean> {
    this.statusRefusals += 1;
    if (this.retries >= this.policy.maxRetries) return false;
    return this.wait(this.policy.statusRetryDelayMs(attempt, retryAfterMs));
  }

  settle(outcome: 'recovered' | 'exhausted'): void {
    if (this.statusRefusals > 0) recordThrottleRetryOutcome(outcome, this.retries);
  }

  async waitAfterTransportFailure(attempt: number): Promise<boolean> {
    if (this.retries >= this.policy.maxRetries) return false;
    if (this.transportRetries >= this.policy.maxTransportRetries) return false;
    this.transportRetries += 1;
    return this.wait(this.policy.backoffMs(attempt));
  }

  private async wait(delayMs: number): Promise<boolean> {
    if (this.spentMs + delayMs > this.policy.maxTotalBackoffMs) return false;
    this.retries += 1;
    this.spentMs += delayMs;
    await this.policy.sleep(delayMs);
    return true;
  }
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

export const defaultAxiosRequest: HttpRequestFn = async (url, config) => {
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
  const policy = resolveRetryPolicy(options, host);

  const headers = options.headers ?? { 'User-Agent': SCRAPER_USER_AGENT };
  const config: HttpRequestConfig = {
    timeoutMs: options.timeoutMs ?? 10_000,
    headers: submission
      ? { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }
      : headers,
    maxRedirects: options.maxRedirects ?? 5,
    ...submission,
  };

  const backoff = new RetryBackoffBudget(policy);
  for (let attempt = 0; ; attempt += 1) {
    let result: HttpRequestResult;
    try {
      result = await limiter.run(host, () => request(safeUrl, config));
    } catch (error) {
      if (!(await backoff.waitAfterTransportFailure(attempt))) {
        backoff.settle('exhausted');
        throw error;
      }
      continue;
    }
    if (result.status >= 200 && result.status < 300) {
      backoff.settle('recovered');
      return {
        url: result.finalUrl || safeUrl,
        html: result.data ?? '',
        status: result.status,
        ...(result.setCookies?.length ? { setCookies: result.setCookies } : {}),
      };
    }
    if (
      policy.retryable.has(result.status) &&
      (await backoff.waitAfterStatusRefusal(attempt, result.retryAfterMs))
    ) {
      continue;
    }
    backoff.settle('exhausted');
    throw new HttpStatusError(result.status);
  }
}

interface HttpStatusRejection {
  response: { status: number; headers?: Record<string, unknown> };
  config?: { url?: string; baseURL?: string };
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
  let backoff: RetryBackoffBudget | undefined;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const value = await send();
      backoff?.settle('recovered');
      return value;
    } catch (error) {
      const rejection = httpStatusRejection(error);
      if (!rejection) {
        backoff?.settle('exhausted');
        throw error;
      }
      backoff ??= new RetryBackoffBudget(
        resolveRetryPolicy(
          options,
          hostnameForLimiter(rejection.config?.url, rejection.config?.baseURL),
        ),
      );
      const retryable = backoff.policy.retryable.has(rejection.response.status);
      const retryAfterMs = parseRetryAfterMs(rejection.response.headers?.['retry-after']);
      if (!retryable || !(await backoff.waitAfterStatusRefusal(attempt, retryAfterMs))) {
        backoff.settle('exhausted');
        throw error;
      }
    }
  }
}

export interface RetryableResultOutcome {
  status?: number;
  succeeded: boolean;
}

export async function retryOnRetryableResultStatus<T>(
  host: string | undefined,
  send: () => Promise<T>,
  classify: (result: T) => RetryableResultOutcome,
  options: RetryPolicyOptions = {},
): Promise<T> {
  const backoff = new RetryBackoffBudget(resolveRetryPolicy(options, host));
  for (let attempt = 0; ; attempt += 1) {
    const result = await send();
    const { status, succeeded } = classify(result);
    const refused = !succeeded && status !== undefined && backoff.policy.retryable.has(status);
    if (!refused || !(await backoff.waitAfterStatusRefusal(attempt))) {
      backoff.settle(succeeded ? 'recovered' : 'exhausted');
      return result;
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
