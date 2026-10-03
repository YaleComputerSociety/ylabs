import { AxiosError, type AxiosAdapter, type AxiosResponse } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import client from '../axios';
import {
  HTTP_AUTH_REQUIRED_EVENT,
  HTTP_RATE_LIMITED_EVENT,
  type HttpRateLimitDetail,
} from '../httpStatusEvents';

const failingWith =
  (status: number, headers: Record<string, string> = {}, data: unknown = {}): AxiosAdapter =>
  async (config) => {
    const response = {
      status,
      statusText: '',
      headers,
      data,
      config,
    } as AxiosResponse;
    throw new AxiosError(`status ${status}`, AxiosError.ERR_BAD_REQUEST, config, null, response);
  };

const requestFailingWith = (...args: Parameters<typeof failingWith>) =>
  client.get('/synthetic-endpoint', { adapter: failingWith(...args) });

describe('axios client http status interceptor', () => {
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
  });

  it('announces a sign-in prompt on a 401 and still rejects the request', async () => {
    await expect(requestFailingWith(401)).rejects.toMatchObject({ response: { status: 401 } });
    expect(authRequired).toHaveBeenCalledTimes(1);
    expect(rateLimited).not.toHaveBeenCalled();
  });

  it('announces a rate limit on a 429 using the Retry-After header and the server message', async () => {
    await expect(
      requestFailingWith(429, { 'retry-after': '42' }, { error: 'Slow down, synthetic.' }),
    ).rejects.toMatchObject({ response: { status: 429 } });
    expect(rateLimited).toHaveBeenCalledWith({
      message: 'Slow down, synthetic.',
      retryAfterSeconds: 42,
    });
    expect(authRequired).not.toHaveBeenCalled();
  });

  it('falls back to the body retry delay and a default message on a 429 without the header', async () => {
    await expect(requestFailingWith(429, {}, { retryAfterSeconds: 7 })).rejects.toBeInstanceOf(
      AxiosError,
    );
    expect(rateLimited).toHaveBeenCalledWith({
      message: 'Too many requests.',
      retryAfterSeconds: 7,
    });
  });

  it('prefers the body retry delay when the Retry-After header is not a number', async () => {
    await expect(
      requestFailingWith(429, { 'retry-after': 'soon' }, { retryAfterSeconds: 9 }),
    ).rejects.toBeInstanceOf(AxiosError);
    expect(rateLimited).toHaveBeenCalledWith({
      message: 'Too many requests.',
      retryAfterSeconds: 9,
    });
  });

  it('announces nothing for a server error', async () => {
    await expect(requestFailingWith(500)).rejects.toMatchObject({ response: { status: 500 } });
    expect(authRequired).not.toHaveBeenCalled();
    expect(rateLimited).not.toHaveBeenCalled();
  });
});
