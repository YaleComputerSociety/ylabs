import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import axios, { type AxiosInstance } from 'axios';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ssrfSafeAgents } from '../../../utils/ssrfGuard';
import {
  attachHttpValidatorCache,
  emptyHttpValidatorCacheStats,
  HttpValidatorStore,
  resolveHttpValidatorCacheConfig,
  withHttpCacheFetchMetrics,
  withHttpValidatorCacheScope,
  type HttpValidatorCacheHandle,
  type StoredHttpResponse,
} from '../httpValidatorCache';

interface SeenRequest {
  path: string;
  ifNoneMatch?: string;
  ifModifiedSince?: string;
}

type Route = (req: http.IncomingMessage, res: http.ServerResponse) => void;

const LAST_MODIFIED = 'Wed, 01 Jan 2025 00:00:00 GMT';

function etagRoute(body: string, etag: string, extraHeaders: Record<string, string> = {}): Route {
  return (req, res) => {
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ETag: etag, ...extraHeaders });
    res.end(body);
  };
}

let server: http.Server;
let origin: string;
let routes: Map<string, Route>;
let seen: SeenRequest[];
let cacheDir: string;
let client: AxiosInstance;
let handle: HttpValidatorCacheHandle;

beforeEach(async () => {
  routes = new Map();
  seen = [];
  server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    seen.push({
      path: url,
      ifNoneMatch: req.headers['if-none-match'] as string | undefined,
      ifModifiedSince: req.headers['if-modified-since'] as string | undefined,
    });
    const route = routes.get(url);
    if (!route) {
      res.writeHead(404);
      res.end();
      return;
    }
    route(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ylabs-http-cache-test-'));
  client = axios.create();
  handle = attachHttpValidatorCache(client, { store: new HttpValidatorStore(cacheDir) });
});

afterEach(async () => {
  handle.detach();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(cacheDir, { recursive: true, force: true });
});

describe('attachHttpValidatorCache', () => {
  it('stores validators on a 200 and replays the stored body as a 200 on a 304', async () => {
    const body = '<html><body>synthetic lab page</body></html>';
    routes.set('/page', etagRoute(body, '"v1"'));

    const first = await client.get(`${origin}/page`, { responseType: 'text' });
    const second = await client.get(`${origin}/page`, { responseType: 'text' });

    expect(seen.map((request) => request.ifNoneMatch)).toEqual([undefined, '"v1"']);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.data).toBe(body);
    expect(second.headers['etag']).toBe('"v1"');
    expect(handle.globalStats()).toMatchObject({
      revalidations: 1,
      notModified: 1,
      stored: 1,
      bytesSaved: Buffer.byteLength(body),
      bytesDownloaded: Buffer.byteLength(body),
    });
  });

  it('parses a replayed JSON body exactly as the original response was parsed', async () => {
    const payload = { items: [{ id: 1, title: 'synthetic' }] };
    routes.set('/api', (req, res) => {
      if (req.headers['if-modified-since'] === LAST_MODIFIED) {
        res.writeHead(304);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Last-Modified': LAST_MODIFIED });
      res.end(JSON.stringify(payload));
    });

    const first = await client.get(`${origin}/api`);
    const second = await client.get(`${origin}/api`);

    expect(seen[1].ifModifiedSince).toBe(LAST_MODIFIED);
    expect(second.data).toEqual(first.data);
    expect(second.data).toEqual(payload);
  });

  it('delivers a changed page in full when the origin answers 200 to the conditional request', async () => {
    let version = 1;
    routes.set('/changing', (req, res) => {
      const etag = `"v${version}"`;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ETag: etag });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html', ETag: etag });
      res.end(`<p>version ${version}</p>`);
    });

    await client.get(`${origin}/changing`, { responseType: 'text' });
    version = 2;
    const changed = await client.get(`${origin}/changing`, { responseType: 'text' });
    const replayed = await client.get(`${origin}/changing`, { responseType: 'text' });

    expect(changed.data).toBe('<p>version 2</p>');
    expect(replayed.data).toBe('<p>version 2</p>');
    expect(seen.map((request) => request.ifNoneMatch)).toEqual([undefined, '"v1"', '"v2"']);
  });

  it('never stores a Cache-Control: no-store response and drops a stored entry that becomes no-store', async () => {
    routes.set('/private', etagRoute('<p>secret</p>', '"n1"', { 'Cache-Control': 'no-store' }));
    await client.get(`${origin}/private`);
    await client.get(`${origin}/private`);
    expect(seen.map((request) => request.ifNoneMatch)).toEqual([undefined, undefined]);

    let noStore = false;
    routes.set('/flip', (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/html',
        ETag: '"f1"',
        ...(noStore ? { 'Cache-Control': 'no-store' } : {}),
      });
      res.end('<p>flip</p>');
    });
    await client.get(`${origin}/flip`);
    noStore = true;
    await client.get(`${origin}/flip`);
    await client.get(`${origin}/flip`);
    expect(seen.slice(2).map((request) => request.ifNoneMatch)).toEqual([
      undefined,
      '"f1"',
      undefined,
    ]);
  });

  it('does not cache non-textual bodies, non-GET requests, or pages without validators', async () => {
    routes.set('/image', (req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png', ETag: '"img"' });
      res.end('binary');
    });
    routes.set('/no-validators', (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<p>plain</p>');
    });
    routes.set('/post', etagRoute('<p>posted</p>', '"p1"'));

    await client.get(`${origin}/image`);
    await client.get(`${origin}/image`);
    await client.get(`${origin}/no-validators`);
    await client.get(`${origin}/no-validators`);
    await client.post(`${origin}/post`, 'x');
    await client.get(`${origin}/post`);

    expect(seen.every((request) => request.ifNoneMatch === undefined)).toBe(true);
    expect(handle.globalStats().stored).toBe(1);
  });

  it('bypasses the cache entirely inside a release scope', async () => {
    routes.set('/page', etagRoute('<p>release</p>', '"r1"'));

    const { stats } = await withHttpValidatorCacheScope({ bypass: true }, async () => {
      await client.get(`${origin}/page`);
      await client.get(`${origin}/page`);
    });
    await client.get(`${origin}/page`);

    expect(seen.map((request) => request.ifNoneMatch)).toEqual([undefined, undefined, undefined]);
    expect(stats).toEqual(emptyHttpValidatorCacheStats());
  });

  it('attributes counters to the run scope that made the request', async () => {
    const body = '<p>scoped</p>';
    routes.set('/page', etagRoute(body, '"s1"'));
    await client.get(`${origin}/page`);

    const { stats } = await withHttpValidatorCacheScope({ bypass: false }, async () => {
      await client.get(`${origin}/page`);
    });

    expect(stats).toMatchObject({
      revalidations: 1,
      notModified: 1,
      bytesSaved: Buffer.byteLength(body),
      stored: 0,
    });
  });

  it('keeps the SSRF-safe agents in force on a revalidation', async () => {
    routes.set('/page', etagRoute('<p>guarded</p>', '"g1"'));
    const localhostUrl = `${origin.replace('127.0.0.1', 'localhost')}/page`;
    await client.get(localhostUrl);
    expect(seen).toHaveLength(1);

    const agents = ssrfSafeAgents();
    await expect(
      client.get(localhostUrl, { httpAgent: agents.httpAgent, httpsAgent: agents.httpsAgent }),
    ).rejects.toThrow(/Blocked private or non-public address/);
    expect(seen).toHaveLength(1);
    expect(handle.globalStats().notModified).toBe(0);
  });

  it('keys a redirected page by its final URL and refetches when the redirect target changes', async () => {
    let target = '/new';
    routes.set('/old', (req, res) => {
      res.writeHead(301, { Location: target });
      res.end();
    });
    routes.set('/new', etagRoute('<p>new home</p>', '"shared"'));
    routes.set('/other', (req, res) => {
      if (req.headers['if-none-match']) {
        res.writeHead(304, { ETag: '"shared"' });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<p>other page</p>');
    });

    await client.get(`${origin}/old`, { responseType: 'text' });
    const replayed = await client.get(`${origin}/old`, { responseType: 'text' });
    expect(replayed.data).toBe('<p>new home</p>');
    expect(seen.filter((request) => request.path === '/new').map((r) => r.ifNoneMatch)).toEqual([
      undefined,
      '"shared"',
    ]);

    target = '/other';
    const moved = await client.get(`${origin}/old`, { responseType: 'text' });
    expect(moved.data).toBe('<p>other page</p>');
    expect(handle.globalStats().refetched).toBe(1);
    expect(seen.filter((request) => request.path === '/other').map((r) => r.ifNoneMatch)).toEqual([
      '"shared"',
      undefined,
    ]);
  });

  it('leaves the caller config clean when a conditional request fails', async () => {
    let fail = false;
    routes.set('/flaky', (req, res) => {
      if (fail) {
        res.writeHead(500);
        res.end();
        return;
      }
      etagRoute('<p>flaky</p>', '"k1"')(req, res);
    });
    await client.get(`${origin}/flaky`);
    fail = true;

    const error = await client.get(`${origin}/flaky`).catch((caught: unknown) => caught);
    expect(axios.isAxiosError(error)).toBe(true);
    const config = (error as { config: { headers: { get(name: string): unknown } } }).config;
    expect(config.headers.get('If-None-Match')).toBeUndefined();
  });
});

describe('HttpValidatorStore', () => {
  const entry = (url: string, body: string): StoredHttpResponse => ({
    v: 1,
    url,
    storedAt: new Date(0).toISOString(),
    policy: {} as StoredHttpResponse['policy'],
    body,
  });

  it('evicts the least recently used entries once the size bound is exceeded', async () => {
    const store = new HttpValidatorStore(cacheDir, 2000);
    const body = 'x'.repeat(600);
    await store.save('https://a.example.edu/', entry('https://a.example.edu/', body));
    await store.save('https://b.example.edu/', entry('https://b.example.edu/', body));
    const past = new Date(Date.now() - 60_000);
    const entriesDir = path.join(cacheDir, 'entries');
    for (const name of await fs.readdir(entriesDir)) {
      const stored = JSON.parse(await fs.readFile(path.join(entriesDir, name), 'utf8'));
      if (stored.url === 'https://a.example.edu/') {
        await fs.utimes(path.join(entriesDir, name), past, past);
      }
    }

    await store.save('https://c.example.edu/', entry('https://c.example.edu/', body));

    expect(await store.lookup('https://a.example.edu/')).toBeNull();
    expect(await store.lookup('https://b.example.edu/')).not.toBeNull();
    expect(await store.lookup('https://c.example.edu/')).not.toBeNull();
    expect(await store.totalBytes()).toBeLessThanOrEqual(2000);
  });

  it('ignores a corrupt entry rather than failing the fetch', async () => {
    const store = new HttpValidatorStore(cacheDir);
    await store.save('https://a.example.edu/', entry('https://a.example.edu/', 'ok'));
    const entriesDir = path.join(cacheDir, 'entries');
    const [name] = await fs.readdir(entriesDir);
    await fs.writeFile(path.join(entriesDir, name), '{not json');
    expect(await store.lookup('https://a.example.edu/')).toBeNull();
  });
});

describe('resolveHttpValidatorCacheConfig', () => {
  it('is enabled by default under the user cache directory', () => {
    const config = resolveHttpValidatorCacheConfig({ XDG_CACHE_HOME: '/tmp/xdg' });
    expect(config.enabled).toBe(true);
    expect(config.directory).toBe(path.join('/tmp/xdg', 'ylabs', 'scraper-http-cache'));
    expect(config.maxBytes).toBe(512 * 1024 * 1024);
  });

  it('honours the disable switch, directory, and size knobs', () => {
    const config = resolveHttpValidatorCacheConfig({
      SCRAPER_HTTP_CACHE: 'off',
      SCRAPER_HTTP_CACHE_DIR: '/tmp/elsewhere',
      SCRAPER_HTTP_CACHE_MAX_MB: '2',
    });
    expect(config).toEqual({
      enabled: false,
      directory: '/tmp/elsewhere',
      maxBytes: 2 * 1024 * 1024,
      maxEntryBytes: 2 * 1024 * 1024,
    });
  });
});

describe('withHttpCacheFetchMetrics', () => {
  it('leaves a result untouched when the cache saw nothing', () => {
    const result = { observationCount: 1, entitiesObserved: 1 };
    expect(withHttpCacheFetchMetrics(result, emptyHttpValidatorCacheStats())).toBe(result);
  });

  it('records the cache counters beside the lane fetch metrics', () => {
    const stats = { ...emptyHttpValidatorCacheStats(), revalidations: 2, notModified: 2 };
    const merged = withHttpCacheFetchMetrics({ observationCount: 0, entitiesObserved: 0 }, stats);
    expect(merged.fetchMetrics?.httpCache).toEqual(stats);
    expect(merged.fetchMetrics?.attempts).toEqual([]);
  });
});
