import axios, { AxiosError } from 'axios';
import { isSweepPageReuseHit } from './sweepPageReuseHit';

export const DEFAULT_PER_HOST_CONCURRENCY = 4;

export function resolvePerHostConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.SCRAPER_PER_HOST_CONCURRENCY);
  return Number.isInteger(raw) && raw >= 1 ? raw : DEFAULT_PER_HOST_CONCURRENCY;
}

export interface HostThrottle {
  concurrency: number;
  minIntervalMs: number;
}

export interface HostRetryBudget {
  maxRetries: number;
  maxBackoffMs: number;
  maxTotalBackoffMs: number;
}

export interface HostPoliteness extends HostThrottle {
  retryBudget?: HostRetryBudget;
}

// These hosts refuse 30-50% of single requests at random (measured 2026-10-03), so a page
// fails every attempt with probability p^(maxRetries + 1): 0.5^4 = 6% under the default
// three retries, 0.5^9 = 0.2% under eight. The waits stay inside the slot throttle, and
// maxTotalBackoffMs bounds one page even when every refusal names a long Retry-After.
export const REFUSAL_THROTTLED_HOST_RETRY_BUDGET: HostRetryBudget = {
  maxRetries: 8,
  maxBackoffMs: 15_000,
  maxTotalBackoffMs: 90_000,
};

export const HOST_THROTTLE_OVERRIDES: Readonly<Record<string, HostPoliteness>> = {
  'medicine.yale.edu': {
    concurrency: 3,
    minIntervalMs: 400,
    retryBudget: REFUSAL_THROTTLED_HOST_RETRY_BUDGET,
  },
  'ysph.yale.edu': {
    concurrency: 2,
    minIntervalMs: 400,
    retryBudget: REFUSAL_THROTTLED_HOST_RETRY_BUDGET,
  },
};

// Yale hosts answered about 2 requests a second with 403s (ysph, hold 3i), so any Yale host
// without its own override gets one request at a time, 1.5 s apart, across the whole machine.
export const YALE_HOST_DEFAULT_THROTTLE: HostThrottle = {
  concurrency: 1,
  minIntervalMs: 1_500,
};

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

export type HostSlotRelease = () => void;

export interface HostSlotLimiter {
  acquire(host: string): Promise<HostSlotRelease>;
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

/**
 * The longest a request waits for a host slot before it fails instead. A slot that is never
 * released, or a lease acquire that never answers, would otherwise hold every later request to
 * that host forever, with no fetch deadline running because the wait happens before dispatch.
 * Changing it also requires updating the "Fetch deadlines" table in `skills/scrapers/SKILL.md`.
 */
export const HOST_SLOT_WAIT_TIMEOUT_MS = 10 * 60_000;

export class HostSlotWaitTimeoutError extends Error {
  readonly code = 'ETIMEDOUT';

  constructor(host: string, timeoutMs: number) {
    super(`no host slot for ${host} within ${timeoutMs} ms`);
    this.name = 'HostSlotWaitTimeoutError';
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
    if (host && !isSweepPageReuseHit(config)) {
      try {
        (config as unknown as Record<string, unknown>)[RELEASE_KEY] = await acquireHostSlotWithin(
          limiter,
          host,
          acquireTimeoutMs,
        );
      } catch (error) {
        if (!(error instanceof HostSlotWaitTimeoutError)) throw error;
        throw new AxiosError(error.message, AxiosError.ETIMEDOUT, config);
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
      return response;
    },
    (error) => {
      release(error?.config);
      return Promise.reject(error);
    },
  );
}
