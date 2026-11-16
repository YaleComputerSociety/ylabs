import http from 'node:http';
import net from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));

vi.mock('node:child_process', () => ({ execFile: mocks.execFile }));

import { createScraplingRenderedFetcher, type RenderedFetchProxyPacing } from '../../renderedFetch';
import type { HostSlotLimiter } from '../hostConcurrencyLimiter';
import { resetHostPauseStateForTests } from '../hostPauseState';
import { hostCrawlDelayMs, resetHostCrawlDelaysForTests } from '../hostThrottlePolicy';
import { isNotObserved } from '../notObserved';
import { RobotsDisallowedError } from '../robotsFetchHook';
import {
  resetRobotsPolicyCacheForTests,
  robotsPolicyFor,
  type RobotsTxtFetcher,
} from '../robotsPolicyCache';
import {
  startSsrfGuardedForwardProxy,
  type SsrfGuardedForwardProxy,
} from '../ssrfGuardedForwardProxy';

const SEED_HOST = '8.8.8.8';
const ASSET_HOST = 'assets.test';
const TUNNEL_HOST = 'tunnel.test';
const POLITE_ROBOTS = 'User-agent: *\nDisallow: /private/\nCrawl-delay: 5\n';

const robotsFetcherFor = (bodies: Record<string, string>) => {
  const asked: string[] = [];
  const fetcher: RobotsTxtFetcher = async (host) => {
    asked.push(host);
    const body = bodies[host];
    return body === undefined ? { status: 404, body: '' } : { status: 200, body };
  };
  return { asked, fetcher };
};

const recordingSlots = () => {
  const taken: string[] = [];
  const limiter: HostSlotLimiter = {
    acquire: async (host) => {
      taken.push(host);
      return () => undefined;
    },
  };
  return { taken, limiter };
};

beforeEach(() => {
  mocks.execFile.mockReset();
  resetHostPauseStateForTests();
  resetRobotsPolicyCacheForTests();
  resetHostCrawlDelaysForTests();
});

describe('the rendered fetch reads robots.txt for its seed (#6340)', () => {
  const proxyStub = () => {
    const started: RenderedFetchProxyPacing[] = [];
    return {
      started,
      start: vi.fn(async (pacing: RenderedFetchProxyPacing) => {
        started.push(pacing);
        return {
          url: 'http://127.0.0.1:18080',
          forwardedHosts: () => [SEED_HOST],
          pacingRefusals: () => [],
          robotsRefusals: () => [],
          close: async () => {},
        };
      }),
    };
  };

  const fetcherWith = (
    proxy: ReturnType<typeof proxyStub>,
    robotsTxtFetcher: RobotsTxtFetcher,
    hostSlots: HostSlotLimiter,
  ) =>
    createScraplingRenderedFetcher({
      enabled: true,
      pythonCommand: 'python3',
      bridgePath: 'scraplingBridge.py',
      seedRedirectCheck: async () => false,
      hostSlots,
      robotsTxtFetcher,
      startForwardProxy: proxy.start,
      retry: { sleep: async () => {}, jitter: () => 0, maxRetries: 0 },
      requestLog: null,
    })!;

  it('refuses a disallowed seed before it takes a slot or starts a render, as not observed', async () => {
    const robots = robotsFetcherFor({ [SEED_HOST]: POLITE_ROBOTS });
    const slots = recordingSlots();
    const proxy = proxyStub();

    const failure = await fetcherWith(
      proxy,
      robots.fetcher,
      slots.limiter,
    )({ url: `https://${SEED_HOST}/private/page` }).catch((e) => e);

    expect(failure).toBeInstanceOf(RobotsDisallowedError);
    expect(isNotObserved(failure)).toBe(true);
    expect(slots.taken).toEqual([]);
    expect(proxy.start).not.toHaveBeenCalled();
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('records the seed host Crawl-delay before it takes the slot, and renders an allowed seed', async () => {
    const robots = robotsFetcherFor({ [SEED_HOST]: POLITE_ROBOTS });
    const delayWhenSlotTaken: number[] = [];
    const hostSlots: HostSlotLimiter = {
      acquire: async (host) => {
        delayWhenSlotTaken.push(hostCrawlDelayMs(host));
        return () => undefined;
      },
    };
    mocks.execFile.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(null, {
        stdout: JSON.stringify({ url: `https://${SEED_HOST}/public`, statusCode: 200, html: '<html>ok</html>' }),
        stderr: '',
      });
    });
    const proxy = proxyStub();

    await fetcherWith(proxy, robots.fetcher, hostSlots)({ url: `https://${SEED_HOST}/public` });

    expect(robots.asked).toEqual([SEED_HOST]);
    expect(delayWhenSlotTaken).toEqual([5_000]);
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
    expect(proxy.started[0].robotsTxtFetcher).toBe(robots.fetcher);
  });
});

describe('the rendered fetch proxy reads robots.txt for subresources (#6340)', () => {
  let upstream: http.Server;
  let upstreamPort: number;
  let hits: string[];
  let proxy: SsrfGuardedForwardProxy | undefined;

  beforeEach(async () => {
    hits = [];
    upstream = http.createServer((req, res) => {
      hits.push(req.url ?? '');
      res.end('upstream body');
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    upstreamPort = (upstream.address() as net.AddressInfo).port;
  });

  afterEach(async () => {
    await proxy?.close();
    proxy = undefined;
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  const startProxy = async (
    robotsTxtFetcher: RobotsTxtFetcher,
    hostSlots: HostSlotLimiter,
    heldHost?: string,
  ) => {
    proxy = await startSsrfGuardedForwardProxy({
      forwardablePorts: new Set([upstreamPort]),
      resolveTarget: async () => '127.0.0.1',
      hostSlots,
      robotsTxtFetcher,
      requestLog: null,
      ...(heldHost ? { heldHost } : {}),
    });
    return proxy;
  };

  const getThroughProxy = (host: string, path: string) =>
    new Promise<{ status?: number; body: string }>((resolve, reject) => {
      const proxyUrl = new URL(proxy!.url);
      const req = http.request(
        {
          host: proxyUrl.hostname,
          port: proxyUrl.port,
          path: `http://${host}:${upstreamPort}${path}`,
          method: 'GET',
          headers: { host: `${host}:${upstreamPort}` },
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode, body }));
        },
      );
      req.on('error', reject);
      req.end();
    });

  const openTunnel = (authority: string) =>
    new Promise<string>((resolve, reject) => {
      const proxyUrl = new URL(proxy!.url);
      const socket = net.connect(Number(proxyUrl.port), proxyUrl.hostname, () => {
        socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
      });
      let buffer = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => {
        buffer += chunk;
        if (buffer.includes('\r\n\r\n')) {
          resolve(buffer.split('\r\n')[0]);
          socket.destroy();
        }
      });
      socket.on('error', reject);
    });

  it('refuses a disallowed subresource with a 403 before it takes a slot or reaches the host', async () => {
    const robots = robotsFetcherFor({ [ASSET_HOST]: POLITE_ROBOTS });
    const slots = recordingSlots();
    await startProxy(robots.fetcher, slots.limiter);

    const response = await getThroughProxy(ASSET_HOST, '/private/script.js');

    expect(response.status).toBe(403);
    expect(hits).toEqual([]);
    expect(slots.taken).toEqual([]);
    expect(proxy!.robotsRefusals()).toEqual([expect.any(RobotsDisallowedError)]);
    expect(proxy!.pacingRefusals()).toEqual([]);
  });

  it('forwards an allowed subresource after reading robots.txt once', async () => {
    const robots = robotsFetcherFor({ [ASSET_HOST]: POLITE_ROBOTS });
    const slots = recordingSlots();
    await startProxy(robots.fetcher, slots.limiter);

    const first = await getThroughProxy(ASSET_HOST, '/public/one.css');
    const second = await getThroughProxy(ASSET_HOST, '/public/two.css');

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(hits).toEqual(['/public/one.css', '/public/two.css']);
    expect(robots.asked).toEqual([ASSET_HOST]);
    expect(slots.taken).toEqual([ASSET_HOST, ASSET_HOST]);
    expect(hostCrawlDelayMs(ASSET_HOST)).toBe(5_000);
    expect(proxy!.robotsRefusals()).toEqual([]);
  });

  it('reads only the cached policy for the seed host, never a robots.txt request on its held slot', async () => {
    const robots = robotsFetcherFor({ [SEED_HOST]: POLITE_ROBOTS });
    await robotsPolicyFor(SEED_HOST, robots.fetcher);
    robots.asked.length = 0;
    const slots = recordingSlots();
    await startProxy(robots.fetcher, slots.limiter, SEED_HOST);

    const refused = await getThroughProxy(SEED_HOST, '/private/frame.html');
    const allowed = await getThroughProxy(SEED_HOST, '/public/frame.html');

    expect([refused.status, allowed.status]).toEqual([403, 200]);
    expect(hits).toEqual(['/public/frame.html']);
    expect(robots.asked).toEqual([]);
    expect(slots.taken).toEqual([]);
  });

  it('never sends a robots.txt read for the seed host when its policy is not cached', async () => {
    const robots = robotsFetcherFor({ [SEED_HOST]: POLITE_ROBOTS });
    const slots = recordingSlots();
    await startProxy(robots.fetcher, slots.limiter, SEED_HOST);

    const response = await getThroughProxy(SEED_HOST, '/private/frame.html');

    expect(response.status).toBe(200);
    expect(robots.asked).toEqual([]);
    expect(slots.taken).toEqual([]);
  });

  it('records a tunnelled host Crawl-delay before the tunnel takes its slot', async () => {
    const robots = robotsFetcherFor({ [TUNNEL_HOST]: POLITE_ROBOTS });
    const delayWhenSlotTaken: number[] = [];
    const hostSlots: HostSlotLimiter = {
      acquire: async (host) => {
        delayWhenSlotTaken.push(hostCrawlDelayMs(host));
        return () => undefined;
      },
    };
    await startProxy(robots.fetcher, hostSlots);

    const status = await openTunnel(`${TUNNEL_HOST}:${upstreamPort}`);

    expect(status).toContain(' 200 ');
    expect(robots.asked).toEqual([TUNNEL_HOST]);
    expect(delayWhenSlotTaken).toEqual([5_000]);
  });
});
