import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HTTP_AUTH_REQUIRED_EVENT,
  HTTP_RATE_LIMITED_EVENT,
  type HttpRateLimitDetail,
} from '../httpStatusEvents';
import { keepalivePut } from '../keepalivePut';

const respondWith = (status: number, headers: Record<string, string> = {}, body?: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(body === undefined ? null : JSON.stringify(body), { status, headers }),
      ),
  );

describe('keepalivePut http status events', () => {
  const authRequired = vi.fn();
  const rateLimited = vi.fn<(detail: HttpRateLimitDetail) => void>();
  const onAuthRequired = () => authRequired();
  const onRateLimited = (event: Event) =>
    rateLimited((event as CustomEvent<HttpRateLimitDetail>).detail);

  beforeEach(() => {
    authRequired.mockReset();
    rateLimited.mockReset();
    window.addEventListener(HTTP_AUTH_REQUIRED_EVENT, onAuthRequired);
    window.addEventListener(HTTP_RATE_LIMITED_EVENT, onRateLimited);
  });

  afterEach(() => {
    window.removeEventListener(HTTP_AUTH_REQUIRED_EVENT, onAuthRequired);
    window.removeEventListener(HTTP_RATE_LIMITED_EVENT, onRateLimited);
    vi.unstubAllGlobals();
  });

  it('announces a sign-in prompt on a 401 and still rejects', async () => {
    respondWith(401);
    await expect(keepalivePut('/synthetic', { note: 'x' })).rejects.toThrow('401');
    expect(authRequired).toHaveBeenCalledTimes(1);
    expect(rateLimited).not.toHaveBeenCalled();
  });

  it('announces a rate limit on a 429 using the Retry-After header and the server message', async () => {
    respondWith(429, { 'retry-after': '30' }, { error: 'Slow down, synthetic.' });
    await expect(keepalivePut('/synthetic', { note: 'x' })).rejects.toThrow('429');
    expect(rateLimited).toHaveBeenCalledWith({
      message: 'Slow down, synthetic.',
      retryAfterSeconds: 30,
    });
  });

  it('falls back to the body retry delay and a default message without the header', async () => {
    respondWith(429, {}, { retryAfterSeconds: 5 });
    await expect(keepalivePut('/synthetic', { note: 'x' })).rejects.toThrow('429');
    expect(rateLimited).toHaveBeenCalledWith({
      message: 'Too many requests.',
      retryAfterSeconds: 5,
    });
  });

  it('announces nothing for a server error or a success', async () => {
    respondWith(500);
    await expect(keepalivePut('/synthetic', { note: 'x' })).rejects.toThrow('500');
    respondWith(204);
    await expect(keepalivePut('/synthetic', { note: 'x' })).resolves.toBeUndefined();
    expect(authRequired).not.toHaveBeenCalled();
    expect(rateLimited).not.toHaveBeenCalled();
  });
});
