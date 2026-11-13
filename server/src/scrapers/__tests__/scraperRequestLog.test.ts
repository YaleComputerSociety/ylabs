import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import axios from 'axios';
import { withScraperFetchDeadline } from '../utils/scraperFetchDeadlines';
import {
  SCRAPER_REQUEST_LOG_ENV,
  createScraperRequestLog,
  scraperRequestLogFromEnv,
  type ScraperRequestLogEntry,
} from '../utils/scraperRequestLog';

const servers: http.Server[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function serve(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const sha256Prefix = (text: string) =>
  crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

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

describe('the opt-in scraper request log (#6188)', () => {
  it('records time, host, url hash, status, duration and attempt for each request', async () => {
    const base = await serve((req, res) => {
      res.writeHead(req.url === '/people/secret-page?token=abc' ? 403 : 200);
      res.end('<html>synthetic</html>');
    });
    const { client, lines, entries } = capturingClient();
    const blocked = `${base}/people/secret-page?token=abc`;

    await client.get(`${base}/`);
    await client.get(blocked).catch(() => undefined);
    await client.get(blocked).catch(() => undefined);

    expect(entries().map(({ host, status, attempt }) => ({ host, status, attempt }))).toEqual([
      { host: '127.0.0.1', status: 200, attempt: 1 },
      { host: '127.0.0.1', status: 403, attempt: 1 },
      { host: '127.0.0.1', status: 403, attempt: 2 },
    ]);
    expect(entries()[1].urlHash).toBe(sha256Prefix(blocked));
    expect(entries()[1].urlHash).not.toBe(sha256Prefix(`${base}/people/secret-page`));
    for (const entry of entries()) {
      expect(Number.isNaN(Date.parse(entry.at))).toBe(false);
      expect(entry.at.endsWith('Z')).toBe(true);
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    }
    expect(lines.join('')).not.toMatch(/secret-page|token|synthetic/);
  });

  it('records the error code of a request that never got a response', async () => {
    const base = await serve(() => undefined);
    const closed = base.replace(/:\d+$/, ':1');
    const { client, entries } = capturingClient();

    await client.get(`${closed}/`).catch(() => undefined);

    expect(entries()).toHaveLength(1);
    expect(entries()[0].status).toBeUndefined();
    expect(entries()[0].error).toBe('ECONNREFUSED');
  });

  it('returns the response and the real error when the log cannot be written', async () => {
    const base = await serve((req, res) => {
      res.writeHead(req.url === '/ok' ? 200 : 503);
      res.end();
    });
    const failingLog = createScraperRequestLog(() => {
      throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
    });
    const client = axios.create({
      adapter: withScraperFetchDeadline(axios.getAdapter('http'), { requestLog: failingLog }),
    });

    await expect(client.get(`${base}/ok`)).resolves.toMatchObject({ status: 200 });
    await expect(client.get(`${base}/down`)).rejects.toMatchObject({
      response: { status: 503 },
    });
  });

  it('writes nothing when no log is configured', async () => {
    expect(scraperRequestLogFromEnv({})).toBeUndefined();
    expect(scraperRequestLogFromEnv({ [SCRAPER_REQUEST_LOG_ENV]: '  ' })).toBeUndefined();
  });

  it('appends to an owner-only file named by the environment', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'request-log-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'requests.jsonl');
    const log = scraperRequestLogFromEnv({ [SCRAPER_REQUEST_LOG_ENV]: file });

    log?.record('https://example.edu/lab/people/', new Date('2026-01-01T00:00:00Z'), 12, {
      status: 200,
    });

    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const [line] = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(JSON.parse(line)).toEqual({
      at: '2026-01-01T00:00:00.000Z',
      host: 'example.edu',
      urlHash: sha256Prefix('https://example.edu/lab/people/'),
      status: 200,
      durationMs: 12,
      attempt: 1,
    });
  });
});
