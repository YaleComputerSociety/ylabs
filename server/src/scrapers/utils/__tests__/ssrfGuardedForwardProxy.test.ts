import http from 'node:http';
import net from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resolvePublicForwardTarget,
  startSsrfGuardedForwardProxy,
  type SsrfGuardedForwardProxy,
} from '../ssrfGuardedForwardProxy';

const UPSTREAM_NAME = 'upstream.test';

describe('startSsrfGuardedForwardProxy', () => {
  let upstream: http.Server;
  let upstreamPort: number;
  let hits: Array<{ url: string; host?: string }>;
  let proxy: SsrfGuardedForwardProxy | undefined;

  beforeEach(async () => {
    hits = [];
    upstream = http.createServer((req, res) => {
      hits.push({ url: req.url ?? '', host: req.headers.host });
      if (req.url === '/bounce') {
        res.writeHead(302, { location: `http://127.0.0.1:${upstreamPort}/internal` });
        res.end();
        return;
      }
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

  const startProxy = async (resolveUpstreamName: boolean) => {
    proxy = await startSsrfGuardedForwardProxy({
      forwardablePorts: new Set([upstreamPort]),
      resolveTarget: async (hostname) =>
        resolveUpstreamName && hostname === UPSTREAM_NAME
          ? '127.0.0.1'
          : resolvePublicForwardTarget(hostname),
    });
    return proxy;
  };

  const getThroughProxy = (target: string) =>
    new Promise<{ status?: number; body: string; location?: string }>((resolve, reject) => {
      const proxyUrl = new URL(proxy!.url);
      const req = http.request(
        {
          host: proxyUrl.hostname,
          port: proxyUrl.port,
          path: target,
          method: 'GET',
          headers: { host: new URL(target).host },
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () =>
            resolve({ status: res.statusCode, body, location: res.headers.location }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });

  const tunnelThroughProxy = (authority: string) =>
    new Promise<{ status: string; tunnelResponse: string }>((resolve, reject) => {
      const proxyUrl = new URL(proxy!.url);
      const socket = net.connect(Number(proxyUrl.port), proxyUrl.hostname, () => {
        socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
      });
      let buffer = '';
      let status = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => {
        buffer += chunk;
        if (!status && buffer.includes('\r\n\r\n')) {
          status = buffer.split('\r\n')[0];
          buffer = '';
          if (status.includes(' 200 ')) {
            socket.write(
              `GET /tunnelled HTTP/1.1\r\nHost: ${authority}\r\nConnection: close\r\n\r\n`,
            );
          }
        }
      });
      socket.on('end', () => resolve({ status, tunnelResponse: buffer }));
      socket.on('close', () => resolve({ status, tunnelResponse: buffer }));
      socket.on('error', reject);
    });

  it('refuses a plain request to a loopback address without contacting it', async () => {
    await startProxy(false);

    const response = await getThroughProxy(`http://127.0.0.1:${upstreamPort}/internal`);

    expect(response.status).toBe(403);
    expect(hits).toEqual([]);
    expect(proxy!.refusedHosts()).toEqual(['127.0.0.1']);
  });

  it('refuses a tunnel to a loopback address or a name that resolves to one', async () => {
    await startProxy(false);

    expect((await tunnelThroughProxy(`127.0.0.1:${upstreamPort}`)).status).toContain(' 403 ');
    expect((await tunnelThroughProxy(`localhost:${upstreamPort}`)).status).toContain(' 403 ');
    expect((await tunnelThroughProxy(`[::1]:${upstreamPort}`)).status).toContain(' 403 ');
    expect(hits).toEqual([]);
    expect(proxy!.forwardedHosts()).toEqual([]);
  });

  it('refuses the cloud metadata address', async () => {
    await startProxy(false);

    const response = await getThroughProxy('http://169.254.169.254/latest/meta-data/');

    expect(response.status).toBe(403);
    expect(proxy!.refusedHosts()).toEqual(['169.254.169.254']);
  });

  it('refuses a port outside the forwardable set even for an admitted host', async () => {
    await startProxy(true);

    const response = await getThroughProxy(`http://${UPSTREAM_NAME}:${upstreamPort + 1}/page`);

    expect(response.status).toBe(403);
    expect(hits).toEqual([]);
  });

  it('forwards an admitted request with its original Host header', async () => {
    await startProxy(true);

    const response = await getThroughProxy(`http://${UPSTREAM_NAME}:${upstreamPort}/page`);

    expect(response).toMatchObject({ status: 200, body: 'upstream body' });
    expect(hits).toEqual([{ url: '/page', host: `${UPSTREAM_NAME}:${upstreamPort}` }]);
    expect(proxy!.forwardedHosts()).toEqual([UPSTREAM_NAME]);
  });

  it('tunnels an admitted host', async () => {
    await startProxy(true);

    const tunnel = await tunnelThroughProxy(`${UPSTREAM_NAME}:${upstreamPort}`);

    expect(tunnel.status).toContain(' 200 ');
    expect(tunnel.tunnelResponse).toContain('upstream body');
    expect(hits.map((hit) => hit.url)).toEqual(['/tunnelled']);
  });

  it('judges every hop of a redirect, so a public page cannot bounce the browser inward', async () => {
    await startProxy(true);

    const first = await getThroughProxy(`http://${UPSTREAM_NAME}:${upstreamPort}/bounce`);
    expect(first.status).toBe(302);
    const second = await getThroughProxy(first.location!);

    expect(second.status).toBe(403);
    expect(hits.map((hit) => hit.url)).toEqual(['/bounce']);
  });
});
