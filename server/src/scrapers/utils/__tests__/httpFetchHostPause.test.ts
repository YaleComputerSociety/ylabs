import { afterEach, describe, expect, it, vi } from 'vitest';

import { HostRateLimiter, fetchPageWithPolicy } from '../httpFetch';
import { HostPausedError } from '../hostPause';
import {
  hostBackoffState,
  hostPausedUntil,
  recordHostBackoff,
  resetHostPauseStateForTests,
} from '../hostPauseState';

const base = {
  assertUrl: async (url: string) => new URL(url),
  limiter: new HostRateLimiter({ minIntervalMs: 0, sleep: async () => {} }),
  sleep: async () => {},
  jitter: () => 0,
};
const ok = { status: 200, data: '<p>page</p>', finalUrl: '' };
const FUTURE = new Date('2099-11-20T07:32:40Z');
const stated = {
  status: 403,
  data: '203.0.113.7 has been banned up to Fri, 20 Nov 2099 07:32:40 +0000',
  finalUrl: 'https://dept.example.edu/people/a',
};

afterEach(() => resetHostPauseStateForTests());

describe('fetchPageWithPolicy and a host that refuses', () => {
  it('spends a plain 403 on its quick retries first, then pauses the host', async () => {
    const request = vi.fn(async () => ({ status: 403, data: 'Forbidden', finalUrl: '' }));

    await expect(
      fetchPageWithPolicy('https://dept.example.edu/people/a', { ...base, request, maxRetries: 2 }),
    ).rejects.toMatchObject({ name: 'HttpStatusError', status: 403 });

    expect(request).toHaveBeenCalledTimes(3);
    expect(hostPausedUntil('dept.example.edu')).toBeDefined();
  });

  it('recovers within its quick retries without pausing the host', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ status: 403, data: 'Forbidden', finalUrl: '' })
      .mockResolvedValueOnce(ok);

    await expect(
      fetchPageWithPolicy('https://dept.example.edu/people/a', { ...base, request }),
    ).resolves.toMatchObject({ status: 200 });
    expect(hostPausedUntil('dept.example.edu')).toBeUndefined();
  });

  it('pauses the host at once on a 429 whose Retry-After outlasts its quick retries', async () => {
    const request = vi.fn(async () => ({
      status: 429,
      data: '',
      finalUrl: '',
      retryAfterMs: 20 * 60_000,
    }));

    await expect(
      fetchPageWithPolicy('https://dept.example.edu/people/a', { ...base, request, maxRetries: 5 }),
    ).rejects.toBeInstanceOf(HostPausedError);
    expect(request).toHaveBeenCalledTimes(1);
    expect(hostBackoffState('dept.example.edu')?.lastStatus).toBe(429);
    expect((hostPausedUntil('dept.example.edu')?.getTime() ?? 0) - Date.now()).toBeGreaterThan(
      19 * 60_000,
    );
  });

  it('spends a plain 429 on its quick retries, then pauses the host', async () => {
    const request = vi.fn(async () => ({ status: 429, data: '', finalUrl: '' }));

    await expect(
      fetchPageWithPolicy('https://dept.example.edu/people/a', { ...base, request, maxRetries: 2 }),
    ).rejects.toMatchObject({ name: 'HttpStatusError', status: 429 });
    expect(request).toHaveBeenCalledTimes(3);
    expect(hostPausedUntil('dept.example.edu')).toBeDefined();
  });

  it('pauses to the date a refusal states and sends nothing more until then', async () => {
    const request = vi.fn(async () => stated);

    await expect(
      fetchPageWithPolicy('https://dept.example.edu/people/a', { ...base, request, maxRetries: 8 }),
    ).rejects.toBeInstanceOf(HostPausedError);
    await expect(
      fetchPageWithPolicy('https://www.dept.example.edu/people/b', { ...base, request }),
    ).rejects.toBeInstanceOf(HostPausedError);

    expect(request).toHaveBeenCalledTimes(1);
    expect(hostPausedUntil('dept.example.edu')).toEqual(FUTURE);
  });

  it('marks the refusal that started a pause as sent, and a later refusal of a paused host as not sent (#6195)', async () => {
    const request = vi.fn(async () => stated);

    await expect(
      fetchPageWithPolicy('https://dept.example.edu/people/a', { ...base, request }),
    ).rejects.toMatchObject({ name: 'HostPausedError', requestSent: true });
    await expect(
      fetchPageWithPolicy('https://dept.example.edu/people/b', { ...base, request }),
    ).rejects.toMatchObject({ name: 'HostPausedError', requestSent: false });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('records the pause under the host that answered after a redirect', async () => {
    const request = vi.fn(async () => stated);

    await expect(
      fetchPageWithPolicy('https://vanity.example.org/lab', { ...base, request }),
    ).rejects.toBeInstanceOf(HostPausedError);
    expect(hostPausedUntil('dept.example.edu')).toBeDefined();
    expect(hostPausedUntil('vanity.example.org')).toBeUndefined();
  });

  it('refuses a paused host under its www and trailing-dot spellings, and still fetches its subdomains', async () => {
    recordHostBackoff('dept.example.edu', { status: 403, statedUntil: FUTURE });
    const request = vi.fn(async () => ok);

    for (const url of ['https://www.dept.example.edu/a', 'https://dept.example.edu./b']) {
      await expect(fetchPageWithPolicy(url, { ...base, request })).rejects.toBeInstanceOf(
        HostPausedError,
      );
    }
    expect(request).not.toHaveBeenCalled();
    await expect(
      fetchPageWithPolicy('https://lab.dept.example.edu/c', { ...base, request }),
    ).resolves.toMatchObject({ status: 200 });
  });

  it('rethrows a pause the redirect hook raised instead of retrying it as a transport failure', async () => {
    const paused = new HostPausedError({ host: 'dept.example.edu', until: FUTURE });
    const request = vi.fn(async () => {
      throw Object.assign(new Error('Redirected request failed'), {
        cause: Object.assign(new Error('Redirected request failed'), { cause: paused }),
      });
    });

    await expect(
      fetchPageWithPolicy('https://vanity.example.org/lab', { ...base, request, maxRetries: 5 }),
    ).rejects.toBe(paused);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('fetches a host again once its pause has ended', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-13T12:00:00Z'), toFake: ['Date'] });
    try {
      recordHostBackoff('dept.example.edu', { status: 429 });
      const request = vi.fn(async () => ok);
      await expect(
        fetchPageWithPolicy('https://dept.example.edu/a', { ...base, request }),
      ).rejects.toBeInstanceOf(HostPausedError);

      vi.setSystemTime(new Date('2026-11-13T12:01:00Z'));
      await expect(
        fetchPageWithPolicy('https://dept.example.edu/a', { ...base, request }),
      ).resolves.toMatchObject({ status: 200 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a redirect hop into a paused host before that hop is sent', async () => {
    recordHostBackoff('dept.example.edu', { status: 403, statedUntil: FUTURE });
    const request = vi.fn(async (target: string) =>
      target.startsWith('https://vanity.example.org/')
        ? { status: 301, data: '', finalUrl: '', location: 'https://www.dept.example.edu/lab' }
        : ok,
    );

    await expect(
      fetchPageWithPolicy('https://vanity.example.org/lab', { ...base, request }),
    ).rejects.toBeInstanceOf(HostPausedError);
    expect(request.mock.calls.map(([target]) => target)).toEqual([
      'https://vanity.example.org/lab',
    ]);
  });
});
