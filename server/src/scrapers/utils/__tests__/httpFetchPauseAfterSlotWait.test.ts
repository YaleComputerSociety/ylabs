import { afterEach, describe, expect, it, vi } from 'vitest';

import { HostPausedError } from '../hostPause';
import { recordHostBackoff, resetHostPauseStateForTests } from '../hostPauseState';
import { fetchPageWithPolicy, HostRateLimiter } from '../httpFetch';

const HOST = 'paced.example.org';
const URL_ON_HOST = `https://${HOST}/research`;

afterEach(() => resetHostPauseStateForTests());

describe('fetchPageWithPolicy re-checks the host pause after its slot wait (#6335)', () => {
  it('refuses a host another process paused while this request waited for its slot', async () => {
    const request = vi.fn(async () => ({
      status: 200,
      data: '<html>ok</html>',
      finalUrl: URL_ON_HOST,
    }));
    const limiter = new HostRateLimiter({
      minIntervalMs: 0,
      machineWide: () => ({
        acquire: async (host: string) => {
          await recordHostBackoff(host, { status: 429 });
          return () => {};
        },
      }),
    });

    const error = await fetchPageWithPolicy(URL_ON_HOST, {
      limiter,
      request,
      assertUrl: async (url) => new URL(url),
      maxRetries: 0,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HostPausedError);
    expect((error as HostPausedError).requestSent).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
});
