import { describe, expect, it, vi } from 'vitest';
import { retryOnRetryableStatus } from '../httpFetch';
import { fetchFailureStatusCode } from '../fetchFailure';
import { BenchmarkReplayNetworkError } from '../../snapshotBenchmarkMode';

function statusRejection(status: number, headers: Record<string, unknown> = {}) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, headers },
  });
}

const fastPolicy = { sleep: vi.fn(async () => {}), jitter: () => 0 };

describe('retryOnRetryableStatus', () => {
  it('re-sends a request refused with a transient 403 and returns the page that follows', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(statusRejection(403))
      .mockResolvedValueOnce({ status: 200, data: '<html>index</html>' });
    const sleep = vi.fn(async (_ms: number) => {});

    const res = await retryOnRetryableStatus(send, { sleep, jitter: () => 0 });

    expect(res).toEqual({ status: 200, data: '<html>index</html>' });
    expect(send).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it('rethrows the final refusal unchanged after its retries, so the lane still records a 403', async () => {
    const send = vi.fn(async () => {
      throw statusRejection(403);
    });
    const sleep = vi.fn(async (_ms: number) => {});

    const failure = await retryOnRetryableStatus(send, { sleep, jitter: () => 0 }).catch(
      (error: unknown) => error,
    );

    expect(send).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000, 2000]);
    expect(fetchFailureStatusCode(failure)).toBe(403);
    expect((failure as Error).message).toBe('Request failed with status code 403');
  });

  it('waits the Retry-After interval when the host names one, capped at the backoff ceiling', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(statusRejection(429, { 'retry-after': '3' }))
      .mockRejectedValueOnce(statusRejection(429, { 'retry-after': '120' }))
      .mockResolvedValueOnce({ status: 200 });
    const sleep = vi.fn(async (_ms: number) => {});

    await retryOnRetryableStatus(send, { sleep, jitter: () => 0 });

    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([3000, 8000]);
  });

  it('does not re-send a non-retryable status', async () => {
    const send = vi.fn(async () => {
      throw statusRejection(404);
    });

    await expect(retryOnRetryableStatus(send, fastPolicy)).rejects.toThrow(/status code 404/);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not re-send a transport error or a benchmark replay refusal', async () => {
    const timeout = vi.fn(async () => {
      throw Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ETIMEDOUT' });
    });
    const replayRefusal = vi.fn(async () => {
      throw new BenchmarkReplayNetworkError();
    });

    await expect(retryOnRetryableStatus(timeout, fastPolicy)).rejects.toThrow(/timeout/);
    await expect(retryOnRetryableStatus(replayRefusal, fastPolicy)).rejects.toBeInstanceOf(
      BenchmarkReplayNetworkError,
    );
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(replayRefusal).toHaveBeenCalledTimes(1);
  });
});
