import { describe, expect, it } from 'vitest';
import { AxiosResponse } from 'axios';

import { getRateLimitDetail } from '../httpStatusEvents';

describe('httpStatusEvents', () => {
  it('builds rate-limit detail from server payload retry metadata', () => {
    const response = {
      data: {
        error: 'Too many write requests, please try again later.',
        retryAfterSeconds: 75,
      },
      headers: {},
      config: { url: '/listings' },
    } as AxiosResponse;

    expect(getRateLimitDetail(response)).toEqual({
      status: 429,
      message: 'Too many write requests, please try again later.',
      retryAfterSeconds: 75,
      path: '/listings',
    });
  });

  it('falls back to Retry-After response header', () => {
    const response = {
      data: {},
      headers: { 'retry-after': '30' },
      config: { url: '/research' },
    } as unknown as AxiosResponse;

    expect(getRateLimitDetail(response)).toMatchObject({
      status: 429,
      message: 'Too many requests. Please try again later.',
      retryAfterSeconds: 30,
      path: '/research',
    });
  });
});
