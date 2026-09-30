import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SsrfBlockedError } from '../../../utils/ssrfGuard';
import { fetchPublicHttpUrl, type PublicHttpHopRequest } from '../httpFetch';

const PUBLIC_SEED = 'https://93.184.216.34/start';

describe('fetchPublicHttpUrl', () => {
  let server: http.Server;
  let hits: string[];
  let port: number;

  beforeEach(async () => {
    hits = [];
    server = http.createServer((req, res) => {
      hits.push(req.url ?? '');
      if (req.url === '/hop') {
        res.writeHead(302, { location: `http://127.0.0.1:${port}/internal` });
        res.end();
        return;
      }
      res.end('internal');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('refuses a redirect hop to a loopback address without requesting it', async () => {
    const request = vi.fn<PublicHttpHopRequest>(async () => ({
      status: 302,
      body: '',
      location: 'http://127.0.0.1/internal',
    }));

    await expect(fetchPublicHttpUrl(PUBLIC_SEED, { request })).rejects.toMatchObject({
      name: 'SsrfBlockedError',
      reason: 'private-address',
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(hits).toEqual([]);
  });

  it('refuses a redirect hop to the cloud metadata address', async () => {
    const request = vi.fn<PublicHttpHopRequest>(async () => ({
      status: 301,
      body: '',
      location: 'http://169.254.169.254/latest/meta-data/',
    }));

    await expect(fetchPublicHttpUrl(PUBLIC_SEED, { request })).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('refuses a private seed with the real transport and never reaches the server', async () => {
    await expect(fetchPublicHttpUrl(`http://127.0.0.1:${port}/hop`)).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    expect(hits).toEqual([]);
  });

  it('refuses at connect time with the real transport even when the URL check is bypassed', async () => {
    const seed = `http://127.0.0.1:${port}/hop`;
    const { assertPublicHttpUrl } = await import('../../../utils/ssrfGuard');
    const assertUrl = async (url: string) =>
      url === seed ? new URL(url) : assertPublicHttpUrl(url);

    await expect(fetchPublicHttpUrl(seed, { assertUrl })).rejects.toMatchObject({
      code: 'EHOSTUNREACH',
    });
    expect(hits).toEqual([]);
  });

  it('follows public redirects, resolving a relative location against the hop', async () => {
    const request = vi.fn<PublicHttpHopRequest>(async (url) =>
      url === PUBLIC_SEED
        ? { status: 301, body: '', location: '/landing' }
        : { status: 200, body: '<title>Landing</title>' },
    );

    const response = await fetchPublicHttpUrl(PUBLIC_SEED, { request });

    expect(response).toEqual({
      status: 200,
      body: '<title>Landing</title>',
      finalUrl: 'https://93.184.216.34/landing',
    });
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      PUBLIC_SEED,
      'https://93.184.216.34/landing',
    ]);
  });

  it('returns the redirect itself once the hop budget is spent', async () => {
    const request = vi.fn<PublicHttpHopRequest>(async () => ({
      status: 302,
      body: '',
      location: '/again',
    }));

    const response = await fetchPublicHttpUrl(PUBLIC_SEED, { request, maxRedirects: 2 });

    expect(response.status).toBe(302);
    expect(response.location).toBe('/again');
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('with no redirects allowed, hands the caller the location to judge', async () => {
    const request = vi.fn<PublicHttpHopRequest>(async () => ({
      status: 301,
      body: '',
      location: 'https://93.184.216.35/elsewhere',
    }));

    const response = await fetchPublicHttpUrl(PUBLIC_SEED, { request, maxRedirects: 0 });

    expect(response).toMatchObject({ status: 301, location: 'https://93.184.216.35/elsewhere' });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
