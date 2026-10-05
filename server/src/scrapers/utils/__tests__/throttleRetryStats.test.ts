import { describe, expect, it, vi } from 'vitest';
import {
  fetchPageWithPolicy,
  HostRateLimiter,
  retryOnRetryableResultStatus,
  retryOnRetryableStatus,
  type HttpRequestFn,
} from '../httpFetch';
import {
  emptyThrottleRetryStats,
  withThrottleRetryFetchMetrics,
  withThrottleRetryScope,
} from '../throttleRetryStats';

const noSleep = async () => {};
const noJitter = () => 0;
const policy = { sleep: noSleep, jitter: noJitter };

function refusal(status: number, url = 'https://lab.example.edu/page') {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, headers: {} },
    config: { url },
  });
}

describe('throttle retry outcomes', () => {
  it('counts a refused request that a retry recovers', async () => {
    const send = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(refusal(403))
      .mockResolvedValueOnce('page');
    const { value, stats } = await withThrottleRetryScope(() =>
      retryOnRetryableStatus(send, policy),
    );
    expect(value).toBe('page');
    expect(stats).toEqual({ refused: 1, recovered: 1, exhausted: 0, retries: 1 });
  });

  it('counts a request still refused once the budget is spent', async () => {
    const send = vi.fn<() => Promise<string>>().mockRejectedValue(refusal(429));
    const { value, stats } = await withThrottleRetryScope(() =>
      retryOnRetryableStatus(send, { ...policy, maxRetries: 2 }).catch(() => 'lost'),
    );
    expect(value).toBe('lost');
    expect(send).toHaveBeenCalledTimes(3);
    expect(stats).toEqual({ refused: 1, recovered: 0, exhausted: 1, retries: 2 });
  });

  it('counts nothing for a request that was never refused', async () => {
    const { stats } = await withThrottleRetryScope(async () => {
      await retryOnRetryableStatus(async () => 'page', policy);
      await retryOnRetryableStatus(() => Promise.reject(refusal(404)), policy).catch(() => null);
    });
    expect(stats).toEqual(emptyThrottleRetryStats());
  });

  it('counts fetchPageWithPolicy outcomes in the same scope', async () => {
    const request = vi
      .fn<HttpRequestFn>()
      .mockResolvedValueOnce({ status: 503, data: '', finalUrl: 'https://lab.example.edu/x' })
      .mockResolvedValueOnce({ status: 200, data: 'ok', finalUrl: 'https://lab.example.edu/x' });
    const { stats } = await withThrottleRetryScope(() =>
      fetchPageWithPolicy('https://lab.example.edu/x', {
        ...policy,
        request,
        assertUrl: async (url) => ({ toString: () => url }),
        limiter: new HostRateLimiter({ minIntervalMs: 0, sleep: noSleep }),
      }),
    );
    expect(stats).toEqual({ refused: 1, recovered: 1, exhausted: 0, retries: 1 });
  });

  it('keeps concurrent scopes apart', async () => {
    const recovered = withThrottleRetryScope(() =>
      retryOnRetryableStatus(
        vi.fn<() => Promise<string>>().mockRejectedValueOnce(refusal(403)).mockResolvedValue('ok'),
        policy,
      ),
    );
    const untouched = withThrottleRetryScope(() =>
      retryOnRetryableStatus(async () => 'ok', policy),
    );
    expect((await recovered).stats.recovered).toBe(1);
    expect((await untouched).stats).toEqual(emptyThrottleRetryStats());
  });
});

describe('retryOnRetryableResultStatus', () => {
  const classify = (result: { status?: number }) => ({
    status: result.status,
    succeeded: result.status === 200,
  });

  it('re-sends a result carrying a retryable status until it succeeds', async () => {
    const send = vi
      .fn<() => Promise<{ status?: number }>>()
      .mockResolvedValueOnce({ status: 403 })
      .mockResolvedValueOnce({ status: 200 });
    const { value, stats } = await withThrottleRetryScope(() =>
      retryOnRetryableResultStatus('lab.example.edu', send, classify, policy),
    );
    expect(value).toEqual({ status: 200 });
    expect(stats.recovered).toBe(1);
  });

  it('returns the last refused result once the budget is spent', async () => {
    const send = vi.fn<() => Promise<{ status?: number }>>().mockResolvedValue({ status: 429 });
    const { value, stats } = await withThrottleRetryScope(() =>
      retryOnRetryableResultStatus('lab.example.edu', send, classify, { ...policy, maxRetries: 1 }),
    );
    expect(value).toEqual({ status: 429 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(stats.exhausted).toBe(1);
  });

  it('does not re-send a non-retryable failure or a result without a status', async () => {
    const notFound = vi.fn(async () => ({ status: 404 }));
    const noStatus = vi.fn(async () => ({}));
    await retryOnRetryableResultStatus('lab.example.edu', notFound, classify, policy);
    await retryOnRetryableResultStatus('lab.example.edu', noStatus, classify, policy);
    expect(notFound).toHaveBeenCalledTimes(1);
    expect(noStatus).toHaveBeenCalledTimes(1);
  });

  it('gives a refusal-throttled host its larger budget', async () => {
    const send = vi.fn<() => Promise<{ status?: number }>>().mockResolvedValue({ status: 403 });
    await retryOnRetryableResultStatus('medicine.yale.edu', send, classify, policy);
    expect(send.mock.calls.length).toBeGreaterThan(4);
  });
});

describe('withThrottleRetryFetchMetrics', () => {
  it('attaches the counts only when a request was refused', () => {
    const result = { observationCount: 0 } as never;
    expect(withThrottleRetryFetchMetrics(result, emptyThrottleRetryStats())).toBe(result);
    const stats = { refused: 2, recovered: 1, exhausted: 1, retries: 5 };
    expect(withThrottleRetryFetchMetrics(result, stats).fetchMetrics?.throttleRetry).toEqual(stats);
  });
});
