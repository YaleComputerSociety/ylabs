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
import { isSweepPageReuseHit } from './sweepPageReuseHit';
import { assertPublicHttpUrl, SsrfBlockedError, ssrfSafeAgents } from '../../utils/ssrfGuard';
import {
  HostConcurrencyLimiter,
  HostSlotWaitTimeoutError,
  hostnameForLimiter,
  resolveHostRetryBudget,
  type HostSlotLimiter,
} from './hostConcurrencyLimiter';
import { HostBudgetUnavailableError } from './machineHostBudget';
import { machineHostSlotsForDirectRequest } from './scraperHostSlotLimiter';
import {
  benchmarkCacheRead,
  benchmarkCacheWrite,
  isBenchmarkReplayActive,
  refuseBenchmarkReplayNetwork,
} from '../snapshotBenchmarkMode';
import { isTlsVerificationError } from '../../utils/tlsVerificationErrors';
import { recordThrottleRetryOutcome } from './throttleRetryStats';
import { withScraperUserAgent } from './scraperUserAgent';
import {
  HOST_PAUSE_POLICY_FETCH,
  HostPausedError,
  activeHostPause,
  hostPauseInErrorChain,
  recordHostRefusal,
  recordTierOneExhausted,
  refuseRedirectIntoPausedHost,
} from './hostPause';
import { recordHostSuccess } from './hostPauseState';
import { withScrapeRunProgress } from '../scrapeRunProgress';
import { recordKnownDeadUrlSkip, rememberGoneUrl } from './knownDeadUrls';

export { SCRAPER_USER_AGENT } from './scraperUserAgent';

export interface FetchedHttpPage {
  url: string;
  html: string;
  status: number;
  setCookies?: string[];
  reused?: true;
}

export interface HttpRequestResult {
  status: number;
  data: string;
  finalUrl: string;
  retryAfterMs?: number;
  setCookies?: string[];
  location?: string;
  reused?: true;
}

/**
 * Whether a fetch result was replayed from a local cache rather than answered by its host: the
 * one test every host-accounting path asks (#6195), so a replay never counts as the host
 * answering, clears a backoff, or spends a request.
 */
export const isReusedResponse = (result: { reused?: unknown } | null | undefined): boolean =>
  result?.reused === true;

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
  applyHostOverrides?: boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  machineWide?: () => HostSlotLimiter | undefined;
}

const realSleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

export class HostRateLimiter {
  private readonly slots: HostConcurrencyLimiter;
  private readonly machineWide: () => HostSlotLimiter | undefined;

  constructor(options: HostRateLimiterOptions = {}) {
    this.slots = new HostConcurrencyLimiter(options.maxConcurrency ?? 2, {
      minIntervalMs: options.minIntervalMs ?? 400,
      applyHostOverrides: options.applyHostOverrides,
      now: options.now,
      sleep: options.sleep,
    });
    this.machineWide = options.machineWide ?? machineHostSlotsForDirectRequest;
  }

  async run<T>(host: string, fn: () => Promise<T>): Promise<T> {
    const release = await this.slots.acquire(host);
    try {
      const machine = this.machineWide();
      if (!machine) return await fn();
      const releaseMachine = await machine.acquire(host);
      try {
        return await fn();
      } finally {
        releaseMachine();
      }
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
  maxBackoffMs: number;
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
    maxBackoffMs: maxBackoff,
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

const POLICY_FETCH_MARK: object = { [HOST_PAUSE_POLICY_FETCH]: true };

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
          beforeRedirect: refuseRedirectIntoPausedHost(),
          ...POLICY_FETCH_MARK,
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
          beforeRedirect: refuseRedirectIntoPausedHost(),
          ...POLICY_FETCH_MARK,
          httpAgent: agents.httpAgent,
          httpsAgent: agents.httpsAgent,
          responseType: 'text',
          validateStatus: () => true,
          transitional: { clarifyTimeoutError: true } as never,
        });
  const finalUrl =
    typeof res.request?.res?.responseUrl === 'string' ? res.request.res.responseUrl : url;
  const location = res.headers?.location;
  return {
    status: res.status,
    data: typeof res.data === 'string' ? res.data : String(res.data ?? ''),
    finalUrl,
    retryAfterMs: parseRetryAfterMs(res.headers?.['retry-after']),
    setCookies: setCookieHeaders(res.headers?.['set-cookie']),
    ...(typeof location === 'string' && location ? { location } : {}),
    ...(isSweepPageReuseHit(res.config) ? { reused: true as const } : {}),
  };
};

function hostOf(url: string): string {
  return hostnameForLimiter(url) ?? url;
}

export const POLICY_FETCH_BENCHMARK_NAMESPACE = 'policy-fetch';

export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly finalUrl?: string,
  ) {
    super(`Request failed with status code ${status}`);
    this.name = 'HttpStatusError';
  }
}

/**
 * A request `fetchPageWithPolicy` never sent, because a recent link-health probe found the URL
 * gone. It is the 404 or 410 the request would have answered, so every lane handles it exactly
 * as it handles that status, with no request spent (#6210).
 */
export class KnownDeadUrlError extends HttpStatusError {
  constructor(status: number, finalUrl: string) {
    super(status, finalUrl);
    this.name = 'KnownDeadUrlError';
  }
}

interface FrozenFailedPage {
  failedStatus: number;
}

interface FrozenTlsFailure {
  failedTlsCode: string;
}

function isFrozenFailedPage(payload: unknown): payload is FrozenFailedPage {
  return typeof (payload as FrozenFailedPage).failedStatus === 'number';
}

function isFrozenTlsFailure(payload: unknown): payload is FrozenTlsFailure {
  return typeof (payload as FrozenTlsFailure).failedTlsCode === 'string';
}

export class FrozenTlsVerificationError extends Error {
  constructor(readonly code: string) {
    super(`TLS certificate verification failed: ${code}`);
    this.name = 'FrozenTlsVerificationError';
  }
}

export async function fetchPageWithPolicy(
  url: string,
  options: FetchPageWithPolicyOptions = {},
): Promise<FetchedHttpPage> {
  const benchmarkKey = `page:v1:${url}`;
  const frozen = benchmarkCacheRead(POLICY_FETCH_BENCHMARK_NAMESPACE, benchmarkKey);
  if (frozen.handled && frozen.payload) {
    if (isFrozenFailedPage(frozen.payload)) throw new HttpStatusError(frozen.payload.failedStatus);
    if (isFrozenTlsFailure(frozen.payload)) {
      throw new FrozenTlsVerificationError(frozen.payload.failedTlsCode);
    }
    return frozen.payload as FetchedHttpPage;
  }
  if (isBenchmarkReplayActive()) refuseBenchmarkReplayNetwork();
  const knownDeadStatus = recordKnownDeadUrlSkip(url);
  if (knownDeadStatus !== undefined) throw new KnownDeadUrlError(knownDeadStatus, url);
  let page: FetchedHttpPage;
  try {
    page = await fetchPageLive(url, options);
  } catch (error) {
    if (error instanceof HttpStatusError) {
      rememberGoneUrl(url, error.status);
      benchmarkCacheWrite(POLICY_FETCH_BENCHMARK_NAMESPACE, benchmarkKey, {
        failedStatus: error.status,
      } satisfies FrozenFailedPage);
    } else if (isTlsVerificationError(error)) {
      benchmarkCacheWrite(POLICY_FETCH_BENCHMARK_NAMESPACE, benchmarkKey, {
        failedTlsCode: (error as { code: string }).code,
      } satisfies FrozenTlsFailure);
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
  const send = options.request ?? defaultAxiosRequest;
  const request: HttpRequestFn = (target, requestConfig) =>
    withScrapeRunProgress(() => send(target, requestConfig));
  const policy = resolveRetryPolicy(options, host);

  const headers = withScraperUserAgent(options.headers);
  const config: HttpRequestConfig = {
    timeoutMs: options.timeoutMs ?? 10_000,
    headers: submission
      ? { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }
      : headers,
    maxRedirects: options.maxRedirects ?? 5,
    ...submission,
  };

  const followHops = (): Promise<HttpRequestResult> =>
    followRedirectsWithinBudget(safeUrl, config, { limiter, request, assertUrl });

  const knownPause = activeHostPause(host);
  if (knownPause) throw new HostPausedError(knownPause);
  const backoff = new RetryBackoffBudget(policy);
  for (let attempt = 0; ; attempt += 1) {
    let result: HttpRequestResult;
    try {
      result = await followHops();
    } catch (error) {
      const pausedHop = hostPauseInErrorChain(error);
      if (pausedHop) {
        backoff.settle('exhausted');
        throw pausedHop;
      }
      if (isRefusedBeforeSending(error)) {
        backoff.settle('exhausted');
        throw error;
      }
      if (!(await backoff.waitAfterTransportFailure(attempt))) {
        backoff.settle('exhausted');
        throw error;
      }
      continue;
    }
    const answeringHost = hostOf(result.finalUrl || safeUrl);
    if (result.status >= 200 && result.status < 300) {
      backoff.settle('recovered');
      if (!isReusedResponse(result)) await recordHostSuccess(answeringHost);
      return {
        url: result.finalUrl || safeUrl,
        html: result.data ?? '',
        status: result.status,
        ...(result.setCookies?.length ? { setCookies: result.setCookies } : {}),
        ...(isReusedResponse(result) ? { reused: true as const } : {}),
      };
    }
    const pause = await recordHostRefusal({
      host: answeringHost,
      status: result.status,
      body: result.data,
      retryAfterMs: result.retryAfterMs,
      quickRetryWaitMs: policy.maxBackoffMs,
    });
    if (pause) {
      backoff.settle('exhausted');
      throw new HostPausedError(pause, true);
    }
    if (
      policy.retryable.has(result.status) &&
      (await backoff.waitAfterStatusRefusal(attempt, result.retryAfterMs))
    ) {
      continue;
    }
    backoff.settle('exhausted');
    if (policy.retryable.has(result.status)) {
      await recordTierOneExhausted(answeringHost, result.status, result.retryAfterMs);
    }
    throw new HttpStatusError(result.status, result.finalUrl || safeUrl);
  }
}

const isRedirectStatus = (status: number): boolean => status >= 300 && status < 400;

function isRefusedBeforeSending(error: unknown): boolean {
  return (
    error instanceof SsrfBlockedError ||
    error instanceof HostPausedError ||
    error instanceof HostBudgetUnavailableError ||
    error instanceof HostSlotWaitTimeoutError
  );
}

function tooManyRedirectsError(maxRedirects: number): Error & { code: string } {
  return Object.assign(new Error(`Maximum number of redirects exceeded (${maxRedirects})`), {
    code: 'ERR_FR_TOO_MANY_REDIRECTS',
  });
}

const CROSS_ORIGIN_STRIPPED_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
]);

function withoutHeaders(
  headers: Record<string, string>,
  stripped: (name: string) => boolean,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !stripped(name.toLowerCase())),
  );
}

function leavesCredentialScope(from: URL, to: URL): boolean {
  const downgradesProtocol = to.protocol !== from.protocol && to.protocol !== 'https:';
  const leavesHost = to.host !== from.host && !to.host.endsWith(`.${from.host}`);
  return downgradesProtocol || leavesHost;
}

// The same method rewrite and credential stripping follow-redirects applies, so a manual hop
// sends what axios would have.
function configAfterRedirect(
  config: HttpRequestConfig,
  status: number,
  from: string,
  to: string,
): HttpRequestConfig {
  let next = config;
  if (next.method === 'POST' && [301, 302, 303].includes(status)) {
    const { body: _body, method: _method, ...rest } = next;
    next = { ...rest, headers: withoutHeaders(next.headers, (name) => name === 'content-type') };
  }
  if (leavesCredentialScope(new URL(from), new URL(to))) {
    next = {
      ...next,
      headers: withoutHeaders(next.headers, (name) => CROSS_ORIGIN_STRIPPED_HEADERS.has(name)),
    };
  }
  return next;
}

/**
 * Follows redirects one hop at a time, so every hop is charged to the host that receives it,
 * where axios's own follow would send the hop on the first host's budget from a synchronous hook
 * that cannot wait for a slot.
 */
async function followRedirectsWithinBudget(
  startUrl: string,
  config: HttpRequestConfig,
  deps: {
    limiter: HostRateLimiter;
    request: HttpRequestFn;
    assertUrl: (url: string) => Promise<{ toString(): string }>;
  },
): Promise<HttpRequestResult> {
  let current = startUrl;
  let hopConfig: HttpRequestConfig = { ...config, maxRedirects: 0 };
  for (let redirects = 0; ; redirects += 1) {
    const target = current;
    const sent = hopConfig;
    const pausedHop = activeHostPause(hostOf(target));
    if (pausedHop) throw new HostPausedError(pausedHop);
    const result = await deps.limiter.run(hostOf(target), () => deps.request(target, sent));
    if (config.maxRedirects === 0 || !isRedirectStatus(result.status) || !result.location) {
      return { ...result, finalUrl: result.finalUrl || current };
    }
    if (redirects >= config.maxRedirects) throw tooManyRedirectsError(config.maxRedirects);
    current = (await deps.assertUrl(new URL(result.location, target).toString())).toString();
    hopConfig = configAfterRedirect(hopConfig, result.status, target, current);
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
    headers: withScraperUserAgent(options.headers),
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
