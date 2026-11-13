import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import axios from 'axios';
import { withScraperFetchDeadline } from '../utils/scraperFetchDeadlines';
import { createScraperRequestLog, type ScraperRequestLogEntry } from '../utils/scraperRequestLog';
import {
  REFUSED_BODY_PREFIX_BYTES,
  redactDiagnosticText,
  refusedBodyPrefix,
} from '../utils/refusedResponseDiagnostics';

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function serve(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const capturingClient = () => {
  const lines: string[] = [];
  const client = axios.create({
    adapter: withScraperFetchDeadline(axios.getAdapter('http'), {
      requestLog: createScraperRequestLog((line) => lines.push(line)),
    }),
  });
  const entries = () => lines.map((line) => JSON.parse(line) as ScraperRequestLogEntry);
  return { client, lines, entries };
};

const SYNTHETIC_BAN_BODY = [
  '<html><body><h1>Access denied</h1>',
  '<p>Requests from 192.0.2.44 are blocked until further notice.</p>',
  '<p>Also seen: 2001:db8::7, [2001:db8::1%en0], ::ffff:192.0.2.9 and 2001:db8:0:0:0:0:0:2.</p>',
  '<p>Questions: blocked-desk@example.org or blocked-desk%40example.org</p>',
  '<a href="https://example.org/unblock?token=abc123&session=xyz">unblock</a>',
  '</body></html>',
].join('\n');

const LEAKED = [
  '192.0.2.44',
  '192.0.2.9',
  '192.0.2.10',
  '192.0.2.5',
  '2001:db8::7',
  '2001:db8::1',
  '2001:db8:0:0:0:0:0:2',
  'blocked-desk',
  'abc123',
  'xyz',
  'synthetic-cookie-value',
];

describe('refused-response diagnostics in the request log (#6215)', () => {
  it('keeps allowlisted headers and a redacted body prefix of a 403, and no address', async () => {
    const base = await serve((_req, res) => {
      res.writeHead(403, {
        'content-type': 'text/html; charset=utf-8',
        'retry-after': '3600',
        'x-ratelimit-remaining': '0',
        server: 'edge 192.0.2.10',
        'x-forwarded-for': '192.0.2.5',
        'set-cookie': 'session=synthetic-cookie-value; Path=/',
      });
      res.end(SYNTHETIC_BAN_BODY);
    });
    const { client, lines, entries } = capturingClient();

    await client.get(`${base}/people/`).catch(() => undefined);

    const [entry] = entries();
    expect(entry.status).toBe(403);
    expect(Object.keys(entry.headers ?? {}).sort()).toEqual([
      'content-type',
      'date',
      'retry-after',
      'server',
      'x-ratelimit-remaining',
    ]);
    expect(entry.headers?.server).toBe('edge [ip]');
    expect(entry.bodyPrefix).toContain('Requests from [ip] are blocked');
    for (const secret of LEAKED) expect(lines.join('')).not.toContain(secret);
  });

  it('never writes a cookie or an unlisted header from a refused response', async () => {
    const base = await serve((_req, res) => {
      res.writeHead(429, {
        'set-cookie': 'session=synthetic-cookie-value',
        'www-authenticate': 'Basic realm="synthetic"',
        location: 'https://example.org/next?token=abc123',
        'x-ratelimit-reset': '60',
      });
      res.end('slow down');
    });
    const { client, lines, entries } = capturingClient();

    await client.get(`${base}/`, { validateStatus: () => true });

    expect(entries()[0].status).toBe(429);
    expect(Object.keys(entries()[0].headers ?? {}).sort()).toEqual(['date', 'x-ratelimit-reset']);
    expect(entries()[0].headers?.['x-ratelimit-reset']).toBe('60');
    expect(lines.join('')).not.toMatch(/synthetic-cookie-value|realm|abc123|set-cookie|location/);
  });

  it('writes no header or body field for a successful response', async () => {
    const base = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', server: 'edge' });
      res.end('<p>Contact 192.0.2.44</p>');
    });
    const { client, entries } = capturingClient();

    await client.get(`${base}/`);

    expect(entries()[0]).not.toHaveProperty('headers');
    expect(entries()[0]).not.toHaveProperty('bodyPrefix');
  });

  it('bounds the body prefix and redacts an address that straddles the cut', () => {
    const filler = 'é'.repeat(250);
    const straddling = `${filler}x 192.0.2.44 ${'z'.repeat(5000)}`;

    const prefix = refusedBodyPrefix(straddling);

    expect(Buffer.byteLength(prefix, 'utf8')).toBeLessThanOrEqual(REFUSED_BODY_PREFIX_BYTES);
    expect(prefix).not.toContain('192.0');
    expect(prefix).not.toContain('�');
    expect(refusedBodyPrefix('a\u0000b\u001bc\nd')).toBe('a b c d');
  });

  it('redacts every address form but leaves a clock time alone', () => {
    expect(
      redactDiagnosticText(
        'v4 192.0.2.1:8080, v6 2001:db8::1, [2001:db8::2]:443, 2001:db8::3%en0, ::ffff:192.0.2.3, at 13:05:59',
      ),
    ).toBe('v4 [ip]:8080, v6 [ip], [ip]:443, [ip], [ip], at 13:05:59');
  });
});
