import http from 'node:http';
import type { AddressInfo } from 'node:net';
import axios from 'axios';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  HostConcurrencyLimiter,
  installScraperHostConcurrencyInterceptor,
} from '../hostConcurrencyLimiter';
import { HOST_PAUSE_POLICY_FETCH, hostPauseInErrorChain } from '../hostPause';
import { SWEEP_PAGE_REUSE_HIT_KEY } from '../sweepPageReuseHit';
import {
  hostBackoffState,
  hostPausedUntil,
  recordHostBackoff,
  resetHostPauseStateForTests,
} from '../hostPauseState';

const NOTICE = '203.0.113.7 has been banned up to Fri, 20 Nov 2099 07:32:40 +0000';

let server: http.Server;
let port: number;
let requests = 0;
const seenPaths: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests += 1;
    seenPaths.push(`${req.headers.host?.split(':')[0]}${req.url}`);
    if (req.url === '/moved') {
      res.writeHead(302, { Location: `http://localhost:${port}/people/a` });
      res.end();
      return;
    }
    if (req.url === '/busy') {
      res.writeHead(429, { 'Content-Type': 'text/plain' });
      res.end('slow down');
      return;
    }
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end(NOTICE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  port = (server.address() as AddressInfo).port;
  installScraperHostConcurrencyInterceptor(
    new HostConcurrencyLimiter(4, { applyHostOverrides: false }),
  );
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  resetHostPauseStateForTests();
  requests = 0;
  seenPaths.length = 0;
});

describe('the scraper axios interceptor and a host that refuses', () => {
  it('pauses the host to a stated date and sends it nothing more', async () => {
    await expect(axios.get(`http://127.0.0.1:${port}/people/a`)).rejects.toMatchObject({
      response: { status: 403 },
    });
    expect(hostPausedUntil('127.0.0.1')).toEqual(new Date('2099-11-20T07:32:40Z'));

    const second = await axios.get(`http://127.0.0.1:${port}/people/b`).catch((error) => error);
    expect(hostPauseInErrorChain(second)).toBeDefined();
    expect(requests).toBe(1);
  });

  it('pauses a host that answers 429, for lanes that accept any status too', async () => {
    const response = await axios.get(`http://localhost:${port}/busy`, {
      validateStatus: () => true,
    });

    expect(response.status).toBe(429);
    expect(hostBackoffState('localhost')?.lastStatus).toBe(429);
  });

  it('records the pause under the host that answered when a redirect led there', async () => {
    await expect(axios.get(`http://127.0.0.1:${port}/moved`)).rejects.toMatchObject({
      response: { status: 403 },
    });

    expect(hostPausedUntil('localhost')).toBeDefined();
    expect(hostPausedUntil('127.0.0.1')).toBeUndefined();
  });

  it('refuses a redirect hop into a paused host before the hop is sent', async () => {
    recordHostBackoff('localhost', { status: 403, statedUntil: new Date('2099-01-01T00:00:00Z') });

    const failure = await axios
      .get(`http://127.0.0.1:${port}/moved`)
      .catch((error: unknown) => error);

    expect(hostPauseInErrorChain(failure)).toBeDefined();
    expect(seenPaths).toEqual(['127.0.0.1/moved']);
  });

  it('leaves a policy fetch response to the policy fetch, so a refusal is counted once', async () => {
    await axios
      .get(`http://127.0.0.1:${port}/busy`, { [HOST_PAUSE_POLICY_FETCH]: true } as object)
      .catch(() => undefined);

    expect(hostBackoffState('127.0.0.1')).toBeUndefined();
  });

  it('never counts a page reused from the sweep cache as the host answering', async () => {
    const handlers = (
      axios.interceptors.response as unknown as {
        handlers: Array<{ fulfilled?: (response: unknown) => unknown } | null>;
      }
    ).handlers;

    for (const handler of handlers) {
      handler?.fulfilled?.({
        status: 429,
        data: '',
        headers: {},
        config: { url: `http://127.0.0.1:${port}/people/a`, [SWEEP_PAGE_REUSE_HIT_KEY]: true },
      });
    }

    expect(hostBackoffState('127.0.0.1')).toBeUndefined();
  });
});
