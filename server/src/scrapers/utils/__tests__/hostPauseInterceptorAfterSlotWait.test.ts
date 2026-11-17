import http from 'node:http';
import type { AddressInfo } from 'node:net';
import axios from 'axios';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { hostPauseInErrorChain } from '../hostPause';
import { fetchPageWithPolicy, HostRateLimiter } from '../httpFetch';
import { recordHostBackoff, resetHostPauseStateForTests } from '../hostPauseState';
import { installScraperFetchHooks } from '../scraperFetchHooks';

let server: http.Server;
let port: number;
let requests = 0;
const release = vi.fn();

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    requests += 1;
    res.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  port = (server.address() as AddressInfo).port;
  installScraperFetchHooks({
    validatorCache: false,
    hostSlotLimiter: {
      acquire: async (host) => {
        await recordHostBackoff(host, { status: 429 });
        return release;
      },
    },
  });
});

afterAll(async () => {
  resetHostPauseStateForTests();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('with the scraper fetch hooks installed, a pause recorded during the slot wait refuses the request (#6335)', () => {
  it('refuses a host another process paused while the request waited, releasing the slot', async () => {
    const error = await axios.get(`http://127.0.0.1:${port}/page`).catch((caught) => caught);

    expect(hostPauseInErrorChain(error)).toBeDefined();
    expect(requests).toBe(0);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('covers fetchPageWithPolicy too, whose machine-wide slot the interceptor takes', async () => {
    release.mockClear();
    resetHostPauseStateForTests();

    const error = await fetchPageWithPolicy(`http://127.0.0.1:${port}/policy`, {
      limiter: new HostRateLimiter({ minIntervalMs: 0 }),
      assertUrl: async (url) => new URL(url),
      maxRetries: 0,
    }).catch((caught: unknown) => caught);

    expect(hostPauseInErrorChain(error)).toBeDefined();
    expect(requests).toBe(0);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
