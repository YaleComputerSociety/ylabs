import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import axios, { type AxiosAdapter } from 'axios';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HostSlotLimiter } from '../hostConcurrencyLimiter';
import { installScraperFetchHooks } from '../scraperFetchHooks';
import { isSweepPageReuseHit } from '../sweepPageReuseHit';

let sent = 0;

const stubNetwork: AxiosAdapter = async (config) => {
  sent += 1;
  return {
    data: '<html><body>synthetic live page</body></html>',
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'text/html; charset=utf-8', etag: '"v1"' },
    config,
    request: {},
  };
};

const openLimiter: HostSlotLimiter = { acquire: async () => () => undefined };

let workDir: string;
let savedEnv: NodeJS.ProcessEnv;

beforeAll(async () => {
  savedEnv = { ...process.env };
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ylabs-fetch-hooks-liveness-'));
  process.env.SCRAPER_HTTP_CACHE = 'on';
  process.env.SCRAPER_HTTP_CACHE_DIR = path.join(workDir, 'cache');
  axios.defaults.adapter = stubNetwork;
});

afterAll(async () => {
  process.env = savedEnv;
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('installScraperFetchHooks with validatorCache: false', () => {
  it('asks the host every time, even after a later default install, so a dead page never reads alive', async () => {
    installScraperFetchHooks({ validatorCache: false, hostSlotLimiter: openLimiter });
    installScraperFetchHooks();
    const url = 'https://liveness-fixture.invalid/page';

    await axios.get(url);
    const second = await axios.get(url);

    expect(isSweepPageReuseHit(second.config)).toBe(false);
    expect(sent).toBe(2);
    expect(await fs.readdir(process.env.SCRAPER_HTTP_CACHE_DIR!).catch(() => [])).toEqual([]);
  });
});
