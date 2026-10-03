import { describe, expect, it, vi } from 'vitest';
import {
  HOST_THROTTLE_OVERRIDES,
  REFUSAL_THROTTLED_HOST_RETRY_BUDGET,
  resolveHostRetryBudget,
} from '../hostConcurrencyLimiter';
import {
  DEFAULT_MAX_RETRIES,
  fetchPageWithPolicy,
  HostRateLimiter,
  resolveRetryPolicy,
  retryOnRetryableStatus,
  type HttpRequestFn,
} from '../httpFetch';

const passthroughAssert = async (url: string) => ({ toString: () => url });

function statusRejection(status: number, url: string, headers: Record<string, unknown> = {}) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, headers },
    config: { url },
  });
}

function recordingSleep() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe('resolveHostRetryBudget', () => {
  it('gives every refusal-throttled host the larger budget, keyed by lowercased hostname', () => {
    expect(resolveHostRetryBudget('medicine.yale.edu')).toEqual(
      REFUSAL_THROTTLED_HOST_RETRY_BUDGET,
    );
    expect(resolveHostRetryBudget('YSPH.Yale.EDU')).toEqual(REFUSAL_THROTTLED_HOST_RETRY_BUDGET);
  });

  it('leaves an unlisted host, an unknown host, and prototype keys on the default policy', () => {
    expect(resolveHostRetryBudget('lab.example.edu')).toBeUndefined();
    expect(resolveHostRetryBudget(undefined)).toBeUndefined();
    expect(resolveHostRetryBudget('__proto__')).toBeUndefined();
    expect(resolveHostRetryBudget('constructor')).toBeUndefined();
  });

  it('keeps the throttle and the retry budget in the one override entry per host', () => {
    for (const entry of Object.values(HOST_THROTTLE_OVERRIDES)) {
      expect(entry.retryBudget).toBeDefined();
      expect(entry.concurrency).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('resolveRetryPolicy', () => {
  it('uses the host budget for status retries but keeps transport retries at the default', () => {
    const policy = resolveRetryPolicy({}, 'medicine.yale.edu');
    expect(policy.maxRetries).toBe(8);
    expect(policy.maxTransportRetries).toBe(DEFAULT_MAX_RETRIES);
    expect(policy.maxTotalBackoffMs).toBe(90_000);
  });

  it('lets an explicit caller option win over the host budget', () => {
    const policy = resolveRetryPolicy({ maxRetries: 0 }, 'medicine.yale.edu');
    expect(policy.maxRetries).toBe(0);
  });

  it('leaves an unlisted host on the unchanged default policy', () => {
    const policy = resolveRetryPolicy({}, 'lab.example.edu');
    expect(policy.maxRetries).toBe(DEFAULT_MAX_RETRIES);
    expect(policy.maxTotalBackoffMs).toBe(Number.POSITIVE_INFINITY);
  });

  it('persists through 0.5 per-request refusal far better than the default budget', () => {
    const p = 0.5;
    const persistentFailure = (retries: number) => p ** (retries + 1);
    expect(persistentFailure(DEFAULT_MAX_RETRIES)).toBeCloseTo(0.0625);
    expect(persistentFailure(resolveRetryPolicy({}, 'medicine.yale.edu').maxRetries)).toBeLessThan(
      0.002,
    );
  });
});

describe('retryOnRetryableStatus on a refusal-throttled host', () => {
  it('keeps re-asking through eight refusals and returns the page that follows', async () => {
    const url = 'https://medicine.yale.edu/about/a-to-z-index/lab-websites/';
    const send = vi.fn();
    for (let i = 0; i < 8; i += 1) send.mockRejectedValueOnce(statusRejection(403, url));
    send.mockResolvedValueOnce({ status: 200, data: '<html>index</html>' });
    const { waits, sleep } = recordingSleep();

    const res = await retryOnRetryableStatus(send, { sleep, jitter: () => 0 });

    expect(res).toEqual({ status: 200, data: '<html>index</html>' });
    expect(send).toHaveBeenCalledTimes(9);
    expect(waits).toEqual([500, 1000, 2000, 4000, 8000, 15_000, 15_000, 15_000]);
  });

  it('bounds the worst case below 90 s of backoff even at maximum jitter', async () => {
    const url = 'https://medicine.yale.edu/lab/x/';
    const send = vi.fn(async () => {
      throw statusRejection(403, url);
    });
    const { waits, sleep } = recordingSleep();

    await expect(retryOnRetryableStatus(send, { sleep, jitter: () => 0.999 })).rejects.toThrow(
      /status code 403/,
    );

    expect(send).toHaveBeenCalledTimes(9);
    expect(Math.max(...waits)).toBeLessThanOrEqual(15_000);
    expect(sum(waits)).toBeLessThan(90_000);
  });

  it('stops at the total backoff bound when every refusal names a long Retry-After', async () => {
    const url = 'https://ysph.yale.edu/x/';
    const send = vi.fn(async () => {
      throw statusRejection(429, url, { 'retry-after': '3600' });
    });
    const { waits, sleep } = recordingSleep();

    await expect(retryOnRetryableStatus(send, { sleep, jitter: () => 0 })).rejects.toThrow(
      /status code 429/,
    );

    expect(waits).toEqual([15_000, 15_000, 15_000, 15_000, 15_000, 15_000]);
    expect(sum(waits)).toBeLessThanOrEqual(90_000);
    expect(send).toHaveBeenCalledTimes(7);
  });

  it('still gives an unlisted host only the default three retries', async () => {
    const send = vi.fn(async () => {
      throw statusRejection(403, 'https://lab.example.edu/x');
    });
    const { sleep } = recordingSleep();

    await expect(retryOnRetryableStatus(send, { sleep, jitter: () => 0 })).rejects.toThrow();

    expect(send).toHaveBeenCalledTimes(4);
  });

  it('never re-sends a timeout on a throttled host', async () => {
    const send = vi.fn(async () => {
      throw Object.assign(new Error('timeout of 30000ms exceeded'), {
        code: 'ECONNABORTED',
        config: { url: 'https://medicine.yale.edu/x' },
      });
    });

    await expect(retryOnRetryableStatus(send, { sleep: async () => {} })).rejects.toThrow(
      /timeout/,
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('fetchPageWithPolicy on a refusal-throttled host', () => {
  const base = {
    assertUrl: passthroughAssert,
    limiter: new HostRateLimiter({ minIntervalMs: 0, sleep: async () => {} }),
    jitter: () => 0,
  };

  it('retries a refusal up to the host budget before giving up', async () => {
    const request = vi.fn<HttpRequestFn>(async () => ({ status: 403, data: '', finalUrl: 'u' }));
    const { waits, sleep } = recordingSleep();

    await expect(
      fetchPageWithPolicy('https://medicine.yale.edu/x', { ...base, request, sleep }),
    ).rejects.toThrow('status code 403');

    expect(request).toHaveBeenCalledTimes(9);
    expect(sum(waits)).toBeLessThan(90_000);
  });

  it('caps transport failures at the default retries even on a throttled host', async () => {
    const request = vi.fn<HttpRequestFn>(async () => {
      throw new Error('ETIMEDOUT');
    });
    const { sleep } = recordingSleep();

    await expect(
      fetchPageWithPolicy('https://medicine.yale.edu/x', { ...base, request, sleep }),
    ).rejects.toThrow('ETIMEDOUT');

    expect(request).toHaveBeenCalledTimes(DEFAULT_MAX_RETRIES + 1);
  });

  it('releases the host slot while it backs off', async () => {
    const limiter = new HostRateLimiter({
      maxConcurrency: 1,
      minIntervalMs: 0,
      sleep: async () => {},
    });
    const request = vi
      .fn<HttpRequestFn>()
      .mockResolvedValueOnce({ status: 403, data: '', finalUrl: 'u' })
      .mockResolvedValueOnce({ status: 200, data: 'body', finalUrl: 'u' });
    let slotFreeDuringBackoff = false;
    const sleep = async () => {
      slotFreeDuringBackoff = await Promise.race([
        limiter.run('medicine.yale.edu', async () => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
      ]);
    };

    const page = await fetchPageWithPolicy('https://medicine.yale.edu/x', {
      ...base,
      limiter,
      request,
      sleep,
    });

    expect(page.html).toBe('body');
    expect(slotFreeDuringBackoff).toBe(true);
  });
});
