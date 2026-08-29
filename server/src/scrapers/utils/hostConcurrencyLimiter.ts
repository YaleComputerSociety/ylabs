import axios from 'axios';

export const DEFAULT_PER_HOST_CONCURRENCY = 4;

export function resolvePerHostConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.SCRAPER_PER_HOST_CONCURRENCY);
  return Number.isInteger(raw) && raw >= 1 ? raw : DEFAULT_PER_HOST_CONCURRENCY;
}

export interface HostThrottle {
  concurrency: number;
  minIntervalMs: number;
}

export const HOST_THROTTLE_OVERRIDES: Readonly<Record<string, HostThrottle>> = {
  'medicine.yale.edu': { concurrency: 2, minIntervalMs: 400 },
  'ysph.yale.edu': { concurrency: 2, minIntervalMs: 400 },
};

export function resolveHostThrottle(
  host: string | undefined,
  defaults: HostThrottle,
): HostThrottle {
  const key = host?.toLowerCase();
  const override =
    key && Object.hasOwn(HOST_THROTTLE_OVERRIDES, key) ? HOST_THROTTLE_OVERRIDES[key] : undefined;
  if (!override) return defaults;
  return {
    concurrency: Math.min(defaults.concurrency, override.concurrency),
    minIntervalMs: Math.max(defaults.minIntervalMs, override.minIntervalMs),
  };
}

export type HostSlotRelease = () => void;

const realSleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

interface HostSlotState {
  active: number;
  lastGrantAt: number;
  waiters: Array<() => void>;
}

export interface HostConcurrencyLimiterOptions {
  minIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class HostConcurrencyLimiter {
  private readonly baseThrottle: HostThrottle;
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
    return this.makeRelease(key);
  }

  activeCount(host: string): number {
    return this.states.get(host || '(unknown-host)')?.active ?? 0;
  }

  private throttleFor(host: string): HostThrottle {
    return resolveHostThrottle(host, this.baseThrottle);
  }

  private stateFor(key: string): HostSlotState {
    let state = this.states.get(key);
    if (!state) {
      state = { active: 0, lastGrantAt: Number.NEGATIVE_INFINITY, waiters: [] };
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
  limiter: HostConcurrencyLimiter = defaultHostConcurrencyLimiter,
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

const RELEASE_KEY = '__scraperHostRelease';
let installed = false;

export function installScraperHostConcurrencyInterceptor(
  limiter: HostConcurrencyLimiter = defaultHostConcurrencyLimiter,
): void {
  if (installed) return;
  installed = true;
  axios.interceptors.request.use(async (config) => {
    const host = hostnameForLimiter(config.url, config.baseURL);
    if (host) {
      (config as unknown as Record<string, unknown>)[RELEASE_KEY] = await limiter.acquire(host);
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
