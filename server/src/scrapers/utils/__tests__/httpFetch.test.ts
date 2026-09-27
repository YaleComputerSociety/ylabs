import { describe, it, expect, vi } from 'vitest';
import {
  fetchPageWithPolicy,
  HostRateLimiter,
  POLICY_FETCH_BENCHMARK_NAMESPACE,
  type HttpRequestFn,
} from '../httpFetch';
import {
  BenchmarkReplayNetworkError,
  beginBenchmarkCapture,
  beginBenchmarkReplay,
  finishBenchmarkCapture,
  finishBenchmarkReplay,
} from '../../snapshotBenchmarkMode';

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

  it('applies the per-host override interval to rate-limited Yale medical hosts', async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const limiter = new HostRateLimiter({
      maxConcurrency: 8,
      minIntervalMs: 0,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
    await limiter.run('medicine.yale.edu', async () => true);
    await limiter.run('medicine.yale.edu', async () => true);
    expect(sleeps).toEqual([400]);
  });

  it('caps a rate-limited host below a looser configured concurrency', async () => {
    const limiter = new HostRateLimiter({
      maxConcurrency: 8,
      minIntervalMs: 0,
      sleep: async () => {},
    });
    let active = 0;
    let peak = 0;
    const task = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active -= 1;
      return true;
    };
    await Promise.all(Array.from({ length: 6 }, () => limiter.run('ysph.yale.edu', task)));
    expect(peak).toBe(2);
  });

  it('spaces overlapping same-host runs instead of releasing them in bursts', async () => {
    vi.useFakeTimers();
    try {
      const limiter = new HostRateLimiter({ maxConcurrency: 8, minIntervalMs: 0 });
      const startedAt = Date.now();
      const starts: number[] = [];
      const jobs = Array.from({ length: 4 }, () =>
        limiter.run('medicine.yale.edu', async () => {
          starts.push(Date.now() - startedAt);
        }),
      );
      await vi.advanceTimersByTimeAsync(5_000);
      await Promise.all(jobs);
      expect(starts).toEqual([0, 400, 800, 1200]);
    } finally {
      vi.useRealTimers();
    }
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

  it('keys the limiter by hostname so an explicit port still gets the host override', async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const limiter = new HostRateLimiter({
      maxConcurrency: 8,
      minIntervalMs: 0,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
    const request: HttpRequestFn = async (url) => ({ status: 200, data: 'ok', finalUrl: url });
    await fetchPageWithPolicy('https://medicine.yale.edu/x', { ...base, limiter, request });
    await fetchPageWithPolicy('https://medicine.yale.edu:8443/y', { ...base, limiter, request });
    expect(sleeps).toEqual([400]);
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

describe('fetchPageWithPolicy under a benchmark', () => {
  const options = (request: HttpRequestFn) => ({
    assertUrl: passthroughAssert,
    request,
    sleep: noSleep,
    jitter: noJitter,
  });

  it('records a page during capture and serves it on replay without a request', async () => {
    beginBenchmarkCapture();
    const live = vi.fn(() => ok('<html>frozen</html>'));
    await fetchPageWithPolicy('https://lab.example.edu/x', options(live));
    const pages = finishBenchmarkCapture();
    expect(pages.map((page) => page.sourceName)).toEqual([POLICY_FETCH_BENCHMARK_NAMESPACE]);

    beginBenchmarkReplay(pages);
    const replayRequest = vi.fn(() => ok('<html>live</html>'));
    try {
      const page = await fetchPageWithPolicy('https://lab.example.edu/x', options(replayRequest));
      expect(page.html).toBe('<html>frozen</html>');
      expect(replayRequest).not.toHaveBeenCalled();
    } finally {
      expect(finishBenchmarkReplay()).toMatchObject({ pagesServed: 1, pagesMissed: 0 });
    }
  });

  it('freezes a failed status during capture and replays the same failure as a served page', async () => {
    beginBenchmarkCapture();
    const live = vi.fn(() => Promise.resolve({ status: 404, data: '', finalUrl: '' }));
    await expect(
      fetchPageWithPolicy('https://lab.example.edu/people', options(live)),
    ).rejects.toThrow('Request failed with status code 404');
    const pages = finishBenchmarkCapture();
    expect(pages).toHaveLength(1);

    beginBenchmarkReplay(pages);
    const replayRequest = vi.fn(() => ok());
    try {
      await expect(
        fetchPageWithPolicy('https://lab.example.edu/people', options(replayRequest)),
      ).rejects.toThrow('Request failed with status code 404');
      expect(replayRequest).not.toHaveBeenCalled();
    } finally {
      expect(finishBenchmarkReplay()).toMatchObject({
        pagesServed: 1,
        pagesMissed: 0,
        networkBlocks: 0,
      });
    }
  });

  it('refuses a page the capture never saw instead of fetching it', async () => {
    beginBenchmarkReplay([]);
    const replayRequest = vi.fn(() => ok());
    try {
      await expect(
        fetchPageWithPolicy('https://lab.example.edu/unseen', options(replayRequest)),
      ).rejects.toBeInstanceOf(BenchmarkReplayNetworkError);
      expect(replayRequest).not.toHaveBeenCalled();
    } finally {
      expect(finishBenchmarkReplay()).toMatchObject({ pagesServed: 0, pagesMissed: 1 });
    }
  });
});
