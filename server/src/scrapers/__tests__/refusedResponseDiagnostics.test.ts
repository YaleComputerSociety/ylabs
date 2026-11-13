import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import axios from 'axios';
import { withScraperFetchDeadline } from '../utils/scraperFetchDeadlines';
import { createScraperRequestLog, type ScraperRequestLogEntry } from '../utils/scraperRequestLog';
import {
  REFUSED_BODY_PREFIX_BYTES,
  decodeForRedaction,
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
    const straddling = `${filler}x 192.0.2.44 ${'word '.repeat(1000)}`;

    const prefix = refusedBodyPrefix(straddling);

    expect(Buffer.byteLength(prefix, 'utf8')).toBeLessThanOrEqual(REFUSED_BODY_PREFIX_BYTES);
    expect(Buffer.byteLength(prefix, 'utf8')).toBeGreaterThan(REFUSED_BODY_PREFIX_BYTES - 4);
    expect(prefix).not.toContain('192.0');
    expect(prefix).not.toContain('\uFFFD');
    expect(refusedBodyPrefix('a\u0000b\u001bc\nd')).toBe('a b c d');
  });

  it('redacts every address form but leaves a clock time alone', () => {
    expect(
      redactDiagnosticText(
        'v4 192.0.2.1:8080, v6 2001:db8::1, [2001:db8::2]:443, 2001:db8::3%en0, ::ffff:192.0.2.3, at 13:05:59',
      ),
    ).toBe('v4 [ip]:8080, v6 [ip], [ip]:443, [ip], [ip], at 13:05:59');
  });
  it.each([
    ['decimal HTML entities for the dots', '192&#46;0&#46;2&#46;44'],
    ['decimal HTML entities for the digits', '&#49;&#57;&#50;.0.2.44'],
    ['hex HTML entities', '192&#x2E;0&#x2E;2&#x2E;44'],
    ['named HTML entities', '192&period;0&period;2&period;44'],
    ['percent-encoded dots', '192%2E0%2E2%2E44'],
    ['double percent-encoded dots', '192%252E0%252E2%252E44'],
  ])('redacts an IPv4 address written with %s', (_shape, encoded) => {
    const redacted = redactDiagnosticText(`blocked: ${encoded} end`);

    expect(redacted).toBe('blocked: [ip] end');
    expect(redacted).not.toMatch(/192|0\.2|44/);
  });

  it.each([
    ['percent-encoded colons', '2001%3Adb8%3A%3A7'],
    ['hex HTML entities for the colons', '2001&#x3A;db8&#x3A;&#x3A;7'],
    ['decimal HTML entities for the colons', '2001&#58;db8&#58;&#58;7'],
    ['named HTML entities for the colons', '2001&colon;db8&colon;&colon;7'],
  ])('redacts an IPv6 address written with %s', (_shape, encoded) => {
    const redacted = redactDiagnosticText(`seen ${encoded} end`);

    expect(redacted).toBe('seen [ip] end');
    expect(redacted).not.toMatch(/2001|db8/);
  });

  it.each([
    ['a named HTML entity for the at sign', 'desk&commat;example.org'],
    ['a hex HTML entity for the at sign', 'desk&#x40;example.org'],
    ['a decimal HTML entity for the at sign', 'desk&#64;example.org'],
    ['percent-encoding for the at sign', 'desk%40example.org'],
  ])('redacts an email address written with %s', (_shape, encoded) => {
    const redacted = redactDiagnosticText(`write to ${encoded} today`);

    expect(redacted).toBe('write to [email] today');
    expect(redacted).not.toContain('desk');
  });

  it('decodes until the text is stable and leaves ordinary markup alone', () => {
    expect(decodeForRedaction('a &#x26;#46; b')).toBe('a . b');
    expect(decodeForRedaction('a&#46b')).toBe('a.b');
    expect(decodeForRedaction('x &lt;p&gt; &nbsp; y')).toBe('x &lt;p&gt; &nbsp; y');
  });

  it('redacts an address the window cut splits after replacements shrink the text', () => {
    const shrinking = '[2001:db8:1111:2222:3333:4444:5555:6666%eth12345] '.repeat(81);
    const straddleStart = 4096 - 5;
    const body = `${shrinking}${' '.repeat(straddleStart - shrinking.length)}192.0.2.44${' tail'.repeat(1000)}`;

    const prefix = refusedBodyPrefix(body);

    expect(Buffer.byteLength(shrinking)).toBeLessThan(straddleStart);
    expect(prefix).toContain('[ip]');
    expect(prefix).not.toMatch(/192|2001|db8|eth12345/);
    expect(Buffer.byteLength(prefix, 'utf8')).toBeLessThanOrEqual(REFUSED_BODY_PREFIX_BYTES);
  });

  it('redacts token-looking values outside a query string', () => {
    const body = [
      '<input type="hidden" name="csrfmiddlewaretoken" value="sYnTh3t1cT0k3nV4lu3">',
      '{"access_token": "sYnTh3t1cB34r3rV4lu3", "session_id": "sYnTh3t1cS3ss10n"}',
      'Authorization: Bearer sYnTh3t1cH34d3rV4lu3',
    ].join('\n');

    const redacted = redactDiagnosticText(body);

    expect(redacted).not.toMatch(/sYnTh3t1c/);
    expect(redacted).toContain('[redacted]');
  });
});
