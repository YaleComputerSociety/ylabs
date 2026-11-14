import {
  HOST_PAUSE_POLICY_FETCH,
  HostPausedError,
  activeHostPause,
  recordHostRefusal,
  refuseRedirectIntoPausedHost,
} from './hostPause';
import { recordHostSuccess } from './hostPauseState';
import axios, { AxiosError } from 'axios';
import { isSweepPageReuseHit } from './sweepPageReuseHit';
import { isHostBudgetExempt } from './hostBudgetExempt';
import {
  DEFAULT_PER_HOST_CONCURRENCY,
  HOST_SLOT_WAIT_TIMEOUT_MS,
  HOST_THROTTLE_OVERRIDES,
  HostSlotWaitTimeoutError,
  type HostPoliteness,
  type HostRetryBudget,
  type HostSlotLimiter,
  type HostSlotRelease,
  type HostThrottle,
} from './hostThrottlePolicy';

export {
  BAN_PRONE_HOST_RETRY_BUDGET,
  DEFAULT_PER_HOST_CONCURRENCY,
  HOST_SLOT_WAIT_TIMEOUT_MS,
  HOST_THROTTLE_OVERRIDES,
  HostSlotWaitTimeoutError,
  REFUSAL_THROTTLED_HOST_RETRY_BUDGET,
  YALE_HOST_DEFAULT_THROTTLE,
  type HostPoliteness,
  type HostRetryBudget,
  type HostSlotLimiter,
  type HostSlotRelease,
  type HostThrottle,
} from './hostThrottlePolicy';

export function resolvePerHostConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.SCRAPER_PER_HOST_CONCURRENCY);
  return Number.isInteger(raw) && raw >= 1 ? raw : DEFAULT_PER_HOST_CONCURRENCY;
}

function hostPoliteness(host: string | undefined): HostPoliteness | undefined {
  const key = host?.toLowerCase();
  return key && Object.hasOwn(HOST_THROTTLE_OVERRIDES, key)
    ? HOST_THROTTLE_OVERRIDES[key]
    : undefined;
}

export function resolveHostRetryBudget(host: string | undefined): HostRetryBudget | undefined {
  return hostPoliteness(host)?.retryBudget;
}

export function resolveHostThrottle(
  host: string | undefined,
  defaults: HostThrottle,
): HostThrottle {
  const override = hostPoliteness(host);
  if (!override) return defaults;
  return {
    concurrency: Math.min(defaults.concurrency, override.concurrency),
    minIntervalMs: Math.max(defaults.minIntervalMs, override.minIntervalMs),
  };
}

export class ChainedHostSlotLimiter implements HostSlotLimiter {
  constructor(private readonly limiters: readonly HostSlotLimiter[]) {}

  async acquire(host: string): Promise<HostSlotRelease> {
    const releases: HostSlotRelease[] = [];
    try {
      for (const limiter of this.limiters) releases.push(await limiter.acquire(host));
    } catch (error) {
      for (const release of releases.reverse()) release();
      throw error;
    }
    return () => {
      for (const release of [...releases].reverse()) release();
    };
  }
}

const realSleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

interface HostSlotState {
  active: number;
  lastGrantAt: number;
  lastActualGrantAt: number;
  waiters: Array<() => void>;
}

export interface HostConcurrencyLimiterOptions {
  minIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  applyHostOverrides?: boolean;
}

export class HostConcurrencyLimiter implements HostSlotLimiter {
  private readonly baseThrottle: HostThrottle;
  private readonly applyHostOverrides: boolean;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly states = new Map<string, HostSlotState>();

  constructor(
    cap: number = DEFAULT_PER_HOST_CONCURRENCY,
    options: HostConcurrencyLimiterOptions = {},
  ) {
    this.baseThrottle = {
      concurrency: Math.max(1, Math.floor(cap) || 1),
      minIntervalMs: Math.max(0, options.minIntervalMs ?? 0),
    };
    this.applyHostOverrides = options.applyHostOverrides ?? true;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? realSleep;
  }

  async acquire(host: string): Promise<HostSlotRelease> {
    const key = host || '(unknown-host)';
    const throttle = this.throttleFor(key);
    const state = this.stateFor(key);
    while (state.active >= throttle.concurrency) {
      await new Promise<void>((resolve) => state.waiters.push(resolve));
    }
    state.active += 1;
    // Reserve the grant instant before awaiting: overlapping acquirers that read
    // lastGrantAt only after sleeping would all compute the same wait and fire together.
    const grantAt = Math.max(this.now(), state.lastGrantAt + throttle.minIntervalMs);
    state.lastGrantAt = grantAt;
    const waitMs = grantAt - this.now();
    if (waitMs > 0) await this.sleep(waitMs);
    // A timer that fires late moves this grant but not the reservations after it, so the
    // next grant is re-spaced against the grant actually made rather than the one reserved.
    for (
      let gapMs = state.lastActualGrantAt + throttle.minIntervalMs - this.now();
      gapMs > 0;
      gapMs = state.lastActualGrantAt + throttle.minIntervalMs - this.now()
    ) {
      await this.sleep(gapMs);
    }
    state.lastActualGrantAt = this.now();
    return this.makeRelease(key);
  }

  adopt(host: string): HostSlotRelease {
    const key = host || '(unknown-host)';
    const state = this.stateFor(key);
    state.active += 1;
    state.lastGrantAt = Math.max(state.lastGrantAt, this.now());
    state.lastActualGrantAt = Math.max(state.lastActualGrantAt, this.now());
    return this.makeRelease(key);
  }

  activeCount(host: string): number {
    return this.states.get(host || '(unknown-host)')?.active ?? 0;
  }

  private throttleFor(host: string): HostThrottle {
    return this.applyHostOverrides
      ? resolveHostThrottle(host, this.baseThrottle)
      : this.baseThrottle;
  }

  private stateFor(key: string): HostSlotState {
    let state = this.states.get(key);
    if (!state) {
      state = {
        active: 0,
        lastGrantAt: Number.NEGATIVE_INFINITY,
        lastActualGrantAt: Number.NEGATIVE_INFINITY,
        waiters: [],
      };
      this.states.set(key, state);
    }
    return state;
  }

  private makeRelease(key: string): HostSlotRelease {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const state = this.stateFor(key);
      state.active = Math.max(0, state.active - 1);
      const next = state.waiters.shift();
      if (next) next();
    };
  }
}

export const defaultHostConcurrencyLimiter = new HostConcurrencyLimiter(
  resolvePerHostConcurrency(),
);

export function hostnameForLimiter(url: unknown, baseURL?: string): string | undefined {
  if (typeof url !== 'string' || url.length === 0) return undefined;
  try {
    return new URL(url, baseURL || undefined).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export async function withHostSlot<T>(
  url: string,
  run: () => Promise<T>,
  limiter: HostSlotLimiter = defaultHostConcurrencyLimiter,
): Promise<T> {
  const host = hostnameForLimiter(url);
  if (!host) return run();
  const release = await limiter.acquire(host);
  try {
    return await run();
  } finally {
    release();
  }
}

/** A slot granted after the wait gave up is released at once, so a late grant never leaks. */
export function acquireHostSlotWithin(
  limiter: HostSlotLimiter,
  host: string,
  timeoutMs: number = HOST_SLOT_WAIT_TIMEOUT_MS,
): Promise<HostSlotRelease> {
  return new Promise<HostSlotRelease>((resolve, reject) => {
    let gaveUp = false;
    const timer = setTimeout(() => {
      gaveUp = true;
      reject(new HostSlotWaitTimeoutError(host, timeoutMs));
    }, timeoutMs);
    limiter.acquire(host).then(
      (release) => {
        if (gaveUp) {
          release();
          return;
        }
        clearTimeout(timer);
        resolve(release);
      },
      (error: unknown) => {
        if (gaveUp) return;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export interface ScraperHostConcurrencyInterceptorOptions {
  acquireTimeoutMs?: number;
}

/**
 * Records a response's refusal or success against its host. A page reused from the sweep cache was
 * not answered by the host, so it says nothing about the host's limits and is skipped.
 */
function recordHostOutcomeFromResponse(response: unknown): void {
  const typed = response as
    | {
        status?: unknown;
        data?: unknown;
        headers?: unknown;
        config?: { url?: string; baseURL?: string; [HOST_PAUSE_POLICY_FETCH]?: unknown };
        request?: { res?: { responseUrl?: unknown } };
      }
    | undefined;
  if (typeof typed?.status !== 'number' || typed.config?.[HOST_PAUSE_POLICY_FETCH]) return;
  if (isSweepPageReuseHit(typed.config)) return;
  const host =
    hostnameForLimiter(typed.request?.res?.responseUrl) ??
    hostnameForLimiter(typed.config?.url, typed.config?.baseURL);
  if (!host || isHostBudgetExempt(host)) return;
  if (typed.status >= 200 && typed.status < 300) {
    void recordHostSuccess(host).catch((error: unknown) => {
      console.warn(
        `[host-pause] could not record a success from ${host}: ${(error as Error)?.message ?? error}`,
      );
    });
    return;
  }
  // The interceptor cannot wait, so a request already in flight may still reach the host before
  // this pause lands; every later acquire reads it.
  void recordHostRefusal({
    host,
    status: typed.status,
    headers: typed.headers,
    body: typed.data,
  }).catch((error: unknown) => {
    console.warn(
      `[host-pause] could not record a ${typed.status} from ${host}: ${(error as Error)?.message ?? error}`,
    );
  });
}

const RELEASE_KEY = '__scraperHostRelease';
let installed = false;

export function isScraperHostConcurrencyInterceptorInstalled(): boolean {
  return installed;
}

export function installScraperHostConcurrencyInterceptor(
  limiter: HostSlotLimiter = defaultHostConcurrencyLimiter,
  options: ScraperHostConcurrencyInterceptorOptions = {},
): void {
  if (installed) return;
  installed = true;
  const acquireTimeoutMs = options.acquireTimeoutMs ?? HOST_SLOT_WAIT_TIMEOUT_MS;
  axios.interceptors.request.use(async (config) => {
    const host = hostnameForLimiter(config.url, config.baseURL);
    if (isHostBudgetExempt(host)) return config;
    const knownPause = activeHostPause(host);
    if (knownPause && !isSweepPageReuseHit(config)) throw new HostPausedError(knownPause);
    const redirectable = config as {
      beforeRedirect?: Parameters<typeof refuseRedirectIntoPausedHost>[0];
    };
    redirectable.beforeRedirect = refuseRedirectIntoPausedHost(redirectable.beforeRedirect);
    if (host && !isSweepPageReuseHit(config)) {
      try {
        (config as unknown as Record<string, unknown>)[RELEASE_KEY] = await acquireHostSlotWithin(
          limiter,
          host,
          acquireTimeoutMs,
        );
      } catch (error) {
        if (!(error instanceof HostSlotWaitTimeoutError)) throw error;
        const timedOut = new AxiosError(error.message, AxiosError.ETIMEDOUT, config);
        // Keeps the original reachable, so a lane still reads this as a request never sent (#6258)
        // rather than as a verdict on the page.
        timedOut.cause = error;
        throw timedOut;
      }
    }
    return config;
  });
  const release = (config: unknown): void => {
    const holder = config as Record<string, unknown> | undefined;
    const fn = holder?.[RELEASE_KEY];
    if (typeof fn === 'function') {
      (fn as HostSlotRelease)();
      delete holder?.[RELEASE_KEY];
    }
  };
  axios.interceptors.response.use(
    (response) => {
      release(response.config);
      recordHostOutcomeFromResponse(response);
      return response;
    },
    (error) => {
      release(error?.config);
      recordHostOutcomeFromResponse(error?.response);
      return Promise.reject(error);
    },
  );
}
