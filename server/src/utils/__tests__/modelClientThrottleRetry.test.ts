import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MODEL_THROTTLE_BASE_DELAY_MS,
  MODEL_THROTTLE_MAX_ATTEMPTS,
  MODEL_THROTTLE_MAX_TOTAL_WAIT_MS,
  type ModelRequest,
  type ModelUsageRecord,
  postChatCompletion,
  postEmbedding,
  restoreDefaultModelUsageSink,
  retryAfterMs,
  setModelUsageSink,
  throttleDelayMs,
  withoutModelCalls,
} from '../modelClient';

vi.mock('axios', () => ({ default: { post: vi.fn() } }));

const post = vi.mocked(axios.post);

const ok = { data: { choices: [{ message: { content: '{}' } }], usage: {} }, headers: {} };

const httpError = (status: number, headers: Record<string, unknown> = {}) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, headers },
  });

const request = (overrides: Partial<ModelRequest> = {}): ModelRequest => ({
  caller: 'card-synthesis',
  apiKey: 'sk-test',
  timeoutMs: 30_000,
  body: { model: 'gpt-5-mini', messages: [] },
  ...overrides,
});

const settle = async <T>(promise: Promise<T>) => {
  const outcome = promise.then(
    (value) => ({ value, error: undefined as unknown }),
    (error: unknown) => ({ value: undefined, error }),
  );
  await vi.runAllTimersAsync();
  return outcome;
};

describe('model call backoff on 429 and 503 (#6253)', () => {
  let recorded: ModelUsageRecord[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    recorded = [];
    setModelUsageSink(async (record) => {
      recorded.push(record);
    });
    post.mockReset();
  });

  afterEach(() => {
    restoreDefaultModelUsageSink();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('waits the Retry-After the API asks for, then returns the retried response', async () => {
    post.mockRejectedValueOnce(httpError(429, { 'retry-after': '2' })).mockResolvedValueOnce(ok);

    const pending = postChatCompletion(request());
    await vi.advanceTimersByTimeAsync(1_999);
    expect(post).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe(ok);

    expect(post).toHaveBeenCalledTimes(2);
    expect(recorded.map((record) => record.succeeded)).toEqual([false, true]);
  });

  it('prefers the millisecond Retry-After header the API also sends', async () => {
    post.mockRejectedValueOnce(httpError(429, { 'retry-after-ms': '750', 'retry-after': '5' }));
    post.mockResolvedValueOnce(ok);

    const pending = postChatCompletion(request());
    await vi.advanceTimersByTimeAsync(749);
    expect(post).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe(ok);
  });

  it('backs off within the base delay when a 429 names no Retry-After', async () => {
    vi.mocked(Math.random).mockReturnValue(0.999);
    post.mockRejectedValueOnce(httpError(429)).mockResolvedValueOnce(ok);

    const pending = postChatCompletion(request());
    await vi.advanceTimersByTimeAsync(MODEL_THROTTLE_BASE_DELAY_MS - 2);
    expect(post).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    await expect(pending).resolves.toBe(ok);
  });

  it('retries a 503 the same way as a 429', async () => {
    post.mockRejectedValueOnce(httpError(503, { 'retry-after': '1' })).mockResolvedValueOnce(ok);

    const { value } = await settle(postChatCompletion(request()));

    expect(value).toBe(ok);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('stops at the attempt cap and throws the last throttle', async () => {
    const throttle = httpError(429, { 'retry-after': '1' });
    post.mockRejectedValue(throttle);

    const { error } = await settle(postChatCompletion(request()));

    expect(error).toBe(throttle);
    expect(post).toHaveBeenCalledTimes(3);
    expect(MODEL_THROTTLE_MAX_ATTEMPTS).toBe(3);
    expect(recorded).toHaveLength(MODEL_THROTTLE_MAX_ATTEMPTS);
    expect(recorded.every((record) => !record.succeeded)).toBe(true);
  });

  it('throws a non-retryable status at once', async () => {
    for (const status of [400, 401, 403, 404, 500]) {
      post.mockReset();
      const failure = httpError(status, { 'retry-after': '1' });
      post.mockRejectedValue(failure);

      const { error } = await settle(postChatCompletion(request()));

      expect(error).toBe(failure);
      expect(post).toHaveBeenCalledTimes(1);
    }
  });

  it('throws a network error with no response at once', async () => {
    const failure = new Error('socket hang up');
    post.mockRejectedValue(failure);

    const { error } = await settle(postChatCompletion(request()));

    expect(error).toBe(failure);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('never waits past the total-wait cap, even when the API asks for longer', async () => {
    const throttle = httpError(429, {
      'retry-after': String(MODEL_THROTTLE_MAX_TOTAL_WAIT_MS / 1_000 + 1),
    });
    post.mockRejectedValue(throttle);
    const startedAt = Date.now();

    const { error } = await settle(postChatCompletion(request()));

    expect(error).toBe(throttle);
    expect(post).toHaveBeenCalledTimes(1);
    expect(Date.now() - startedAt).toBe(0);
  });

  it('bounds the summed waits across every retry by the total-wait cap', async () => {
    const throttle = httpError(429, { 'retry-after': '20' });
    post.mockRejectedValue(throttle);
    const startedAt = Date.now();

    const { error } = await settle(postChatCompletion(request()));

    expect(error).toBe(throttle);
    expect(post).toHaveBeenCalledTimes(2);
    expect(Date.now() - startedAt).toBeLessThanOrEqual(MODEL_THROTTLE_MAX_TOTAL_WAIT_MS);
  });

  it('leaves a caller that opts out to handle the throttle itself', async () => {
    const throttle = httpError(429, { 'retry-after': '1' });
    post.mockRejectedValue(throttle);

    const { error } = await settle(postEmbedding(request({ retryWhenThrottled: false })));

    expect(error).toBe(throttle);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('still refuses before any attempt inside a model-free scope', async () => {
    post.mockResolvedValue(ok);

    const { error } = await settle(
      withoutModelCalls('materialize', () => postChatCompletion(request())),
    );

    expect((error as Error).name).toBe('ModelCallRefusedError');
    expect(post).not.toHaveBeenCalled();
  });
});

describe('retryAfterMs', () => {
  it('reads seconds, milliseconds and an HTTP date, and ignores junk', () => {
    const now = Date.parse('2026-11-14T12:00:00Z');
    expect(retryAfterMs({ 'retry-after': '3' }, now)).toBe(3_000);
    expect(retryAfterMs({ 'retry-after-ms': '120' }, now)).toBe(120);
    expect(retryAfterMs({ 'retry-after': 'Sat, 14 Nov 2026 12:00:05 GMT' }, now)).toBe(5_000);
    expect(retryAfterMs({ 'retry-after': 'Sat, 14 Nov 2026 11:59:00 GMT' }, now)).toBe(0);
    expect(retryAfterMs({ 'retry-after': 'soon' }, now)).toBeUndefined();
    expect(retryAfterMs(undefined, now)).toBeUndefined();
  });
});

describe('throttleDelayMs', () => {
  it('doubles the full-jitter ceiling on each retry and adds only a small jitter to a server delay', () => {
    expect(throttleDelayMs(1, undefined, () => 0.999)).toBeLessThan(MODEL_THROTTLE_BASE_DELAY_MS);
    expect(throttleDelayMs(2, undefined, () => 0.999)).toBeLessThan(
      MODEL_THROTTLE_BASE_DELAY_MS * 2,
    );
    expect(throttleDelayMs(2, undefined, () => 0)).toBe(0);
    expect(throttleDelayMs(1, 2_000, () => 0)).toBe(2_000);
    expect(throttleDelayMs(1, 2_000, () => 0.999)).toBeLessThan(2_250);
  });
});
