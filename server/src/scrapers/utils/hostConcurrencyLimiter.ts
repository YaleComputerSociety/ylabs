import axios from 'axios';

export const DEFAULT_PER_HOST_CONCURRENCY = 4;

export function resolvePerHostConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.SCRAPER_PER_HOST_CONCURRENCY);
  return Number.isInteger(raw) && raw >= 1 ? raw : DEFAULT_PER_HOST_CONCURRENCY;
}

export type HostSlotRelease = () => void;

export class HostConcurrencyLimiter {
  private readonly cap: number;
  private readonly active = new Map<string, number>();
  private readonly waiters = new Map<string, Array<() => void>>();

  constructor(cap: number = DEFAULT_PER_HOST_CONCURRENCY) {
    this.cap = Math.max(1, Math.floor(cap) || 1);
  }

  acquire(host: string): Promise<HostSlotRelease> {
    const key = host || '(unknown-host)';
    const active = this.active.get(key) ?? 0;
    if (active < this.cap) {
      this.active.set(key, active + 1);
      return Promise.resolve(this.makeRelease(key));
    }
    return new Promise<HostSlotRelease>((resolve) => {
      const queue = this.waiters.get(key) ?? [];
      queue.push(() => resolve(this.makeRelease(key)));
      this.waiters.set(key, queue);
    });
  }

  activeCount(host: string): number {
    return this.active.get(host || '(unknown-host)') ?? 0;
  }

  private makeRelease(key: string): HostSlotRelease {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = (this.active.get(key) ?? 1) - 1;
      if (next <= 0) this.active.delete(key);
      else this.active.set(key, next);
      this.pump(key);
    };
  }

  private pump(key: string): void {
    const queue = this.waiters.get(key);
    if (!queue || queue.length === 0) return;
    if ((this.active.get(key) ?? 0) >= this.cap) return;
    const grant = queue.shift() as () => void;
    if (queue.length === 0) this.waiters.delete(key);
    this.active.set(key, (this.active.get(key) ?? 0) + 1);
    grant();
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
