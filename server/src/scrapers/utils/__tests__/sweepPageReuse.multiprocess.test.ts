import { spawn } from 'child_process';
import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hermeticChildEnvironment } from '../../../test/hermeticEnvironment';
import { HostConcurrencyLimiter, type HostSlotRelease } from '../hostConcurrencyLimiter';
import { HostSlotBroker } from '../hostSlotBroker';
import { SWEEP_PAGE_REUSE_HOSTS } from '../sweepPageReuse';
import { SweepPageStore } from '../sweepPageStore';

const CHILD_SCRIPT = path.resolve(__dirname, 'fixtures/sweepPageReuseChild.ts');
const TSX_BIN = path.resolve(__dirname, '../../../../node_modules/.bin/tsx');
const SERVER_ROOT = path.resolve(__dirname, '../../../..');

class CountingLimiter extends HostConcurrencyLimiter {
  readonly acquired: string[] = [];

  override acquire(host: string): Promise<HostSlotRelease> {
    this.acquired.push(host);
    return super.acquire(host);
  }
}

interface ChildResult {
  path: string;
  status: number;
  body?: string;
  finalPath?: string;
  reused?: boolean;
}

interface ChildReport {
  results: ChildResult[];
  stats: { lookups: number; reused: number; bytesReused: number; offered: number };
}

let server: http.Server;
let port: number;
let hits: Record<string, number>;
let refusalsLeft: number;
const brokers: HostSlotBroker[] = [];

beforeEach(async () => {
  hits = {};
  refusalsLeft = 1;
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://fixture').pathname;
    hits[pathname] = (hits[pathname] ?? 0) + 1;
    if (pathname === '/profile/slug/') {
      res.writeHead(301, { Location: '/profile/id/' });
      res.end();
    } else if (pathname === '/profile/refused/' && refusalsLeft > 0) {
      refusalsLeft -= 1;
      res.writeHead(403);
      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>${pathname}</h1>`);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  for (const broker of brokers.splice(0)) await broker.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function startBroker(limiter: HostConcurrencyLimiter, withPages: boolean) {
  const socketPath = path.join(
    os.tmpdir(),
    `ylabs-page-reuse-mp-${process.pid}-${Math.random().toString(36).slice(2, 8)}.sock`,
  );
  const broker = await HostSlotBroker.listen(
    socketPath,
    limiter,
    withPages ? { pageStore: new SweepPageStore(64 * 1024 * 1024, SWEEP_PAGE_REUSE_HOSTS) } : {},
  );
  brokers.push(broker);
  return broker;
}

function runChild(
  broker: HostSlotBroker,
  paths: string[],
  reuse: '0' | '1' = '1',
): Promise<ChildReport> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX_BIN, [CHILD_SCRIPT], {
      cwd: SERVER_ROOT,
      env: hermeticChildEnvironment({
        SCRAPER_HOST_SLOT_BROKER: broker.socketPath,
        SCRAPER_SWEEP_PAGE_REUSE: reuse,
        SCRAPER_HTTP_CACHE: 'off',
        FIXTURE_HOST: 'medicine.yale.edu',
        FIXTURE_PORT: String(port),
        FIXTURE_PATHS: paths.join(','),
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.on('exit', (code) => {
      const line = stdout.trim().split('\n').pop() ?? '';
      if (code !== 0) reject(new Error(`child exited ${code}: ${stderr}`));
      else resolve(JSON.parse(line) as ChildReport);
    });
  });
}

const PATHS = ['/profile/a/', '/profile/slug/', '/profile/refused/'];

describe('sweep page reuse across sweep child processes', () => {
  it('serves a later child the pages an earlier child fetched, without a host slot or a request', async () => {
    const limiter = new CountingLimiter(4);
    const broker = await startBroker(limiter, true);

    const first = await runChild(broker, PATHS);
    const second = await runChild(broker, PATHS);

    expect(first.results.map((result) => result.status)).toEqual([200, 200, 403]);
    expect(first.stats).toMatchObject({ lookups: 3, reused: 0, offered: 2 });
    expect(second.results).toEqual([
      {
        path: '/profile/a/',
        status: 200,
        body: '<h1>/profile/a/</h1>',
        finalPath: '/profile/a/',
        reused: true,
      },
      {
        path: '/profile/slug/',
        status: 200,
        body: '<h1>/profile/id/</h1>',
        finalPath: '/profile/id/',
        reused: true,
      },
      {
        path: '/profile/refused/',
        status: 200,
        body: '<h1>/profile/refused/</h1>',
        finalPath: '/profile/refused/',
        reused: false,
      },
    ]);
    expect(second.stats).toMatchObject({ lookups: 3, reused: 2, offered: 1 });
    expect(hits).toEqual({
      '/profile/a/': 1,
      '/profile/slug/': 1,
      '/profile/id/': 1,
      '/profile/refused/': 2,
    });
    expect(limiter.acquired).toEqual(Array(4).fill('medicine.yale.edu'));
    expect(broker.pageStore?.stats()).toMatchObject({ hits: 2, stored: 3 });
  });

  it('fetches every page in every child when the sweep disabled reuse', async () => {
    const broker = await startBroker(new HostConcurrencyLimiter(4), false);

    const first = await runChild(broker, PATHS.slice(0, 2), '0');
    const second = await runChild(broker, PATHS.slice(0, 2), '0');

    expect(first.stats.lookups + second.stats.lookups).toBe(0);
    expect(second.results.every((result) => result.reused === false)).toBe(true);
    expect(hits).toEqual({ '/profile/a/': 2, '/profile/slug/': 2, '/profile/id/': 2 });
  });
});
