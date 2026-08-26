import { describe, it, expect, vi } from 'vitest';
import { fetchPageWithPolicy, HostRateLimiter, type HttpRequestFn } from '../httpFetch';

const passthroughAssert = async (url: string) => ({ toString: () => url });
const noSleep = vi.fn(async () => {});
const noJitter = () => 0;

function ok(
  data = '<html>ok</html>',
  finalUrl = 'https://lab.example.edu/x',
): ReturnType<HttpRequestFn> {
  return Promise.resolve({ status: 200, data, finalUrl });
}

describe('HostRateLimiter', () => {
  it('caps concurrency per host', async () => {
    const limiter = new HostRateLimiter({
      maxConcurrency: 1,
      minIntervalMs: 0,
      sleep: async () => {},
    });
    let active = 0;
    let peak = 0;
    const task = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return true;
    };
    await Promise.all([limiter.run('h', task), limiter.run('h', task), limiter.run('h', task)]);
    expect(peak).toBe(1);
  });

  it('enforces a minimum interval between same-host starts', async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const limiter = new HostRateLimiter({
      maxConcurrency: 4,
      minIntervalMs: 1000,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
    await limiter.run('h', async () => true);
    await limiter.run('h', async () => true);
    expect(sleeps).toEqual([1000]);
  });

  it('does not throttle across different hosts', async () => {
    const sleeps: number[] = [];
    const limiter = new HostRateLimiter({
      maxConcurrency: 1,
      minIntervalMs: 1000,
      now: () => 0,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await limiter.run('a', async () => true);
    await limiter.run('b', async () => true);
    expect(sleeps).toEqual([]);
  });
});

describe('fetchPageWithPolicy', () => {
  const base = {
    assertUrl: passthroughAssert,
    limiter: new HostRateLimiter({ minIntervalMs: 0, sleep: async () => {} }),
    sleep: noSleep,
    jitter: noJitter,
  };

  it('returns the page body on a 2xx response', async () => {
    const request = vi.fn(() => ok());
    const page = await fetchPageWithPolicy('https://lab.example.edu/x', { ...base, request });
    expect(page).toEqual({
      url: 'https://lab.example.edu/x',
      html: '<html>ok</html>',
      status: 200,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('retries a 403 with backoff and then succeeds', async () => {
    const sleep = vi.fn(async () => {});
    const request = vi
      .fn<HttpRequestFn>()
      .mockResolvedValueOnce({ status: 403, data: '', finalUrl: 'u' })
      .mockResolvedValueOnce({ status: 403, data: '', finalUrl: 'u' })
      .mockResolvedValueOnce({ status: 200, data: 'body', finalUrl: 'u' });
    const page = await fetchPageWithPolicy('https://lab.example.edu/x', {
      ...base,
      request,
      sleep,
    });
    expect(page.html).toBe('body');
    expect(request).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-retryable 404', async () => {
    const request = vi.fn(() => Promise.resolve({ status: 404, data: '', finalUrl: 'u' }));
    await expect(
      fetchPageWithPolicy('https://lab.example.edu/x', { ...base, request }),
    ).rejects.toThrow('status code 404');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('honors an explicit Retry-After delay', async () => {
    const sleep = vi.fn(async () => {});
    const request = vi
      .fn<HttpRequestFn>()
      .mockResolvedValueOnce({ status: 429, data: '', finalUrl: 'u', retryAfterMs: 4321 })
      .mockResolvedValueOnce({ status: 200, data: 'body', finalUrl: 'u' });
    await fetchPageWithPolicy('https://lab.example.edu/x', { ...base, request, sleep });
    expect(sleep).toHaveBeenCalledWith(4321);
  });

  it('clamps a pathological Retry-After to maxBackoff', async () => {
    const sleep = vi.fn(async () => {});
    const request = vi
      .fn<HttpRequestFn>()
      .mockResolvedValueOnce({ status: 429, data: '', finalUrl: 'u', retryAfterMs: 86_400_000 })
      .mockResolvedValueOnce({ status: 200, data: 'body', finalUrl: 'u' });
    await fetchPageWithPolicy('https://lab.example.edu/x', {
      ...base,
      request,
      sleep,
      maxBackoffMs: 8_000,
    });
    expect(sleep).toHaveBeenCalledWith(8_000);
  });

  it('throws after exhausting retries on a persistent 403', async () => {
    const request = vi.fn(() => Promise.resolve({ status: 403, data: '', finalUrl: 'u' }));
    await expect(
      fetchPageWithPolicy('https://lab.example.edu/x', { ...base, request, maxRetries: 2 }),
    ).rejects.toThrow('status code 403');
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('retries transient network errors and rethrows after the last attempt', async () => {
    const request = vi.fn(() => Promise.reject(new Error('ETIMEDOUT')));
    await expect(
      fetchPageWithPolicy('https://lab.example.edu/x', { ...base, request, maxRetries: 1 }),
    ).rejects.toThrow('ETIMEDOUT');
    expect(request).toHaveBeenCalledTimes(2);
  });
});
