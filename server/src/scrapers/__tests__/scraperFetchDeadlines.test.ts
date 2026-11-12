import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import axios, { AxiosError, type AxiosAdapter } from 'axios';
import {
  SCRAPER_FETCH_CONNECT_TIMEOUT_MS,
  SCRAPER_FETCH_OVERALL_DEADLINE_MS,
  SCRAPER_FETCH_READ_TIMEOUT_MS,
  installScraperFetchDeadlines,
  scraperFetchOverallDeadlineMs,
  scraperFetchReadTimeoutMs,
  withScraperFetchDeadline,
} from '../utils/scraperFetchDeadlines';
import { ConnectDeadlineHttpsAgent } from '../../utils/connectDeadlineAgents';
import {
  devWriteProgress,
  resetDevWriteProgressForTests,
  watchOutboundHttpProgress,
} from '../../db/devWriteProgress';

const TEST_DEADLINE_MS = 300;
const BOUND_SLACK_MS = 2_000;

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

const servers: net.Server[] = [];
const sockets = new Set<net.Socket>();

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function listen<T extends net.Server>(server: T): Promise<string> {
  servers.push(server);
  server.on('connection', (socket: net.Socket) => sockets.add(socket));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return `127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const serve = async (handler: Handler): Promise<string> =>
  `http://${await listen(http.createServer(handler))}/`;

const neverResponds: Handler = () => undefined;

const tricklesForever: Handler = (req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  const drip = setInterval(() => res.write('<p>'), 50);
  req.on('close', () => clearInterval(drip));
};

const deadlineClient = () =>
  axios.create({
    adapter: withScraperFetchDeadline(axios.getAdapter('http'), {
      overallDeadlineMs: () => TEST_DEADLINE_MS,
    }),
  });

const failedOnOverallDeadline = (error: unknown): boolean =>
  error instanceof AxiosError &&
  error.code === AxiosError.ETIMEDOUT &&
  error.message.includes('overall deadline');

async function settleWithin<T>(work: Promise<T>): Promise<{ elapsedMs: number; error: unknown }> {
  const startedAt = Date.now();
  try {
    await work;
    return { elapsedMs: Date.now() - startedAt, error: undefined };
  } catch (error) {
    return { elapsedMs: Date.now() - startedAt, error };
  }
}

describe('the scraper fetch deadline constants', () => {
  it('match the documented connect, read and overall bounds', () => {
    expect(SCRAPER_FETCH_CONNECT_TIMEOUT_MS).toBe(15_000);
    expect(SCRAPER_FETCH_READ_TIMEOUT_MS).toBe(30_000);
    expect(SCRAPER_FETCH_OVERALL_DEADLINE_MS).toBe(90_000);
  });

  it('replaces a missing or infinite read timeout with the documented 30 s default', () => {
    expect(scraperFetchReadTimeoutMs(undefined)).toBe(30_000);
    expect(scraperFetchReadTimeoutMs(0)).toBe(30_000);
    expect(scraperFetchReadTimeoutMs(Number.POSITIVE_INFINITY)).toBe(30_000);
    expect(scraperFetchReadTimeoutMs(20_000)).toBe(20_000);
  });

  it('gives a lane with a longer documented read timeout the 15 s connect budget on top', () => {
    expect(scraperFetchOverallDeadlineMs(30_000)).toBe(90_000);
    expect(scraperFetchOverallDeadlineMs(80_000)).toBe(95_000);
    expect(scraperFetchOverallDeadlineMs(120_000)).toBe(135_000);
  });
});

describe('withScraperFetchDeadline', () => {
  it('fails a request to a server that never responds within the overall deadline', async () => {
    const url = await serve(neverResponds);

    const { elapsedMs, error } = await settleWithin(deadlineClient().get(url));

    expect(failedOnOverallDeadline(error)).toBe(true);
    expect((error as AxiosError).code).toBe(AxiosError.ETIMEDOUT);
    expect(elapsedMs).toBeLessThan(TEST_DEADLINE_MS + BOUND_SLACK_MS);
  }, 5_000);

  it('ends a body that trickles forever even though every byte resets the read timeout', async () => {
    const url = await serve(tricklesForever);

    const { elapsedMs, error } = await settleWithin(deadlineClient().get(url, { timeout: 4_000 }));

    expect(failedOnOverallDeadline(error)).toBe(true);
    expect(elapsedMs).toBeLessThan(TEST_DEADLINE_MS + BOUND_SLACK_MS);
  }, 5_000);

  it('still returns a normal fast response', async () => {
    const url = await serve((_req, res) => res.end('<html>ok</html>'));

    const response = await deadlineClient().get(url);

    expect(response.status).toBe(200);
    expect(response.data).toBe('<html>ok</html>');
  });

  it('applies the default read timeout to a request that set none', async () => {
    const seen: unknown[] = [];
    const recordTimeout: AxiosAdapter = async (config) => {
      seen.push(config.timeout);
      return { data: '', status: 200, statusText: 'OK', headers: {}, config };
    };

    await axios.create({ adapter: withScraperFetchDeadline(recordTimeout) }).get('http://x.test/');

    expect(seen).toEqual([SCRAPER_FETCH_READ_TIMEOUT_MS]);
  });

  it('leaves a caller cancellation a cancellation rather than a deadline', async () => {
    const url = await serve(neverResponds);
    const caller = new AbortController();
    setTimeout(() => caller.abort(), 50);

    const { error } = await settleWithin(deadlineClient().get(url, { signal: caller.signal }));

    expect(axios.isCancel(error)).toBe(true);
    expect(failedOnOverallDeadline(error)).toBe(false);
  }, 5_000);

  it('lets the Development write lease see a timed-out request settle', async () => {
    resetDevWriteProgressForTests();
    watchOutboundHttpProgress();
    const url = await serve(tricklesForever);
    const before = devWriteProgress().count;

    await settleWithin(deadlineClient().get(url, { timeout: 4_000 }));
    await new Promise((resolve) => setImmediate(resolve));

    expect(devWriteProgress().count).toBeGreaterThan(before);
  }, 5_000);
});

describe('the connect deadline', () => {
  it('fails an https request whose peer accepts TCP but never finishes the handshake', async () => {
    const address = await listen(net.createServer(() => undefined));
    const httpsAgent = new ConnectDeadlineHttpsAgent({ connectTimeoutMs: 200 });

    const { elapsedMs, error } = await settleWithin(
      axios.get(`https://${address}/`, { httpsAgent, timeout: 4_000 }),
    );

    expect((error as AxiosError).code).toBe('ETIMEDOUT');
    expect((error as Error).message).toMatch(/connect timeout/);
    expect(elapsedMs).toBeLessThan(200 + BOUND_SLACK_MS);
  }, 5_000);
});

describe('installScraperFetchDeadlines', () => {
  it('bounds every request on the instance and restores the adapter on detach', async () => {
    const instance = axios.create();
    const original = instance.defaults.adapter;
    const handle = installScraperFetchDeadlines(instance, {
      overallDeadlineMs: () => TEST_DEADLINE_MS,
    });
    const url = await serve(neverResponds);

    expect(installScraperFetchDeadlines(instance)).toBe(handle);
    const { error } = await settleWithin(instance.get(url));
    handle.detach();

    expect(failedOnOverallDeadline(error)).toBe(true);
    expect(instance.defaults.adapter).toBe(original);
  }, 5_000);

  it('leaves a per-request adapter that never reaches the network alone', async () => {
    const instance = axios.create();
    const handle = installScraperFetchDeadlines(instance);
    const reused: AxiosAdapter = async (config) => ({
      data: 'reused',
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    });

    const response = await instance.get('http://x.test/', { adapter: reused });
    handle.detach();

    expect(response.data).toBe('reused');
    expect(response.config.signal).toBeUndefined();
  });
});
