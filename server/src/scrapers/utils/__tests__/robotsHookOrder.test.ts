import fs from 'node:fs';
import path from 'node:path';
import axios, { type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { HostSlotLimiter } from '../hostThrottlePolicy';
import { MACHINE_API_HOSTS_EXEMPT_FROM_ROBOTS, RobotsDisallowedError } from '../robotsFetchHook';
import { installScraperFetchHooks } from '../scraperFetchHooks';

vi.mock('../../../utils/ssrfGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/ssrfGuard')>()),
  assertPublicHttpUrl: async (raw: string) => new URL(raw),
  ssrfSafeAgents: () => ({}),
}));

const slotsTaken: string[] = [];
const recordingLimiter: HostSlotLimiter = {
  acquire: async (host) => {
    slotsTaken.push(host);
    return () => undefined;
  },
};

const sent: string[] = [];
const stubNetwork: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
  sent.push(new URL(String(config.url)).pathname);
  return { data: 'page', status: 200, statusText: 'OK', headers: {}, config };
};

let originalAdapter: typeof axios.defaults.adapter;

beforeAll(() => {
  originalAdapter = axios.defaults.adapter;
  axios.defaults.adapter = stubNetwork;
  installScraperFetchHooks({
    hostSlotLimiter: recordingLimiter,
    validatorCache: false,
    robotsTxtFetcher: async () => ({ status: 200, body: 'User-agent: *\nDisallow: /private/\n' }),
  });
});

afterAll(() => {
  axios.defaults.adapter = originalAdapter;
});

describe('the robots.txt hook runs before the host budget (#6213)', () => {
  it('refuses a disallowed path before it takes a host slot', async () => {
    const failure = await axios.get('https://ordered.example.edu/private/page').catch((e) => e);

    expect(failure).toBeInstanceOf(RobotsDisallowedError);
    expect(slotsTaken).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('lets an allowed path take its slot as before', async () => {
    await axios.get('https://ordered.example.edu/public/page');

    expect(slotsTaken).toEqual(['ordered.example.edu']);
    expect(sent).toEqual(['/public/page']);
  });
});

const SERVER_SRC = path.resolve(__dirname, '../../..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

describe('every machine API host the scrapers call is exempt from robots.txt (#6338 review)', () => {
  it('lists each https://api. host named in the scraper, script and service sources', () => {
    const named = new Set<string>();
    for (const root of ['scrapers', 'scripts', 'services']) {
      for (const file of sourceFiles(path.join(SERVER_SRC, root))) {
        for (const match of fs
          .readFileSync(file, 'utf8')
          .matchAll(/https:\/\/(api\.[a-z0-9.-]+)/g)) {
          named.add(match[1].replace(/\.$/, ''));
        }
      }
    }
    const missing = [...named].filter((host) => !MACHINE_API_HOSTS_EXEMPT_FROM_ROBOTS.has(host));
    expect(missing).toEqual([]);
  });
});
