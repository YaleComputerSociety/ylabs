import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import axios, { type AxiosInstance } from 'axios';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachHttpValidatorCache, HttpValidatorStore } from '../httpValidatorCache';
import { HostSlotBroker } from '../hostSlotBroker';
import { HostConcurrencyLimiter } from '../hostConcurrencyLimiter';
import {
  BrokeredSweepPageClient,
  SWEEP_PAGE_REUSE_HOSTS,
  SWEEP_PAGE_REUSE_RESPONSE_HEADER,
  attachSweepPageReuse,
  isSweepPageReuseEnabledForChild,
  observeSweepPageReuse,
  resolveSweepPageReuseMaxBytes,
  sweepPageReuseKey,
  withSweepPageReuseFetchMetrics,
  withSweepPageReuseScope,
  withoutSweepPageReuse,
  type SweepPageReuseHandle,
  type SweepPageSource,
} from '../sweepPageReuse';
import { SweepPageStore, type SweepPageRecord } from '../sweepPageStore';

type Route = (req: http.IncomingMessage, res: http.ServerResponse) => void;

function html(body: string, headers: Record<string, string> = {}): Route {
  return (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
    res.end(body);
  };
}

function redirect(status: number, location: string): Route {
  return (_req, res) => {
    res.writeHead(status, { Location: location });
    res.end();
  };
}

let server: http.Server;
let baseUrl: string;
let routes: Record<string, Route>;
let hits: Record<string, number>;
let instance: AxiosInstance;
let store: SweepPageStore;
let handles: SweepPageReuseHandle[];

function storeSource(pageStore: SweepPageStore): SweepPageSource {
  return {
    lookup: async (key) => (key ? pageStore.get(key) : null),
    offer: (key, permanentRedirect, page) => {
      pageStore.put(key, permanentRedirect, page);
    },
  };
}

function attach(target: AxiosInstance = instance, source: SweepPageSource = storeSource(store)) {
  const handle = attachSweepPageReuse(target, { source, hosts: ['127.0.0.1'] });
  handles.push(handle);
  return handle;
}

beforeEach(async () => {
  routes = {};
  hits = {};
  handles = [];
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://fixture').pathname;
    hits[pathname] = (hits[pathname] ?? 0) + 1;
    const route = routes[pathname];
    if (route) route(req, res);
    else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  instance = axios.create();
  store = new SweepPageStore(64 * 1024 * 1024, ['127.0.0.1']);
});

afterEach(async () => {
  for (const handle of handles.splice(0)) handle.detach();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('attachSweepPageReuse', () => {
  it('serves a second GET of the same URL from the page fetched first, without asking the site', async () => {
    routes['/profile/a/'] = html('<h1>profile a</h1>');
    attach();

    const first = await instance.get(`${baseUrl}/profile/a/`);
    const second = await instance.get(`${baseUrl}/profile/a/#bio`);

    expect(hits['/profile/a/']).toBe(1);
    expect(second.status).toBe(200);
    expect(second.data).toBe(first.data);
    expect(first.headers[SWEEP_PAGE_REUSE_RESPONSE_HEADER]).toBeUndefined();
    expect(Date.parse(String(second.headers[SWEEP_PAGE_REUSE_RESPONSE_HEADER]))).not.toBeNaN();
    expect(second.request.res.responseUrl).toBe(`${baseUrl}/profile/a/`);
  });

  it('runs the caller transform on a reused page exactly as on a fetched one', async () => {
    routes['/data'] = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"faculty":[1,2]}');
    };
    attach();

    const first = await instance.get(`${baseUrl}/data`);
    const second = await instance.get(`${baseUrl}/data`);

    expect(hits['/data']).toBe(1);
    expect(second.data).toEqual({ faculty: [1, 2] });
    expect(second.data).toEqual(first.data);
  });

  it('never reuses a refusal or an error, and stores the first page that succeeds', async () => {
    let refusals = 1;
    routes['/profile/refused/'] = (req, res) => {
      if (refusals > 0) {
        refusals -= 1;
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      html('<h1>now served</h1>')(req, res);
    };
    routes['/rate-limited'] = (_req, res) => {
      res.writeHead(429);
      res.end();
    };
    attach();

    await expect(instance.get(`${baseUrl}/profile/refused/`)).rejects.toMatchObject({
      response: { status: 403 },
    });
    await expect(instance.get(`${baseUrl}/rate-limited`)).rejects.toMatchObject({
      response: { status: 429 },
    });
    await expect(instance.get(`${baseUrl}/rate-limited`)).rejects.toMatchObject({
      response: { status: 429 },
    });
    const served = await instance.get(`${baseUrl}/profile/refused/`);
    const reused = await instance.get(`${baseUrl}/profile/refused/`);

    expect(hits['/profile/refused/']).toBe(2);
    expect(hits['/rate-limited']).toBe(2);
    expect(reused.data).toBe(served.data);
    expect(reused.headers[SWEEP_PAGE_REUSE_RESPONSE_HEADER]).toBeDefined();
  });

  it('reuses a permanently redirected URL with its recorded final URL, and the final page directly', async () => {
    routes['/profile/slug/'] = redirect(301, '/ysm/profile/id/');
    routes['/ysm/profile/id/'] = redirect(308, '/profile/id/');
    routes['/profile/id/'] = html('<h1>final profile</h1>');
    attach();

    await instance.get(`${baseUrl}/profile/slug/`);
    const viaRedirect = await instance.get(`${baseUrl}/profile/slug/`);
    const direct = await instance.get(`${baseUrl}/profile/id/`);

    expect(hits).toMatchObject({ '/profile/slug/': 1, '/ysm/profile/id/': 1, '/profile/id/': 1 });
    expect(viaRedirect.request.res.responseUrl).toBe(`${baseUrl}/profile/id/`);
    expect(viaRedirect.data).toBe('<h1>final profile</h1>');
    expect(direct.headers[SWEEP_PAGE_REUSE_RESPONSE_HEADER]).toBeDefined();
  });

  it('re-asks the site for a temporary redirect, reusing only the final page it landed on', async () => {
    routes['/current'] = redirect(302, '/landing');
    routes['/landing'] = html('<h1>landing</h1>');
    attach();

    await instance.get(`${baseUrl}/current`);
    const again = await instance.get(`${baseUrl}/current`);
    const direct = await instance.get(`${baseUrl}/landing`);

    expect(hits['/current']).toBe(2);
    expect(hits['/landing']).toBe(2);
    expect(again.headers[SWEEP_PAGE_REUSE_RESPONSE_HEADER]).toBeUndefined();
    expect(direct.headers[SWEEP_PAGE_REUSE_RESPONSE_HEADER]).toBeDefined();
  });

  it('leaves non-GET, credentialed, conditional, binary and no-store requests alone', async () => {
    routes['/form'] = html('<p>form</p>');
    routes['/private'] = html('<p>private</p>', { 'Cache-Control': 'private, no-store' });
    routes['/logo'] = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(Buffer.from([1, 2, 3]));
    };
    attach();

    await instance.post(`${baseUrl}/form`, 'a=1');
    await instance.post(`${baseUrl}/form`, 'a=1');
    await instance.get(`${baseUrl}/form`, { headers: { Authorization: 'Bearer token' } });
    await instance.get(`${baseUrl}/form`, { headers: { Cookie: 'session=1' } });
    await instance.get(`${baseUrl}/form`, { headers: { 'If-None-Match': '"v1"' } });
    await instance.get(`${baseUrl}/private`);
    await instance.get(`${baseUrl}/private`);
    await instance.get(`${baseUrl}/logo`);
    await instance.get(`${baseUrl}/logo`);
    await instance.get(`${baseUrl}/logo`, { responseType: 'arraybuffer' });

    expect(hits).toMatchObject({ '/form': 5, '/private': 2, '/logo': 3 });
    expect(store.stats().stored).toBe(0);
  });

  it('only reuses pages on the listed hosts', async () => {
    routes['/page'] = html('<p>page</p>');
    const source = storeSource(store);
    handles.push(attachSweepPageReuse(instance, { source, hosts: ['medicine.yale.edu'] }));

    await instance.get(`${baseUrl}/page`);
    await instance.get(`${baseUrl}/page`);

    expect(hits['/page']).toBe(2);
    expect(store.stats().lookups).toBe(0);
    expect(SWEEP_PAGE_REUSE_HOSTS).toEqual(['medicine.yale.edu', 'ysph.yale.edu']);
  });

  it('reads live inside withoutSweepPageReuse, and neither looks up nor stores there', async () => {
    routes['/profile/live/'] = html('<p>live</p>');
    attach();

    await instance.get(`${baseUrl}/profile/live/`);
    const live = await withoutSweepPageReuse(() => instance.get(`${baseUrl}/profile/live/`));

    expect(hits['/profile/live/']).toBe(2);
    expect(live.headers[SWEEP_PAGE_REUSE_RESPONSE_HEADER]).toBeUndefined();
    expect(store.stats().lookups).toBe(1);
  });

  it('counts reuse into the run scope and into an observed read', async () => {
    routes['/a'] = html('<p>a</p>');
    routes['/b'] = html('<p>b</p>');
    attach();

    const { stats } = await withSweepPageReuseScope(async () => {
      await instance.get(`${baseUrl}/a`);
      const read = await observeSweepPageReuse(async () => {
        await instance.get(`${baseUrl}/a`);
        await instance.get(`${baseUrl}/b`);
        return 'read';
      });
      expect(read).toEqual({ value: 'read', pagesReused: 1 });
    });

    expect(stats).toEqual({ lookups: 3, reused: 1, bytesReused: 8, offered: 2 });
    const withMetrics = withSweepPageReuseFetchMetrics({ observationCount: 0 } as never, stats);
    expect(withMetrics.fetchMetrics?.sweepPageReuse).toEqual(stats);
    expect(withMetrics.fetchMetrics?.attempts).toEqual([]);
    const untouched = { observationCount: 0 } as never;
    expect(
      withSweepPageReuseFetchMetrics(untouched, {
        lookups: 0,
        reused: 0,
        bytesReused: 0,
        offered: 0,
      }),
    ).toBe(untouched);
  });

  it('answers a hit ahead of the validator cache, so the site sees no revalidation', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ylabs-sweep-reuse-'));
    const seen: Array<string | undefined> = [];
    routes['/etag'] = (req, res) => {
      seen.push(req.headers['if-none-match']);
      res.writeHead(200, { 'Content-Type': 'text/html', ETag: '"v1"' });
      res.end('<p>etag</p>');
    };
    const validator = attachHttpValidatorCache(instance, {
      store: new HttpValidatorStore(directory),
    });
    attach();
    try {
      await instance.get(`${baseUrl}/etag`);
      const reused = await instance.get(`${baseUrl}/etag`);
      expect(seen).toEqual([undefined]);
      expect(reused.data).toBe('<p>etag</p>');
    } finally {
      validator.detach();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

describe('SweepPageStore', () => {
  const record = (finalUrl: string, size = 10): SweepPageRecord => ({
    finalUrl,
    contentType: 'text/html',
    fetchedAt: '2026-09-26T00:00:00.000Z',
    gzipBase64: Buffer.alloc(size, 1).toString('base64'),
  });

  it('holds at most maxBytes, evicting the least recently used page first', () => {
    const bounded = new SweepPageStore(3 * (100 + 256 + 30), ['h.test']);
    bounded.put('https://h.test/a', false, record('https://h.test/a', 100));
    bounded.put('https://h.test/b', false, record('https://h.test/b', 100));
    bounded.put('https://h.test/c', false, record('https://h.test/c', 100));
    expect(bounded.get('https://h.test/a')).not.toBeNull();
    bounded.put('https://h.test/d', false, record('https://h.test/d', 100));

    expect(bounded.get('https://h.test/b')).toBeNull();
    expect(bounded.get('https://h.test/a')).not.toBeNull();
    const stats = bounded.stats();
    expect(stats.heldBytes).toBeLessThanOrEqual(stats.maxBytes);
    expect(stats).toMatchObject({ stored: 4, evicted: 1, heldPages: 3 });
  });

  it('refuses pages from unlisted hosts and pages larger than the whole bound', () => {
    const bounded = new SweepPageStore(1000, ['h.test']);
    expect(bounded.put('https://other.test/a', false, record('https://other.test/a'))).toBe(false);
    expect(bounded.put('https://h.test/a', true, record('https://other.test/a'))).toBe(false);
    expect(bounded.put('https://h.test/big', false, record('https://h.test/big', 5000))).toBe(
      false,
    );
    expect(bounded.stats()).toMatchObject({ rejected: 3, stored: 0 });
  });

  it('answers a permanent-redirect alias until its page is evicted, and never a temporary one', () => {
    const bounded = new SweepPageStore(2 * (100 + 256 + 60), ['h.test']);
    bounded.put('https://h.test/old', true, record('https://h.test/new', 100));
    bounded.put('https://h.test/temp', false, record('https://h.test/landing', 100));
    expect(bounded.get('https://h.test/old')?.finalUrl).toBe('https://h.test/new');
    expect(bounded.get('https://h.test/temp')).toBeNull();
    expect(bounded.get('https://h.test/landing')).not.toBeNull();

    bounded.put('https://h.test/x', false, record('https://h.test/x', 100));
    expect(bounded.get('https://h.test/new')).toBeNull();
    expect(bounded.get('https://h.test/old')).toBeNull();
  });
});

describe('broker-held page store', () => {
  const brokers: HostSlotBroker[] = [];
  const clients: BrokeredSweepPageClient[] = [];
  const socketPath = () =>
    path.join(os.tmpdir(), `ylabs-page-reuse-test-${process.pid}-${Math.random()}.sock`);

  afterEach(async () => {
    for (const client of clients.splice(0)) client.close();
    for (const broker of brokers.splice(0)) await broker.close();
  });

  const page: SweepPageRecord = {
    finalUrl: 'https://medicine.yale.edu/profile/id/',
    contentType: 'text/html',
    fetchedAt: '2026-09-26T00:00:00.000Z',
    gzipBase64: Buffer.from('gz').toString('base64'),
  };

  it('shares pages across clients on the sweep broker', async () => {
    const pageStore = new SweepPageStore(1024 * 1024, SWEEP_PAGE_REUSE_HOSTS);
    const broker = await HostSlotBroker.listen(socketPath(), new HostConcurrencyLimiter(2), {
      pageStore,
    });
    brokers.push(broker);
    const writer = new BrokeredSweepPageClient(broker.socketPath, () => {});
    const reader = new BrokeredSweepPageClient(broker.socketPath, () => {});
    clients.push(writer, reader);

    writer.offer('https://medicine.yale.edu/profile/slug/', true, page);
    await writer.lookup('');

    expect(await reader.lookup('https://medicine.yale.edu/profile/slug/')).toEqual(page);
    expect(await reader.lookup('https://medicine.yale.edu/profile/id/')).toEqual(page);
    expect(await reader.lookup('https://medicine.yale.edu/profile/other/')).toBeNull();
  });

  it('answers every lookup with a miss when the sweep did not enable reuse', async () => {
    const broker = await HostSlotBroker.listen(socketPath(), new HostConcurrencyLimiter(2));
    brokers.push(broker);
    const client = new BrokeredSweepPageClient(broker.socketPath, () => {});
    clients.push(client);

    client.offer('https://medicine.yale.edu/profile/id/', false, page);
    expect(await client.lookup('https://medicine.yale.edu/profile/id/')).toBeNull();
  });

  it('falls back to fetching once, with one warning, when the broker is unreachable', async () => {
    const reasons: string[] = [];
    const client = new BrokeredSweepPageClient(socketPath(), (reason) => reasons.push(reason));
    clients.push(client);

    expect(await client.lookup('https://medicine.yale.edu/profile/id/')).toBeNull();
    expect(await client.lookup('https://medicine.yale.edu/profile/id/')).toBeNull();
    expect(reasons).toHaveLength(1);
  });
});

describe('sweep page reuse configuration', () => {
  it('is on in a child only when the sweep parent both started the broker and enabled reuse', () => {
    expect(
      isSweepPageReuseEnabledForChild({
        SCRAPER_HOST_SLOT_BROKER: '/tmp/broker.sock',
        SCRAPER_SWEEP_PAGE_REUSE: '1',
      }),
    ).toBe(true);
    expect(isSweepPageReuseEnabledForChild({ SCRAPER_SWEEP_PAGE_REUSE: '1' })).toBe(false);
    expect(
      isSweepPageReuseEnabledForChild({
        SCRAPER_HOST_SLOT_BROKER: '/tmp/broker.sock',
        SCRAPER_SWEEP_PAGE_REUSE: '0',
      }),
    ).toBe(false);
    expect(isSweepPageReuseEnabledForChild({})).toBe(false);
  });

  it('bounds the store at 1 GiB unless the operator sets a size', () => {
    expect(resolveSweepPageReuseMaxBytes({})).toBe(1024 * 1024 * 1024);
    expect(resolveSweepPageReuseMaxBytes({ SCRAPER_SWEEP_PAGE_REUSE_MAX_MB: '64' })).toBe(
      64 * 1024 * 1024,
    );
    expect(resolveSweepPageReuseMaxBytes({ SCRAPER_SWEEP_PAGE_REUSE_MAX_MB: 'x' })).toBe(
      1024 * 1024 * 1024,
    );
  });

  it('keys a page by its whole URL without the fragment', () => {
    expect(sweepPageReuseKey('HTTPS://Medicine.Yale.edu:443/profile/a/?tab=1#bio')).toBe(
      'https://medicine.yale.edu/profile/a/?tab=1',
    );
    expect(sweepPageReuseKey('ftp://medicine.yale.edu/a')).toBeNull();
    expect(sweepPageReuseKey('not a url')).toBeNull();
  });
});
