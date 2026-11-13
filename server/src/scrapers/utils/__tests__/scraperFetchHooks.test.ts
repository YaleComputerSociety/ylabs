import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import axios, { AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HostSlotLimiter } from '../hostConcurrencyLimiter';
import { HOST_BUDGET_EXEMPT } from '../hostBudgetExempt';
import { installScraperFetchHooks } from '../scraperFetchHooks';
import { SCRAPER_USER_AGENT } from '../scraperUserAgent';
import { isSweepPageReuseHit } from '../sweepPageReuseHit';

const sent: InternalAxiosRequestConfig[] = [];
const slotsTaken: string[] = [];

const recordingLimiter: HostSlotLimiter = {
  async acquire(host) {
    slotsTaken.push(host);
    return () => undefined;
  },
};

const stubNetwork: AxiosAdapter = async (config) => {
  sent.push(config);
  return {
    data: '<html><body>synthetic page</body></html>',
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'text/html; charset=utf-8', etag: '"v1"' },
    config,
    request: {},
  };
};

const requestInterceptorCount = (): number =>
  (axios.interceptors.request as unknown as { handlers: Array<unknown | null> }).handlers.filter(
    Boolean,
  ).length;

let workDir: string;
let requestLogPath: string;
let savedEnv: NodeJS.ProcessEnv;

const requestLogLines = async (): Promise<string[]> =>
  (await fs.readFile(requestLogPath, 'utf8').catch(() => '')).split('\n').filter(Boolean);

const sentUserAgent = (config: InternalAxiosRequestConfig): unknown =>
  AxiosHeaders.from(config.headers).get('User-Agent');

beforeAll(async () => {
  savedEnv = { ...process.env };
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ylabs-fetch-hooks-'));
  requestLogPath = path.join(workDir, 'requests.jsonl');
  process.env.SCRAPER_HTTP_CACHE = 'on';
  process.env.SCRAPER_HTTP_CACHE_DIR = path.join(workDir, 'cache');
  process.env.SCRAPER_REQUEST_LOG = requestLogPath;
  axios.defaults.adapter = stubNetwork;
  installScraperFetchHooks({ hostSlotLimiter: recordingLimiter });
});

afterAll(async () => {
  process.env = savedEnv;
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('installScraperFetchHooks', () => {
  it('installs each hook once however often it is called', () => {
    const interceptors = requestInterceptorCount();
    const adapter = axios.defaults.adapter;

    installScraperFetchHooks();
    installScraperFetchHooks({ hostSlotLimiter: recordingLimiter });

    expect(interceptors).toBe(3);
    expect(requestInterceptorCount()).toBe(interceptors);
    expect(axios.defaults.adapter).toBe(adapter);
  });

  it('answers a reused body before the host budget, so it takes no slot and logs no request', async () => {
    const url = 'https://hooks-fixture.invalid/reused';

    const first = await axios.get(url);
    const firstCounts = {
      sent: sent.length,
      slots: slotsTaken.length,
      logged: (await requestLogLines()).length,
    };
    const second = await axios.get(url);

    expect(isSweepPageReuseHit(first.config)).toBe(false);
    expect(firstCounts).toEqual({ sent: 1, slots: 1, logged: 1 });
    expect(isSweepPageReuseHit(second.config)).toBe(true);
    expect(second.data).toBe(first.data);
    expect({
      sent: sent.length,
      slots: slotsTaken.length,
      logged: (await requestLogLines()).length,
    }).toEqual(firstCounts);
  });

  it("sends the scraper User-Agent in place of a caller's own", async () => {
    await axios.get('https://hooks-fixture.invalid/spoofed', {
      headers: { 'user-agent': 'Mozilla/5.0 (fixture browser)' },
    });

    expect(sentUserAgent(sent.at(-1)!)).toBe(SCRAPER_USER_AGENT);
  });

  it('leaves a model API call out of the host budget', async () => {
    const slots = slotsTaken.length;

    await axios.post(
      'https://model-fixture.invalid/v1/chat',
      {},
      { timeout: 1_000, ...HOST_BUDGET_EXEMPT },
    );

    expect(sent.at(-1)?.url).toBe('https://model-fixture.invalid/v1/chat');
    expect(slotsTaken.length).toBe(slots);
  });

  it('detaches the validator cache when a later caller refuses it', async () => {
    const url = 'https://hooks-fixture.invalid/refused-later';
    await axios.get(url);
    const before = sent.length;

    installScraperFetchHooks({ validatorCache: false });
    const again = await axios.get(url);

    expect(isSweepPageReuseHit(again.config)).toBe(false);
    expect(sent.length).toBe(before + 1);
  });
});
